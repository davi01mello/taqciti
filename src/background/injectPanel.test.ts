import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';

const LOADER = 'assets/index.ts-loader-57zIpFAE.js';

function installMocks(
  options: {
    contentScripts?: Array<{ js?: string[] }>;
    executeScript?: ReturnType<typeof vi.fn>;
    tabs?: chrome.tabs.Tab[];
  } = {},
) {
  const executeScript = options.executeScript ?? vi.fn(async () => []);
  const query = vi.fn(async () => options.tabs ?? []);
  installChromeStorageMock({
    extra: {
      runtime: {
        getManifest: () => ({
          content_scripts: options.contentScripts ?? [{ js: [LOADER] }],
        }),
      },
      scripting: { executeScript },
      tabs: { query },
    },
  });
  return { executeScript, query };
}

/** Uma aba alcançável por padrão; cada teste estraga só o campo que lhe importa. */
function tab(url: string | undefined, over: Partial<chrome.tabs.Tab> = {}) {
  return { id: 7, url, status: 'complete', discarded: false, ...over } as chrome.tabs.Tab;
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

/*
 * A primeira execução. É o único momento em que o background injeta: depois
 * dela, o content script declarado entra em toda página sozinho.
 */
describe('backfillOpenTabs — alcançar as abas já abertas na instalação', () => {
  it('injeta o loader do manifesto em cada aba alcançável', async () => {
    const { executeScript } = installMocks({
      tabs: [tab('https://github.com', { id: 7 }), tab('https://meet.google.com/x', { id: 9 })],
    });
    const { backfillOpenTabs } = await import('./injectPanel');

    await expect(backfillOpenTabs()).resolves.toBe(2);
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: [LOADER] });
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 9 }, files: [LOADER] });
  });

  it('anota as abas, para o estado ao vivo saber onde entregar', async () => {
    installMocks({ tabs: [tab('https://github.com', { id: 7 })] });
    const { backfillOpenTabs } = await import('./injectPanel');
    const { panelTabs } = await import('./panelTabs');

    await backfillOpenTabs();

    expect(await panelTabs()).toEqual([7]);
  });

  it('injeção que falhou não deixa a aba anotada', async () => {
    installMocks({
      tabs: [tab('https://github.com')],
      executeScript: vi.fn(async () => {
        throw new Error('Cannot access contents of the page');
      }),
    });
    const { backfillOpenTabs } = await import('./injectPanel');
    const { panelTabs } = await import('./panelTabs');

    await expect(backfillOpenTabs()).resolves.toBe(0);
    expect(await panelTabs()).toEqual([]);
  });

  it('pula página fechada à injeção em vez de tentar e falhar', async () => {
    const { executeScript } = installMocks({
      tabs: [tab('chrome://extensions'), tab('https://chromewebstore.google.com/x', { id: 8 })],
    });
    const { backfillOpenTabs } = await import('./injectPanel');

    await expect(backfillOpenTabs()).resolves.toBe(0);
    expect(executeScript).not.toHaveBeenCalled();
  });

  /*
   * A triagem que impede a primeira execução de virar erro vermelho. Aba
   * descartada pela gestão de memória, ou ainda carregando, recusa
   * `executeScript` — e não é defeito nenhum: quando ela voltar, o content
   * script declarado entra sozinho.
   */
  it.each([
    ['descartada pela gestão de memória', { discarded: true }],
    ['ainda carregando', { status: 'loading' }],
    ['sem id', { id: undefined }],
  ])('pula aba %s, sem tentar injetar', async (_label, broken) => {
    const { executeScript } = installMocks({ tabs: [tab('https://github.com', broken)] });
    const { backfillOpenTabs } = await import('./injectPanel');

    await expect(backfillOpenTabs()).resolves.toBe(0);
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('manifesto sem content script não injeta — nome de arquivo não se adivinha', async () => {
    const { executeScript } = installMocks({
      contentScripts: [],
      tabs: [tab('https://github.com')],
    });
    const { backfillOpenTabs } = await import('./injectPanel');

    await expect(backfillOpenTabs()).resolves.toBe(0);
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('a aba anotada não é reinjetada pelo clique no ícone', async () => {
    const { executeScript } = installMocks({ tabs: [tab('https://github.com', { id: 7 })] });
    const { backfillOpenTabs, ensurePanelInTab } = await import('./injectPanel');

    await backfillOpenTabs();
    executeScript.mockClear();

    await ensurePanelInTab(tab('https://github.com', { id: 7 }));
    expect(executeScript).not.toHaveBeenCalled();
  });

  /*
   * A brecha estreita que o clique no ícone precisa fechar: uma aba que estava
   * CARREGANDO na instalação escapa do backfill (documento a meio) e do content
   * script declarado (que só vale para documento que começa depois). Sem esta
   * rede, o único jeito de trazer o TaqCITi para essa aba seria recarregá-la.
   */
  it('a aba que escapou da instalação recebe o painel no clique no ícone', async () => {
    const { executeScript } = installMocks({
      tabs: [tab('https://github.com', { id: 7, status: 'loading' })],
    });
    const { backfillOpenTabs, ensurePanelInTab } = await import('./injectPanel');

    await backfillOpenTabs();
    expect(executeScript).not.toHaveBeenCalled();

    await ensurePanelInTab(tab('https://github.com', { id: 7 }));
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: [LOADER] });
  });

  it('uma aba impossível não impede as outras', async () => {
    const executeScript = vi.fn(async ({ target }: { target: { tabId: number } }) => {
      if (target.tabId === 7) throw new Error('Cannot access contents of the page');
      return [];
    });
    installMocks({
      tabs: [tab('https://a.com', { id: 7 }), tab('https://b.com', { id: 8 })],
      executeScript: executeScript as unknown as ReturnType<typeof vi.fn>,
    });
    const { backfillOpenTabs } = await import('./injectPanel');

    await expect(backfillOpenTabs()).resolves.toBe(1);
  });
});
