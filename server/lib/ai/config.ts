/**
 * ÚNICO lugar do código onde existe nome de modelo. Se você encontrar uma
 * string `claude-*`, `gemini-*` ou `grok-*` fora daqui e de pricing.ts, é bug.
 *
 * Cada agente pode usar um provedor diferente, e isso é resultado provável e
 * útil: o Auditor faz julgamento binário sobre trecho curto e talvez rode
 * bem no modelo mais barato de qualquer fornecedor, enquanto o Analista
 * precisa do melhor. Por isso a configuração é por agente, não global.
 *
 * Sobrescrevível por variável de ambiente, pra trocar provedor sem
 * recompilar:
 *   DOCCITI_ANALISTA=google:gemini-3.6-flash
 *   DOCCITI_AUDITOR=xai:grok-4.3
 */
import { AGENT_NAMES, isProviderId, type AgentName, type ProviderId } from './types';

export interface AgentModelConfig {
  provider: ProviderId;
  model: string;
}

/**
 * Defaults. Os IDs da Anthropic vêm da especificação da tarefa e estão
 * ativos na documentação oficial. Os de Google e xAI foram escolhidos por
 * mim a partir da documentação de cada um (ver README de lib/ai) seguindo o
 * mesmo princípio dos defaults da Anthropic: o melhor modelo disponível
 * para leitura/raciocínio, e o mais barato para o julgamento binário do
 * Auditor.
 */
const DEFAULT_AGENT_CONFIG: Record<AgentName, AgentModelConfig> = {
  // Lê a transcrição inteira; precisa de janela grande.
  analista: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  // Raciocina sobre o contexto compactado.
  pensante: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  // Julgamento binário sobre excerto curto: a chamada mais frequente do
  // pipeline e a mais simples. Se errar demais na prática, subir de modelo
  // é trocar uma linha aqui.
  auditor: { provider: 'anthropic', model: 'claude-haiku-4-5' },
  // Redação final.
  escritor: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
};

/**
 * Alternativas equivalentes nos outros dois provedores. Não são usadas em
 * runtime: existem pra o harness da Fase 8 montar as três configurações
 * comparáveis sem que ninguém precise redigitar ID de modelo.
 */
export const COMPARISON_MATRIX: Record<ProviderId, Record<AgentName, string>> = {
  anthropic: {
    analista: 'claude-sonnet-4-6',
    pensante: 'claude-sonnet-4-6',
    auditor: 'claude-haiku-4-5',
    escritor: 'claude-sonnet-4-6',
  },
  google: {
    analista: 'gemini-3.6-flash',
    pensante: 'gemini-3.6-flash',
    auditor: 'gemini-3.5-flash-lite',
    escritor: 'gemini-3.6-flash',
  },
  xai: {
    // A linha do Grok não tem um degrau barato equivalente a Haiku ou
    // Flash-Lite: `grok-build-0.1` é o mais barato ($1.00/$2.00) mas está
    // posicionado pra código, não pra julgamento de texto. Deixei o Auditor
    // no mesmo modelo dos outros agentes em vez de forçar uma equivalência
    // que a documentação não sustenta.
    analista: 'grok-4.3',
    pensante: 'grok-4.3',
    auditor: 'grok-4.3',
    escritor: 'grok-4.3',
  },
};

const ENV_VAR_BY_AGENT: Record<AgentName, string> = {
  analista: 'DOCCITI_ANALISTA',
  pensante: 'DOCCITI_PENSANTE',
  auditor: 'DOCCITI_AUDITOR',
  escritor: 'DOCCITI_ESCRITOR',
};

/** Formato aceito: `provedor:modelo`, ex. `google:gemini-3.6-flash`. */
function parseOverride(raw: string, envVar: string): AgentModelConfig {
  const separator = raw.indexOf(':');
  if (separator === -1) {
    throw new Error(
      `${envVar}="${raw}" está mal formado. Use "provedor:modelo", ` +
        'ex. DOCCITI_ANALISTA=google:gemini-3.6-flash.',
    );
  }
  const provider = raw.slice(0, separator).trim();
  const model = raw.slice(separator + 1).trim();

  if (!isProviderId(provider)) {
    throw new Error(`${envVar}: provedor "${provider}" desconhecido. Use anthropic, google ou xai.`);
  }
  if (!model) {
    throw new Error(`${envVar}="${raw}": o modelo está vazio.`);
  }
  return { provider, model };
}

function buildAgentConfig(): Record<AgentName, AgentModelConfig> {
  const config = { ...DEFAULT_AGENT_CONFIG };
  for (const agent of AGENT_NAMES) {
    const raw = process.env[ENV_VAR_BY_AGENT[agent]];
    if (raw && raw.trim()) {
      config[agent] = parseOverride(raw.trim(), ENV_VAR_BY_AGENT[agent]);
    }
  }
  return config;
}

export const AGENT_CONFIG: Record<AgentName, AgentModelConfig> = buildAgentConfig();

/** Provedores efetivamente configurados agora — só destes a chave é obrigatória. */
export function activeProviders(): ProviderId[] {
  return [...new Set(AGENT_NAMES.map((agent) => AGENT_CONFIG[agent].provider))];
}
