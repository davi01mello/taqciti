/**
 * A aba da HOME. O que se testa aqui é o que a pessoa nota: clicar duas vezes
 * não deixa duas abas, e o alvo chega na URL.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';

const HOME_URL = 'chrome-extension://taqciti/src/home/index.html';

function installMocks(existentes: chrome.tabs.Tab[] = []) {
  const create = vi.fn(async () => ({}) as chrome.tabs.Tab);
  const update = vi.fn(async () => ({}) as chrome.tabs.Tab);
  const query = vi.fn(async () => existentes);
  const windowUpdate = vi.fn(async () => ({}) as chrome.windows.Window);
  installChromeStorageMock({
    extra: {
      runtime: { getURL: (p: string) => `chrome-extension://taqciti/${p}` },
      tabs: { create, update, query },
      windows: { update: windowUpdate },
    },
  });
  return { create, update, query, windowUpdate };
}

beforeEach(() => {
  vi.resetModules();
});

describe('openHome', () => {
  it('abre a HOME numa aba nova quando nenhuma existe', async () => {
    const { create, update } = installMocks();
    const { openHome } = await import('./homeTab');

    await expect(
      openHome({ id: 5, url: 'https://github.com', windowId: 2 } as chrome.tabs.Tab),
    ).resolves.toBe(true);

    expect(create).toHaveBeenCalledWith({ url: HOME_URL, windowId: 2 });
    expect(update).not.toHaveBeenCalled();
  });

  /*
   * O motivo de este módulo existir. Sem a busca, usar o produto por meia hora
   * deixava meia dúzia de abas iguais abertas — e o rascunho do compositor
   * ficava numa delas.
   */
  it('foca a aba que já existe em vez de abrir outra', async () => {
    const { create, update, windowUpdate } = installMocks([
      { id: 9, url: HOME_URL, windowId: 3 } as chrome.tabs.Tab,
    ]);
    const { openHome } = await import('./homeTab');

    await openHome({ id: 5, url: 'https://github.com', windowId: 2 } as chrome.tabs.Tab);

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(9, { active: true });
    expect(windowUpdate).toHaveBeenCalledWith(3, { focused: true });
  });

  /* Sem alvo novo a URL não é reescrita: navegar recarrega e perde o rascunho. */
  it('não renavega a aba existente quando não há alvo', async () => {
    const { update } = installMocks([
      { id: 9, url: `${HOME_URL}?secao=reunioes`, windowId: 3 } as chrome.tabs.Tab,
    ]);
    const { openHome } = await import('./homeTab');

    await openHome();

    expect(update).toHaveBeenCalledWith(9, { active: true });
  });

  it('com alvo, leva a aba existente até ele', async () => {
    const { update } = installMocks([
      { id: 9, url: HOME_URL, windowId: 3 } as chrome.tabs.Tab,
    ]);
    const { openHome } = await import('./homeTab');

    await openHome(undefined, { recordId: 'abc-123' });

    expect(update).toHaveBeenCalledWith(9, {
      active: true,
      url: `${HOME_URL}?secao=reunioes&record=abc-123`,
    });
  });

  /*
   * O clique no ícone numa aba nova. Ali nada pode ser desenhado
   * (`chrome://newtab` é fechada para extensão), e criar uma SEGUNDA aba
   * deixaria a primeira para trás, vazia, do lado da que interessa.
   */
  it.each(['chrome://newtab/', 'chrome://new-tab-page/', 'about:blank'])(
    'reaproveita a aba vazia %s em vez de empilhar outra',
    async (url) => {
      const { create, update } = installMocks();
      const { openHome } = await import('./homeTab');

      await openHome({ id: 5, url, windowId: 2 } as chrome.tabs.Tab);

      expect(update).toHaveBeenCalledWith(5, { url: HOME_URL });
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('uma página de verdade nunca é substituída', async () => {
    const { create, update } = installMocks();
    const { openHome } = await import('./homeTab');

    await openHome({ id: 5, url: 'https://meet.google.com/x' } as chrome.tabs.Tab);

    expect(update).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
  });

  it('a seção vira query string', async () => {
    const { create } = installMocks();
    const { openHome } = await import('./homeTab');

    await openHome(undefined, { secao: 'documentos' });

    expect(create).toHaveBeenCalledWith({
      url: `${HOME_URL}?secao=documentos`,
      windowId: undefined,
    });
  });

  it('alvo vazio mantém a URL limpa', async () => {
    const { create } = installMocks();
    const { openHome } = await import('./homeTab');

    await openHome(undefined, { recordId: null });

    expect(create).toHaveBeenCalledWith({ url: HOME_URL, windowId: undefined });
  });

  it('falha do Chrome vira false, não exceção', async () => {
    installChromeStorageMock({
      extra: {
        runtime: { getURL: (p: string) => `chrome-extension://taqciti/${p}` },
        tabs: {
          query: vi.fn(async () => []),
          create: vi.fn(async () => {
            throw new Error('No window with id');
          }),
          update: vi.fn(),
        },
      },
    });
    const { openHome } = await import('./homeTab');

    await expect(openHome()).resolves.toBe(false);
  });
});
