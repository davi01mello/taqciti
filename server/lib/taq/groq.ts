/**
 * Adaptador de TURNO com ferramentas para o Groq — TEMPORÁRIO.
 *
 * Entrou em 2026-09-23 porque a cota grátis do Gemini não aguentava um dia de
 * teste do Taq. É só do Taq: o pipeline de geração (`lib/ai/`) não conhece o
 * Groq, e `ProviderId` continua sem ele. Para tirar: apagar este arquivo, a
 * linha de `groq` em `config.ts` e a de `app/api/taq/turno/route.ts`.
 *
 * O Groq fala o formato da OpenAI (`/openai/v1/chat/completions`), com
 * `tools` e `tool_calls`. Por isso é `fetch` puro, sem SDK: o formato é
 * pequeno, e um SDK a mais no servidor para uma peça temporária não se paga.
 *
 * Diferenças para o Gemini que importam aqui:
 *   - não há parte opaca para devolver: nada de `continuacao`;
 *   - os ids das chamadas vêm sempre, e voltam no `tool_call_id`;
 *   - o contexto entra como um bloco antes da primeira mensagem da pessoa, na
 *     mesma mensagem — no sistema ele se misturaria às instruções.
 */
import { OverloadedError, ProviderError, RateLimitError, type ProviderId } from '@/lib/ai/types';
import type { ChamadaDeFerramenta, MensagemDoTurno } from './contrato';
import { ErroDeLentidao, type AdaptadorDeTurno } from './gemini';

const URL_DO_GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const TEMPO_MAXIMO_MS = 50_000;
/**
 * A cota grátis é de 8 mil tokens POR MINUTO, e uma pergunta ao Taq gasta ~6
 * mil em duas chamadas (medido em 2026-09-23). O Groq diz quanto esperar; se
 * for pouco, espera-se aqui e tenta-se UMA vez mais, dentro do prazo da rota
 * (`maxDuration` 60 s), em vez de devolver o erro para a extensão.
 */
const ESPERA_MAXIMA_MS = 20_000;

/**
 * O `gpt-oss` cita com colchetes de outra família — `【r2】`, às vezes
 * `【r2†L1-L3】`. Sem isto a extensão não reconhece a referência e a fonte some.
 */
function normalizarCitacoes(texto: string): string {
  return texto.replace(/【\s*(r\d+(?:\s*[,;]\s*r\d+)*)[^】]*】/g, '[$1]');
}

function esperar(ms: number, sinal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (sinal.aborted) return reject(sinal.reason);
    const t = setTimeout(() => {
      sinal.removeEventListener('abort', aoAbortar);
      resolve();
    }, ms);
    const aoAbortar = () => {
      clearTimeout(t);
      reject(sinal.reason);
    };
    sinal.addEventListener('abort', aoAbortar, { once: true });
  });
}

/**
 * Os erros tipados de `lib/ai/types` pedem um `ProviderId`, e o Groq não é um
 * (ver o cabeçalho). O rótulo só aparece na mensagem; quem decide o código do
 * erro é a CLASSE (`atender.ts`). Conversão pontual, e some junto com o arquivo.
 */
const GROQ = 'groq' as unknown as ProviderId;

type MensagemOpenAI =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    }
  | { role: 'tool'; tool_call_id: string; content: string };

/** Converte o histórico neutro no formato da OpenAI. Exportado para teste. */
export function paraMensagensOpenAI(
  sistema: string,
  contexto: string,
  mensagens: MensagemDoTurno[],
): MensagemOpenAI[] {
  const saida: MensagemOpenAI[] = [{ role: 'system', content: sistema }];
  let contextoPendente = contexto.trim();
  for (const m of mensagens) {
    if (m.papel === 'pessoa') {
      const texto = contextoPendente ? `${contextoPendente}\n\n---\n\n${m.texto}` : m.texto;
      contextoPendente = '';
      saida.push({ role: 'user', content: texto });
    } else if (m.papel === 'modelo') {
      saida.push({
        role: 'assistant',
        content: m.texto || null,
        ...(m.chamadas.length
          ? {
              tool_calls: m.chamadas.map((c) => ({
                id: c.id,
                type: 'function' as const,
                function: { name: c.nome, arguments: JSON.stringify(c.argumentos) },
              })),
            }
          : {}),
      });
    } else {
      for (const r of m.resultados) {
        saida.push({ role: 'tool', tool_call_id: r.chamadaId, content: JSON.stringify(r.conteudo) });
      }
    }
  }
  return saida;
}

