/**
 * Janela principal da extensão — substitui o side panel do Chrome por uma
 * janela flutuante independente (chrome.windows.create), mesmo HTML de
 * antes (src/sidepanel/index.html). Único dono da abertura: todo ponto de
 * entrada (popup, botão "Ver no histórico" no painel do Meet) manda mensagem
 * pro background chamar `openMainWindow()` — nunca duplica chrome.windows.*
 * em mais de um lugar.
 *
 * Instância única: guarda o windowId em chrome.storage.session (sobrevive a
 * restart do service worker, cai com o navegador — não faz sentido guardar
 * em local, que sobrevive além da sessão do SO). Reabrir só foca a janela
 * existente; se o usuário fechou manualmente, chrome.windows.update rejeita,
 * e daí abre uma nova.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { readLocal, readSession, removeSession, writeLocal, writeSession } from '@/shared/services/storage';
import { logger } from '@/shared/services/log';

const MAIN_WINDOW_PATH = 'src/sidepanel/index.html';
const DEFAULT_WIDTH = 420;
const DEFAULT_HEIGHT = 700;
/** Debounce de gravação dos bounds — não escreve a cada pixel de resize/drag. */
const BOUNDS_SAVE_DEBOUNCE_MS = 500;
/** Quanto de uma janela salva precisa estar visível numa tela atual pra contar como "cabe". */
const MIN_VISIBLE_WIDTH = 80;
const MIN_VISIBLE_HEIGHT = 60;

interface WindowBounds {
  width: number;
  height: number;
  top: number;
  left: number;
}

async function getTrackedWindowId(): Promise<number | null> {
  return readSession<number>(STORAGE_KEYS.mainWindowId);
}

async function setTrackedWindowId(id: number): Promise<void> {
  await writeSession(STORAGE_KEYS.mainWindowId, id);
}

async function clearTrackedWindowId(): Promise<void> {
  await removeSession(STORAGE_KEYS.mainWindowId);
}

/** Quanto de `bounds` cai dentro de alguma tela conectada agora. */
async function fitsOnScreen(bounds: WindowBounds): Promise<boolean> {
  let displays: chrome.system.display.DisplayInfo[];
  try {
    displays = await chrome.system.display.getInfo();
  } catch (error) {
    logger.error('system.display indisponível, pulando validação de bounds', error);
    return true; // sem como validar: confia no valor salvo em vez de recentralizar à toa.
  }
  return displays.some(({ workArea }) => {
    const visibleWidth =
      Math.min(bounds.left + bounds.width, workArea.left + workArea.width) -
      Math.max(bounds.left, workArea.left);
    const visibleHeight =
      Math.min(bounds.top + bounds.height, workArea.top + workArea.height) -
      Math.max(bounds.top, workArea.top);
    return visibleWidth >= MIN_VISIBLE_WIDTH && visibleHeight >= MIN_VISIBLE_HEIGHT;
  });
}

async function centeredDefaultBounds(): Promise<WindowBounds> {
  let displays: chrome.system.display.DisplayInfo[] = [];
  try {
    displays = await chrome.system.display.getInfo();
  } catch (error) {
    logger.error('system.display indisponível, usando bounds padrão sem centralizar', error);
  }
  const primary = displays.find((d) => d.isPrimary) ?? displays[0];
  if (!primary) return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, top: 0, left: 0 };

  const { workArea } = primary;
  const width = Math.min(DEFAULT_WIDTH, workArea.width);
  const height = Math.min(DEFAULT_HEIGHT, workArea.height);
  return {
    width,
    height,
    left: Math.round(workArea.left + (workArea.width - width) / 2),
    top: Math.round(workArea.top + (workArea.height - height) / 2),
  };
}

async function resolveOpenBounds(): Promise<WindowBounds> {
  const saved = await readLocal<WindowBounds>(STORAGE_KEYS.windowBounds);
  if (saved && (await fitsOnScreen(saved))) return saved;
  return centeredDefaultBounds();
}

/** Abre a janela principal, ou foca a que já está aberta. Único ponto de entrada. */
export async function openMainWindow(): Promise<void> {
  const trackedId = await getTrackedWindowId();
  if (trackedId !== null) {
    try {
      await chrome.windows.update(trackedId, { focused: true });
      return;
    } catch {
      // Fechada manualmente — a janela guardada não existe mais.
      await clearTrackedWindowId();
    }
  }

  const bounds = await resolveOpenBounds();
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(MAIN_WINDOW_PATH),
    type: 'popup',
    ...bounds,
  });
  if (win?.id !== undefined) await setTrackedWindowId(win.id);
}

let boundsSaveTimer: ReturnType<typeof setTimeout> | null = null;

/** Registrado uma vez, no carregamento do service worker — exigência do MV3. */
export function registerMainWindowListeners(): void {
  chrome.windows.onRemoved.addListener((closedId) => {
    void getTrackedWindowId().then((id) => {
      if (id === closedId) void clearTrackedWindowId();
    });
  });

  chrome.windows.onBoundsChanged.addListener((win) => {
    if (win.id === undefined) return;
    void getTrackedWindowId().then((id) => {
      if (id !== win.id) return;
      if (win.width === undefined || win.height === undefined) return;
      if (win.top === undefined || win.left === undefined) return;
      const bounds: WindowBounds = {
        width: win.width,
        height: win.height,
        top: win.top,
        left: win.left,
      };
      if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
      boundsSaveTimer = setTimeout(() => {
        void writeLocal(STORAGE_KEYS.windowBounds, bounds);
      }, BOUNDS_SAVE_DEBOUNCE_MS);
    });
  });
}
