/**
 * O que os três adaptadores fazem igual: montar as mensagens (incluindo a
 * posição do `cacheablePrefix`), validar contra o `jsonSchema` e, quando
 * preciso, gastar UMA tentativa de reparo marcando `repaired: true`.
 *
 * Cada adaptador só implementa `RawInvoke` — a chamada crua ao provedor,
 * com `usage` já normalizado. Nada de laço de reparo duplicado três vezes:
 * se o protocolo de reparo variasse por provedor, a flag `repaired` deixaria
 * de ser comparável, que é justamente pra isso que ela existe.
 */
import { parseAndValidate, repairInstruction, schemaInstruction } from '../jsonSchema';
import {
  OverloadedError,
  ProviderError,
  RateLimitError,
  type CompletionMessage,
  type CompletionRequest,
  type CompletionResult,
  type CompletionUsage,
  type JsonSchema,
  type ProviderId,
} from '../types';

// ---------------------------------------------------------------------------
// Espera por 429
// ---------------------------------------------------------------------------

/**
 * Uma geração completa faz de 20 a 30 chamadas (1 Analista + 9 Pensante +
 * N Auditor + 9 Escritor). Em free tier isso estoura limite por minuto com
 * facilidade, e sem espera a primeira geração morre no meio — parecendo bug
 * de lógica, que é o diagnóstico errado e caro.
 */
const DEFAULT_MAX_RATE_LIMIT_RETRIES = 5;
const BASE_BACKOFF_MS = 1_000;
/** Teto por espera. Sem ele, o expoente leva a esperas de dezenas de minutos. */
const MAX_BACKOFF_MS = 60_000;

export function maxRateLimitRetries(): number {
  const raw = process.env.DOCCITI_RATE_LIMIT_RETRIES;
  if (!raw?.trim()) return DEFAULT_MAX_RATE_LIMIT_RETRIES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`DOCCITI_RATE_LIMIT_RETRIES="${raw}" precisa ser um inteiro >= 0.`);
  }
  return parsed;
}

/** Exponencial com jitter. O jitter evita que 9 chamadas do Pensante que
 *  tomaram 429 juntas voltem todas no mesmo milissegundo. */
export function backoffDelayMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return Math.min(retryAfterMs, MAX_BACKOFF_MS);
  }
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Repete só o que se resolve esperando — 429 (cota) e 503 (sobrecarga do
 * provedor) — contando os dois SEPARADAMENTE, porque o diagnóstico é oposto:
 * 429 se resolve do nosso lado indo mais devagar, 503 não se resolve daqui.
 *
 * Erro que não é nenhum dos dois sobe na hora: repetir um 401 ou um schema
 * inválido dá o mesmo erro cinco vezes mais devagar.
 */
export async function withRateLimitRetry<T>(
  call: () => Promise<T>,
  options: { maxRetries?: number; onWait?: (ms: number) => Promise<void> | void } = {},
): Promise<{ value: T; rateLimitWaits: number; overloadWaits: number }> {
  const maxRetries = options.maxRetries ?? maxRateLimitRetries();
  const wait = options.onWait ?? sleep;

  let rateLimitWaits = 0;
  let overloadWaits = 0;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return { value: await call(), rateLimitWaits, overloadWaits };
    } catch (error) {
      const retryable = error instanceof RateLimitError || error instanceof OverloadedError;
      if (!retryable || attempt >= maxRetries) throw error;
      await wait(backoffDelayMs(attempt, error.retryAfterMs));
      if (error instanceof RateLimitError) rateLimitWaits += 1;
      else overloadWaits += 1;
    }
  }
}

/** Lê `retry-after` (segundos, ou data HTTP) em milissegundos. */
export function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

export interface RawInvocation {
  system: string;
  messages: CompletionMessage[];
  maxTokens: number;
  /** Presente só quando o provedor tem saída estruturada NATIVA. Quando
   *  não tem, o schema já foi injetado em `system` e isto vem indefinido. */
  jsonSchema?: JsonSchema;
  /** Já embutido em `messages[0]`; repetido aqui porque o adaptador da
   *  Anthropic precisa saber onde marcar o breakpoint explícito de cache. */
  cacheablePrefixLength?: number;
}

export type RawInvoke = (invocation: RawInvocation) => Promise<{
  text: string;
  usage: CompletionUsage;
}>;

const EMPTY_USAGE: CompletionUsage = { inputTokens: 0, outputTokens: 0 };

function addUsage(a: CompletionUsage, b: CompletionUsage): CompletionUsage {
  const cached = (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0);
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(a.cachedInputTokens !== undefined || b.cachedInputTokens !== undefined
      ? { cachedInputTokens: cached }
      : {}),
  };
}

