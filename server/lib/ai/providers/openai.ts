/**
 * Adaptador OpenAI.
 *
 * ── Por que HTTP cru, e não o SDK ────────────────────────────────────────
 *
 * Duas razões, e a segunda é a que decide.
 *
 * A primeira é dependência: o servidor já carrega dois SDKs, e um terceiro
 * para falar um protocolo que é um POST com JSON não se paga.
 *
 * A segunda é TESTABILIDADE. O requisito desta fase é que nenhum teste toque a
 * rede. Com um SDK, o ponto de interceptação é a instância do cliente, que
 * nasce dentro do módulo e precisa ser espionada por macaco-patch. Com um
 * `fetch` injetado, a costura é um PARÂMETRO: `criarOpenAIProvider({ transporte
 * })` devolve um provedor idêntico ao de produção, e o teste passa a função que
 * quiser. O provedor exportado por padrão usa o `fetch` global — e esse é o
 * único lugar do arquivo onde a rede existe.
 *
 * ── Nativas usadas ───────────────────────────────────────────────────────
 *
 * Saída estruturada (`response_format: json_schema`) e cache de prefixo
 * IMPLÍCITO — a OpenAI cacheia prefixos automaticamente e reporta o acerto em
 * `usage.prompt_tokens_details.cached_tokens`; não há controle no nível da
 * requisição, e é por isso que `supports('contextCache')` é false aqui e true
 * na Anthropic. Ver o comentário de capacidades em `types.ts`: a pergunta é
 * "existe controle nativo?", não "funciona?".
 *
 * `strict: true` NÃO é usado. Ele exige `additionalProperties: false` e todas
 * as chaves em `required` em todo nível do schema, e os schemas deste servidor
 * não são escritos assim. Sem `strict`, a forma é forte mas não garantida — e é
 * exatamente para isso que `runCompletion` valida e faz uma tentativa de
 * reparo, marcando `repaired: true`. O número de reparos passa a ser o dado
 * honesto sobre este provedor.
 */
import {
  OverloadedError,
  ProviderError,
  RateLimitError,
  type Capability,
  type CompletionRequest,
  type CompletionUsage,
  type Provider,
} from '../types';
import { parseRetryAfter, requireApiKey, runCompletion, type RawInvocation } from './shared';

/** A única porta para a rede. Injetável — ver o cabeçalho. */
export type Transporte = (url: string, init: RequestInit) => Promise<Response>;

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

/**
 * Janelas de contexto, em tokens.
 *
 * Os IDs aqui são o que a documentação da OpenAI publicava quando este
 * adaptador foi escrito, e nenhum deles foi verificado contra a API — esta fase
 * proíbe chamada real. Trocar de modelo é editar `config.ts`; este mapa existe
 * só para o janelamento não chutar. O fallback erra para BAIXO de propósito:
 * janelar demais desperdiça contexto, janelar de menos estoura em produção.
 */
const CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4.1': 1_000_000,
  'gpt-4.1-mini': 1_000_000,
  'gpt-4.1-nano': 1_000_000,
};

const FALLBACK_CONTEXT_TOKENS = 128_000;

interface RespostaOpenAI {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string; type?: string };
}

/** Traduz o corpo de erro da OpenAI para os erros desta camada. */
function comoErro(model: string, status: number, corpo: unknown, retryAfter: string | null) {
  const mensagem =
    (corpo as RespostaOpenAI | undefined)?.error?.message?.slice(0, 200) ?? `HTTP ${status}`;

  if (status === 429) {
    /*
     * A OpenAI distingue cota por minuto de saldo esgotado pelo `type`. Saldo
     * esgotado é o análogo do `perDay` do Google: não reabre esperando, e cada
     * tentativa a mais só gasta tempo antes do mesmo erro. Ver RateLimitError.
     */
    const semSaldo = (corpo as RespostaOpenAI | undefined)?.error?.type === 'insufficient_quota';
    return new RateLimitError(
      'openai',
      model,
      `cota estourada (429): ${mensagem}`,
      parseRetryAfter(retryAfter),
      corpo,
      semSaldo,
    );
  }
  if (status >= 500) {
    return new OverloadedError(
      'openai',
      model,
      `provedor sobrecarregado (${status}): ${mensagem}`,
      parseRetryAfter(retryAfter),
      corpo,
    );
  }
  return new ProviderError('openai', model, mensagem, corpo);
}

