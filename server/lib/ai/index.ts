/**
 * Porta de entrada da camada de IA. Quem precisa de inferência chama
 * `complete(agent, req)` e nunca vê provedor, cliente ou nome de modelo.
 *
 * Trocar o provedor de um agente é editar `config.ts` ou exportar uma
 * variável de ambiente — nenhum outro arquivo muda.
 */
import { API_KEY_ENV_VAR, hasApiKey } from './availability';
import { AGENT_CONFIG, activeProviders, type MatrixEntry } from './config';
import { estimateCost, type CostBreakdown } from './pricing';
import { anthropicProvider } from './providers/anthropic';
import { googleProvider } from './providers/google';
import { mockProvider } from './providers/mock';
import { openaiProvider } from './providers/openai';
import { xaiProvider } from './providers/xai';
import {
  PROVIDER_IDS,
  ProviderError,
  type AgentName,
  type Capability,
  type CompletionRequest,
  type CompletionResult,
  type JsonSchema,
  type Provider,
  type ProviderId,
} from './types';

const PROVIDERS: Record<ProviderId, Provider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  google: googleProvider,
  xai: xaiProvider,
  mock: mockProvider,
};

export function getProvider(id: ProviderId): Provider {
  return PROVIDERS[id];
}

/** Resolve o agente para o provedor+modelo configurados agora. */
export function resolveAgent(agent: AgentName): { provider: Provider; model: string } {
  const { provider, model } = AGENT_CONFIG[agent];
  return { provider: PROVIDERS[provider], model };
}

export async function complete(
  agent: AgentName,
  req: CompletionRequest,
): Promise<CompletionResult> {
  const { provider, model } = resolveAgent(agent);
  return provider.complete(model, req);
}

/**
 * Inferência com FORMA garantida.
 *
 * A diferença para `complete` não é o schema — `CompletionRequest.jsonSchema`
 * já existe — e sim o que volta: aqui o valor já validado, tipado, em vez de
 * `result.parsed?: unknown` que todo chamador teria de estreitar por conta
 * própria. Isso importa porque `parsed` só é preenchido quando houve schema, e
 * um `as T` espalhado por cada chamada é a forma mais fácil de essa garantia
 * virar mentira.
 *
 * O `T` é uma afirmação de quem chama, e não uma prova: quem valida a FORMA é
 * `parseAndValidate`, contra o schema. Manter os dois juntos — schema e tipo —
 * na mesma chamada é o que impede que eles divirjam em silêncio.
 */
export async function completeStructured<T = unknown>(
  agent: AgentName,
  req: CompletionRequest & { jsonSchema: JsonSchema },
): Promise<{ value: T; result: CompletionResult }> {
  const result = await complete(agent, req);
  if (result.parsed === undefined) {
    // Inalcançável pelo caminho normal: `runCompletion` já teria levantado
    // ProviderError. Existe para o dia em que um adaptador novo esquecer de
    // passar por ele — melhor falhar aqui que devolver `undefined as T`.
    throw new ProviderError(
      result.meta.provider,
      result.meta.model,
      'resposta estruturada pedida, mas nada foi validado contra o schema.',
    );
  }
  return { value: result.parsed as T, result };
}

/** Janela de contexto do modelo deste agente — o janelamento da Fase 2
 *  consulta isto em vez de assumir um número. */
export function maxContextTokensFor(agent: AgentName): number {
  const { provider, model } = resolveAgent(agent);
  return provider.maxContextTokens(model);
}

export function supportsFor(agent: AgentName, capability: Capability): boolean {
  return resolveAgent(agent).provider.supports(capability);
}

/** Custo estimado de um resultado, a partir de `meta` + `usage`. */
export function costOf(result: CompletionResult): CostBreakdown | undefined {
  return estimateCost(result.meta.provider, result.meta.model, result.usage);
}

/**
 * Custo de uma execução da matriz. Difere de `estimateCost` num ponto: uma
 * configuração marcada `billing: 'free-tier'` custa zero mesmo que o modelo
 * tenha preço pago na tabela — que é o caso do `gemini-2.5-flash`, usado em
 * desenvolvimento no free tier e cobrado normalmente numa chave paga.
 *
 * O harness da Fase 8 deve somar por aqui, não por `estimateCost` direto,
 * senão reporta um custo que ninguém pagou.
 */
export function costForEntry(
  entry: MatrixEntry,
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number },
): CostBreakdown | undefined {
  if (entry.billing === 'free-tier') {
    return { inputUsd: 0, cachedInputUsd: 0, outputUsd: 0, totalUsd: 0, longContextTier: false };
  }
  return estimateCost(entry.provider, entry.model, usage);
}

export interface CapabilityRow {
  provider: ProviderId;
  structuredOutput: boolean;
  contextCache: boolean;
  extendedThinking: boolean;
}

/**
 * Quem suporta o quê, no sentido de "existe controle nativo no nível da
 * requisição". Capacidade false não quer dizer que o recurso não funcione:
 * quer dizer que o adaptador degrada em código ou depende de comportamento
 * automático do provedor. Ver o comentário de topo de cada adaptador.
 */
export function capabilityTable(): CapabilityRow[] {
  return PROVIDER_IDS.map((id) => {
    const provider = PROVIDERS[id];
    return {
      provider: id,
      structuredOutput: provider.supports('structuredOutput'),
      contextCache: provider.supports('contextCache'),
      extendedThinking: provider.supports('extendedThinking'),
    };
  });
}

/**
 * Falha cedo e alto se um provedor configurado estiver sem chave. A falta
 * das chaves dos provedores NÃO configurados é normal e não pode quebrar
 * nada — o objetivo é comparar os três sem ser obrigado a assinar os três.
 */
export function assertConfiguredProvidersHaveKeys(): void {
  const missing = activeProviders()
    .filter((id) => !hasApiKey(id))
    .map((id) => `${API_KEY_ENV_VAR[id]} (provedor ${id})`);

  if (missing.length > 0) {
    throw new Error(
      `Chave de API ausente para provedor configurado: ${missing.join(', ')}. ` +
        'Defina em server/.env.local — ver server/.env.example.',
    );
  }
}

export {
  API_KEY_ENV_VAR,
  describeSkips,
  hasApiKey,
  planMatrixRun,
} from './availability';
export type { RunPlan, SkippedEntry, SkippedProvider } from './availability';
export {
  AGENT_CONFIG,
  COMPARISON_MATRIX,
  DEFAULT_AGENT_CONFIG,
  activeDataPolicyWarning,
  activeProviders,
  agentConfigFor,
  cheapestProductionEntry,
  dataPolicyWarning,
  matrixEntryForModel,
  matrixFor,
  parseOverride,
  productionCandidates,
  usesContentForTraining,
} from './config';
export type { AgentModelConfig, Billing, DataPolicy, MatrixEntry, Tier } from './config';
export { PRICING, estimateCost, priceFor } from './pricing';
export type { CostBreakdown } from './pricing';
export * from './types';
