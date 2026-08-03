/**
 * Preferências do painel no Meet (borda, posição, visibilidade das legendas
 * nativas) — persistidas em chrome.storage.local direto do content script.
 * São preferências de apresentação: não passam pela máquina de estados.
 */
import type { PanelPrefs } from '@/shared/types/domain';
import { DEFAULT_PANEL_PREFS } from '@/shared/types/domain';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { readLocal, writeLocal } from '@/shared/services/storage';

export async function loadPanelPrefs(): Promise<PanelPrefs> {
  const saved = await readLocal<Partial<PanelPrefs>>(STORAGE_KEYS.prefs);
  return { ...DEFAULT_PANEL_PREFS, ...saved };
}

export function savePanelPrefs(prefs: PanelPrefs): void {
  void writeLocal(STORAGE_KEYS.prefs, prefs);
}
