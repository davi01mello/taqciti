import { describe, expect, it, vi } from 'vitest';
import { backoffDelayMs, parseRetryAfter, runCompletion, withRateLimitRetry } from './shared';
import { ProviderError, RateLimitError } from '../types';

const rateLimited = (retryAfterMs?: number) =>
  new RateLimitError('google', 'modelo-falso', 'cota estourada (429)', retryAfterMs);

/** Espera falsa: registra quanto teria dormido, sem dormir. */
function fakeWaiter() {
  const delays: number[] = [];
  return {
    delays,
    onWait: (ms: number) => {
      delays.push(ms);
    },
  };
}

describe('withRateLimitRetry', () => {
  it('não espera quando a primeira tentativa passa', async () => {
    const waiter = fakeWaiter();
    const call = vi.fn().mockResolvedValue('pronto');

    const { value, waits } = await withRateLimitRetry(call, { onWait: waiter.onWait });

    expect(value).toBe('pronto');
    expect(waits).toBe(0);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('repete em 429 e conta as esperas', async () => {
    const waiter = fakeWaiter();
    const call = vi
      .fn()
      .mockRejectedValueOnce(rateLimited())
      .mockRejectedValueOnce(rateLimited())
      .mockResolvedValue('pronto');

    const { value, waits } = await withRateLimitRetry(call, { maxRetries: 5, onWait: waiter.onWait });

    expect(value).toBe('pronto');
    expect(waits).toBe(2);
    expect(waiter.delays).toHaveLength(2);
  });

  it('NÃO repete erro que não é 429', async () => {
    // Repetir um 401 ou um schema inválido dá o mesmo erro cinco vezes mais
    // devagar, e esconde a causa atrás de um minuto de espera.
    const waiter = fakeWaiter();
    const call = vi.fn().mockRejectedValue(new ProviderError('xai', 'm', 'chave inválida'));

    await expect(
      withRateLimitRetry(call, { maxRetries: 5, onWait: waiter.onWait }),
    ).rejects.toThrow(/chave inválida/);

    expect(call).toHaveBeenCalledTimes(1);
    expect(waiter.delays).toHaveLength(0);
  });

  it('desiste depois do teto e propaga o 429', async () => {
    const waiter = fakeWaiter();
    const call = vi.fn().mockRejectedValue(rateLimited());

    await expect(
      withRateLimitRetry(call, { maxRetries: 2, onWait: waiter.onWait }),
    ).rejects.toBeInstanceOf(RateLimitError);

    // 1 tentativa inicial + 2 repetições.
    expect(call).toHaveBeenCalledTimes(3);
    expect(waiter.delays).toHaveLength(2);
  });

  it('com teto zero, não repete nada', async () => {
    const call = vi.fn().mockRejectedValue(rateLimited());
    await expect(withRateLimitRetry(call, { maxRetries: 0 })).rejects.toBeInstanceOf(RateLimitError);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('respeita o retry-after do provedor em vez do backoff cego', async () => {
    const waiter = fakeWaiter();
    const call = vi.fn().mockRejectedValueOnce(rateLimited(3_000)).mockResolvedValue('pronto');

    await withRateLimitRetry(call, { maxRetries: 3, onWait: waiter.onWait });

    expect(waiter.delays[0]).toBe(3_000);
  });
});

describe('backoffDelayMs', () => {
  it('cresce com a tentativa', () => {
    // Com jitter de 50–100%, a tentativa 3 no pior caso ainda é maior que a
    // tentativa 0 no melhor caso.
    const cedo = backoffDelayMs(0);
    const tarde = backoffDelayMs(3);
    expect(tarde).toBeGreaterThan(cedo);
  });

  it('aplica jitter, não um valor fixo', () => {
    // Sem jitter, nove chamadas do Pensante que tomarem 429 juntas voltam
    // todas no mesmo milissegundo e tomam 429 de novo.
    const amostras = new Set(Array.from({ length: 30 }, () => backoffDelayMs(2)));
    expect(amostras.size).toBeGreaterThan(1);
  });

  it('respeita o teto mesmo em tentativa alta', () => {
    expect(backoffDelayMs(20)).toBeLessThanOrEqual(60_000);
  });

  it('trunca um retry-after absurdo no teto', () => {
    expect(backoffDelayMs(0, 999_999_999)).toBe(60_000);
  });
});

describe('parseRetryAfter', () => {
  it('lê segundos', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
  });

  it('lê data HTTP', () => {
    const futuro = new Date(Date.now() + 5_000).toUTCString();
    expect(parseRetryAfter(futuro)).toBeGreaterThan(0);
  });

  it('devolve undefined para ausente ou lixo', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter('logo ali')).toBeUndefined();
  });
});

describe('rateLimitWaits em runCompletion', () => {
  it('some as esperas da chamada principal e da de reparo', async () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] };
    let call = 0;
    const invoke = vi.fn().mockImplementation(async () => {
      call += 1;
      // 1ª: 429. 2ª: JSON inválido (dispara reparo). 3ª: 429. 4ª: válido.
      if (call === 1 || call === 3) throw rateLimited(1);
      if (call === 2) return { text: '{}', usage: { inputTokens: 5, outputTokens: 5 } };
      return { text: '{"a":"ok"}', usage: { inputTokens: 5, outputTokens: 5 } };
    });

    const result = await runCompletion(
      'google',
      'modelo-falso',
      { system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 10, jsonSchema: schema },
      { nativeStructuredOutput: true, maxRateLimitRetries: 3 },
      invoke,
    );

    expect(result.meta.rateLimitWaits).toBe(2);
    expect(result.meta.repaired).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it('reporta zero quando não houve 429', async () => {
    const invoke = vi.fn().mockResolvedValue({ text: 'ok', usage: { inputTokens: 1, outputTokens: 1 } });
    const result = await runCompletion(
      'anthropic',
      'modelo-falso',
      { system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 10 },
      { nativeStructuredOutput: true },
      invoke,
    );
    expect(result.meta.rateLimitWaits).toBe(0);
  });
});
