/**
 * O adaptador da Groq e o limite de tokens por minuto do plano gratuito.
 * Sem rede: o `fetch` é falso, e o que se confere é o PEDIDO que sai.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitError } from '../types';
import { estimarTokens, groqProvider, limiteDeTokensPorMinuto, saidaQueCabe } from './groq';

const SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
const resposta = (corpo: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(corpo), { status, headers });
const ok = () =>
  resposta({
    choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 10 },
  });

let fetchFalso: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv('GROQ_API_KEY', 'gsk_teste');
  fetchFalso = vi.fn(async () => ok());
  vi.stubGlobal('fetch', fetchFalso);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const pedido = (extra: Record<string, unknown> = {}) => ({
  system: 'sistema',
  messages: [{ role: 'user' as const, content: 'conteudo' }],
  maxTokens: 48_000,
  jsonSchema: SCHEMA,
  ...extra,
});
const corpoEnviado = () => JSON.parse((fetchFalso.mock.calls[0]![1] as { body: string }).body);

describe('a conta do limite', () => {
  it('o padrão é 8000, e GROQ_TPM_LIMIT sobrescreve', () => {
    expect(limiteDeTokensPorMinuto()).toBe(8000);
    vi.stubEnv('GROQ_TPM_LIMIT', '30000');
    expect(limiteDeTokensPorMinuto()).toBe(30_000);
    vi.stubEnv('GROQ_TPM_LIMIT', 'lixo');
    expect(limiteDeTokensPorMinuto()).toBe(8000);
  });

  it('estima ~3,5 caracteres por token (medido: 3,77)', () => {
    expect(estimarTokens('a'.repeat(350))).toBe(100);
  });

  it('a saída é o que sobra do limite, nunca mais que o pedido', () => {
    expect(saidaQueCabe(5000, 48_000, 8000)).toBe(2750);
    expect(saidaQueCabe(1000, 500, 8000)).toBe(500);
  });

  it('entrada que não deixa espaço para resposta útil não cabe', () => {
    expect(saidaQueCabe(7000, 48_000, 8000)).toBeNull();
  });
});

describe('o pedido que sai', () => {
  it('reduz o max_tokens para caber no limite (o Leitor pede 48 mil)', async () => {
    await groqProvider.complete('openai/gpt-oss-120b', pedido());
    expect(corpoEnviado().max_tokens).toBeLessThanOrEqual(8000);
    expect(corpoEnviado().max_tokens).toBeGreaterThanOrEqual(1200);
  });

  it('com orçamento apertado usa raciocínio low (no gpt-oss ele sai do mesmo max_tokens)', async () => {
    // ~5000 tokens de entrada (uma transcrição real): sobram ~2700 para a saída.
    const transcricao = 'x'.repeat(15_000);
    await groqProvider.complete(
      'openai/gpt-oss-120b',
      pedido({ reasoning: 'high', messages: [{ role: 'user', content: transcricao }] }),
    );
    expect(corpoEnviado().reasoning_effort).toBe('low');
    expect(corpoEnviado().max_tokens).toBeLessThan(4000);
  });

  it('com limite folgado respeita o raciocínio pedido', async () => {
    vi.stubEnv('GROQ_TPM_LIMIT', '200000');
    await groqProvider.complete('openai/gpt-oss-120b', pedido({ reasoning: 'high', maxTokens: 20_000 }));
    expect(corpoEnviado().reasoning_effort).toBe('high');
    expect(corpoEnviado().max_tokens).toBe(20_000);
  });

  it('não manda reasoning_effort a modelo que não é gpt-oss', async () => {
    await groqProvider.complete('llama-3.3-70b-versatile', pedido());
    expect(corpoEnviado()).not.toHaveProperty('reasoning_effort');
  });

  it('pede saída estruturada, sem strict (campo ausente é lacuna)', async () => {
    await groqProvider.complete('openai/gpt-oss-120b', pedido());
    expect(corpoEnviado().response_format.type).toBe('json_schema');
    expect(corpoEnviado().response_format.json_schema).not.toHaveProperty('strict');
  });

  it('entrada grande demais falha ANTES da rede, com a conta na mensagem', async () => {
    const enorme = 'palavra '.repeat(4000); // ~10 mil tokens
    await expect(
      groqProvider.complete('openai/gpt-oss-120b', pedido({ messages: [{ role: 'user', content: enorme }] })),
    ).rejects.toThrow(/só de entrada[\s\S]*8000 por minuto/);
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});

describe('os erros da Groq', () => {
  it('429 por minuto é cota passageira; por dia é cota do dia', async () => {
    fetchFalso.mockImplementation(async () =>
      resposta({ error: { message: 'Rate limit reached ... on tokens per minute (TPM)' } }, 429, { 'retry-after': '1' }),
    );
    // o laço de espera se esgota e relança o erro de cota
    const porMinuto = await groqProvider
      .complete('openai/gpt-oss-120b', pedido(), )
      .catch((e: unknown) => e);
    expect(porMinuto).toBeInstanceOf(RateLimitError);
    expect((porMinuto as RateLimitError).perDay).toBe(false);

    fetchFalso.mockImplementation(async () =>
      resposta({ error: { message: 'Rate limit reached ... on tokens per day (TPD): Limit 200000' } }, 429),
    );
    const porDia = await groqProvider.complete('openai/gpt-oss-120b', pedido()).catch((e: unknown) => e);
    expect((porDia as RateLimitError).perDay).toBe(true);
  }, 60_000);

  it('413 vira erro claro de pedido grande demais', async () => {
    fetchFalso.mockImplementation(async () => resposta({ error: { message: 'Request too large' } }, 413));
    await expect(groqProvider.complete('openai/gpt-oss-120b', pedido())).rejects.toThrow(/grande demais/);
  });
});
