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
  ProviderError,
  type CompletionMessage,
  type CompletionRequest,
  type CompletionResult,
  type CompletionUsage,
  type JsonSchema,
  type ProviderId,
} from '../types';

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
  options: { nativeStructuredOutput: boolean },
  invoke: RawInvoke,
): Promise<CompletionResult> {
  const startedAt = Date.now();

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

  const first = await invoke(base);
  let usage = addUsage(EMPTY_USAGE, first.usage);

  if (!req.jsonSchema) {
    return {
      text: first.text,
      usage,
      meta: { provider, model, latencyMs: Date.now() - startedAt, repaired: false },
    };
  }

  const firstCheck = parseAndValidate(first.text, req.jsonSchema);
  if (firstCheck.ok) {
    return {
      text: first.text,
      parsed: firstCheck.value,
      usage,
      meta: { provider, model, latencyMs: Date.now() - startedAt, repaired: false },
    };
  }

  // Uma tentativa, não um laço. Provedor que não acerta a forma em duas
  // passadas é informação sobre o provedor, não problema pra insistir.
  const repair = await invoke({
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
    meta: { provider, model, latencyMs: Date.now() - startedAt, repaired: true },
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
