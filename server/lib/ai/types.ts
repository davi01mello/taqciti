/**
 * CONTRATO ÚNICO de acesso a modelo. Nenhum outro arquivo do servidor
 * instancia cliente de provedor ou conhece nome de modelo — quem precisa
 * de inferência chama `complete(agent, req)` de `lib/ai/index.ts`.
 *
 * A abstração NÃO é `complete(system, messages) → string`. Essa assinatura
 * jogaria fora exatamente o que diferencia os provedores em custo e
 * qualidade: saída estruturada nativa, cache de contexto e raciocínio
 * estendido. O resultado seria comparar três provedores rodando todos no
 * modo mais burro de cada um.
 *
 * Em vez disso a interface declara CAPACIDADES, e o adaptador degrada em
 * código quando o provedor não tem a nativa. `supports()` responde "existe
 * controle nativo, no nível da requisição, para isto?" — não "isto
 * funciona?". `jsonSchema` sempre funciona nos três; o que varia é se o
 * provedor garante a forma ou se o adaptador precisou validar e reparar.
 */

export type ProviderId = 'anthropic' | 'google' | 'xai';

export const PROVIDER_IDS: readonly ProviderId[] = ['anthropic', 'google', 'xai'];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);
}

export type Capability = 'structuredOutput' | 'contextCache' | 'extendedThinking';

export type AgentName = 'analista' | 'pensante' | 'auditor' | 'escritor';

export const AGENT_NAMES: readonly AgentName[] = [
  'analista',
  'pensante',
  'auditor',
  'escritor',
];

export interface CompletionMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  system: string;
  messages: CompletionMessage[];
  maxTokens: number;
  /**
   * Quando presente, a resposta DEVE validar contra ele. O adaptador usa a
   * saída estruturada nativa quando existe; quando não existe, injeta o
   * schema no prompt, valida em código e faz UMA tentativa de reparo.
   */
  jsonSchema?: JsonSchema;
  /**
   * Conteúdo estável reaproveitado entre chamadas. Vai sempre no INÍCIO da
   * primeira mensagem de usuário, porque todo cache de prefixo — explícito
   * (Anthropic) ou implícito (Google, xAI) — casa por prefixo. É otimização
   * opcional: o resultado é o mesmo com ou sem, o custo não. É justamente
   * essa diferença que o harness da Fase 8 vai medir.
   */
  cacheablePrefix?: string;
}

export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
  /** Parte de `inputTokens` que veio de cache. Ausente = provedor não reportou. */
  cachedInputTokens?: number;
}

export interface CompletionMeta {
  provider: ProviderId;
  model: string;
  latencyMs: number;
  /**
   * true = a primeira resposta não validou contra `jsonSchema` e foi
   * preciso uma segunda chamada pra consertar. É dado de comparação, não
   * detalhe interno: provedor que repara sempre é provedor menos confiável.
   */
  repaired: boolean;
  /**
   * Quantas vezes esta chamada esperou por 429 antes de passar. Entra no
   * relatório porque é a diferença entre "o provedor é lento" e "o provedor
   * está estrangulando a sua cota" — e porque uma geração completa faz 20 a
   * 30 chamadas, então esperar sempre vira minutos de latência que nenhuma
   * outra métrica explica.
   */
  rateLimitWaits: number;
  /** Quantas vezes esperou por 503/sobrecarga do provedor. Ver OverloadedError. */
  overloadWaits: number;
}

export interface CompletionResult {
  text: string;
  /** Preenchido quando `jsonSchema` foi pedido e a validação passou. */
  parsed?: unknown;
  usage: CompletionUsage;
  meta: CompletionMeta;
}

export interface Provider {
  id: ProviderId;
  supports(capability: Capability): boolean;
  /** Janela de contexto do modelo, em tokens. O janelamento da Fase 2
   *  depende deste número — nada de constante hardcoded fora daqui. */
  maxContextTokens(model: string): number;
  complete(model: string, req: CompletionRequest): Promise<CompletionResult>;
}

/** Subconjunto de JSON Schema que os três provedores aceitam. */
export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  description?: string;
  additionalProperties?: boolean;
  [key: string]: unknown;
}

/**
 * Erro de provedor com o suficiente pra debugar sem vazar chave.
 *
 * Campos declarados e atribuídos à mão em vez de parameter properties: essa
 * açúcar sintático não é apagável, e quebra o type-stripping nativo do Node
 * se algum dia um teste rodar este arquivo direto, sem passar pelo build.
 */
export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly model: string;
  readonly detail: unknown;

  constructor(provider: ProviderId, model: string, message: string, detail?: unknown) {
    super(`[${provider}/${model}] ${message}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.model = model;
    this.detail = detail;
  }
}

/**
 * 429 — cota estourada. Subclasse própria porque é o único erro que vale a
 * pena repetir: os demais (401, 400, schema inválido) só se repetiriam
 * iguais. Cada adaptador traduz o 429 do seu provedor para isto, e o laço
 * de espera em providers/shared.ts é um só para os três.
 */
export class RateLimitError extends ProviderError {
  /** Do header `retry-after`, quando o provedor manda. Sem isso, backoff cego. */
  readonly retryAfterMs?: number;

  constructor(
    provider: ProviderId,
    model: string,
    message: string,
    retryAfterMs?: number,
    detail?: unknown,
  ) {
    super(provider, model, message, detail);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * 503 / UNAVAILABLE / overloaded — o provedor está sobrecarregado.
 *
 * Contado SEPARADAMENTE de 429 de propósito. Os dois se resolvem esperando,
 * mas o diagnóstico é oposto: 429 é "você está indo rápido demais" e se
 * resolve do nosso lado, 503 é "o provedor está sofrendo" e não se resolve
 * de jeito nenhum daqui. Somar os dois num contador só transformaria a
 * métrica em ruído justamente quando ela fosse útil.
 */
export class OverloadedError extends ProviderError {
  readonly retryAfterMs?: number;

  constructor(
    provider: ProviderId,
    model: string,
    message: string,
    retryAfterMs?: number,
    detail?: unknown,
  ) {
    super(provider, model, message, detail);
    this.name = 'OverloadedError';
    this.retryAfterMs = retryAfterMs;
  }
}
