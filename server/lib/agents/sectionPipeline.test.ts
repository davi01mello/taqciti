import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * O laço Pensante ↔ Auditor com o modelo mockado. O que se testa aqui é o
 * TETO DE DUAS PASSADAS e o descarte — a parte que, se estiver errada, ou
 * roda para sempre ou deixa afirmação não confirmada entrar na ata.
 */
const complete = vi.hoisted(() => vi.fn());
vi.mock('../ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai')>()),
  complete,
}));

const { runSection, MAX_PASSES } = await import('./sectionPipeline');
const { TEMPLATES } = await import('../templates');
import type { CompactedContext } from '../compactedContext';

const transcript = 'Carlos: acho que deveriamos adiar a entrega. Ana: vamos pensar.';

const context: CompactedContext = {
  statements: [
    {
      id: 'st-001',
      text: 'Carlos considerou adiar a entrega.',
      quote: 'acho que deveriamos adiar a entrega',
      anchor: { start: transcript.indexOf('acho'), end: transcript.indexOf('acho') + 35, exact: true },
      kind: 'argument',
    },
  ],
  entities: { people: ['Carlos'], projects: [], companies: [], technologies: [] },
};

const decisoes = TEMPLATES.ata.sections.find((s) => s.id === 'decisoes')!;
const conclusao = TEMPLATES.ata.sections.find((s) => s.id === 'conclusao')!;

const reply = (parsed: unknown) => ({
  text: JSON.stringify(parsed),
  parsed,
  usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
  meta: { provider: 'google', model: 'falso', latencyMs: 1, repaired: false, rateLimitWaits: 0, overloadWaits: 0 },
});

const umaDecisao = {
  decisions: [
    { text: 'Adiar a entrega', evidence: 'Carlos propôs', confidence: 'high', statementIds: ['st-001'] },
  ],
};

const run = () =>
  runSection({ context, section: decisoes, transcript, known: {}, answers: [] });

afterEach(() => complete.mockReset());

describe('seção não-strict', () => {
  it('não chama o Auditor', async () => {
    complete.mockResolvedValueOnce(reply({ text: 'Parágrafo executivo.' }));

    const result = await runSection({
      context,
      section: conclusao,
      transcript,
      known: {},
      answers: [],
    });

    expect(result.audited).toBe(false);
    expect(result.passes).toBe(1);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

describe('seção strict', () => {
  it('aprovada de primeira: uma passada, nada descartado', async () => {
    complete
      .mockResolvedValueOnce(reply(umaDecisao))
      .mockResolvedValueOnce(reply({ supported: true, reason: 'o trecho mostra a decisão' }));

    const result = await run();

    expect(result.passes).toBe(1);
    expect(result.audited).toBe(true);
    expect(result.discarded).toEqual([]);
    expect(result.data.decisions).toHaveLength(1);
  });

  it('rejeitada e corrigida: duas passadas, nada descartado', async () => {
    complete
      .mockResolvedValueOnce(reply(umaDecisao))
      .mockResolvedValueOnce(reply({ supported: false, reason: 'é proposta, não decisão' }))
      .mockResolvedValueOnce(reply(umaDecisao))
      .mockResolvedValueOnce(reply({ supported: true, reason: 'agora sustenta' }));

    const result = await run();

    expect(result.passes).toBe(2);
    expect(result.discarded).toEqual([]);
    expect(result.data.decisions).toHaveLength(1);
  });

  it('rejeitada DUAS vezes: descartada, fora do documento', async () => {
    complete
      .mockResolvedValueOnce(reply(umaDecisao))
      .mockResolvedValueOnce(reply({ supported: false, reason: 'é proposta, não decisão' }))
      .mockResolvedValueOnce(reply(umaDecisao))
      .mockResolvedValueOnce(reply({ supported: false, reason: 'continua sendo proposta' }));

    const result = await run();

    expect(result.passes).toBe(MAX_PASSES);
    expect(result.data.decisions).toEqual([]);
    expect(result.discarded).toHaveLength(1);
    expect(result.discarded[0]!.text).toContain('Adiar a entrega');
  });

  it('a afirmação descartada vira lacuna, não silêncio', async () => {
    // Some do documento, mas o documento precisa mostrar que ali FALTA algo,
    // e não que ali não havia nada.
    complete
      .mockResolvedValueOnce(reply(umaDecisao))
      .mockResolvedValueOnce(reply({ supported: false, reason: 'proposta' }))
      .mockResolvedValueOnce(reply(umaDecisao))
      .mockResolvedValueOnce(reply({ supported: false, reason: 'proposta' }));

    const result = await run();

    expect(result.gaps.some((g) => g.field === 'decisions[0]')).toBe(true);
    expect(result.gaps.find((g) => g.field === 'decisions[0]')!.why).toContain('Rejeitada duas vezes');
  });

  it('nunca passa de duas passadas, mesmo rejeitando sempre', async () => {
    // Sem teto isto seria laço infinito gastando dinheiro.
    complete.mockImplementation(async (agent: string) =>
      agent === 'auditor' ? reply({ supported: false, reason: 'não' }) : reply(umaDecisao),
    );

    const result = await run();

    expect(result.passes).toBe(MAX_PASSES);
    // 2 do Pensante + 2 do Auditor.
    expect(complete).toHaveBeenCalledTimes(4);
  });

  it('a segunda passada recebe a justificativa da rejeição', async () => {
    complete
      .mockResolvedValueOnce(reply(umaDecisao))
      .mockResolvedValueOnce(reply({ supported: false, reason: 'MOTIVO ESPECIFICO DA REJEICAO' }))
      .mockResolvedValueOnce(reply({ decisions: [] }))
      .mockResolvedValueOnce(reply({ supported: true, reason: 'ok' }));

    await run();

    const segundaChamadaDoPensante = complete.mock.calls[2]!;
    const pedido = segundaChamadaDoPensante[1].messages[0].content;
    expect(pedido).toContain('MOTIVO ESPECIFICO DA REJEICAO');
    expect(pedido).toContain('REJEITADAS');
  });

  it('afirmação sem âncora é rejeitada sem gastar chamada de modelo', async () => {
    // Sem trecho não há o que auditar. Aprovar por omissão seria o oposto
    // do propósito do Auditor.
    complete.mockImplementation(async (agent: string) =>
      agent === 'auditor'
        ? reply({ supported: true, reason: 'nunca deveria ser chamado' })
        : reply({
            decisions: [
              { text: 'D', evidence: 'E', confidence: 'low', statementIds: ['id-inexistente'] },
            ],
          }),
    );

    const result = await run();

    expect(result.data.decisions).toEqual([]);
    // 2 do Pensante e NENHUMA do Auditor.
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('soma o usage das quatro chamadas', async () => {
    complete.mockImplementation(async (agent: string) =>
      agent === 'auditor' ? reply({ supported: false, reason: 'não' }) : reply(umaDecisao),
    );

    const result = await run();

    expect(result.usage.inputTokens).toBe(40);
    expect(result.usage.outputTokens).toBe(20);
  });
});
