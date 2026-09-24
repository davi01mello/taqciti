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
 *   DOCCITI_LEITOR=google:gemini-3.6-flash
 *   DOCCITI_AUDITOR=xai:grok-4.3
 */
import { AGENT_NAMES, isProviderId, type AgentName, type ProviderId } from './types';

export interface AgentModelConfig {
  provider: ProviderId;
  model: string;
}

/**
 * Configuração ATIVA: Gemini, `flash` na leitura e `lite` na conferência.
 * São DUAS chamadas por documento — ver `generateStep.ts`.
 *
 * A configuração de produção pretendida está em `COMPARISON_MATRIX` e é
 * decidida pelo harness da Fase 8, não aqui. Trocar é editar este bloco ou
 * exportar `DOCCITI_*`.
 *
 * Referência das opções (IDs conferidos na documentação oficial em
 * 2026-08-12): Anthropic `claude-sonnet-5` para o Leitor e `claude-haiku-4-5`
 * para o Auditor; Google `gemini-3.6-flash` e `gemini-3.5-flash-lite`.
 */
const DEFAULT_AGENT_CONFIG: Record<AgentName, AgentModelConfig> = {
  // A LEITURA — uma chamada por documento, com raciocínio HIGH. É a que
  // separa proposta de decisão e a que escreve o texto final, então fica no
  // `flash`: sendo a única, descer de modelo aqui economiza centavos e arrisca
  // justamente o que o produto existe para acertar.
  //
  // ATENÇÃO ao trocar este modelo: é ELE que produz `quote`, e portanto é a
  // taxa de âncoras dele que sustenta a auditoria inteira. `gemini-3.5-flash`
  // já foi visto devolvendo "gesto" onde a transcrição diz "gestão" numa
  // execução do bench, derrubando a taxa de 100% para 29% — intermitente,
  // amostra de duas execuções. É a dívida #5 do handoff.
  leitor: { provider: 'google', model: 'gemini-3.5-flash' },

  // A CONFERÊNCIA — julgamento binário sobre excertos curtos, todos numa
  // chamada. É verificação, não deliberação.
  auditor: { provider: 'google', model: 'gemini-3.5-flash-lite' },
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
 * Os provedores que a matriz de comparação cobre — DERIVADO dela, nunca escrito
 * à mão, senão a lista e a matriz divergem no primeiro acréscimo.
 *
 * Nem todo provedor implementado está aqui, e isso é estado legítimo:
 *
 *  - `mock` nunca entra. Ele não é um fornecedor a comparar; pô-lo na matriz
 *    faria o harness "medir" um provedor que devolve texto inventado de graça,
 *    e ele ganharia todas as métricas de custo.
 *  - `openai` ainda não entrou. Entrar exige escolher os modelos e conferir os
 *    preços na documentação oficial, e a fase que escreveu o adaptador não
 *    consulta a rede. Enquanto o preço não estiver na tabela, uma entrada aqui
 *    produziria custo `undefined` no relatório — ver `estimateCost`.
 */
export function providersNaMatriz(): ProviderId[] {
  return [...new Set(COMPARISON_MATRIX.map((entry) => entry.provider))];
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
  leitor: 'DOCCITI_LEITOR',
  auditor: 'DOCCITI_AUDITOR',
};

/**
 * Nomes antigos que ainda valem, para uma variável já configurada no deploy
 * não parar de funcionar em silêncio. `DOCCITI_PENSANTE` apontava o modelo que
 * lia a transcrição — é o mesmo papel do Leitor. `DOCCITI_ESCRITOR` não tem
 * sucessor: o agente não existe mais.
 */
const LEGACY_ENV_VAR_BY_AGENT: Partial<Record<AgentName, string>> = {
  leitor: 'DOCCITI_PENSANTE',
};

/** Formato aceito: `provedor:modelo`, ex. `google:gemini-3.6-flash`. */
export function parseOverride(raw: string, envVar: string): AgentModelConfig {
  const separator = raw.indexOf(':');
  if (separator === -1) {
    throw new Error(
      `${envVar}="${raw}" está mal formado. Use "provedor:modelo", ` +
        'ex. DOCCITI_LEITOR=google:gemini-3.6-flash.',
    );
  }
  const provider = raw.slice(0, separator).trim();
  const model = raw.slice(separator + 1).trim();

  if (!isProviderId(provider)) {
    throw new Error(
      `${envVar}: provedor "${provider}" desconhecido. ` +
        'Use anthropic, openai, google, xai ou mock.',
    );
  }
  if (!model) {
    throw new Error(`${envVar}="${raw}": o modelo está vazio.`);
  }
  return { provider, model };
}

// ---------------------------------------------------------------------------
// Troca global de provedor
// ---------------------------------------------------------------------------

/**
 * `LLM_PROVIDER` — o nome COMERCIAL, não o interno.
 *
 * Quem escreve a variável pensa em "Claude" e "GPT"; quem lê o código pensa em
 * `anthropic` e `openai`. Este mapa é a tradução, e ele existe num lugar só
 * para os dois vocabulários não vazarem um no outro. Os ids internos também são
 * aceitos — quem já conhece a camada não deveria ser corrigido por ela.
 */
const APELIDO_DE_PROVEDOR: Record<string, ProviderId> = {
  claude: 'anthropic',
  anthropic: 'anthropic',
  gpt: 'openai',
  openai: 'openai',
  gemini: 'google',
  google: 'google',
  grok: 'xai',
  xai: 'xai',
  mock: 'mock',
  fake: 'mock',
};

/** O modelo usado quando só o PROVEDOR foi escolhido, sem dizer qual modelo. */
const MODELO_PADRAO_POR_PROVEDOR: Record<ProviderId, string> = {
  anthropic: 'claude-sonnet-5',
  // Sem modelo decidido ainda — ver o README da fase e a lista de pendências.
  openai: 'gpt-4.1-mini',
  google: 'gemini-3.5-flash',
  xai: 'grok-4.3',
  mock: 'mock-1',
};

export function parseProviderAlias(raw: string, envVar: string): ProviderId {
  const provedor = APELIDO_DE_PROVEDOR[raw.trim().toLowerCase()];
  if (!provedor) {
    throw new Error(
      `${envVar}="${raw}" desconhecido. Use claude, openai (ou gpt), google, xai ou mock.`,
    );
  }
  return provedor;
}

/**
 * Quando o mock é o padrão — e por que não é sempre que `NODE_ENV !==
 * 'production'`.
 *
 * A regra pedida é "mock por padrão em desenvolvimento local". Tomada ao pé da
 * letra, ela sequestraria o `next dev` de quem TEM chave configurada e está
 * justamente testando a geração de verdade: o servidor subiria respondendo
 * `[mock]` sem ninguém ter pedido, e o sintoma (um documento de texto falso)
 * levaria um tempo até ser entendido.
 *
 * A regra implementada é a mesma intenção sem esse efeito: fora de produção, o
 * mock assume quando NÃO HÁ CHAVE do provedor configurado. Quem não tem chave
 * ganha um servidor que funciona; quem tem continua com o que configurou. E
 * `MOCK_LLM=true` força o mock em qualquer ambiente, inclusive com chave — é o
 * botão explícito, e o que a suíte de testes usa.
 */
export function mockPadrao(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MOCK_LLM?.trim().toLowerCase() === 'true') return true;
  if (env.NODE_ENV === 'production') return false;
  if (env.LLM_PROVIDER?.trim()) return false;
  // Uma chave de qualquer provedor basta: a configuração padrão é por agente e
  // pode misturar fornecedores.
  const chaves = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY'];
  return !chaves.some((chave) => env[chave]?.trim());
}

