/**
 * ÚNICO lugar do código onde existe nome de modelo. Se você encontrar uma
 * string `claude-*`, `gemini-*` ou `grok-*` fora daqui e de pricing.ts, é bug.
 *
 * Cada agente pode usar um provedor diferente, e isso é resultado provável e
 * útil: o Auditor faz julgamento binário sobre trecho curto e talvez rode
 * bem no modelo mais barato de qualquer fornecedor, enquanto o Pensante
 * precisa do melhor. Por isso a configuração é por agente, não global.
 *
 * Sobrescrevível por variável de ambiente, pra trocar provedor sem
 * recompilar:
 *   DOCCITI_PENSANTE=google:gemini-3.6-flash
 *   DOCCITI_AUDITOR=xai:grok-4.3
 */
import { AGENT_NAMES, isProviderId, type AgentName, type ProviderId } from './types';

export interface AgentModelConfig {
  provider: ProviderId;
  model: string;
}

/**
 * Configuração ATIVA. Hoje é `gemini-2.5-flash` nos quatro agentes, no free
 * tier — a única que roda sem cartão enquanto só há chave do Google.
 *
 * **Isto não é a configuração boa, é a que funciona.** Três coisas erradas
 * com ela, todas conhecidas e nenhuma acidental:
 *
 * - manda conteúdo para treinamento do provedor, com revisão humana; enquanto
 *   for a ativa, SÓ TRANSCRIÇÃO SINTÉTICA (ver `activeDataPolicyWarning`);
 * - é geração anterior, então não serve para comparar fornecedores;
 * - põe o mesmo modelo no Pensante e no Auditor, o que a matriz existe
 *   justamente para questionar.
 *
 * A configuração de produção pretendida está em `COMPARISON_MATRIX` e é
 * decidida pelo harness da Fase 8, não aqui. Quando houver chave paga,
 * trocar é editar este bloco ou exportar `DOCCITI_*`.
 *
 * Referência das opções (IDs conferidos na documentação oficial em
 * 2026-08-12): Anthropic `claude-sonnet-5` para Pensante/Escritor e
 * `claude-haiku-4-5` para o Auditor; Google `gemini-3.6-flash` e
 * `gemini-3.5-flash-lite`.
 */
const DEFAULT_AGENT_CONFIG: Record<AgentName, AgentModelConfig> = {
  // RACIOCÍNIO — lê a transcrição bruta e decide o que entra na seção, com
  // raciocínio ligado em HIGH (ver THINKING_LEVEL em providers/google.ts).
  //
  // ATENÇÃO ao trocar este modelo: desde o corte da compactação é ELE que
  // produz `quote`, e portanto é a taxa de âncoras dele que sustenta a
  // auditoria inteira. `gemini-3.5-flash` já foi visto devolvendo "gesto"
  // onde a transcrição diz "gestão" numa execução do bench, derrubando a
  // taxa de 100% para 29% — intermitente, amostra de duas execuções. É a
  // dívida #5 do handoff, e agora ela pesa aqui.
  pensante: { provider: 'google', model: 'gemini-3.5-flash' },

  // EXTRAÇÃO — julgamento binário sobre excerto curto, e a chamada mais
  // frequente do pipeline. É verificação, não deliberação.
  auditor: { provider: 'google', model: 'gemini-3.5-flash-lite' },

  // Redação final. Fica no modelo de raciocínio: é geração de prosa, não
  // extração. Se o custo incomodar, é a primeira linha a descer para lite —
  // a especificação observa que a redação é a parte mais fácil.
  escritor: { provider: 'google', model: 'gemini-3.5-flash' },
};

// ---------------------------------------------------------------------------
// Matriz de comparação (insumo da Fase 8)
// ---------------------------------------------------------------------------

export type Tier = 'caro' | 'barato';

/**
 * O que o provedor faz com o conteúdo enviado.
 *
 * `private`   — não é usado para treinar nem passa por revisão humana.
 * `training`  — o conteúdo PODE ser usado para melhorar produtos, com
 *               revisão humana. É o caso do free tier do Gemini.
 *
 * Isto não é metadado decorativo: transcrição de reunião é exatamente o
 * tipo de dado que os termos desaconselham mandar para `training`.
 */
export type DataPolicy = 'private' | 'training';

export type Billing = 'paid' | 'free-tier';

export interface MatrixEntry {
  id: string;
  provider: ProviderId;
  tier: Tier;
  /** Modelo usado em TODOS os agentes desta configuração. */
  model: string;
  /** true = preview ou free tier. Roda na matriz, não é candidato a produção. */
  experimental?: boolean;
  /** Ausente = `private`. */
  dataPolicy?: DataPolicy;
  /** Ausente = `paid`. `free-tier` faz o custo desta configuração ser zero
   *  no relatório, mesmo com o modelo tendo preço na tabela. */
  billing?: Billing;
  note?: string;
}

/**
 * true quando a configuração manda conteúdo para treinamento. Enquanto a
 * ativa for uma dessas, **só transcrição sintética** — nenhuma gravação
 * real de reunião.
 */
export function usesContentForTraining(entry: MatrixEntry): boolean {
  return entry.dataPolicy === 'training';
}

