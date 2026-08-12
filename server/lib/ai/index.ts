/**
 * Porta de entrada da camada de IA. Quem precisa de inferência chama
 * `complete(agent, req)` e nunca vê provedor, cliente ou nome de modelo.
 *
 * Trocar o provedor de um agente é editar `config.ts` ou exportar uma
 * variável de ambiente — nenhum outro arquivo muda.
 */
import { AGENT_CONFIG, activeProviders } from './config';
import { estimateCost, type CostBreakdown } from './pricing';
import { anthropicProvider } from './providers/anthropic';
import { googleProvider } from './providers/google';
import { xaiProvider } from './providers/xai';
import {
  PROVIDER_IDS,
  type AgentName,
  type Capability,
  type CompletionRequest,
  type CompletionResult,
  type Provider,
  type ProviderId,
} from './types';

const PROVIDERS: Record<ProviderId, Provider> = {
  anthropic: anthropicProvider,
  google: googleProvider,
  xai: xaiProvider,
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
  const envVarByProvider: Record<ProviderId, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GOOGLE_API_KEY',
    xai: 'XAI_API_KEY',
  };

  const missing = activeProviders()
    .filter((id) => !process.env[envVarByProvider[id]]?.trim())
    .map((id) => `${envVarByProvider[id]} (provedor ${id})`);

  if (missing.length > 0) {
    throw new Error(
      `Chave de API ausente para provedor configurado: ${missing.join(', ')}. ` +
        'Defina em server/.env.local — ver server/.env.example.',
    );
  }
}

export {
  AGENT_CONFIG,
  COMPARISON_MATRIX,
  DEFAULT_AGENT_CONFIG,
  activeProviders,
  agentConfigFor,
  matrixFor,
  parseOverride,
  productionCandidates,
} from './config';
export type { AgentModelConfig, MatrixEntry, Tier } from './config';
export { PRICING, estimateCost, priceFor } from './pricing';
export type { CostBreakdown } from './pricing';
export * from './types';
