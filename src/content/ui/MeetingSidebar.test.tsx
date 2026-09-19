/**
 * A pergunta que antecede a captura, na tela.
 *
 * O `controller.test.ts` prova que nada é enviado antes da resposta; aqui se
 * prova a outra metade: que a pergunta APARECE, que os dois botões estão
 * ligados às duas decisões, e que recusar não deixa a pessoa sem caminho de
 * volta — o estado real da captura fica visível, com o botão de começar.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { DEFAULT_PANEL_PREFS } from '@/shared/types/domain';
import type { MeetingState } from '@/shared/types/domain';
import { MeetingSidebar, type PanelCallbacks, type PanelContext } from './MeetingSidebar';

const OCIOSO: MeetingState = { phase: 'idle', session: null };

function callbacksFalsos(): PanelCallbacks {
  return {
    onPause: vi.fn(),
    onResume: vi.fn(),
    onFinish: vi.fn(),
    onRename: vi.fn(),
    onOpenHome: vi.fn(),
    onResumeCapture: vi.fn(),
    onCloseEnded: vi.fn(),
    onEnableCaptions: vi.fn(),
    onDismissLanguageWarning: vi.fn(),
    onToggleNativeCaptions: vi.fn(),
    onPrefsChange: vi.fn(),
    onAceitarRegistro: vi.fn(),
    onRecusarRegistro: vi.fn(),
  };
}

const CTX_BASE: PanelContext = {
  inMeeting: true,
  captionsAutoFailed: false,
  nativeCaptionsHidden: true,
  captureHealthy: true,
  aguardandoResposta: null,
  registroRecusado: false,
};

let host: HTMLDivElement;
let root: Root;

function botaoComTexto(texto: string): HTMLButtonElement {
  const achado = Array.from(host.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === texto,
  );
  if (!achado) throw new Error(`não achei o botão "${texto}"`);
  return achado;
}

async function montar(ctx: Partial<PanelContext>, callbacks: PanelCallbacks) {
  await act(async () => {
    root.render(
      <MeetingSidebar
        state={OCIOSO}
        ctx={{ ...CTX_BASE, ...ctx }}
        prefs={{ ...DEFAULT_PANEL_PREFS, presence: 'open' }}
        callbacks={callbacks}
      />,
    );
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  installChromeStorageMock({
    extra: {
      runtime: {
        id: 'taqciti',
        getURL: (p: string) => `chrome-extension://taqciti/${p}`,
        sendMessage: vi.fn(async () => null),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    },
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('a pergunta antes da captura', () => {
  it('pergunta pelo nome da reunião, sem prometer gravação de áudio', async () => {
    await montar({ aguardandoResposta: { title: 'Planning do time' } }, callbacksFalsos());

    expect(host.textContent).toContain('Registrar esta reunião?');
    expect(host.textContent).toContain('Planning do time');
    expect(host.textContent).toContain('legendas do Meet');
    expect(host.textContent).toContain('não há gravação de áudio nem de vídeo');
    // O texto antigo prometia o contrário do que o produto agora faz.
    expect(host.textContent).not.toContain('começa sozinha');
  });

  it('"Registrar" aceita e "Agora não" recusa', async () => {
    const callbacks = callbacksFalsos();
    await montar({ aguardandoResposta: { title: 'Daily' } }, callbacks);

    await act(async () => botaoComTexto('Registrar').click());
    expect(callbacks.onAceitarRegistro).toHaveBeenCalledTimes(1);

    await act(async () => botaoComTexto('Agora não').click());
    expect(callbacks.onRecusarRegistro).toHaveBeenCalledTimes(1);
  });

  it('recusado, mostra o estado real e o caminho de começar depois', async () => {
    const callbacks = callbacksFalsos();
    await montar({ registroRecusado: true }, callbacks);

    expect(host.textContent).toContain('Captura desligada');
    await act(async () => botaoComTexto('Começar a registrar').click());
    expect(callbacks.onAceitarRegistro).toHaveBeenCalledTimes(1);
  });

  /* Fora de uma reunião não há o que ligar: o botão sumiria com um clique que
     não faria nada. */
  it('sem reunião detectada, não oferece começar', async () => {
    await montar({ inMeeting: false }, callbacksFalsos());
    expect(host.textContent).toContain('Nada sendo capturado');
    expect(
      Array.from(host.querySelectorAll('button')).some(
        (b) => b.textContent?.trim() === 'Começar a registrar',
      ),
    ).toBe(false);
  });
});
