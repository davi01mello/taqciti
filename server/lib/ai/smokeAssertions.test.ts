import { describe, expect, it } from 'vitest';
import { assertUsable } from './smokeAssertions';
import type { CompletionResult } from './types';

function result(overrides: Partial<CompletionResult> = {}): CompletionResult {
  return {
    text: 'ok',
    usage: { inputTokens: 12, outputTokens: 3, cachedInputTokens: 0 },
    meta: {
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      latencyMs: 100,
      repaired: false,
      rateLimitWaits: 0,
    },
    ...overrides,
  };
}

describe('assertUsable', () => {
  it('aprova uma resposta sadia', () => {
    expect(assertUsable(result(), false)).toEqual([]);
  });

  // O caso que motiva o arquivo inteiro: HTTP 200, texto certo, e mesmo
  // assim o adaptador não leu o usage.
  it.each([
    ['zero', 0],
    ['negativo', -1],
    ['NaN', Number.NaN],
    ['ausente', undefined as unknown as number],
    ['nulo', null as unknown as number],
  ])('reprova inputTokens %s mesmo com texto válido', (_nome, inputTokens) => {
    const failures = assertUsable(result({ usage: { inputTokens, outputTokens: 3 } }), false);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join()).toContain('usage.inputTokens');
  });

  it('reprova outputTokens zero quando houve texto', () => {
    const failures = assertUsable(result({ usage: { inputTokens: 10, outputTokens: 0 } }), false);
    expect(failures.join()).toContain('usage.outputTokens');
  });

  it('reprova texto vazio', () => {
    expect(assertUsable(result({ text: '   ' }), false).join()).toContain('texto vazio');
  });

  it('reprova parsed ausente quando jsonSchema foi pedido', () => {
    expect(assertUsable(result(), true).join()).toContain('`parsed` veio vazio');
  });

  it('aceita parsed ausente quando jsonSchema NÃO foi pedido', () => {
    expect(assertUsable(result(), false)).toEqual([]);
  });

  it('aprova quando parsed veio preenchido e o schema foi pedido', () => {
    expect(assertUsable(result({ parsed: { a: 1 } }), true)).toEqual([]);
  });

  it('reprova modelo fora da tabela de preços', () => {
    const failures = assertUsable(
      result({
        meta: {
          provider: 'anthropic',
          model: 'modelo-inexistente',
          latencyMs: 1,
          repaired: false,
          rateLimitWaits: 0,
        },
      }),
      false,
    );
    expect(failures.join()).toContain('tabela de preços');
  });

  it('acumula todas as falhas em vez de parar na primeira', () => {
    // Corrigir uma de cada vez, com uma chamada paga entre elas, é o
    // caminho lento.
    const failures = assertUsable(
      result({ text: '', usage: { inputTokens: 0, outputTokens: 0 } }),
      true,
    );
    expect(failures.length).toBeGreaterThanOrEqual(4);
  });

  it('cachedInputTokens zero não é falha', () => {
    // Uma chamada única não exercita cache — zero aqui é o esperado, não um
    // defeito. Ver `naoVerificado` na resposta da rota de fumaça.
    expect(assertUsable(result({ usage: { inputTokens: 9, outputTokens: 2, cachedInputTokens: 0 } }), false))
      .toEqual([]);
  });
});
