/**
 * Preferências do painel flutuante — posição, tamanho, presença, rota,
 * visibilidade das legendas nativas. Persistidas em chrome.storage.local. São
 * preferências de apresentação: não passam pela máquina de estados.
 *
 * ── Por que isto saiu do content script ────────────────────────────────────
 *
 * Enquanto só o painel lia e escrevia estas chaves, elas moravam ao lado dele.
 * Agora o background também precisa delas, por dois motivos que a persistência
 * entre páginas criou: ele grava `presence: 'open'` antes de injetar no clique
 * do ícone, e observa `presence` para decidir se mantém a injeção automática
 * registrada. Duas leituras do mesmo formato em camadas diferentes é
 * exatamente onde a normalização divergiria.
 */
import type {
  PanelPresence,
  PanelPrefs,
  PanelRoute,
  PanelSize,
} from '@/shared/types/domain';
import { DEFAULT_PANEL_PREFS } from '@/shared/types/domain';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { readLocal, writeLocal } from '@/shared/services/storage';

const SIZES: PanelSize[] = ['compact', 'regular', 'tall'];
const PRESENCES: PanelPresence[] = ['closed', 'minimized', 'open'];

/**
 * A rota vem do storage, que é editável de fora e sobrevive a versões antigas
 * da extensão. Uma rota `record` sem `id` levaria a `records.find(undefined)`,
 * que não acha nada e mostra a lista — silencioso, mas errado. Aqui ela cai
 * para `auto` em vez de virar um estado impossível.
 */
function normalizeRoute(route: unknown): PanelRoute {
  if (typeof route !== 'object' || route === null) return { kind: 'auto' };
  const candidate = route as { kind?: unknown; id?: unknown };
  if (candidate.kind === 'history') return { kind: 'history' };
  if (candidate.kind === 'record' && typeof candidate.id === 'string' && candidate.id) {
    return { kind: 'record', id: candidate.id };
  }
  return { kind: 'auto' };
}

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
    presence: PRESENCES.includes(saved.presence as PanelPresence)
      ? (saved.presence as PanelPresence)
      : DEFAULT_PANEL_PREFS.presence,
    route: normalizeRoute(saved.route),
    hideMeetCaptions: saved.hideMeetCaptions !== false,
  };
}

export async function loadPanelPrefs(): Promise<PanelPrefs> {
  return normalize(await readLocal<Partial<PanelPrefs>>(STORAGE_KEYS.prefs));
}

export function savePanelPrefs(prefs: PanelPrefs): void {
  void writeLocal(STORAGE_KEYS.prefs, prefs);
}

/**
 * Lê, aplica o patch e grava — para quem não tem as preferências em mãos.
 *
 * É o caminho do background, que só quer mexer num campo (`presence`) sem
 * carregar o resto. O painel NÃO usa isto: ele já tem as preferências em
 * memória, e um read-modify-write assíncrono por clique perderia a gravação
 * mais recente sempre que duas mudanças caíssem na mesma volta.
 */
export async function patchPanelPrefs(patch: Partial<PanelPrefs>): Promise<PanelPrefs> {
  const next = { ...(await loadPanelPrefs()), ...patch };
  await writeLocal(STORAGE_KEYS.prefs, next);
  return next;
}
