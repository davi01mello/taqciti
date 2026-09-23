import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O cache explícito e o raciocínio por chamada, com o SDK do Google
 * simulado. O que precisa estar certo aqui é o que não dá para conferir sem
 * gastar: que o cache é criado UMA vez por transcrição, que a requisição com
 * cache não leva `systemInstruction` (é 400 no Gemini), e que qualquer falha
 * do cache cai na chamada normal em vez de derrubar a Ata.
 */
const generateContent = vi.hoisted(() => vi.fn());
const createCache = vi.hoisted(() => vi.fn());

vi.mock('@google/genai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@google/genai')>()),
  GoogleGenAI: class {
    models = { generateContent };
    caches = { create: createCache };
  },
}));

const { googleProvider, resetPrefixCachesForTests, MIN_CACHE_PREFIX_CHARS, thinkingConfigFor } =
  await import('./google');

const MODELO = 'gemini-3.5-flash';
const TRANSCRICAO = 'Ana: vamos manter o cronograma. '.repeat(Math.ceil(MIN_CACHE_PREFIX_CHARS / 30));

const resposta = (text = '{"ok":true}') => ({
  text,
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, cachedContentTokenCount: 90 },
});

const pedido = (secao: string, extra: Record<string, unknown> = {}) => ({
  system: 'sistema idêntico nas nove seções',
  messages: [{ role: 'user' as const, content: `# Seção: ${secao}` }],
  maxTokens: 1000,
  cacheablePrefix: TRANSCRICAO,
  ...extra,
});

beforeEach(() => {
  vi.stubEnv('GOOGLE_API_KEY', 'chave-de-teste');
  resetPrefixCachesForTests();
  createCache.mockResolvedValue({ name: 'cachedContents/abc' });
  generateContent.mockResolvedValue(resposta());
});

afterEach(() => {
  vi.unstubAllEnvs();
  generateContent.mockReset();
  createCache.mockReset();
});

describe('cache explícito da transcrição', () => {
  it('cria o cache uma vez e o reaproveita nas seções seguintes', async () => {
    await googleProvider.complete(MODELO, pedido('identificacao'));
    await googleProvider.complete(MODELO, pedido('participantes'));
    await googleProvider.complete(MODELO, pedido('decisoes'));

    expect(createCache).toHaveBeenCalledTimes(1);
    const criado = createCache.mock.calls[0]![0];
    expect(criado.model).toBe(MODELO);
    expect(criado.config.systemInstruction).toBe('sistema idêntico nas nove seções');
    expect(criado.config.contents[0].parts[0].text).toBe(TRANSCRICAO);

    for (const [chamada] of generateContent.mock.calls) {
      expect(chamada.config.cachedContent).toBe('cachedContents/abc');
      // Mandar systemInstruction junto com cachedContent é 400 no Gemini.
      expect(chamada.config.systemInstruction).toBeUndefined();
      // A transcrição NÃO vai de novo: só o pedido da seção.
      expect(chamada.contents).toHaveLength(1);
      expect(chamada.contents[0].parts[0].text).toMatch(/^# Seção: /);
    }
  });

  it('transcrição curta não cria cache', async () => {
    await googleProvider.complete(MODELO, { ...pedido('x'), cacheablePrefix: 'Ana: oi.' });

    expect(createCache).not.toHaveBeenCalled();
    const [chamada] = generateContent.mock.calls[0]!;
    expect(chamada.config.systemInstruction).toBe('sistema idêntico nas nove seções');
    expect(chamada.contents[0].parts[0].text).toMatch(/^Ana: oi\./);
  });

  it('criação recusada: segue sem cache e não tenta de novo', async () => {
    createCache.mockRejectedValue(new Error('400 cached content is too small'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const r = await googleProvider.complete(MODELO, pedido('identificacao'));
    await googleProvider.complete(MODELO, pedido('participantes'));

    expect(r.text).toBe('{"ok":true}');
    expect(createCache).toHaveBeenCalledTimes(1);
    for (const [chamada] of generateContent.mock.calls) {
      expect(chamada.config.cachedContent).toBeUndefined();
      expect(chamada.contents[0].parts[0].text.startsWith(TRANSCRICAO)).toBe(true);
    }
  });

  it('cache recusado na hora de usar (expirou): refaz a chamada sem ele', async () => {
    generateContent
      .mockRejectedValueOnce(new Error('403 CachedContent not found'))
      .mockResolvedValueOnce(resposta('{"de":"novo"}'));

    const r = await googleProvider.complete(MODELO, pedido('decisoes'));

    expect(r.text).toBe('{"de":"novo"}');
    const [, [semCache]] = generateContent.mock.calls as [unknown, [{ config: { cachedContent?: string; systemInstruction?: string } }]];
    expect(semCache.config.cachedContent).toBeUndefined();
    expect(semCache.config.systemInstruction).toBe('sistema idêntico nas nove seções');

    // E a seção seguinte cria um cache novo, em vez de insistir no morto.
    await googleProvider.complete(MODELO, pedido('outcomes'));
    expect(createCache).toHaveBeenCalledTimes(2);
  });

  it('429 com cache sobe para o laço de espera, sem virar chamada sem cache', async () => {
    vi.stubEnv('DOCCITI_RATE_LIMIT_RETRIES', '1');
    generateContent
      .mockRejectedValueOnce(Object.assign(new Error('429 RESOURCE_EXHAUSTED retryDelay: "0s"'), { status: 429 }))
      .mockResolvedValueOnce(resposta());

    await googleProvider.complete(MODELO, pedido('decisoes'));

    expect(generateContent).toHaveBeenCalledTimes(2);
    for (const [chamada] of generateContent.mock.calls) {
      expect(chamada.config.cachedContent).toBe('cachedContents/abc');
    }
  });

  it('DOCCITI_GEMINI_CACHE=off desliga', async () => {
    vi.stubEnv('DOCCITI_GEMINI_CACHE', 'off');
    await googleProvider.complete(MODELO, pedido('identificacao'));
    expect(createCache).not.toHaveBeenCalled();
  });

  it('o uso reportado conta o que veio do cache', async () => {
    const r = await googleProvider.complete(MODELO, pedido('identificacao'));
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 10, cachedInputTokens: 90 });
  });
});

describe('raciocínio por chamada', () => {
  it('o pedido do chamador vence a tabela por modelo', async () => {
    await googleProvider.complete(MODELO, pedido('identificacao', { reasoning: 'low' }));
    expect(generateContent.mock.calls[0]![0].config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
  });

  it('sem pedido, fica o padrão do modelo', () => {
    expect(thinkingConfigFor(MODELO)).toEqual({ thinkingConfig: { thinkingLevel: 'HIGH' } });
    expect(thinkingConfigFor('gemini-3.5-flash-lite')).toEqual({ thinkingConfig: { thinkingLevel: 'LOW' } });
  });

  it('família 2.5 recebe orçamento em tokens', () => {
    expect(thinkingConfigFor('gemini-2.5-flash', 'low')).toEqual({ thinkingConfig: { thinkingBudget: 1024 } });
    expect(thinkingConfigFor('gemini-2.5-flash', 'high')).toEqual({ thinkingConfig: { thinkingBudget: -1 } });
  });
});
