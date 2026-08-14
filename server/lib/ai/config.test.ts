import { describe, expect, it } from 'vitest';
import {
  COMPARISON_MATRIX,
  DEFAULT_AGENT_CONFIG,
  activeDataPolicyWarning,
  agentConfigFor,
  cheapestProductionEntry,
  dataPolicyWarning,
  matrixEntryForModel,
  matrixFor,
  parseOverride,
  productionCandidates,
  usesContentForTraining,
} from './config';
import { costForEntry } from './index';
import { priceFor } from './pricing';
import { AGENT_NAMES, PROVIDER_IDS } from './types';

describe('matriz de comparação', () => {
  it('cada provedor tem exatamente um piso de produção', () => {
    // A rota de smoke escolhe o modelo por este critério; dois pisos
    // tornariam a escolha dependente da ordem do array. A regra vale entre
    // CANDIDATOS A PRODUÇÃO: entradas experimentais podem repetir tier,
    // porque respondem perguntas laterais em vez de disputar a decisão.
    for (const provider of PROVIDER_IDS) {
      const baratos = productionCandidates().filter(
        (entry) => entry.provider === provider && entry.tier === 'barato',
      );
      expect(baratos, `provedor ${provider}`).toHaveLength(1);
      expect(cheapestProductionEntry(provider)).toBe(baratos[0]);
    }
  });

  it('cada provedor tem pelo menos um teto de produção', () => {
    for (const provider of PROVIDER_IDS) {
      const caros = productionCandidates().filter(
        (entry) => entry.provider === provider && entry.tier === 'caro',
      );
      expect(caros.length, `provedor ${provider}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('o piso de produção nunca envia conteúdo para treinamento', () => {
    // Se um dia o piso de um fornecedor virar free tier sem querer, o
    // pipeline passaria a mandar transcrição para treinamento em silêncio.
    for (const provider of PROVIDER_IDS) {
      expect(usesContentForTraining(cheapestProductionEntry(provider)), provider).toBe(false);
    }
  });

  it('matrixFor devolve também as entradas experimentais', () => {
    expect(matrixFor('google').map((entry) => entry.id)).toContain('google-dev-free');
  });

  it('os ids das entradas são únicos', () => {
    const ids = COMPARISON_MATRIX.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('toda entrada da matriz tem preço na tabela', () => {
    // Sem isto, um modelo novo entra na matriz, o harness roda, e o custo
    // sai `undefined` — que é justamente o número que decide.
    for (const entry of COMPARISON_MATRIX) {
      expect(priceFor(entry.provider, entry.model), `${entry.id} (${entry.model})`).toBeDefined();
    }
  });

  it('entrada experimental fica de fora dos candidatos a produção', () => {
    const experimentais = COMPARISON_MATRIX.filter((entry) => entry.experimental);
    expect(experimentais.length).toBeGreaterThan(0);
    for (const entry of experimentais) {
      expect(productionCandidates().map((c) => c.id)).not.toContain(entry.id);
    }
  });

  it('toda entrada que manda conteúdo para treinamento é experimental', () => {
    // A recíproca não vale (preview pode ser privado), mas esta direção
    // sim: dado que vai para treinamento nunca pode ser candidato a produção.
    for (const entry of COMPARISON_MATRIX.filter(usesContentForTraining)) {
      expect(entry.experimental, entry.id).toBe(true);
    }
  });
});

describe('política de dados', () => {
  it('gemini-2.5-flash em free tier está marcado como treinamento', () => {
    const entry = COMPARISON_MATRIX.find((candidate) => candidate.id === 'google-dev-free')!;
    expect(entry.model).toBe('gemini-2.5-flash');
    expect(entry.dataPolicy).toBe('training');
    expect(entry.billing).toBe('free-tier');
    expect(usesContentForTraining(entry)).toBe(true);
  });

  it('o aviso nomeia a configuração e proíbe transcrição real', () => {
    const entry = COMPARISON_MATRIX.find((candidate) => candidate.id === 'google-dev-free')!;
    const aviso = dataPolicyWarning(entry)!;
    expect(aviso).toContain('google-dev-free');
    expect(aviso).toContain('sintética');
  });

  it('configuração privada não gera aviso', () => {
    expect(dataPolicyWarning(cheapestProductionEntry('anthropic'))).toBeNull();
  });

  it('DOCCITI_DATA_POLICY=training força o aviso, independentemente do modelo', () => {
    // A política é do PLANO DA CHAVE, não do modelo: uma chave de free tier
    // manda tudo para treinamento em qualquer modelo. Sem este override, a
    // proteção sumiria só por trocar gemini-2.5-flash por gemini-3.5-flash.
    const original = process.env.DOCCITI_DATA_POLICY;
    try {
      process.env.DOCCITI_DATA_POLICY = 'training';
      const aviso = activeDataPolicyWarning();
      expect(aviso).not.toBeNull();
      expect(aviso).toContain('sintética');
    } finally {
      if (original === undefined) delete process.env.DOCCITI_DATA_POLICY;
      else process.env.DOCCITI_DATA_POLICY = original;
    }
  });

  it('sem o override e com modelos pagos, não há aviso', () => {
    const original = process.env.DOCCITI_DATA_POLICY;
    try {
      delete process.env.DOCCITI_DATA_POLICY;
      expect(activeDataPolicyWarning()).toBeNull();
    } finally {
      if (original !== undefined) process.env.DOCCITI_DATA_POLICY = original;
    }
  });

  it('matrixEntryForModel encontra a entrada do modelo ativo do Auditor', () => {
    const { provider, model } = DEFAULT_AGENT_CONFIG.auditor;
    expect(matrixEntryForModel(provider, model)?.id).toBe('google-barato');
  });

  it('a nota da entrada de free tier registra os três motivos', () => {
    const nota = COMPARISON_MATRIX.find((c) => c.id === 'google-dev-free')!.note!;
    expect(nota).toMatch(/revisão humana/i);
    expect(nota).toMatch(/geração anterior/i);
    expect(nota).toMatch(/limites de requisição/i);
  });
});

describe('custo por entrada da matriz', () => {
  it('free tier custa zero mesmo com o modelo tendo preço pago', () => {
    const entry = COMPARISON_MATRIX.find((candidate) => candidate.id === 'google-dev-free')!;
    // O modelo TEM preço na tabela — é o preço pago dele, e continua certo.
    expect(priceFor(entry.provider, entry.model)).toBeDefined();
    expect(costForEntry(entry, { inputTokens: 1_000_000, outputTokens: 500_000 })!.totalUsd).toBe(0);
  });

  it('configuração paga usa a tabela normalmente', () => {
    const entry = cheapestProductionEntry('anthropic');
    const cost = costForEntry(entry, { inputTokens: 1_000_000, outputTokens: 0 })!;
    expect(cost.totalUsd).toBeGreaterThan(0);
  });

  it('agentConfigFor expande a entrada para todos os agentes', () => {
    const entry = COMPARISON_MATRIX[0]!;
    const config = agentConfigFor(entry);
    expect(Object.keys(config).sort()).toEqual([...AGENT_NAMES].sort());
    for (const agent of AGENT_NAMES) {
      expect(config[agent]).toEqual({ provider: entry.provider, model: entry.model });
    }
  });
});

describe('defaults de produção', () => {
  it('todo agente tem provedor e modelo', () => {
    for (const agent of AGENT_NAMES) {
      expect(DEFAULT_AGENT_CONFIG[agent].model).toBeTruthy();
      expect(PROVIDER_IDS).toContain(DEFAULT_AGENT_CONFIG[agent].provider);
    }
  });

  it('todo modelo default tem preço na tabela', () => {
    for (const agent of AGENT_NAMES) {
      const { provider, model } = DEFAULT_AGENT_CONFIG[agent];
      expect(priceFor(provider, model), `${agent} (${model})`).toBeDefined();
    }
  });

  it('o Auditor não é mais caro que os agentes de raciocínio', () => {
    // O Auditor é a chamada mais frequente do pipeline. Se um dia ele ficar
    // no modelo mais caro, é engano, não decisão.
    const auditor = priceFor(
      DEFAULT_AGENT_CONFIG.auditor.provider,
      DEFAULT_AGENT_CONFIG.auditor.model,
    )!;
    const pensante = priceFor(
      DEFAULT_AGENT_CONFIG.pensante.provider,
      DEFAULT_AGENT_CONFIG.pensante.model,
    )!;
    expect(auditor.inputPerMTok).toBeLessThanOrEqual(pensante.inputPerMTok);
    expect(auditor.outputPerMTok).toBeLessThanOrEqual(pensante.outputPerMTok);
  });
});

describe('parseOverride', () => {
  it('aceita provedor:modelo', () => {
    expect(parseOverride('google:gemini-3.6-flash', 'DOCCITI_ANALISTA')).toEqual({
      provider: 'google',
      model: 'gemini-3.6-flash',
    });
  });

  it('aceita modelo com dois-pontos no nome', () => {
    // Alguns IDs de provedor carregam `:` (versão em Bedrock, por exemplo).
    // Cortar no primeiro separador, não no último, mantém isso funcionando.
    expect(parseOverride('xai:grok-4.3:v1', 'DOCCITI_PENSANTE').model).toBe('grok-4.3:v1');
  });

  it('recusa formato sem separador', () => {
    expect(() => parseOverride('gemini-3.6-flash', 'DOCCITI_ANALISTA')).toThrow(/mal formado/);
  });

  it('recusa provedor desconhecido', () => {
    expect(() => parseOverride('openai:gpt-5', 'DOCCITI_ANALISTA')).toThrow(/desconhecido/);
  });

  it('recusa modelo vazio', () => {
    expect(() => parseOverride('google:', 'DOCCITI_ANALISTA')).toThrow(/vazio/);
  });
});
