import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { TEXTO_DO_AVISO, avisarParticipantes, avisoJaEnviado } from './chatNotice';

beforeEach(() => {
  installChromeStorageMock();
});

describe('avisarParticipantes — o aviso automático no chat', () => {
  it('envia o texto fixo uma vez e registra; a segunda vez não reenvia', async () => {
    const enviar = vi.fn(async () => true);
    expect(await avisarParticipantes('m1', enviar)).toBe(true);
    expect(enviar).toHaveBeenCalledWith(TEXTO_DO_AVISO);
    expect(await avisoJaEnviado('m1')).toBe(true);

    await avisarParticipantes('m1', enviar);
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('falha no envio não vira registro: o botão da sidebar continua oferecendo', async () => {
    expect(await avisarParticipantes('m2', async () => false)).toBe(false);
    expect(await avisarParticipantes('m3', async () => Promise.reject(new Error('aba fechada')))).toBe(false);
    expect(await avisoJaEnviado('m2')).toBe(false);
    expect(await avisoJaEnviado('m3')).toBe(false);
  });
});
