/**
 * A FORMA das preferências do painel — posição, tamanho, presença, rota,
 * visibilidade das legendas nativas. Só normalização, sem I/O.
 *
 * A leitura e a escrita moram em `prefsStore.ts`, e a separação é deliberada:
 * a normalização é pura e testável sem `chrome.*`, e é chamada dos dois lados
 * (ao ler do storage e ao aplicar um patch), garantindo que nenhum caminho
 * consiga gravar um estado impossível.
 */
import type {
  PanelPresence,
  PanelPrefs,
  PanelRoute,
  PanelSize,
} from '@/shared/types/domain';
import { DEFAULT_PANEL_PREFS } from '@/shared/types/domain';

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
export function normalizePanelPrefs(saved: Partial<PanelPrefs> | null): PanelPrefs {
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
