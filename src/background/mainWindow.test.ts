import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { installChromeStorageMock } from '@/test/chromeStorageMock';

const PRIMARY_DISPLAY = {
  isPrimary: true,
  workArea: { left: 0, top: 0, width: 1920, height: 1080 },
};

function makeWindowsMock() {
  let nextId = 100;
  const removedListeners: Array<(id: number) => void> = [];
  const boundsListeners: Array<(win: chrome.windows.Window) => void> = [];
  const openIds = new Set<number>();

  const create = vi.fn(async (opts: chrome.windows.CreateData) => {
    const id = nextId++;
    openIds.add(id);
    return {
      id,
      width: opts.width,
      height: opts.height,
      top: opts.top,
      left: opts.left,
    } as chrome.windows.Window;
  });

  const update = vi.fn(async (id: number) => {
    if (!openIds.has(id)) throw new Error('No window with id: ' + id);
    return { id } as chrome.windows.Window;
  });

  return {
    windows: {
      create,
      update,
      onRemoved: { addListener: (cb: (id: number) => void) => removedListeners.push(cb) },
      onBoundsChanged: {
        addListener: (cb: (win: chrome.windows.Window) => void) => boundsListeners.push(cb),
      },
    },
    // Helpers de teste, não fazem parte da API do chrome.
    _closeWindow(id: number) {
      openIds.delete(id);
      for (const cb of removedListeners) cb(id);
    },
    _changeBounds(win: chrome.windows.Window) {
      for (const cb of boundsListeners) cb(win);
    },
  };
}

function installMocks(options: {
  displays?: chrome.system.display.DisplayInfo[];
  local?: Record<string, unknown>;
  session?: Record<string, unknown>;
} = {}) {
  const windowsMock = makeWindowsMock();
  const displays = options.displays ?? [PRIMARY_DISPLAY as chrome.system.display.DisplayInfo];
  const getInfo = vi.fn(async () => displays);
  const { local, session } = installChromeStorageMock({
    local: options.local,
    session: options.session,
    extra: {
      windows: windowsMock.windows,
      system: { display: { getInfo } },
      runtime: { getURL: (path: string) => `chrome-extension://fake-id/${path}` },
    },
  });
  return { windowsMock, getInfo, local, session };
}

/** onRemoved/onBoundsChanged não são aguardáveis (fire-and-forget, como o
 *  resto da mensageria do background) — dá tempo do encadeamento async
 *  interno (getTrackedWindowId → clearTrackedWindowId) drenar antes do
 *  próximo passo do teste. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('openMainWindow — instância única', () => {
  it('sem janela rastreada, cria uma nova', async () => {
    const { windowsMock } = installMocks();
    const { openMainWindow } = await import('./mainWindow');

    await openMainWindow();

    expect(windowsMock.windows.create).toHaveBeenCalledTimes(1);
    expect(windowsMock.windows.update).not.toHaveBeenCalled();
    expect(windowsMock.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'popup', url: expect.stringContaining('src/sidepanel/index.html') }),
    );
  });

  it('com janela já aberta, foca em vez de abrir outra', async () => {
    const { windowsMock } = installMocks();
    const { openMainWindow } = await import('./mainWindow');

    await openMainWindow();
    await openMainWindow();

    expect(windowsMock.windows.create).toHaveBeenCalledTimes(1);
    expect(windowsMock.windows.update).toHaveBeenCalledTimes(1);
    expect(windowsMock.windows.update).toHaveBeenCalledWith(100, { focused: true });
  });

  it('se o usuário fechou a janela manualmente (onRemoved), a próxima chamada cria de novo', async () => {
    const { windowsMock } = installMocks();
    const { openMainWindow, registerMainWindowListeners } = await import('./mainWindow');
    registerMainWindowListeners();

    await openMainWindow();
    windowsMock._closeWindow(100);
    await flushMicrotasks();
    await openMainWindow();

    expect(windowsMock.windows.create).toHaveBeenCalledTimes(2);
    expect(windowsMock.windows.update).not.toHaveBeenCalled();
  });

  it('se o windowId guardado não existe mais (update rejeita) sem onRemoved ter disparado, recupera criando uma nova', async () => {
    const { windowsMock } = installMocks();
    const { openMainWindow } = await import('./mainWindow');

    await openMainWindow();
    // Simula a janela sumindo sem passar pelo listener (ex.: SW reiniciou e
    // perdeu o estado em memória, mas o id salvo em session já não existe).
    windowsMock.windows.update.mockRejectedValueOnce(new Error('No window with id: 100'));

    await openMainWindow();

    expect(windowsMock.windows.create).toHaveBeenCalledTimes(2);
  });
});

describe('openMainWindow — tamanho e posição', () => {
  it('sem posição salva, centraliza na tela primária com o tamanho padrão', async () => {
    const { windowsMock } = installMocks();
    const { openMainWindow } = await import('./mainWindow');

    await openMainWindow();

    expect(windowsMock.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 420,
        height: 700,
        left: Math.round((1920 - 420) / 2),
        top: Math.round((1080 - 700) / 2),
      }),
    );
  });

  it('com posição salva que cabe na tela atual, restaura exatamente', async () => {
    const saved = { width: 500, height: 600, top: 50, left: 60 };
    const { windowsMock } = installMocks({
      local: { [STORAGE_KEYS.windowBounds]: saved },
    });
    const { openMainWindow } = await import('./mainWindow');

    await openMainWindow();

    expect(windowsMock.windows.create).toHaveBeenCalledWith(expect.objectContaining(saved));
  });

  it('com posição salva fora de qualquer tela atual (monitor desconectado), cai pra centralizada', async () => {
    const saved = { width: 500, height: 600, top: 5000, left: 5000 };
    const { windowsMock } = installMocks({
      local: { [STORAGE_KEYS.windowBounds]: saved },
    });
    const { openMainWindow } = await import('./mainWindow');

    await openMainWindow();

    expect(windowsMock.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 420,
        height: 700,
        left: Math.round((1920 - 420) / 2),
        top: Math.round((1080 - 700) / 2),
      }),
    );
  });

  it('persiste bounds novos com debounce quando a janela rastreada é redimensionada/movida', async () => {
    vi.useFakeTimers();
    const { windowsMock, local } = installMocks();
    const { openMainWindow, registerMainWindowListeners } = await import('./mainWindow');
    registerMainWindowListeners();

    await openMainWindow();
    windowsMock._changeBounds({ id: 100, width: 480, height: 640, top: 20, left: 30 } as chrome.windows.Window);

    // Ainda dentro do debounce: não gravou.
    expect(local.values[STORAGE_KEYS.windowBounds]).toBeUndefined();

    await vi.advanceTimersByTimeAsync(600);

    expect(local.values[STORAGE_KEYS.windowBounds]).toEqual({
      width: 480,
      height: 640,
      top: 20,
      left: 30,
    });
  });

  it('bounds changed de uma janela que não é a rastreada não grava nada', async () => {
    vi.useFakeTimers();
    const { windowsMock, local } = installMocks();
    const { openMainWindow, registerMainWindowListeners } = await import('./mainWindow');
    registerMainWindowListeners();

    await openMainWindow();
    windowsMock._changeBounds({ id: 999, width: 1, height: 1, top: 0, left: 0 } as chrome.windows.Window);
    await vi.advanceTimersByTimeAsync(600);

    expect(local.values[STORAGE_KEYS.windowBounds]).toBeUndefined();
  });
});
