/**
 * A camada inteira, de ponta a ponta — pelo mock.
 *
 * Os testes de adaptador exercitam cada provedor por dentro. Este exercita o
 * CAMINHO: `complete(agente, …)` → resolução do agente → provedor →
 * `runCompletion` → validação de schema → resultado. É o percurso que roda em
 * produção, e o único centímetro trocado é o POST.
 *
 * A suíte inteira roda com `MOCK_LLM=true` (ver vitest.setup.ts), então
 * `resolveAgent` devolve o mock para todo agente aqui.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_NAMES,
  PROVIDER_IDS,
  capabilityTable,
  complete,
  completeStructured,
  costOf,
  getProvider,
  resolveAgent,
} from './index';
import { limparMock, registrarResposta } from './providers/mock';

const PEDIDO = {
  system: 'Você resume reuniões.',
  messages: [{ role: 'user' as const, content: 'O que ficou decidido?' }],
  maxTokens: 512,
};

beforeEach(() => limparMock());

describe('a tranca da suíte', () => {
  it('todo agente resolve para o mock', () => {
    for (const agente of AGENT_NAMES) {
      expect(resolveAgent(agente).provider.id, agente).toBe('mock');
    }
  });
});

describe('o caminho completo', () => {
  it('complete devolve texto e metadados', async () => {
    const r = await complete('auditor', PEDIDO);
    expect(r.text).toContain('[mock]');
    expect(r.meta.provider).toBe('mock');
    expect(r.meta.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('completeStructured devolve o valor já validado', async () => {
    const { value, result } = await completeStructured<{ decisoes: string[] }>('leitor', {
      ...PEDIDO,
      jsonSchema: {
        type: 'object',
        properties: { decisoes: { type: 'array', items: { type: 'string' } } },
        required: ['decisoes'],
      },
    });

    expect(Array.isArray(value.decisoes)).toBe(true);
    expect(result.parsed).toEqual(value);
  });

  it('uma resposta combinada atravessa a camada inteira', async () => {
    registrarResposta(() => true, '{"decisoes":["Login social fica fora."]}');
    const { value } = await completeStructured<{ decisoes: string[] }>('auditor', {
      ...PEDIDO,
      jsonSchema: {
        type: 'object',
        properties: { decisoes: { type: 'array', items: { type: 'string' } } },
        required: ['decisoes'],
      },
    });
    expect(value.decisoes).toEqual(['Login social fica fora.']);
  });

  /*
   * Custo `undefined` é o certo aqui, e não zero: o mock não tem preço na
   * tabela porque não há chamada nenhuma. Zero silencioso seria um relatório de
   * custo dizendo que a geração saiu de graça — ver `estimateCost`.
   */
  it('o mock não produz custo inventado', async () => {
    expect(costOf(await complete('auditor', PEDIDO))).toBeUndefined();
  });
});

describe('o registro de provedores', () => {
  it('todo id tem adaptador, e o id do adaptador bate com a chave', () => {
    for (const id of PROVIDER_IDS) {
      expect(getProvider(id).id, id).toBe(id);
    }
  });

  it('a tabela de capacidades cobre os cinco', () => {
    expect(capabilityTable().map((linha) => linha.provider).sort()).toEqual(
      [...PROVIDER_IDS].sort(),
    );
  });

  it('só a Anthropic declara controle de cache por requisição', () => {
    const comCache = capabilityTable()
      .filter((linha) => linha.contextCache)
      .map((linha) => linha.provider);
    // Google, xAI e OpenAI cacheiam por conta própria, sem controle nosso; o
    // que a capacidade pergunta é se existe controle, não se há cache.
    expect(comCache).toEqual(['anthropic']);
  });
});
