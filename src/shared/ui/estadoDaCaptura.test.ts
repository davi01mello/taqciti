import { describe, expect, it } from 'vitest';
import {
  ERRO_APOS_MS,
  INICIANDO_MS,
  SEM_TRECHO_MS,
  derivarEstadoDaCaptura,
  type SinaisDaCaptura,
} from './estadoDaCaptura';

const T0 = 1_000_000;
const gravando = (p: Partial<SinaisDaCaptura> = {}): SinaisDaCaptura => ({
  phase: 'recording',
  startedAt: T0,
  lastChunkAt: null,
  falas: 0,
  ...p,
});

describe('derivarEstadoDaCaptura', () => {
  it('sem sessão ou ociosa: desligada', () => {
    expect(derivarEstadoDaCaptura({ phase: 'idle', session: null })).toBe('desligada');
    expect(derivarEstadoDaCaptura(gravando({ startedAt: null }), T0)).toBe('desligada');
  });

  it('legendas ainda sendo ligadas: preparando', () => {
    expect(derivarEstadoDaCaptura(gravando({ phase: 'captionsRequired' }), T0)).toBe('preparando');
  });

  it('primeiros segundos sem trecho: iniciando; depois, aguardando fonte', () => {
    expect(derivarEstadoDaCaptura(gravando(), T0 + INICIANDO_MS - 1)).toBe('iniciando');
    expect(derivarEstadoDaCaptura(gravando(), T0 + INICIANDO_MS)).toBe('aguardando_fonte');
  });

  it('trecho recente: capturando; muito tempo sem trecho: aguardando fonte (não é erro)', () => {
    const s = gravando({ lastChunkAt: T0 + 10_000, falas: 3 });
    expect(derivarEstadoDaCaptura(s, T0 + 20_000)).toBe('capturando');
    expect(derivarEstadoDaCaptura(s, T0 + 10_000 + SEM_TRECHO_MS + 1)).toBe('aguardando_fonte');
  });

  it('leitura impossível: interrompida de início, erro quando persiste', () => {
    const s = gravando({ lastChunkAt: T0 + 10_000, falas: 3, captureHealthy: false });
    expect(derivarEstadoDaCaptura(s, T0 + 20_000)).toBe('interrompida');
    expect(derivarEstadoDaCaptura(s, T0 + 10_000 + ERRO_APOS_MS + 1)).toBe('erro');
  });

  it('leitura impossível sem nenhum trecho conta desde o início da sessão', () => {
    const s = gravando({ captureHealthy: false });
    expect(derivarEstadoDaCaptura(s, T0 + ERRO_APOS_MS - 1)).toBe('interrompida');
    expect(derivarEstadoDaCaptura(s, T0 + ERRO_APOS_MS + 1)).toBe('erro');
  });

  it('pausada e encerrada', () => {
    expect(derivarEstadoDaCaptura(gravando({ phase: 'paused' }), T0)).toBe('pausada');
    expect(derivarEstadoDaCaptura(gravando({ phase: 'ended', falas: 2 }), T0)).toBe('salva');
    expect(derivarEstadoDaCaptura(gravando({ phase: 'ended', falas: 0 }), T0)).toBe('desligada');
  });
});
