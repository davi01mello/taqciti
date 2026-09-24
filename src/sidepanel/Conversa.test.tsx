import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { PlatformProvider } from '@/shared/platform/context';
import { extensionPlatform } from '@/shared/platform/extension';
import { acrescentarMensagem, type Conversation } from '@/home/conversations';
import { App } from './App';

let host: HTMLDivElement;
let root: Root;
let storage: ReturnType<typeof installChromeStorageMock>;
const scrollIntoView = vi.fn();
const q = <T extends Element>(selector: string) => host.querySelector<T>(selector)!;
const click = async (selector: string) => {
  await act(async () => q<HTMLButtonElement>(selector).click());
};
const write = async (value: string) => {
  await act(async () => {
    const field = q<HTMLTextAreaElement>('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      field,
      value,
    );
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
async function mount() {
  await act(async () =>
    root.render(
      <PlatformProvider platform={extensionPlatform}>
        <App />
      </PlatformProvider>,
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
  scrollIntoView.mockClear();
  storage = installChromeStorageMock({
    extra: {
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
        sendMessage: vi.fn(async () => ({ phase: 'idle', session: null })),
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('explica a ausência de IA antes da escrita e salva sem enviar a um processador', async () => {
  await mount();
  expect(host.textContent).toContain('Assistente não conectado');
  await click('.tq-ajuda');
  expect(q('#tq-ajuda-ia').textContent).toContain('Nada é enviado para processamento');
  expect(q<HTMLButtonElement>('.tq-enviar').disabled).toBe(true);
  await write('Ideia para retomar depois');
  await click('.tq-enviar');
  const saved = storage.local.values[STORAGE_KEYS.conversations] as Conversation[];
  expect(saved[0]!.messages).toHaveLength(1);
  expect(saved[0]!.messages[0]!.text).toBe('Ideia para retomar depois');
  expect(q<HTMLTextAreaElement>('textarea').value).toBe('');
  // A onda não mora mais atrás do compositor — ela é o sinal da captura e foi
  // para o pé da transcrição (ver `OndaDaTranscricao`, em Reuniao.tsx).
  expect(q('.tq-wave')).toBeNull();
  expect(host.textContent).toContain('Rascunho salvo');
  expect(
    vi
      .mocked(chrome.runtime.sendMessage)
      .mock.calls.every(([command]) => (command as unknown as { type: string }).type === 'ui/getState'),
  ).toBe(true);
});

it('mantém o texto e mostra falha mesmo na primeira gravação', async () => {
  await mount();
  await write('Não perder este texto');
  storage.local.set.mockRejectedValueOnce(new Error('quota'));
  await click('.tq-enviar');
  expect(q<HTMLTextAreaElement>('textarea').value).toBe('Não perder este texto');
  expect(q('[role="alert"]').textContent).toContain('Seu texto continua no campo');
  expect(host.textContent).not.toContain('Rascunho salvo');
});

/*
 * A rolagem que acompanha é feita pelo `scrollTop` da própria coluna, e não por
 * `scrollIntoView` — este último rola todo ancestral rolável, inclusive o
 * painel que empilha as duas seções da sidebar. O que o teste observa mudou
 * junto; o que ele garante é o mesmo: quem está lendo acima não é puxado.
 */
it('uma atualização da HOME não interrompe quem está lendo acima', async () => {
  const id = await acrescentarMensagem(null, { texto: 'Primeira ideia' });
  await mount();
  const scroller = q<HTMLElement>('.tq-conversa-col');
  Object.defineProperties(scroller, {
    scrollHeight: { value: 2000 },
    clientHeight: { value: 500 },
  });
  await act(async () => {
    scroller.scrollTop = 100;
    scroller.dispatchEvent(new Event('scroll'));
  });
  await act(async () => {
    await acrescentarMensagem(id, { texto: 'Nova ideia escrita na HOME' });
  });
  expect(host.textContent).toContain('Nova ideia escrita na HOME');
  expect(scroller.scrollTop).toBe(100);
  expect(scrollIntoView).not.toHaveBeenCalled();

  await act(async () => {
    scroller.scrollTop = 1500;
    scroller.dispatchEvent(new Event('scroll'));
  });
  await act(async () => {
    await acrescentarMensagem(id, { texto: 'Acompanhar quando estiver no fim' });
  });
  expect(scroller.scrollTop).toBe(2000);
});

it('nova conversa preserva as existentes e os rascunhos ao navegar', async () => {
  const id = await acrescentarMensagem(null, { texto: 'Conversa anterior' });
  await mount();
  await write('Continuação ainda não salva');
  await click('.tq-nova');
  await write('Outra ideia');
  await click('.tq-enviar');
  expect(storage.local.values[STORAGE_KEYS.conversations]).toHaveLength(2);
  await click('.tq-seletor-conversa');
  const previous = [
    ...host.querySelectorAll<HTMLButtonElement>('.tq-conversa-menu button'),
  ].find((b) => b.textContent?.includes('Conversa anterior'))!;
  await act(async () => previous.click());
  expect(q<HTMLTextAreaElement>('textarea').value).toBe('Continuação ainda não salva');
  expect(
    (storage.local.values[STORAGE_KEYS.conversations] as Conversation[]).find(
      (c) => c.id === id,
    )!.messages,
  ).toHaveLength(1);
});
