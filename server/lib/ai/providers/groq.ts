/**
 * Adaptador Groq, via `fetch` contra o endpoint compatível com OpenAI em
 * https://api.groq.com/openai/v1/chat/completions.
 *
 * O formato é o mesmo do adaptador da xAI, e por isso o `fetch` direto: não
 * vale um SDK por um endpoint. (O `lib/taq/groq.ts` é outra coisa — o adaptador
 * temporário do CHAT do Taq. Este é um provedor da camada de documentos.)
 *
 * ── O limite que manda aqui ────────────────────────────────────────────────
 *
 * O plano gratuito da Groq conta tokens por MINUTO (8.000 no `gpt-oss-120b`,
 * medido com a chave do projeto em 20/10/2026) e conta, por pedido, a ENTRADA
 * mais o `max_tokens` pedido — não o que de fato sai. O teto de saída que a
 * camada de documentos pede (48.000 no Leitor) estoura sozinho. Por isso este
 * adaptador:
 *
 *  1. estima a entrada e REDUZ o `max_tokens` para o pedido caber em
 *     `GROQ_TPM_LIMIT` (padrão 8000; suba num plano pago);
 *  2. recusa, com a conta na mensagem, o pedido cuja entrada sozinha já não
 *     cabe — em vez de mandar algo que a Groq vai devolver como 413;
 *  3. usa raciocínio `low` quando o orçamento é apertado: no `gpt-oss`, o
 *     raciocínio sai do mesmo `max_tokens` e, solto, comeria o JSON inteiro.
 *
 * Capacidades em false: o cache de prompt é automático e sem controle por
 * requisição, e o raciocínio é por `reasoning_effort` só nos modelos `gpt-oss`
 * (tratado abaixo, não anunciado como capacidade geral).
 */
import {
  OverloadedError,
  ProviderError,
  RateLimitError,
  type Capability,
  type CompletionRequest,
  type Provider,
} from '../types';
import { parseRetryAfter, requireApiKey, runCompletion } from './shared';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 600_000;

const CONTEXT_WINDOWS: Record<string, number> = {
  'openai/gpt-oss-120b': 131_072,
  'openai/gpt-oss-20b': 131_072,
};
const FALLBACK_CONTEXT_TOKENS = 131_072;

/** Tokens por minuto do plano. O gratuito do gpt-oss-120b é 8000. */
const LIMITE_PADRAO_TPM = 8000;
/** Sobra para o raciocínio e o JSON: abaixo disto a resposta sai truncada. */
const SAIDA_MINIMA = 1200;
/** A estimativa de tokens é por caractere; esta folga cobre o erro dela. */
const MARGEM_DA_ESTIMATIVA = 250;
/**
 * Português no tokenizador do gpt-oss: medido em 20/10/2026 com a transcrição
 * real e o prompt do Leitor, 3,77 caracteres por token. 3,5 fica do lado seguro.
 */
const CARACTERES_POR_TOKEN = 3.5;

export function limiteDeTokensPorMinuto(): number {
  const bruto = process.env.GROQ_TPM_LIMIT?.trim();
  const valor = bruto ? Number.parseInt(bruto, 10) : LIMITE_PADRAO_TPM;
  return Number.isFinite(valor) && valor > 0 ? valor : LIMITE_PADRAO_TPM;
}

export const estimarTokens = (...textos: string[]): number =>
  Math.ceil(textos.reduce((soma, t) => soma + t.length, 0) / CARACTERES_POR_TOKEN);

/**
 * O `max_tokens` que cabe no limite, dada a entrada. `null` = a entrada sozinha
 * já não deixa espaço para uma resposta útil.
 */
export function saidaQueCabe(entradaEstimada: number, pedido: number, limite: number): number | null {
  const sobra = limite - entradaEstimada - MARGEM_DA_ESTIMATIVA;
  if (sobra < SAIDA_MINIMA) return null;
  return Math.min(pedido, sobra);
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string };
}

