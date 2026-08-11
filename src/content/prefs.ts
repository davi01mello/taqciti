/**
 * Preferências do painel flutuante (posição, tamanho, se foi fechado,
 * visibilidade das legendas nativas) — persistidas em chrome.storage.local
 * direto do content script. São preferências de apresentação: não passam pela
 * máquina de estados.
 */
import type { PanelPrefs, PanelSize } from '@/shared/types/domain';
import { DEFAULT_PANEL_PREFS } from '@/shared/types/domain';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { readLocal, writeLocal } from '@/shared/services/storage';

const SIZES: PanelSize[] = ['compact', 'regular', 'tall'];

function clamp01(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : null;
}

/**
 * Reconstrói as preferências campo a campo, em vez de espalhar o que estava
 * salvo por cima do padrão.
 *
 * Duas razões, e as duas já morderam este arquivo. A primeira é histórica: até
 * a 1.5.2 a posição era `edge` + `offset` (borda ancorada), e um spread
 * carregaria essas chaves mortas para sempre no storage de quem já usava a
 * extensão. A segunda é que `storage.local` é editável de fora — um `x` que
 * virou string ou `NaN` posicionaria o painel em `left: NaNpx`, que o
 * navegador simplesmente ignora, deixando a cápsula empilhada no canto sem
 * nenhum erro no console.
 */
function normalize(saved: Partial<PanelPrefs> | null): PanelPrefs {
  if (!saved) return { ...DEFAULT_PANEL_PREFS };
  return {
    x: clamp01(saved.x) ?? DEFAULT_PANEL_PREFS.x,
    y: clamp01(saved.y) ?? DEFAULT_PANEL_PREFS.y,
    size: SIZES.includes(saved.size as PanelSize)
      ? (saved.size as PanelSize)
      : DEFAULT_PANEL_PREFS.size,
    dismissed: saved.dismissed === true,
    hideMeetCaptions: saved.hideMeetCaptions !== false,
  };
}

export async function loadPanelPrefs(): Promise<PanelPrefs> {
  return normalize(await readLocal<Partial<PanelPrefs>>(STORAGE_KEYS.prefs));
}

export function savePanelPrefs(prefs: PanelPrefs): void {
  void writeLocal(STORAGE_KEYS.prefs, prefs);
}
