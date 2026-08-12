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
 * Defaults de produção. Todos os IDs conferidos na documentação oficial em
 * 2026-08-12 (platform.claude.com/docs/en/about-claude/models/overview).
 *
 * Os três agentes de raciocínio ficam em `claude-sonnet-5` — geração atual.
 * Estavam em `claude-sonnet-4-6`, que é geração anterior; comparar isso com
 * `gemini-3.6-flash` mediria diferença de geração, não de fornecedor.
 *
 * O Auditor fica em `claude-haiku-4-5` de propósito: é o degrau barato, e a
 * chamada dele é a mais frequente e a mais simples do pipeline. Note que
 * Haiku 4.5 NÃO tem raciocínio adaptativo (a doc é explícita) — quem trata
 * a exceção é a lista de modelos em providers/anthropic.ts.
 */
const DEFAULT_AGENT_CONFIG: Record<AgentName, AgentModelConfig> = {
  // Lê a transcrição inteira; precisa de janela grande (1M).
  analista: { provider: 'anthropic', model: 'claude-sonnet-5' },
  // Raciocina sobre o contexto compactado.
  pensante: { provider: 'anthropic', model: 'claude-sonnet-5' },
  // Julgamento binário sobre excerto curto. Se errar demais na prática,
  // subir de modelo é trocar esta linha.
  auditor: { provider: 'anthropic', model: 'claude-haiku-4-5' },
  // Redação final.
  escritor: { provider: 'anthropic', model: 'claude-sonnet-5' },
};

// ---------------------------------------------------------------------------
// Matriz de comparação (insumo da Fase 8)
// ---------------------------------------------------------------------------

export type Tier = 'caro' | 'barato';

export interface MatrixEntry {
  id: string;
  provider: ProviderId;
  tier: Tier;
  /** Modelo usado em TODOS os agentes desta configuração. */
  model: string;
  /** true = modelo em preview. Roda na matriz, mas não é candidato a produção. */
  preview?: boolean;
  note?: string;
}

/**
 * A matriz NÃO é uma configuração por provedor, e não tenta emparelhar
 * modelos entre fornecedores. Emparelhar seria inventar uma equivalência que
 * não existe: Sonnet 5 e Gemini Flash não são o mesmo degrau, e chamar os
 * dois de "o modelo médio" transformaria a comparação numa opinião sobre
 * tiers em vez de uma medição.
 *
 * O que a matriz pergunta é outra coisa: **por fornecedor, qual é o custo
 * por documento no menor modelo que ainda passa as asserções
 * determinísticas?** É esse número que decide. Daí duas configurações por
 * provedor — o teto e o piso — com o mesmo modelo em todos os quatro
 * agentes. Configuração mista (Analista caro, Auditor barato) é otimização
 * de uma segunda rodada, depois que se souber onde cada fornecedor quebra.
 *
 * IDs e preços conferidos na documentação oficial de cada provedor em
 * 2026-08-12; ver pricing.ts para as fontes.
 */
export const COMPARISON_MATRIX: MatrixEntry[] = [
  {
    id: 'anthropic-caro',
    provider: 'anthropic',
    tier: 'caro',
    model: 'claude-opus-5',
    note: 'Teto da Anthropic. $5/$25 por MTok, 1M de contexto.',
  },
  {
    id: 'anthropic-barato',
    provider: 'anthropic',
    tier: 'barato',
    model: 'claude-haiku-4-5',
    note:
      'Piso da Anthropic. $1/$5, mas 200k de contexto (não 1M) e sem ' +
      'raciocínio adaptativo — os dois limites que podem derrubá-lo no Analista.',
  },
  {
    id: 'google-caro-preview',
    provider: 'google',
    tier: 'caro',
    model: 'gemini-3.1-pro-preview',
    preview: true,
    note:
      'PREVIEW — não é candidato a produção. Está aqui porque saber se o ' +
      'Gemini mais capaz resolve a armadilha de decisão é informação útil ' +
      'de qualquer jeito. $2–4/$12–18 por MTok (faixa alta acima de 200k tokens).',
  },
  {
    id: 'google-caro',
    provider: 'google',
    tier: 'caro',
    model: 'gemini-3.6-flash',
    note: 'Teto estável do Google. $1,50/$7,50 por MTok.',
  },
  {
    id: 'google-barato',
    provider: 'google',
    tier: 'barato',
    model: 'gemini-3.5-flash-lite',
    note: 'Piso do Google. $0,30/$2,50 por MTok — o mais barato da matriz inteira.',
  },
  {
    id: 'xai-caro',
    provider: 'xai',
    tier: 'caro',
    model: 'grok-4.5',
    note: 'Teto da xAI. $2/$6 por MTok, mas 500k de contexto — menos que o grok-4.3.',
  },
  {
    id: 'xai-barato',
    provider: 'xai',
    tier: 'barato',
    model: 'grok-4.3',
    note:
      'Piso da xAI. $1,25/$2,50 e 1M de contexto. `grok-build-0.1` é mais ' +
      'barato ($1/$2) mas está posicionado pra código e só tem 256k — não ' +
      'é o piso honesto pra texto.',
  },
];

/** Expande uma entrada da matriz na configuração por agente que ela representa. */
export function agentConfigFor(entry: MatrixEntry): Record<AgentName, AgentModelConfig> {
  const config = {} as Record<AgentName, AgentModelConfig>;
  for (const agent of AGENT_NAMES) {
    config[agent] = { provider: entry.provider, model: entry.model };
  }
  return config;
}

export function matrixFor(provider: ProviderId): MatrixEntry[] {
  return COMPARISON_MATRIX.filter((entry) => entry.provider === provider);
}

/** Só o que é candidato a produção — exclui preview. */
export function productionCandidates(): MatrixEntry[] {
  return COMPARISON_MATRIX.filter((entry) => !entry.preview);
}

// ---------------------------------------------------------------------------
// Overrides por ambiente
// ---------------------------------------------------------------------------

const ENV_VAR_BY_AGENT: Record<AgentName, string> = {
  analista: 'DOCCITI_ANALISTA',
  pensante: 'DOCCITI_PENSANTE',
  auditor: 'DOCCITI_AUDITOR',
  escritor: 'DOCCITI_ESCRITOR',
};

/** Formato aceito: `provedor:modelo`, ex. `google:gemini-3.6-flash`. */
export function parseOverride(raw: string, envVar: string): AgentModelConfig {
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

export { DEFAULT_AGENT_CONFIG };
