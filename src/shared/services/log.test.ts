import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from './log';

afterEach(() => vi.restoreAllMocks());

describe('logger com redação central', () => {
  it('nunca imprime mensagem de exceção nem campos sensíveis', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logger.error('falhou', new Error('token=segredo trecho da transcrição'));
    logger.info('aceita', {
      clientMeetingId: 'meeting-safe-id',
      title: 'Cliente Ultra Secreto',
      transcript: 'fala que não pode sair',
      authorization: 'Bearer segredo',
    });

    const serialized = JSON.stringify([errorSpy.mock.calls, infoSpy.mock.calls]);
    expect(serialized).not.toContain('segredo');
    expect(serialized).not.toContain('fala que não pode sair');
    expect(serialized).not.toContain('Cliente Ultra Secreto');
    expect(serialized).toContain('Error');
    expect(serialized).toContain('meeting-safe-id');
  });
});
