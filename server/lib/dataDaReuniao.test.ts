import { afterEach, describe, expect, it } from 'vitest';
import { formatarDataDaReuniao } from './dataDaReuniao';

afterEach(() => {
  delete process.env.DOCCITI_TIMEZONE;
});

describe('formatarDataDaReuniao', () => {
  it('formata como DD/MM/AAAA', () => {
    expect(formatarDataDaReuniao('2026-08-22T14:30:00.000Z')).toBe('22/08/2026');
  });

  /*
   * O BUG QUE ISTO EXISTE PARA PEGAR.
   *
   * Reunião às 21h de 22/08 em São Paulo é 00:00Z de 23/08. Formatar o ISO em
   * UTC escreveria 23/08 — toda reunião da noite sairia com a data do dia
   * seguinte, num campo que ninguém confere.
   */
  it('usa o fuso do documento, não UTC', () => {
    expect(formatarDataDaReuniao('2026-08-23T00:00:00.000Z')).toBe('22/08/2026');
    expect(formatarDataDaReuniao('2026-08-23T02:59:00.000Z')).toBe('22/08/2026');
    expect(formatarDataDaReuniao('2026-08-23T03:00:00.000Z')).toBe('23/08/2026');
  });

  it('honra DOCCITI_TIMEZONE, para time fora do Brasil', () => {
    process.env.DOCCITI_TIMEZONE = 'UTC';
    expect(formatarDataDaReuniao('2026-08-23T00:00:00.000Z')).toBe('23/08/2026');

    process.env.DOCCITI_TIMEZONE = 'Asia/Tokyo';
    expect(formatarDataDaReuniao('2026-08-22T20:00:00.000Z')).toBe('23/08/2026');
  });

  it('preenche com zero à esquerda', () => {
    expect(formatarDataDaReuniao('2026-01-05T15:00:00.000Z')).toBe('05/01/2026');
  });

  /*
   * Ausente ou inválida devolve `undefined`, NUNCA a data de hoje. Um palpite
   * silencioso poria uma data errada numa ata que vai para cliente; a lacuna
   * honesta (`[A preencher: data]`) é muito menos pior.
   */
  it.each([undefined, '', '   ', 'ontem', 'não sei', '2026-13-45T99:99:99Z'])(
    'devolve undefined para %s em vez de chutar',
    (entrada) => {
      expect(formatarDataDaReuniao(entrada)).toBeUndefined();
    },
  );
});