/**
 * O prefixo cacheável vai no INÍCIO da primeira mensagem de usuário, e não
 * no system. Motivo: todo cache de prefixo casa por bytes desde o começo do
 * prompt renderizado, e o system é o lugar onde conteúdo volátil (guidance
 * de seção, instrução de reparo) entra. Prefixo estável primeiro, volátil
 * depois — vale igual para o cache explícito da Anthropic e para o implícito
 * do Google e da xAI.
 */
function withCacheablePrefix(
  messages: CompletionMessage[],
  cacheablePrefix: string | undefined,
): { messages: CompletionMessage[]; prefixLength?: number } {
  if (!cacheablePrefix) return { messages };

  const first = messages[0];
  if (!first || first.role !== 'user') {
    return {
      messages: [{ role: 'user', content: cacheablePrefix }, ...messages],
      prefixLength: cacheablePrefix.length,
    };
  }
  const merged = `${cacheablePrefix}\n\n${first.content}`;
  return {
    messages: [{ role: 'user', content: merged }, ...messages.slice(1)],
    prefixLength: cacheablePrefix.length,
  };
}

export async function runCompletion(
  provider: ProviderId,
  model: string,
  req: CompletionRequest,
  options: { nativeStructuredOutput: boolean; maxRateLimitRetries?: number },
  invoke: RawInvoke,
): Promise<CompletionResult> {
  const startedAt = Date.now();
  let rateLimitWaits = 0;
  let overloadWaits = 0;

  // Cada chamada ao provedor (a primeira e a de reparo) tem seu próprio laço
  // de espera; as esperas somam nos mesmos contadores.
  const invokeWithRetry = async (invocation: RawInvocation) => {
    const result = await withRateLimitRetry(() => invoke(invocation), {
      ...(options.maxRateLimitRetries !== undefined
        ? { maxRetries: options.maxRateLimitRetries }
        : {}),
    });
    rateLimitWaits += result.rateLimitWaits;
    overloadWaits += result.overloadWaits;
    return result.value;
  };

  const needsPromptedSchema = req.jsonSchema !== undefined && !options.nativeStructuredOutput;
  const system = needsPromptedSchema
    ? `${req.system}\n\n${schemaInstruction(req.jsonSchema!)}`
    : req.system;

  const { messages, prefixLength } = withCacheablePrefix(req.messages, req.cacheablePrefix);

  const base: RawInvocation = {
    system,
    messages,
    maxTokens: req.maxTokens,
    ...(options.nativeStructuredOutput && req.jsonSchema ? { jsonSchema: req.jsonSchema } : {}),
    ...(prefixLength !== undefined ? { cacheablePrefixLength: prefixLength } : {}),
  };

  const first = await invokeWithRetry(base);
  let usage = addUsage(EMPTY_USAGE, first.usage);

  if (!req.jsonSchema) {
    return {
      text: first.text,
      usage,
      meta: { provider, model, latencyMs: Date.now() - startedAt, repaired: false, rateLimitWaits, overloadWaits },
    };
  }

  const firstCheck = parseAndValidate(first.text, req.jsonSchema);
  if (firstCheck.ok) {
    return {
      text: first.text,
      parsed: firstCheck.value,
      usage,
      meta: { provider, model, latencyMs: Date.now() - startedAt, repaired: false, rateLimitWaits, overloadWaits },
    };
  }

  // Uma tentativa, não um laço. Provedor que não acerta a forma em duas
  // passadas é informação sobre o provedor, não problema pra insistir.
  const repair = await invokeWithRetry({
    ...base,
    messages: [
      ...messages,
      { role: 'assistant', content: first.text },
      { role: 'user', content: repairInstruction(first.text, firstCheck.errors) },
    ],
  });
  usage = addUsage(usage, repair.usage);

  const secondCheck = parseAndValidate(repair.text, req.jsonSchema);
  if (!secondCheck.ok) {
    throw new ProviderError(
      provider,
      model,
      `resposta não satisfez o schema nem após reparo: ${secondCheck.errors.join('; ')}`,
    );
  }

  return {
    text: repair.text,
    parsed: secondCheck.value,
    usage,
    meta: { provider, model, latencyMs: Date.now() - startedAt, repaired: true, rateLimitWaits, overloadWaits },
  };
}

/** Lê uma chave de ambiente, com erro claro em vez de 401 opaco depois. */
export function requireApiKey(provider: ProviderId, envVar: string): string {
  const value = process.env[envVar];
  if (!value || !value.trim()) {
    throw new ProviderError(
      provider,
      '(sem modelo)',
      `${envVar} não está definida. Defina-a em server/.env.local — ver .env.example.`,
    );
  }
  return value.trim();
}
