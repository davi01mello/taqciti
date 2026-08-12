import { describe, expect, it } from 'vitest';
import {
  COMPARISON_MATRIX,
  DEFAULT_AGENT_CONFIG,
  agentConfigFor,
  matrixFor,
  parseOverride,
  productionCandidates,
} from './config';
import { priceFor } from './pricing';
import { AGENT_NAMES, PROVIDER_IDS } from './types';

describe('matriz de comparação', () => {
  it('cada provedor tem exatamente uma configuração barata', () => {
    // A rota de smoke escolhe o modelo por este critério; duas entradas
    // "barato" tornariam a escolha dependente da ordem do array.
    for (const provider of PROVIDER_IDS) {
      const baratos = matrixFor(provider).filter((entry) => entry.tier === 'barato');
      expect(baratos, `provedor ${provider}`).toHaveLength(1);
    }
  });

  it('cada provedor tem pelo menos uma configuração cara', () => {
    for (const provider of PROVIDER_IDS) {
      const caros = matrixFor(provider).filter((entry) => entry.tier === 'caro');
      expect(caros.length, `provedor ${provider}`).toBeGreaterThanOrEqual(1);
    }
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

  it('modelo em preview fica de fora dos candidatos a produção', () => {
    const previews = COMPARISON_MATRIX.filter((entry) => entry.preview);
    expect(previews.length).toBeGreaterThan(0);
    for (const entry of previews) {
      expect(productionCandidates().map((c) => c.id)).not.toContain(entry.id);
    }
  });

  it('agentConfigFor expande a entrada para os quatro agentes', () => {
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
    const analista = priceFor(
      DEFAULT_AGENT_CONFIG.analista.provider,
      DEFAULT_AGENT_CONFIG.analista.model,
    )!;
    expect(auditor.inputPerMTok).toBeLessThanOrEqual(analista.inputPerMTok);
    expect(auditor.outputPerMTok).toBeLessThanOrEqual(analista.outputPerMTok);
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
