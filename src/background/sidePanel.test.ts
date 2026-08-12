/**
 * A saída larga. O que se testa aqui é o comportamento que o usuário nota: o
 * botão FUNCIONAR, e o clique no ícone numa aba nova não deixar uma aba vazia
 * para trás.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';

const WIDE_URL = 'chrome-extension://taqciti/src/sidepanel/index.html';

function installMocks() {
  const create = vi.fn(async () => ({}) as chrome.tabs.Tab);
  const update = vi.fn(async () => ({}) as chrome.tabs.Tab);
  installChromeStorageMock({
    extra: {
      runtime: { getURL: (p: string) => `chrome-extension://taqciti/${p}` },
      tabs: { create, update },
    },
  });
  return { create, update };
}

beforeEach(() => {
  vi.resetModules();
});

describe('openWideView', () => {
  /*
   * O caso que estava quebrado: o botão dentro do painel. Antes ia por
   * `chrome.sidePanel.open`, que o Chrome recusa fora de um gesto do usuário —
   * e o clique acontece na página, então nunca havia gesto. Este caminho não
   * depende de nenhum.
   */
  it('abre a tela larga numa aba nova', async () => {
    const { create, update } = installMocks();
    const { openWideView } = await import('./sidePanel');

    await expect(
      openWideView({ id: 5, url: 'https://github.com', windowId: 2 } as chrome.tabs.Tab),
    ).resolves.toBe(true);

    expect(create).toHaveBeenCalledWith({ url: WIDE_URL, windowId: 2 });
    expect(update).not.toHaveBeenCalled();
  });

  /*
   * O clique no ícone numa aba nova. Ali o painel não pode ser desenhado
   * (`chrome://newtab` é fechada para extensão), e criar uma SEGUNDA aba
   * deixaria a primeira para trás, vazia, do lado da que interessa.
   */
  it.each(['chrome://newtab/', 'chrome://new-tab-page/', 'about:blank'])(
    'reaproveita a aba vazia %s em vez de empilhar outra',
    async (url) => {
      const { create, update } = installMocks();
      const { openWideView } = await import('./sidePanel');

      await openWideView({ id: 5, url, windowId: 2 } as chrome.tabs.Tab);

      expect(update).toHaveBeenCalledWith(5, { url: WIDE_URL });
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('uma página de verdade nunca é substituída', async () => {
    const { create, update } = installMocks();
    const { openWideView } = await import('./sidePanel');

    await openWideView({ id: 5, url: 'https://meet.google.com/x' } as chrome.tabs.Tab);

    expect(update).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
  });

  it('sem aba conhecida, abre onde o Chrome achar melhor', async () => {
    const { create } = installMocks();
    const { openWideView } = await import('./sidePanel');

    await expect(openWideView()).resolves.toBe(true);
    expect(create).toHaveBeenCalledWith({ url: WIDE_URL, windowId: undefined });
  });

  /*
   * O alvo. Sem ele a aba abria na tela da FASE — com uma reunião em curso, o
   * botão do histórico entregava a transcrição ao vivo e nenhuma volta para a
   * lista. Ver src/sidepanel/route.ts.
   */
  it('leva o pedido de histórico na URL', async () => {
    const { create } = installMocks();
    const { openWideView } = await import('./sidePanel');

    await openWideView({ id: 5, url: 'https://meet.google.com/x' } as chrome.tabs.Tab, {
      history: true,
    });

    expect(create).toHaveBeenCalledWith({
      url: `${WIDE_URL}?view=history`,
      windowId: undefined,
    });
  });

  it('leva a reunião alvo na URL, já implicando o histórico', async () => {
    const { create } = installMocks();
    const { openWideView } = await import('./sidePanel');

    await openWideView(undefined, { recordId: 'abc-123' });

    expect(create).toHaveBeenCalledWith({
      url: `${WIDE_URL}?view=history&record=abc-123`,
      windowId: undefined,
    });
  });

  /* O clique no ícone e o menu do Chrome abrem a MESMA URL, sem query. */
  it('alvo vazio mantém a URL limpa', async () => {
    const { create } = installMocks();
    const { openWideView } = await import('./sidePanel');

    await openWideView(undefined, { history: false, recordId: null });

    expect(create).toHaveBeenCalledWith({ url: WIDE_URL, windowId: undefined });
  });

  it('falha do Chrome vira false, não exceção', async () => {
    installChromeStorageMock({
      extra: {
        runtime: { getURL: (p: string) => `chrome-extension://taqciti/${p}` },
        tabs: {
          create: vi.fn(async () => {
            throw new Error('No window with id');
          }),
          update: vi.fn(),
        },
      },
    });
    const { openWideView } = await import('./sidePanel');

    await expect(openWideView()).resolves.toBe(false);
  });
});
