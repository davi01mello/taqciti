/**
 * Fora do Meet não existe sidebar de reunião.
 *
 * O script continua declarado para toda página (ver o comentário em
 * `index.ts`), então a única coisa que impede um painel de reunião vazio de
 * aparecer numa aba qualquer é este retorno antecipado. Sem o teste, o sintoma
 * seria a versão anterior de volta: o TaqCiti desenhado por cima de todo site
 * visitado, sem reunião nenhuma para mostrar.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';

let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  sendMessage = vi.fn(async () => ({ phase: 'idle', session: null }));
  installChromeStorageMock({
    extra: {
      runtime: {
        id: 'taqciti',
        getURL: (p: string) => `chrome-extension://taqciti/${p}`,
        sendMessage,
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    },
  });
  document.querySelector('taqciti-root')?.remove();
});

describe('onExecute', () => {
  it('numa página qualquer não monta nada nem se anuncia', async () => {
    // jsdom serve a página em `localhost` — que é, para este efeito, "qualquer
    // site que não é o Meet".
    expect(window.location.hostname).not.toBe('meet.google.com');

    const { onExecute } = await import('./index');
    onExecute();
    await Promise.resolve();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(document.querySelector('taqciti-root')).toBeNull();
  });
});
