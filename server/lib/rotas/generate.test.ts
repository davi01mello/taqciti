/**
 * Quando o provedor de IA falha, a rota diz por quê.
 *
 * Antes o erro subia sem tratamento e o Next respondia 500 com o corpo vazio
 * (`{"error":""}`): quem chamava via a cota diária do Gemini estourar como
 * "erro do servidor, sem motivo". A rota de documentos personalizados já
 * respondia 429 com a mensagem; esta passou a responder igual.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { OverloadedError, RateLimitError } from '@/lib/ai/types';

const gerar = vi.fn();
vi.mock('@/lib/generateDocument', async (importarOriginal) => ({
  ...(await importarOriginal<typeof import('@/lib/generateDocument')>()),
  generateDocument: (...args: unknown[]) => gerar(...args),
}));

import { POST } from '@/app/api/generate/route';

const CHAVE = 'chave-de-teste';
const pedir = () =>
  POST(
    new NextRequest('http://localhost/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-docciti-key': CHAVE },
      body: JSON.stringify({ transcript: '[00:01] A: oi', documentType: 'daily' }),
    }),
  );

beforeEach(() => {
  vi.stubEnv('DOCCITI_SHARED_KEY', CHAVE);
  vi.stubEnv('DOCCITI_DATA_POLICY', '');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  gerar.mockReset();
});

describe('POST /api/generate — falha do provedor', () => {
  it('cota diária vira 429 com mensagem', async () => {
    gerar.mockRejectedValue(new RateLimitError('google', 'gemini', 'cota', 41_900_000, undefined, true));
    const r = await pedir();
    expect(r.status).toBe(429);
    expect((await r.json()).error).toMatch(/cota do dia/);
  });

  it('sobrecarga vira 503 com mensagem', async () => {
    gerar.mockRejectedValue(new OverloadedError('google', 'gemini', 'sobrecarregado'));
    const r = await pedir();
    expect(r.status).toBe(503);
    expect((await r.json()).error).toMatch(/sobrecarregado/);
  });

  it('erro desconhecido vira 502 com mensagem — nunca corpo vazio', async () => {
    gerar.mockRejectedValue(new Error('qualquer coisa'));
    const r = await pedir();
    expect(r.status).toBe(502);
    expect((await r.json()).error).not.toBe('');
  });

  it('sucesso continua 200', async () => {
    gerar.mockResolvedValue({ title: 't', content: 'c', html: '', questions: [], gaps: [] });
    expect((await pedir()).status).toBe(200);
  });
});
