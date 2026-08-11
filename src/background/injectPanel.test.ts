import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';

const LOADER = 'assets/index.ts-loader-57zIpFAE.js';

function installMocks(
  options: {
    contentScripts?: Array<{ js?: string[] }>;
    executeScript?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const executeScript = options.executeScript ?? vi.fn(async () => []);
  installChromeStorageMock({
    extra: {
      runtime: {
        getManifest: () => ({
          content_scripts: options.contentScripts ?? [{ js: [LOADER] }],
        }),
      },
      scripting: { executeScript },
    },
  });
  return { executeScript };
}

/** `id` omitido de propósito no caso da aba sem id — passar `undefined` a um
 *  parâmetro com valor padrão devolveria o padrão, e o teste não testaria nada. */
function tab(url: string | undefined, id: number | null = 7): chrome.tabs.Tab {
  return { ...(id === null ? {} : { id }), url } as chrome.tabs.Tab;
}

beforeEach(() => {
  vi.resetModules();
});

describe('canInject — onde o painel cabe', () => {
  it.each([
    'https://github.com/anthropics',
    'http://localhost:3000/',
    'https://meet.google.com/abc-defg-hij',
  ])('aceita página comum: %s', async (url) => {
    installMocks();
    const { canInject } = await import('./injectPanel');
    expect(canInject(url)).toBe(true);
  });

  it.each([
    'chrome://extensions',
    'chrome-extension://abcdef/src/sidepanel/index.html',
    'devtools://devtools/bundled/inspector.html',
    'about:blank',
    'view-source:https://example.com',
    // Depende de "Permitir acesso a URLs de arquivo", que vem desligado.
    'file:///C:/Users/edisi/nota.txt',
    // A Web Store é fechada para extensão, mesmo com host permission.
    'https://chromewebstore.google.com/detail/algo',
    'https://chrome.google.com/webstore',
  ])('recusa página fechada à injeção: %s', async (url) => {
    installMocks();
    const { canInject } = await import('./injectPanel');
    expect(canInject(url)).toBe(false);
  });

  it('recusa aba sem url — sem host permission o Chrome nem informa qual é', async () => {
    installMocks();
    const { canInject } = await import('./injectPanel');
    expect(canInject(undefined)).toBe(false);
    expect(canInject('')).toBe(false);
  });
});

describe('panelScriptFiles — o caminho vem do manifesto, nunca escrito à mão', () => {
  it('devolve o loader que o @crxjs registrou, com hash e tudo', async () => {
    installMocks();
    const { panelScriptFiles } = await import('./injectPanel');
    expect(panelScriptFiles()).toEqual([LOADER]);
  });

  it('sem content script declarado, devolve lista vazia em vez de inventar caminho', async () => {
    installMocks({ contentScripts: [] });
    const { panelScriptFiles } = await import('./injectPanel');
    expect(panelScriptFiles()).toEqual([]);
  });
});

describe('openPanelInTab', () => {
  it('injeta o loader do manifesto na aba pedida', async () => {
    const { executeScript } = installMocks();
    const { openPanelInTab } = await import('./injectPanel');

    await expect(openPanelInTab(tab('https://github.com'))).resolves.toBe(true);
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: [LOADER],
    });
  });

  it('não tenta injetar em página fechada', async () => {
    const { executeScript } = installMocks();
    const { openPanelInTab } = await import('./injectPanel');

    await expect(openPanelInTab(tab('chrome://extensions'))).resolves.toBe(false);
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('aba sem id (devtools destacado, aba fantasma) não injeta', async () => {
    const { executeScript } = installMocks();
    const { openPanelInTab } = await import('./injectPanel');

    await expect(openPanelInTab(tab('https://github.com', null))).resolves.toBe(false);
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('manifesto sem content script não injeta — nome de arquivo não se adivinha', async () => {
    const { executeScript } = installMocks({ contentScripts: [] });
    const { openPanelInTab } = await import('./injectPanel');

    await expect(openPanelInTab(tab('https://github.com'))).resolves.toBe(false);
    expect(executeScript).not.toHaveBeenCalled();
  });

  /*
   * O caso que decide o plano B: `activeTab` só vale para a aba do clique, e o
   * Chrome recusa injeção em páginas que ele reserva. Devolver `false` em vez
   * de estourar é o que permite ao background abrir a outra saída.
   */
  it('injeção rejeitada pelo Chrome vira false, não exceção', async () => {
    const executeScript = vi.fn(async () => {
      throw new Error('Cannot access contents of the page');
    });
    installMocks({ executeScript });
    const { openPanelInTab } = await import('./injectPanel');

    await expect(openPanelInTab(tab('https://github.com'))).resolves.toBe(false);
  });
});