interface RespostaOpenAI {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function segundos(valor: string | null): number | undefined {
  const n = valor ? Number.parseFloat(valor) : NaN;
  return Number.isFinite(n) ? Math.ceil(n * 1000) : undefined;
}

/** A chamada de ferramenta gerada pelo modelo foi recusada pelo provedor. Repetir costuma passar. */
export class ErroDeChamadaDoModelo extends Error {
  constructor(modelo: string, mensagem: string) {
    super(`[groq/${modelo}] ${mensagem}`);
    this.name = 'ErroDeChamadaDoModelo';
  }
}

/** O erro HTTP do Groq, traduzido para as classes que `atender.ts` entende. */
async function erroDoGroq(modelo: string, resposta: Response): Promise<Error> {
  let mensagem = `HTTP ${resposta.status}`;
  try {
    const corpo = (await resposta.json()) as { error?: { message?: string } };
    if (corpo.error?.message) mensagem = corpo.error.message;
  } catch {
    /* corpo sem JSON: fica o status */
  }
  // `retry-after` quando vem; senão o "try again in 6.3s" da mensagem.
  const espera =
    segundos(resposta.headers.get('retry-after')) ??
    segundos(/try again in ([\d.]+)s/i.exec(mensagem)?.[1] ?? null);
  if (resposta.status === 429) {
    // O Groq diz qual cota estourou na mensagem: "... on tokens per day (TPD)"
    // ou "requests per day (RPD)". Por dia não se resolve esperando.
    const porDia = /per day|\b(TPD|RPD)\b/i.test(mensagem);
    return new RateLimitError(GROQ, modelo, mensagem, espera, undefined, porDia);
  }
  // O próprio Groq recusa a chamada de ferramenta que o modelo gerou fora do
  // schema ("tool call validation failed") ou quando não havia ferramenta
  // ("Tool choice is none"). Visto ao vivo: é sorteio do modelo, e repetir
  // costuma passar — então volta como transitório, não como falha final.
  if (resposta.status === 400 && /tool call validation failed|tool choice is none|failed to call a function/i.test(mensagem)) {
    return new ErroDeChamadaDoModelo(modelo, mensagem);
  }
  if (resposta.status === 503 || resposta.status === 502) {
    return new OverloadedError(GROQ, modelo, mensagem, espera);
  }
  return new ProviderError(GROQ, modelo, mensagem);
}

export function criarAdaptadorGroq(deps: {
  chave: () => string;
  fetch?: typeof fetch;
}): AdaptadorDeTurno {
  return {
    provedor: 'groq',

    async executar(modelo, pedido, sinal) {
      const prazo = AbortSignal.timeout(TEMPO_MAXIMO_MS);
      const sinais = sinal ? AbortSignal.any([sinal, prazo]) : prazo;

      const corpoDoPedido = JSON.stringify({
        model: modelo,
        messages: paraMensagensOpenAI(pedido.sistema, pedido.contexto, pedido.mensagens),
        max_completion_tokens: pedido.maxTokensDeSaida,
        ...(pedido.ferramentas.length
          ? {
              tools: pedido.ferramentas.map((f) => ({
                type: 'function',
                function: { name: f.nome, description: f.descricao, parameters: f.parametros },
              })),
              tool_choice: 'auto',
            }
          : {}),
      });
      const chamar = () =>
        (deps.fetch ?? fetch)(URL_DO_GROQ, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${deps.chave()}`,
            'content-type': 'application/json',
          },
          body: corpoDoPedido,
          signal: sinais,
        });

      let resposta: Response;
      try {
        resposta = await chamar();
        if (resposta.status === 429) {
          const erro = await erroDoGroq(modelo, resposta.clone());
          const ms = erro instanceof RateLimitError ? erro.retryAfterMs : undefined;
          if (erro instanceof RateLimitError && !erro.perDay && ms !== undefined && ms <= ESPERA_MAXIMA_MS) {
            await esperar(ms + 250, sinais);
            resposta = await chamar();
          }
        }
      } catch (error) {
        if (prazo.aborted && !sinal?.aborted) throw new ErroDeLentidao(modelo);
        throw error;
      }
      if (!resposta.ok) throw await erroDoGroq(modelo, resposta);

      const corpo = (await resposta.json()) as RespostaOpenAI;
      const escolha = corpo.choices?.[0];
      const texto = normalizarCitacoes(escolha?.message?.content ?? '');
      const chamadas: ChamadaDeFerramenta[] = [];
      for (const [i, c] of (escolha?.message?.tool_calls ?? []).entries()) {
        if (!c.function?.name) continue;
        let argumentos: Record<string, unknown> = {};
        try {
          const lidos: unknown = c.function.arguments ? JSON.parse(c.function.arguments) : {};
          if (lidos && typeof lidos === 'object' && !Array.isArray(lidos)) {
            argumentos = lidos as Record<string, unknown>;
          }
        } catch {
          // Argumento que não é JSON vai vazio: a extensão valida contra o
          // schema da ferramenta e devolve o erro ao modelo, que corrige.
        }
        chamadas.push({ id: c.id || `groq:${i + 1}`, nome: c.function.name, argumentos });
      }

      const motivo = escolha?.finish_reason ?? 'desconhecido';
      if (!texto && chamadas.length === 0) {
        throw new ProviderError(GROQ, modelo, `resposta vazia (finish_reason: ${motivo}).`);
      }
      return {
        tipo: chamadas.length ? 'ferramentas' : motivo === 'length' ? 'truncado' : 'final',
        texto,
        chamadas,
        uso: {
          entrada: corpo.usage?.prompt_tokens ?? 0,
          saida: corpo.usage?.completion_tokens ?? 0,
        },
        provedor: 'groq',
        modelo,
      };
    },
  };
}

/** O adaptador de produção. A chave é lida só aqui, no servidor. */
export const adaptadorGroq = criarAdaptadorGroq({
  chave: () => {
    const chave = process.env.GROQ_API_KEY?.trim();
    if (!chave) throw new ProviderError(GROQ, '(sem modelo)', 'GROQ_API_KEY não está definida.');
    return chave;
  },
});
