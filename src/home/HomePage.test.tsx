/**
 * Os comportamentos da HOME que estavam quebrados — verificados na árvore, e
 * não na compilação.
 *
 * Cada bloco aqui corresponde a um defeito relatado: a barra lateral recolhendo
 * ao clicar, a onda reagindo a clique em qualquer lugar, o envio vazio, o
 * rascunho sumindo ao trocar de conversa. Um teste que só monta a tela não
 * pegaria nenhum deles.
 *
 * O ambiente é jsdom: o `<canvas>` não tem contexto 2D, então o laço de desenho
 * sai cedo sozinho — o que se observa é o ESTADO da onda, exposto em
 * `data-estado`, não o pixel.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import type { Conversation } from './conversations';

class ResizeObserverMock implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function conversa(id: string, texto: string): Conversation {
  return {
    id,
    title: texto,
    createdAt: 1,
    updatedAt: 1,
    messages: [{ id: `m-${id}`, role: 'user', text: texto, at: 1 }],
  };
}

let host: HTMLDivElement;
let root: Root;
let storage: ReturnType<typeof installChromeStorageMock>;

async function montar(conversas: Conversation[] = []) {
  storage = installChromeStorageMock({
    local: { [STORAGE_KEYS.conversations]: conversas },
    extra: {
      runtime: {
        getURL: (p: string) => `chrome-extension://taqciti/${p}`,
        sendMessage: vi.fn(async () => ({ phase: 'idle', session: null })),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    },
  });
  const { PlatformProvider } = await import('@/shared/platform/context');
  const { extensionPlatform } = await import('@/shared/platform/extension');
  const { HomePage } = await import('./HomePage');
  await act(async () => {
    root.render(
      <PlatformProvider platform={extensionPlatform}>
        <HomePage />
      </PlatformProvider>,
    );
  });
}

const q = <T extends Element>(sel: string): T => {
  const el = host.querySelector<T>(sel);
  if (!el) throw new Error(`não achei ${sel}`);
  return el;
};

const campo = () => q<HTMLTextAreaElement>('.tq-campo textarea');
const estadoDaOnda = () => q<HTMLCanvasElement>('.tq-wave').dataset.estado;

/** Um `input` como o React o entende (o setter nativo, não só `.value`). */
function digitar(el: HTMLTextAreaElement, texto: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  setter?.call(el, texto);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  vi.resetModules();
  globalThis.ResizeObserver = ResizeObserverMock;
  // jsdom não implementa `matchMedia`, e `useAnimacao` pergunta por
  // `prefers-reduced-motion` já no primeiro render.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  // jsdom também não tem rolagem nem canvas 2D. Sem contexto, o laço de desenho
  // sai na primeira linha — o que se observa aqui é o estado, não o pixel.
  vi.stubGlobal('scrollTo', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, '', '/');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('a barra lateral não recolhe ao navegar', () => {
  it('clicar numa seção troca de tela e mantém a barra aberta', async () => {
    await montar();

    // Abre pelo clique na faixa (o caminho que não depende de ponteiro).
    await act(async () => {
      q<HTMLButtonElement>('.tq-edge').click();
    });
    expect(q('.tq-home').classList.contains('nav-aberta')).toBe(true);

    const reunioes = Array.from(host.querySelectorAll('.tq-navlinks button')).find(
      (b) => b.textContent?.includes('Reuniões'),
    ) as HTMLButtonElement;
    await act(async () => {
      reunioes.click();
    });

    expect(host.textContent).toContain('O que a extensão capturou');
    // O bug: o `onIr` fechava a barra junto com a navegação.
    expect(q('.tq-home').classList.contains('nav-aberta')).toBe(true);
    expect(reunioes.getAttribute('aria-current')).toBe('page');
  });

  /*
   * O outro extremo, e o defeito relatado: depois de clicar numa seção a barra
   * parava de responder ao mouse e ficava presa aberta. O clique dá foco ao
   * botão, e o guarda de teclado (`contains(activeElement)`) passava a
   * bloquear TODO fechamento a partir dali.
   */
  it('depois de navegar, ainda fecha quando o ponteiro se afasta', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await montar();
      await act(async () => q<HTMLButtonElement>('.tq-edge').click());

      const reunioes = Array.from(host.querySelectorAll('.tq-navlinks button')).find(
        (b) => b.textContent?.includes('Reuniões'),
      ) as HTMLButtonElement;
      await act(async () => {
        reunioes.click();
        reunioes.focus();
      });
      expect(q('.tq-home').classList.contains('nav-aberta')).toBe(true);
      expect(document.activeElement).toBe(reunioes);

      // O ponteiro vai embora, bem além da barra.
      await act(async () => {
        window.dispatchEvent(
          new PointerEvent('pointermove', { clientX: 900, clientY: 400, pointerType: 'mouse' }),
        );
      });
      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      expect(q('.tq-home').classList.contains('nav-aberta')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  /* E o contrário continua valendo: o ponteiro parado sobre a barra a segura,
     mesmo que algo desenhado por cima dispare um `pointerleave` nela. */
  it('não fecha enquanto o ponteiro está sobre a barra', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await montar();
      await act(async () => {
        window.dispatchEvent(
          new PointerEvent('pointermove', { clientX: 10, clientY: 400, pointerType: 'mouse' }),
        );
      });
      expect(q('.tq-home').classList.contains('nav-aberta')).toBe(true);

      // O ponteiro segue dentro da barra; o cabeçalho, desenhado por cima,
      // rouba o alvo e a barra recebe um `pointerleave`.
      await act(async () => {
        window.dispatchEvent(
          new PointerEvent('pointermove', { clientX: 120, clientY: 40, pointerType: 'mouse' }),
        );
        q('#tq-nav').dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }));
      });
      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      expect(q('.tq-home').classList.contains('nav-aberta')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a onda responde à escrita, e a mais nada', () => {
  it('começa em repouso', async () => {
    await montar();
    expect(estadoDaOnda()).toBe('repouso');
  });

  /* Uma camada só. Duas seriam a cópia da animação acompanhando a leitura do
     histórico — o defeito que a versão anterior tinha por usar `fixed`. */
  it('existe exatamente uma camada de animação na página', async () => {
    await montar([conversa('c1', 'uma'), conversa('c2', 'outra')]);
    expect(host.querySelectorAll('.tq-wave')).toHaveLength(1);
  });

  it('sobe ao focar o campo e volta ao repouso no envio', async () => {
    await montar();

    await act(async () => campo().focus());
    expect(estadoDaOnda()).toBe('escrita');

    await act(async () => digitar(campo(), 'olá'));
    expect(estadoDaOnda()).toBe('escrita');

    await act(async () => {
      q<HTMLFormElement>('.tq-escrita').requestSubmit();
    });
    // Mesmo com o campo ainda em foco: o estado "escrevendo" acabou no envio.
    expect(document.activeElement).toBe(campo());
    expect(estadoDaOnda()).toBe('repouso');
  });

  it('a digitação seguinte reativa a onda', async () => {
    await montar();
    await act(async () => campo().focus());
    await act(async () => digitar(campo(), 'olá'));
    await act(async () => q<HTMLFormElement>('.tq-escrita').requestSubmit());
    expect(estadoDaOnda()).toBe('repouso');

    await act(async () => digitar(campo(), 'de novo'));
    expect(estadoDaOnda()).toBe('escrita');
  });

  /* O defeito relatado: clicar em qualquer ponto do chat acendia a escrita. */
  it('clicar fora do campo não ativa a escrita', async () => {
    await montar([conversa('c1', 'mensagem antiga')]);
    expect(estadoDaOnda()).toBe('repouso');

    await act(async () => {
      q<HTMLElement>('.tq-bolha').click();
      q<HTMLElement>('.tq-conversa').click();
      q<HTMLButtonElement>('.tq-edge').click();
    });

    expect(estadoDaOnda()).toBe('repouso');
    expect(document.activeElement).not.toBe(campo());
  });

  it('sair do campo devolve a onda ao repouso, preservando o rascunho', async () => {
    await montar();
    await act(async () => campo().focus());
    await act(async () => digitar(campo(), 'rascunho vivo'));
    await act(async () => campo().blur());

    expect(estadoDaOnda()).toBe('repouso');
    expect(campo().value).toBe('rascunho vivo');
  });
});

describe('o compositor', () => {
  it('não envia mensagem vazia', async () => {
    await montar();
    await act(async () => digitar(campo(), '   '));

    expect(q<HTMLButtonElement>('.tq-enviar').disabled).toBe(true);
    await act(async () => q<HTMLFormElement>('.tq-escrita').requestSubmit());

    const guardadas = (await chrome.storage.local.get(STORAGE_KEYS.conversations))[
      STORAGE_KEYS.conversations
    ];
    expect(guardadas).toEqual([]);
    expect(host.textContent).toContain('O que vamos organizar?');
  });

  it('Enter envia; Shift+Enter não', async () => {
    await montar();
    await act(async () => digitar(campo(), 'primeira'));

    await act(async () => {
      campo().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
      );
    });
    expect(campo().value).toBe('primeira');

    await act(async () => {
      campo().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(campo().value).toBe('');
    expect(host.textContent).toContain('primeira');
  });

  it('a mensagem enviada fica do lado de quem escreveu', async () => {
    await montar([conversa('c1', 'minha fala')]);
    // O turno de quem escreve é o `.tq-turno-voce`; o da IA vive dentro dele,
    // marcado à parte. Lado é CSS, mas a estrutura é o que o CSS alinha.
    expect(host.querySelector('.tq-turno-voce .tq-bolha')?.textContent).toBe(
      'minha fala',
    );
    expect(host.querySelector('.tq-turno-agente')).not.toBeNull();
    expect(host.querySelector('.tq-turno-agente')?.textContent).toContain('TaqCiti');
  });
});

describe('o menu de conversas', () => {
  it('lista as conversas e marca a atual', async () => {
    await montar([conversa('c1', 'mais nova'), conversa('c2', 'mais velha')]);

    await act(async () => q<HTMLButtonElement>('.tq-conversas-botao').click());
    // `[role="menuitemradio"]`: cada linha tem também um botão de apagar, e o
    // seletor genérico misturaria os dois papéis numa lista só.
    const itens = Array.from(
      host.querySelectorAll('.tq-conversas-lista li button[role="menuitemradio"]'),
    );
    expect(itens.map((b) => b.querySelector('.tq-conversas-titulo')?.textContent)).toEqual([
      'mais nova',
      'mais velha',
    ]);
    expect(itens[0]?.getAttribute('aria-checked')).toBe('true');
  });

  it('Escape fecha e devolve o foco ao botão', async () => {
    await montar([conversa('c1', 'uma')]);
    const botao = q<HTMLButtonElement>('.tq-conversas-botao');

    await act(async () => botao.click());
    expect(host.querySelector('.tq-conversas-lista')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(host.querySelector('.tq-conversas-lista')).toBeNull();
    expect(document.activeElement).toBe(botao);
  });

  /* Criar uma conversa nova não pode apagar a anterior. */
  it('a conversa nova não apaga a anterior, e trocar recupera o conteúdo', async () => {
    await montar([conversa('c1', 'texto guardado')]);
    expect(host.textContent).toContain('texto guardado');

    await act(async () => q<HTMLButtonElement>('.tq-conversas-botao').click());
    await act(async () => q<HTMLButtonElement>('.tq-conversas-nova').click());
    expect(host.textContent).not.toContain('texto guardado');
    expect(host.textContent).toContain('O que vamos organizar?');

    await act(async () => q<HTMLButtonElement>('.tq-conversas-botao').click());
    const item = q<HTMLButtonElement>('.tq-conversas-lista li button');
    await act(async () => item.click());
    expect(host.textContent).toContain('texto guardado');
  });

  it('o rascunho de cada conversa sobrevive à troca', async () => {
    await montar([conversa('c1', 'primeira conversa')]);
    await act(async () => digitar(campo(), 'rascunho da c1'));

    await act(async () => q<HTMLButtonElement>('.tq-conversas-botao').click());
    await act(async () => q<HTMLButtonElement>('.tq-conversas-nova').click());
    expect(campo().value).toBe('');

    await act(async () => q<HTMLButtonElement>('.tq-conversas-botao').click());
    await act(async () => q<HTMLButtonElement>('.tq-conversas-lista li button').click());
    expect(campo().value).toBe('rascunho da c1');
  });
});

describe('apagar uma conversa', () => {
  const abrirMenu = async () => {
    await act(async () => q<HTMLButtonElement>('.tq-conversas-botao').click());
  };
  const linhas = () =>
    Array.from(host.querySelectorAll('.tq-conversas-lista li'));
  const guardadas = () =>
    (storage.local.values[STORAGE_KEYS.conversations] as Conversation[]) ?? [];

  it('pergunta antes, no lugar do próprio item', async () => {
    await montar([conversa('c1', 'mais nova'), conversa('c2', 'mais velha')]);
    await abrirMenu();

    await act(async () => {
      linhas()[1]!.querySelector<HTMLButtonElement>('.tq-conversas-apagar')!.click();
    });

    // A pergunta ocupa a linha da conversa que vai sumir, e só ela.
    const confirma = host.querySelectorAll('.tq-conversas-confirma');
    expect(confirma).toHaveLength(1);
    expect(confirma[0]!.textContent).toContain('mais velha');
    // Nada foi apagado ainda.
    expect(guardadas().map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('cancelar devolve o item intacto', async () => {
    await montar([conversa('c1', 'uma')]);
    await abrirMenu();

    await act(async () => {
      q<HTMLButtonElement>('.tq-conversas-apagar').click();
    });
    await act(async () => {
      Array.from(host.querySelectorAll('.tq-conversas-confirma-acoes button'))
        .find((b) => b.textContent === 'Cancelar')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(host.querySelector('.tq-conversas-confirma')).toBeNull();
    expect(guardadas().map((c) => c.id)).toEqual(['c1']);
  });

  it('confirmar tira a conversa do storage e mantém o menu aberto', async () => {
    await montar([conversa('c1', 'mais nova'), conversa('c2', 'mais velha')]);
    await abrirMenu();

    await act(async () => {
      linhas()[1]!.querySelector<HTMLButtonElement>('.tq-conversas-apagar')!.click();
    });
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('.tq-conversas-confirma-acoes .perigo')!
        .click();
    });

    await act(async () => {
      await vi.waitFor(() => expect(guardadas().map((c) => c.id)).toEqual(['c1']));
    });
    // Quem apaga uma conversa velha costuma apagar duas: a lista continua ali.
    expect(host.querySelector('.tq-conversas-lista')).not.toBeNull();
  });

  /* Apagar a conversa ABERTA não pode deixar a tela mostrando as mensagens de
     algo que não existe mais. */
  it('apagar a conversa atual cai na mais recente que sobrou', async () => {
    await montar([conversa('c1', 'aberta agora'), conversa('c2', 'a anterior')]);
    expect(host.textContent).toContain('aberta agora');

    await abrirMenu();
    await act(async () => {
      linhas()[0]!.querySelector<HTMLButtonElement>('.tq-conversas-apagar')!.click();
    });
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('.tq-conversas-confirma-acoes .perigo')!
        .click();
    });

    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('a anterior'));
    });
    expect(host.querySelector('.tq-turnos')?.textContent).not.toContain('aberta agora');
  });

  it('Escape desfaz a pergunta antes de fechar o menu', async () => {
    await montar([conversa('c1', 'uma')]);
    await abrirMenu();

    await act(async () => q<HTMLButtonElement>('.tq-conversas-apagar').click());
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(host.querySelector('.tq-conversas-confirma')).toBeNull();
    expect(host.querySelector('.tq-conversas-lista')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(host.querySelector('.tq-conversas-lista')).toBeNull();
  });
});

describe('a URL aponta para uma seção', () => {
  it('abre direto em Reuniões quando a query pede', async () => {
    window.history.replaceState({}, '', '/?secao=reunioes');
    await montar();
    expect(host.textContent).toContain('O que a extensão capturou');
  });
});
