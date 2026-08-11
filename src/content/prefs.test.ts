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
    expect(
      await load({
        x: 0.1,
        y: 0.9,
        size: 'tall',
        dismissed: true,
        hideMeetCaptions: false,
      }),
    ).toEqual({ x: 0.1, y: 0.9, size: 'tall', dismissed: true, hideMeetCaptions: false });
  });

  /*
   * O formato anterior (borda ancorada). Um spread por cima do padrão levaria
   * `edge`/`offset` de volta ao storage a cada gravação, para sempre.
   */
  it('descarta o formato antigo de borda ancorada', async () => {
    const prefs = await load({ edge: 'left', offset: 0.3, hideMeetCaptions: false });

    expect(prefs).toEqual({ ...DEFAULT_PANEL_PREFS, hideMeetCaptions: false });
    expect(prefs).not.toHaveProperty('edge');
    expect(prefs).not.toHaveProperty('offset');
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

  /* `dismissed` some com a interface inteira: só um `true` explícito vale. */
  it('dismissed só é verdadeiro quando salvo como true', async () => {
    expect((await load({ dismissed: 'sim' })).dismissed).toBe(false);
    expect((await load({})).dismissed).toBe(false);
    expect((await load({ dismissed: true })).dismissed).toBe(true);
  });
});
