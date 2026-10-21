/**
 * `requestGeneration` diz à pessoa o que o servidor disse — dados sintéticos.
 *
 * Seguram: a frase do servidor (cota, provedor ocupado) chega à tela em vez de
 * "erro (429)", o jargão de quem opera o servidor não chega, e reunião sem
 * fala nem vai ao servidor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestGeneration } from './generateDocument';

const REUNIAO = {
  title: 'Daily',
  startedAt: Date.UTC(2026, 9, 21, 12),
  segments: [{ id: 's1', speaker: 'Ana', text: 'O deploy ficou para sexta.', startedAt: 0, endedAt: 1 }],
} as unknown as Parameters<typeof requestGeneration>[0];

const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

describe('requestGeneration', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it('a cota do dia chega dita como o servidor disse', async () => {
    const frase = 'O provedor de IA atingiu a cota do dia. O documento só pode ser gerado quando ela reabrir.';
    fetchMock.mockResolvedValue(resposta(429, { error: frase }));
    const r = await requestGeneration(REUNIAO, 'ata');
    expect(r).toEqual({ status: 'error', documentType: 'ata', message: frase });
  });

  it('a chave recusada não manda conferir variável de ambiente', async () => {
    fetchMock.mockResolvedValue(resposta(401, { error: 'x' }));
    const r = await requestGeneration(REUNIAO, 'ata');
    expect(r.status).toBe('error');
    expect((r as { message: string }).message).not.toContain('DOCCITI_SHARED_KEY');
  });

  it('servidor fora do ar não manda abrir o console', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed'));
    const r = await requestGeneration(REUNIAO, 'ata');
    expect((r as { message: string }).message).toContain('Confira a internet');
    expect((r as { message: string }).message).not.toMatch(/F12|console/);
  });

  it('reunião sem fala nem chega ao servidor', async () => {
    const r = await requestGeneration({ ...REUNIAO, segments: [] }, 'ata');
    expect(fetchMock).not.toHaveBeenCalled();
    expect((r as { message: string }).message).toContain('não tem fala registrada');
  });
});