/**
 * O prefixo cacheável NÃO ganha marcação aqui.
 *
 * `runCompletion` já o colocou no início da primeira mensagem de usuário, que é
 * onde o cache implícito da OpenAI casa. `cacheablePrefixLength` chega no
 * `invocation` e é ignorado de propósito: não há campo de protocolo para ele.
 */
function montarMensagens(invocation: RawInvocation) {
  return [
    { role: 'system' as const, content: invocation.system },
    ...invocation.messages.map((m) => ({ role: m.role, content: m.content })),
  ];
}

function normalizarUso(resposta: RespostaOpenAI): CompletionUsage {
  const cached = resposta.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    // `prompt_tokens` da OpenAI JÁ INCLUI os tokens servidos de cache — ao
    // contrário da Anthropic, onde é preciso somar. A convenção normalizada
    // desta camada (ver pricing.ts) é justamente "inputTokens inclui tudo".
    inputTokens: resposta.usage?.prompt_tokens ?? 0,
    outputTokens: resposta.usage?.completion_tokens ?? 0,
    ...(cached > 0 ? { cachedInputTokens: cached } : {}),
  };
}

export interface OpcoesOpenAI {
  /** A porta para a rede. O padrão é o `fetch` global. */
  transporte?: Transporte;
  /** A chave. O padrão lê `OPENAI_API_KEY` na hora da chamada, não na importação. */
  apiKey?: () => string;
  /** Sobrescreve o endereço — para um proxy corporativo, ou um servidor falso. */
  endpoint?: string;
}

export function criarOpenAIProvider(opcoes: OpcoesOpenAI = {}): Provider {
  const transporte: Transporte = opcoes.transporte ?? ((url, init) => fetch(url, init));
  const lerChave = opcoes.apiKey ?? (() => requireApiKey('openai', 'OPENAI_API_KEY'));
  const endpoint = opcoes.endpoint ?? ENDPOINT;

  return {
    id: 'openai',

    supports(capability: Capability): boolean {
      switch (capability) {
        case 'structuredOutput':
          return true;
        case 'contextCache':
          // Existe cache, e ele é reportado — mas não há controle no nível da
          // requisição. Ver o cabeçalho.
          return false;
        case 'extendedThinking':
          // Os modelos de raciocínio da OpenAI expõem `reasoning_effort`, que
          // é outra coisa: não há orçamento de pensamento por requisição como
          // na Anthropic. Ligar isto exige decidir a família de modelos
          // primeiro — ver o README da fase.
          return false;
      }
    },

    maxContextTokens(model: string): number {
      return CONTEXT_WINDOWS[model] ?? FALLBACK_CONTEXT_TOKENS;
    },

    async complete(model: string, req: CompletionRequest) {
      return runCompletion(
        'openai',
        model,
        req,
        { nativeStructuredOutput: true },
        async (invocation) => {
          const corpo = {
            model,
            messages: montarMensagens(invocation),
            max_completion_tokens: invocation.maxTokens,
            ...(invocation.jsonSchema
              ? {
                  response_format: {
                    type: 'json_schema' as const,
                    json_schema: {
                      name: 'resposta',
                      schema: invocation.jsonSchema,
                    },
                  },
                }
              : {}),
          };

          let resposta: Response;
          try {
            resposta = await transporte(endpoint, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${lerChave()}`,
              },
              body: JSON.stringify(corpo),
            });
          } catch (erro) {
            if (erro instanceof ProviderError) throw erro;
            // Falha de rede (DNS, socket, timeout) não é resposta do provedor:
            // não há status para classificar, e repetir não tem por que ajudar.
            throw new ProviderError('openai', model, `falha de rede: ${(erro as Error).message}`, erro);
          }

          const texto = await resposta.text();
          let dados: RespostaOpenAI;
          try {
            dados = texto ? (JSON.parse(texto) as RespostaOpenAI) : {};
          } catch {
            throw new ProviderError('openai', model, `resposta não é JSON: ${texto.slice(0, 200)}`);
          }

          if (!resposta.ok) {
            throw comoErro(model, resposta.status, dados, resposta.headers.get('retry-after'));
          }

          const escolha = dados.choices?.[0];
          if (escolha?.finish_reason === 'content_filter') {
            throw new ProviderError('openai', model, 'requisição recusada pelos filtros de conteúdo.');
          }

          return { text: escolha?.message?.content ?? '', usage: normalizarUso(dados) };
        },
      );
    },
  };
}

/** O provedor de produção: `fetch` global e chave do ambiente. */
export const openaiProvider: Provider = criarOpenAIProvider();