export const groqProvider: Provider = {
  id: 'groq',

  supports(capability: Capability): boolean {
    switch (capability) {
      case 'structuredOutput':
        return true;
      case 'contextCache':
        return false;
      case 'extendedThinking':
        return false;
    }
  },

  maxContextTokens(model: string): number {
    return CONTEXT_WINDOWS[model] ?? FALLBACK_CONTEXT_TOKENS;
  },

  async complete(model: string, req: CompletionRequest) {
    return runCompletion('groq', model, req, { nativeStructuredOutput: true }, async (invocation) => {
      const apiKey = requireApiKey('groq', 'GROQ_API_KEY');
      const limite = limiteDeTokensPorMinuto();

      const entrada = estimarTokens(
        invocation.system,
        ...invocation.messages.map((m) => m.content),
        invocation.jsonSchema ? JSON.stringify(invocation.jsonSchema) : '',
      );
      const saida = saidaQueCabe(entrada, invocation.maxTokens, limite);
      if (saida === null) {
        throw new ProviderError(
          'groq',
          model,
          `o pedido tem cerca de ${entrada} tokens só de entrada e o limite da Groq é ${limite} por minuto: ` +
            `não sobra espaço para a resposta. Use um plano com limite maior (GROQ_TPM_LIMIT) ou outro provedor.`,
        );
      }

      const apertado = saida < 4000;
      const body = {
        model,
        max_tokens: saida,
        // Só o gpt-oss aceita; os outros modelos da Groq rejeitam o parâmetro.
        ...(model.includes('gpt-oss')
          ? { reasoning_effort: apertado ? 'low' : (req.reasoning ?? 'medium') }
          : {}),
        messages: [
          { role: 'system', content: invocation.system },
          ...invocation.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ],
        ...(invocation.jsonSchema
          ? {
              response_format: {
                type: 'json_schema' as const,
                // Sem `strict`, como no adaptador da xAI: o modo estrito exige
                // todo campo required, e os campos ausentes representam lacuna.
                json_schema: { name: 'resposta', schema: invocation.jsonSchema },
              },
            }
          : {}),
      };

      let response: Response;
      try {
        response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        throw new ProviderError('groq', model, `falha de rede: ${(error as Error).message}`, error);
      }

      const raw = await response.text();
      let payload: ChatCompletionResponse;
      try {
        payload = JSON.parse(raw) as ChatCompletionResponse;
      } catch {
        throw new ProviderError('groq', model, `HTTP ${response.status}, corpo não-JSON: ${raw.slice(0, 300)}`);
      }
      const mensagem = payload.error?.message ?? raw.slice(0, 300);

      if (response.status === 429) {
        // "tokens per day" / "requests per day": não se resolve esperando o minuto.
        const porDia = /per day|\bTPD\b|\bRPD\b/i.test(mensagem);
        throw new RateLimitError(
          'groq',
          model,
          `cota estourada (429): ${mensagem}`,
          parseRetryAfter(response.headers.get('retry-after')),
          undefined,
          porDia,
        );
      }

      if (response.status === 503 || response.status === 529) {
        throw new OverloadedError(
          'groq',
          model,
          `provedor sobrecarregado (${response.status}): ${mensagem}`,
          parseRetryAfter(response.headers.get('retry-after')),
        );
      }

      if (response.status === 413) {
        throw new ProviderError('groq', model, `pedido grande demais para o limite do plano (413): ${mensagem}`);
      }

      if (!response.ok) {
        throw new ProviderError('groq', model, `HTTP ${response.status}: ${mensagem}`);
      }

      const text = payload.choices?.[0]?.message?.content;
      if (typeof text !== 'string') {
        const reason = payload.choices?.[0]?.finish_reason ?? 'desconhecido';
        throw new ProviderError('groq', model, `resposta sem conteúdo (finish_reason: ${reason}).`);
      }

      return {
        text,
        usage: {
          inputTokens: payload.usage?.prompt_tokens ?? 0,
          outputTokens: payload.usage?.completion_tokens ?? 0,
          cachedInputTokens: payload.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        },
      };
    });
  },
};
