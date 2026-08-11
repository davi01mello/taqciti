import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PANEL_PREFS } from '@/shared/types/domain';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { installChromeStorageMock } from '@/test/chromeStorageMock';

beforeEach(() => {
  vi.resetModules();
});

async function load(saved: unknown) {
  installChromeStorageMock({ local: { [STORAGE_KEYS.prefs]: saved } });
  const { loadPanelPrefs } = await import('./prefs');
  return loadPanelPrefs();
}

describe('loadPanelPrefs', () => {
  it('sem nada salvo, devolve o padrão', async () => {
    installChromeStorageMock();
    const { loadPanelPrefs } = await import('./prefs');
    expect(await loadPanelPrefs()).toEqual(DEFAULT_PANEL_PREFS);
  });

  it('preserva preferências válidas', async () => {
    const saved = {
      x: 0.1,
      y: 0.9,
      size: 'tall' as const,
      presence: 'closed' as const,
      route: { kind: 'record' as const, id: 'm-1' },
      hideMeetCaptions: false,
    };
    expect(await load(saved)).toEqual(saved);
  });

  /*
   * Os formatos anteriores: borda ancorada (`edge`/`offset`) e o booleano
   * `dismissed` que virou `presence`. Um spread por cima do padrão carregaria
   * essas chaves mortas de volta ao storage a cada gravação, para sempre.
   */
  it('descarta chaves dos formatos antigos', async () => {
    const prefs = await load({
      edge: 'left',
      offset: 0.3,
      dismissed: true,
      hideMeetCaptions: false,
    });

    expect(prefs).toEqual({ ...DEFAULT_PANEL_PREFS, hideMeetCaptions: false });
    expect(prefs).not.toHaveProperty('edge');
    expect(prefs).not.toHaveProperty('offset');
    expect(prefs).not.toHaveProperty('dismissed');
  });

  it.each([
    ['NaN', NaN],
    ['string', '0.5'],
    ['nulo', null],
  ])('posição %s cai no padrão em vez de virar left:NaNpx', async (_label, x) => {
    expect((await load({ x, y: 0.4 })).x).toBe(DEFAULT_PANEL_PREFS.x);
  });

  it('posição fora de 0..1 é grampeada, não descartada', async () => {
    expect(await load({ x: 4, y: -2 })).toMatchObject({ x: 1, y: 0 });
  });

  it('tamanho desconhecido cai no padrão', async () => {
    expect((await load({ size: 'gigante' })).size).toBe(DEFAULT_PANEL_PREFS.size);
  });

  it('presença desconhecida cai no padrão — minimizado, não fechado', async () => {
    expect((await load({ presence: 'escondido' })).presence).toBe('minimized');
    expect((await load({})).presence).toBe('minimized');
    expect((await load({ presence: 'closed' })).presence).toBe('closed');
  });

  /*
   * A rota atravessa a navegação da página e versões da extensão, então chega
   * aqui vinda de storage que pode estar em qualquer formato. Uma rota
   * `record` sem id levaria a uma busca por `undefined`, que não acha nada e
   * mostra a lista — errado em silêncio, que é o pior jeito de errar.
   */
  describe('rota', () => {
    it.each([
      ['ausente', undefined],
      ['nula', null],
      ['string solta', 'history'],
      ['kind desconhecido', { kind: 'configuracoes' }],
      ['record sem id', { kind: 'record' }],
      ['record com id vazio', { kind: 'record', id: '' }],
      ['record com id não-string', { kind: 'record', id: 42 }],
    ])('%s cai para auto', async (_label, route) => {
      expect((await load({ route })).route).toEqual({ kind: 'auto' });
    });

    it('preserva histórico e reunião válidos', async () => {
      expect((await load({ route: { kind: 'history' } })).route).toEqual({
        kind: 'history',
      });
      expect((await load({ route: { kind: 'record', id: 'abc' } })).route).toEqual({
        kind: 'record',
        id: 'abc',
      });
    });
  });
});