/**
 * A precedência, do mais forte para o mais fraco:
 *
 *   1. `MOCK_LLM=true`            — o botão de pânico; ignora todo o resto
 *   2. `DOCCITI_<AGENTE>`         — provedor+modelo de UM agente
 *                                   (`DOCCITI_PENSANTE` ainda vale pelo Leitor)
 *   3. `LLM_PROVIDER`             — o provedor de TODOS os agentes
 *   4. `DEFAULT_AGENT_CONFIG`     — ou o mock, quando não há chave nenhuma
 *
 * O override por agente vence o global porque é o mais específico: quem
 * escreveu `DOCCITI_AUDITOR=mock:mock-1` com `LLM_PROVIDER=claude` está
 * dizendo "tudo no Claude, menos o auditor", e a ordem inversa tornaria essa
 * frase impossível de escrever.
 */
function buildAgentConfig(): Record<AgentName, AgentModelConfig> {
  if (process.env.MOCK_LLM?.trim().toLowerCase() === 'true') {
    return agentConfigFor({
      id: 'mock',
      provider: 'mock',
      tier: 'barato',
      model: MODELO_PADRAO_POR_PROVEDOR.mock,
    });
  }

  const global = process.env.LLM_PROVIDER?.trim();
  let config: Record<AgentName, AgentModelConfig>;

  if (global) {
    const provider = parseProviderAlias(global, 'LLM_PROVIDER');
    config = agentConfigFor({
      id: `global:${provider}`,
      provider,
      tier: 'barato',
      model: MODELO_PADRAO_POR_PROVEDOR[provider],
    });
  } else if (mockPadrao()) {
    config = agentConfigFor({
      id: 'mock',
      provider: 'mock',
      tier: 'barato',
      model: MODELO_PADRAO_POR_PROVEDOR.mock,
    });
  } else {
    config = { ...DEFAULT_AGENT_CONFIG };
  }

  for (const agent of AGENT_NAMES) {
    const legado = LEGACY_ENV_VAR_BY_AGENT[agent];
    const envVar = process.env[ENV_VAR_BY_AGENT[agent]]?.trim()
      ? ENV_VAR_BY_AGENT[agent]
      : legado && process.env[legado]?.trim()
        ? legado
        : undefined;
    if (envVar) config[agent] = parseOverride(process.env[envVar]!.trim(), envVar);
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
