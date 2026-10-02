import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O raciocínio por chamada, com o SDK do Google simulado. É a alavanca de
 * custo que o chamador controla — raciocínio é cobrado como saída —, e a
 * forma dela muda entre as famílias 2.5 e 3.x: mandar a errada é 400.
 */
const generateContent = vi.hoisted(() => vi.fn());

vi.mock('@google/genai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@google/genai')>()),
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

const { googleProvider, thinkingConfigFor } = await import('./google');

const pedido = (extra: Record<string, unknown> = {}) => ({
  system: 'sistema',
  messages: [{ role: 'user' as const, content: 'pedido' }],
  maxTokens: 1000,
  ...extra,
});

beforeEach(() => {
  vi.stubEnv('GOOGLE_API_KEY', 'chave-de-teste');
  generateContent.mockResolvedValue({
    text: '{"ok":true}',
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 40 },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  generateContent.mockReset();
});

describe('raciocínio por chamada', () => {
  it('o pedido do chamador vence a tabela por modelo', async () => {
    await googleProvider.complete('gemini-3.5-flash', pedido({ reasoning: 'low' }));
    expect(generateContent.mock.calls[0]![0].config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
  });

  it('sem pedido, fica o padrão do modelo', () => {
    expect(thinkingConfigFor('gemini-3.5-flash')).toEqual({ thinkingConfig: { thinkingLevel: 'HIGH' } });
    expect(thinkingConfigFor('gemini-3.5-flash-lite')).toEqual({ thinkingConfig: { thinkingLevel: 'LOW' } });
  });

  it('família 2.5 recebe orçamento em tokens', () => {
    expect(thinkingConfigFor('gemini-2.5-flash', 'low')).toEqual({ thinkingConfig: { thinkingBudget: 1024 } });
    expect(thinkingConfigFor('gemini-2.5-flash', 'high')).toEqual({ thinkingConfig: { thinkingBudget: -1 } });
  });

  it('o raciocínio entra na conta de saída', async () => {
    // `thoughtsTokenCount` vem separado de `candidatesTokenCount` e é cobrado
    // como saída; ignorá-lo subestimaria justamente o que mais custa.
    const r = await googleProvider.complete('gemini-3.5-flash', pedido());
    expect(r.usage.outputTokens).toBe(50);
  });
});
