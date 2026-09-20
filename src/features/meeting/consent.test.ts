/**
 * A decisão sobre registrar a reunião. O que se testa é o que a pessoa nota:
 * a pergunta não volta depois de respondida.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';

beforeEach(() => {
  vi.resetModules();
  installChromeStorageMock();
});

describe('consentimento de registro', () => {
  it('sem resposta ainda, não há decisão', async () => {
    const { decisaoDe } = await import('./consent');
    await expect(decisaoDe('abc-defg-hij')).resolves.toBeNull();
  });

  it('lembra o aceite da sala', async () => {
    const { decisaoDe, guardarDecisao } = await import('./consent');
    await guardarDecisao('abc-defg-hij', 'aceito');
    await expect(decisaoDe('abc-defg-hij')).resolves.toBe('aceito');
  });

  /* O caso que importa: recusar e a pergunta NÃO voltar no próximo render. */
  it('lembra a recusa da sala', async () => {
    const { decisaoDe, guardarDecisao } = await import('./consent');
    await guardarDecisao('abc-defg-hij', 'recusado');
    await expect(decisaoDe('abc-defg-hij')).resolves.toBe('recusado');
  });

  it('a decisão é por sala, não global', async () => {
    const { decisaoDe, guardarDecisao } = await import('./consent');
    await guardarDecisao('sala-um', 'recusado');
    await expect(decisaoDe('sala-dois')).resolves.toBeNull();
  });

  it('mudar de ideia sobrescreve', async () => {
    const { decisaoDe, guardarDecisao } = await import('./consent');
    await guardarDecisao('sala', 'recusado');
    await guardarDecisao('sala', 'aceito');
    await expect(decisaoDe('sala')).resolves.toBe('aceito');
  });

  it('lixo no storage não vira decisão', async () => {
    const { STORAGE_KEYS } = await import('@/shared/config/constants');
    await chrome.storage.session.set({ [STORAGE_KEYS.meetingConsent]: 'talvez' });
    const { decisaoDe } = await import('./consent');
    await expect(decisaoDe('sala')).resolves.toBeNull();
  });
});

