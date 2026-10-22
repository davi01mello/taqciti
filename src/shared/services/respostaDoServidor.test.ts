/**
 * `comPrazo`: depois do corte, distingue quem cortou — a pessoa (cancelar,
 * que não ganha mensagem) ou o prazo (que ganha).
 */
import { describe, expect, it } from 'vitest';
import { comPrazo } from './respostaDoServidor';

const esperarAborto = (s: AbortSignal) =>
  new Promise<void>((ok) => (s.aborted ? ok() : s.addEventListener('abort', () => ok())));

describe('comPrazo', () => {
  it('o prazo corta e se diz esgotado', async () => {
    const corte = comPrazo(undefined, 20);
    await esperarAborto(corte.signal);
    expect(corte.esgotado()).toBe(true);
    expect(corte.cancelado()).toBe(false);
  });

  it('o cancelar de quem pediu corta e não se diz esgotado', async () => {
    const controle = new AbortController();
    const corte = comPrazo(controle.signal, 60_000);
    controle.abort();
    await esperarAborto(corte.signal);
    expect(corte.cancelado()).toBe(true);
    expect(corte.esgotado()).toBe(false);
  });
});
