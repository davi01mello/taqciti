import { describe, expect, it } from 'vitest';
import { cutAgainstBaseline, resolveAgainstBaseline } from './recut';

describe('recorte contra a linha de base (retomar pausa / apagar transcrição)', () => {
  it('nada dito desde o recorte → texto vazio', () => {
    const cut = cutAgainstBaseline('falei isso durante a pausa', 'falei isso durante a pausa');
    expect(cut).toEqual({ text: '', baselineHolds: true });
  });

  it('fala nova entra sem arrastar o que foi dito na pausa', () => {
    const cut = cutAgainstBaseline(
      'falei isso durante a pausa e agora falo de novo',
      'falei isso durante a pausa',
    );
    expect(cut.text).toBe('e agora falo de novo');
    expect(cut.baselineHolds).toBe(true);
  });

  it('linha reaproveitada para outra fala mata a base e entra inteira', () => {
    const cut = cutAgainstBaseline('outra pessoa falando agora', 'falei isso durante a pausa');
    expect(cut).toEqual({ text: 'outra pessoa falando agora', baselineHolds: false });
  });

  it('base vazia devolve o texto intacto', () => {
    const cut = cutAgainstBaseline('primeira fala pós-retomada', '');
    expect(cut).toEqual({ text: 'primeira fala pós-retomada', baselineHolds: true });
  });
});

/**
 * A REGRA DA PAUSA. Estes casos são o bug relatado: pausar dois minutos,
 * retomar, e ver tudo o que foi falado durante a pausa entrar de uma vez.
 */
describe('resolveAgainstBaseline', () => {
  it('sem linha de base, o texto é fala nova', () => {
    expect(resolveAgainstBaseline('olá', undefined, false)).toEqual({
      action: 'emit',
      text: 'olá',
    });
  });

  it('nada dito desde o recorte: não emite', () => {
    expect(resolveAgainstBaseline('antes da pausa', 'antes da pausa', true)).toEqual({
      action: 'skip',
    });
  });

  it('a continuação da mesma fala emite só o trecho novo', () => {
    expect(
      resolveAgainstBaseline('primeira parte e a continuação', 'primeira parte', true),
    ).toEqual({ action: 'emit', text: 'e a continuação' });
  });

  /**
   * O CASO QUE VAZAVA. O Meet reescreve o que já estava na tela ("vou" vira
   * "vamos"), a base deixa de casar, e o nó — que é passado — emitiria o texto
   * inteiro: exatamente o acumulado da pausa.
   */
  it('base quebrada em nó de QUARENTENA reancora e não emite nada', () => {
    const decisao = resolveAgainstBaseline(
      'vamos falar do estoque e de tudo o que foi dito na pausa',
      'vou falar do estoque',
      true,
    );
    expect(decisao).toEqual({
      action: 'rebaseline',
      baseline: 'vamos falar do estoque e de tudo o que foi dito na pausa',
    });
  });

  it('a mesma quebra em nó NOVO é fala de verdade: a linha trocou de dono', () => {
    const decisao = resolveAgainstBaseline('outra fala inteira', 'a fala anterior', false);
    expect(decisao).toEqual({ action: 'reset', text: 'outra fala inteira' });
  });

  /**
   * O modo degradado do parser usa a REGIÃO inteira como nó: o prefixo muda a
   * cada linha que rola para fora. Sem a quarentena, cada rolagem despejaria a
   * transcrição visível inteira.
   */
  it('rolagem da região em quarentena não vira transcrição duplicada', () => {
    const antes = '[Ana] linha um [Bruno] linha dois';
    const depois = '[Bruno] linha dois [Ana] linha três';
    expect(resolveAgainstBaseline(depois, antes, true).action).toBe('rebaseline');
  });
});
