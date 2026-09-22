/**
 * O provedor falso.
 *
 * O que está em teste é a promessa que ele faz: forma correta, determinismo, e
 * nenhuma tentativa de parecer conteúdo real.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { chamadasDoMock, limparMock, mockProvider, registrarResposta, valorParaSchema } from './mock';

const PEDIDO = {
  system: 'Você resume reuniões.',
  messages: [{ role: 'user' as const, content: 'O que ficou decidido?' }],
  maxTokens: 256,
};

beforeEach(() => limparMock());

describe('texto livre', () => {
  it('responde marcado como mock, sem fingir conteúdo', async () => {
    const r = await mockProvider.complete('mock-1', PEDIDO);
    expect(r.text).toContain('[mock]');
    expect(r.text).toContain('O que ficou decidido?');
  });

  it('é determinístico: a mesma pergunta, a mesma resposta', async () => {
    const a = await mockProvider.complete('mock-1', PEDIDO);
    const b = await mockProvider.complete('mock-1', PEDIDO);
    expect(a.text).toBe(b.text);
  });

  it('registra o que passou por ele, para o teste poder afirmar sobre o prompt', async () => {
    await mockProvider.complete('mock-1', PEDIDO);
    expect(chamadasDoMock()).toHaveLength(1);
    expect(chamadasDoMock()[0]!.req.system).toBe('Você resume reuniões.');
  });
});

describe('respostas combinadas', () => {
  it('devolve o que o teste registrou', async () => {
    registrarResposta((c) => c.req.messages[0]!.content.includes('decidido'), 'Fechou o escopo.');
    const r = await mockProvider.complete('mock-1', PEDIDO);
    expect(r.text).toBe('Fechou o escopo.');
  });

  it('a última registrada vence, para um caso sobrescrever o preparo comum', async () => {
    registrarResposta(() => true, 'primeira');
    registrarResposta(() => true, 'segunda');
    const r = await mockProvider.complete('mock-1', PEDIDO);
    expect(r.text).toBe('segunda');
  });

  it('`limparMock` desfaz as combinações', async () => {
    registrarResposta(() => true, 'combinada');
    limparMock();
    const r = await mockProvider.complete('mock-1', PEDIDO);
    expect(r.text).toContain('[mock]');
  });
});

describe('saída estruturada', () => {
  const schema = {
    type: 'object',
    properties: {
      titulo: { type: 'string' },
      participantes: { type: 'array', items: { type: 'string' } },
      minutos: { type: 'integer' },
      concluida: { type: 'boolean' },
      tipo: { type: 'string', enum: ['ata', 'resumo'] },
      opcional: { type: 'string' },
    },
    required: ['titulo', 'participantes', 'minutos', 'concluida', 'tipo'],
  };

  it('constrói um valor que valida contra o schema, sem fixture escrita à mão', async () => {
    const r = await mockProvider.complete('mock-1', { ...PEDIDO, jsonSchema: schema });
    const v = r.parsed as Record<string, unknown>;

    expect(typeof v.titulo).toBe('string');
    expect(Array.isArray(v.participantes)).toBe(true);
    expect(Number.isInteger(v.minutos)).toBe(true);
    expect(typeof v.concluida).toBe('boolean');
    expect(['ata', 'resumo']).toContain(v.tipo);
    expect(r.meta.repaired).toBe(false);
  });

  /*
   * Só o que é `required`. Preencher os opcionais faria o mock entregar mais do
   * que o contrato promete, e um consumidor passaria a depender do que o
   * provedor real pode não mandar.
   */
  it('não inventa campo opcional', async () => {
    const r = await mockProvider.complete('mock-1', { ...PEDIDO, jsonSchema: schema });
    expect(r.parsed).not.toHaveProperty('opcional');
  });

  it('o valor derivado é estável entre execuções', () => {
    expect(valorParaSchema(schema)).toEqual(valorParaSchema(schema));
  });

  it('aninha objetos e arrays de objetos', () => {
    const v = valorParaSchema({
      type: 'object',
      properties: {
        itens: {
          type: 'array',
          items: {
            type: 'object',
            properties: { nome: { type: 'string' } },
            required: ['nome'],
          },
        },
      },
      required: ['itens'],
    }) as { itens: Array<{ nome: string }> };

    expect(v.itens).toHaveLength(2);
    expect(typeof v.itens[0]!.nome).toBe('string');
  });

  it('uma combinação inválida ainda é reprovada pelo schema', async () => {
    registrarResposta(() => true, 'isto não é JSON');
    await expect(
      mockProvider.complete('mock-1', { ...PEDIDO, jsonSchema: schema }),
    ).rejects.toThrow(/não satisfez o schema/);
  });
});

describe('contabilidade', () => {
  it('estima uso em vez de reportar zero', async () => {
    const r = await mockProvider.complete('mock-1', PEDIDO);
    expect(r.usage.inputTokens).toBeGreaterThan(0);
    expect(r.usage.outputTokens).toBeGreaterThan(0);
  });
});
