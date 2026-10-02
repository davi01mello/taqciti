import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * A conferência em LOTE: todas as afirmações numa chamada só, cada uma com o
 * seu trecho. O que precisa estar certo é o casamento veredito ↔ afirmação —
 * um veredito aplicado à afirmação errada aprova um cargo inventado — e o
 * "na dúvida, rejeitar" quando o modelo pula alguma.
 */
const complete = vi.hoisted(() => vi.fn());
vi.mock('../ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai')>()),
  complete,
}));

const { auditar } = await import('./auditor');
import type { AuditableClaim } from '../documentData';

const transcript = 'Maria, gerente de dados, abriu. Joao explicou o pipeline. Ana: fechado, sexta.';
const ancora = (quote: string) => {
  const start = transcript.indexOf(quote);
  return { start, end: start + quote.length, exact: true };
};

const claims: AuditableClaim[] = [
  { path: 'participants[0]', text: 'Maria tem o cargo de Gerente de Dados.', anchors: [ancora('Maria, gerente de dados')] },
  { path: 'participants[1]', text: 'Joao tem o cargo de Engenheiro.', anchors: [ancora('Joao explicou o pipeline.')] },
  { path: 'decisions[0]', text: 'Foi DECIDIDO: entregar sexta.', anchors: [], blocker: 'sem concordância' },
  { path: 'decisions[1]', text: 'Foi DECIDIDO: fechar sexta.', anchors: [ancora('fechado, sexta.')] },
];

const reply = (parsed: unknown) => ({
  text: JSON.stringify(parsed),
  parsed,
  usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
  meta: { provider: 'google', model: 'falso', latencyMs: 1, repaired: false, rateLimitWaits: 0, overloadWaits: 0 },
});

afterEach(() => complete.mockReset());

describe('auditar em lote', () => {
  it('uma chamada para todas as afirmações que precisam de modelo', async () => {
    complete.mockResolvedValue(
      reply({
        verdicts: [
          { id: 'a1', supported: true, reason: 'cargo explícito' },
          { id: 'a2', supported: false, reason: 'não mostra cargo' },
          { id: 'a3', supported: true, reason: 'fechado' },
        ],
      }),
    );

    const { verdicts, rejected, calls } = await auditar({ claims, transcript });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    // Na ordem das afirmações recebidas, com o bloqueio de código no meio.
    expect(verdicts.map((v) => [v.path, v.supported])).toEqual([
      ['participants[0]', true],
      ['participants[1]', false],
      ['decisions[0]', false],
      ['decisions[1]', true],
    ]);
    expect(rejected.map((v) => v.path)).toEqual(['participants[1]', 'decisions[0]']);
  });

  it('cada afirmação leva o PRÓPRIO trecho, e a bloqueada em código nem vai', async () => {
    complete.mockResolvedValue(reply({ verdicts: [] }));
    await auditar({ claims, transcript });

    const blocos = complete.mock.calls[0]![1].messages[0].content.split('\n\n---\n\n');
    expect(blocos).toHaveLength(3);
    expect(blocos[0]).toContain('# Afirmação a1');
    expect(blocos[0]).toContain('⟦Maria, gerente de dados⟧');
    expect(blocos[1]).toContain('⟦Joao explicou o pipeline.⟧');
    expect(complete.mock.calls[0]![1].messages[0].content).not.toContain('entregar sexta');
  });

  it('veredito que o modelo pulou conta como rejeição', async () => {
    complete.mockResolvedValue(reply({ verdicts: [{ id: 'a1', supported: true, reason: 'ok' }] }));
    const { verdicts } = await auditar({ claims, transcript });

    const joao = verdicts.find((v) => v.path === 'participants[1]')!;
    expect(joao.supported).toBe(false);
    expect(joao.reason).toMatch(/não devolveu veredito/);
  });

  it('id repetido: vale o primeiro, não o que "corrige" depois', async () => {
    complete.mockResolvedValue(
      reply({
        verdicts: [
          { id: 'a2', supported: false, reason: 'não mostra cargo' },
          { id: 'a2', supported: true, reason: 'mudei de ideia' },
        ],
      }),
    );
    const { verdicts } = await auditar({ claims, transcript });
    expect(verdicts.find((v) => v.path === 'participants[1]')!.supported).toBe(false);
  });

  it('nada que precise de modelo: nenhuma chamada', async () => {
    const { verdicts } = await auditar({ claims: [claims[2]!], transcript });
    expect(complete).not.toHaveBeenCalled();
    expect(verdicts[0]!.supported).toBe(false);
  });
});