/** Aviso pronto para log, ou `null` quando não há o que avisar. */
export function dataPolicyWarning(entry: MatrixEntry): string | null {
  if (!usesContentForTraining(entry)) return null;
  return (
    `ATENÇÃO: a configuração "${entry.id}" (${entry.provider}/${entry.model}) envia o ` +
    'conteúdo para treinamento do provedor, com possível revisão humana. ' +
    'Use SOMENTE transcrição sintética — nenhuma gravação real de reunião.'
  );
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
 * provedor — o teto e o piso — com o mesmo modelo em todos os três
 * agentes. Configuração mista (Pensante caro, Auditor barato) é otimização
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
      'raciocínio adaptativo — os dois limites que podem derrubá-lo no Pensante, ' +
      'que agora lê a transcrição inteira.',
  },
  {
    id: 'google-caro-preview',
    provider: 'google',
    tier: 'caro',
    model: 'gemini-3.1-pro-preview',
    experimental: true,
    note:
      'PREVIEW — não é candidato a produção. Está aqui porque saber se o ' +
      'Gemini mais capaz resolve a armadilha de decisão é informação útil ' +
      'de qualquer jeito. $2–4/$12–18 por MTok (faixa alta acima de 200k tokens).',
  },
  {
    id: 'google-dev-free',
    provider: 'google',
    tier: 'barato',
    model: 'gemini-2.5-flash',
    experimental: true,
    dataPolicy: 'training',
    billing: 'free-tier',
    note:
      'CONFIGURAÇÃO DE DESENVOLVIMENTO, não candidata a produção, por três ' +
      'motivos independentes. (1) O free tier usa o conteúdo enviado para ' +
      'melhorar produtos, com revisão humana — os termos desaconselham dado ' +
      'sensível, e transcrição de reunião é exatamente isso; enquanto esta ' +
      'for a configuração ativa, só transcrição sintética. (2) É geração ' +
      'anterior: comparar com a família 3.x mede geração, não fornecedor. ' +
      '(3) Limites de requisição baixos — uma geração completa faz de 20 a ' +
      '30 chamadas e estoura o limite por minuto com facilidade (ver a ' +
      'espera por 429 em providers/shared.ts).',
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

/**
 * Só o que é candidato a produção — exclui preview e free tier. É sobre
 * este conjunto que vale a regra de um teto e um piso por fornecedor: as
 * entradas experimentais existem para responder perguntas laterais, não
 * para disputar a decisão.
 */
export function productionCandidates(): MatrixEntry[] {
  return COMPARISON_MATRIX.filter((entry) => !entry.experimental);
}

/** O piso de produção de um fornecedor — o modelo que o harness precisa
 *  derrubar ou aprovar. É por ele que a rota de fumaça escolhe o modelo. */
export function cheapestProductionEntry(provider: ProviderId): MatrixEntry {
  const entry = productionCandidates().find(
    (candidate) => candidate.provider === provider && candidate.tier === 'barato',
  );
  if (!entry) throw new Error(`Matriz sem configuração barata de produção para ${provider}.`);
  return entry;
}

// ---------------------------------------------------------------------------
// Overrides por ambiente
// ---------------------------------------------------------------------------

const ENV_VAR_BY_AGENT: Record<AgentName, string> = {
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
        'ex. DOCCITI_PENSANTE=google:gemini-3.6-flash.',
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

/** A entrada da matriz que descreve este par provedor+modelo, se houver. */
export function matrixEntryForModel(
  provider: ProviderId,
  model: string,
): MatrixEntry | undefined {
  return COMPARISON_MATRIX.find(
    (entry) => entry.provider === provider && entry.model === model,
  );
}

/**
 * Aviso quando a configuração ATIVA manda conteúdo para treinamento.
 *
 * Existe porque a proibição de usar transcrição real é uma regra que só vale
 * se alguém lembrar dela na hora certa, e a hora certa é toda geração.
 *
 * ATENÇÃO ao que determina a política: ela é do PLANO DA CHAVE, não do
 * modelo. Uma chave de free tier do Gemini manda para treinamento tudo que
 * passa por ela, em qualquer modelo — trocar `gemini-2.5-flash` por
 * `gemini-3.5-flash` não muda nada nisso. A detecção por entrada da matriz
 * abaixo só acerta quando a configuração casa com uma entrada conhecida, e
 * por isso NÃO basta: `DOCCITI_DATA_POLICY=training` força o aviso
 * independentemente de modelo, e é o que uma chave de free tier deve usar.
 */
export function activeDataPolicyWarning(): string | null {
  if (process.env.DOCCITI_DATA_POLICY?.trim() === 'training') {
    return (
      'ATENÇÃO: DOCCITI_DATA_POLICY=training — a chave em uso envia o conteúdo ' +
      'para treinamento do provedor, com possível revisão humana, em qualquer ' +
      'modelo. Use SOMENTE transcrição sintética — nenhuma gravação real de reunião.'
    );
  }

  for (const agent of AGENT_NAMES) {
    const { provider, model } = AGENT_CONFIG[agent];
    const entry = matrixEntryForModel(provider, model);
    if (entry && usesContentForTraining(entry)) return dataPolicyWarning(entry);
  }
  return null;
}

export { DEFAULT_AGENT_CONFIG };
