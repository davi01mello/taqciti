/**
 * A reunião com notas ao lado, e a seção Documentos de verdade.
 *
 * Cada bloco corresponde a uma exigência que a tela anterior não cumpria: as
 * notas sempre acessíveis dentro da reunião, a alternância em largura estreita
 * sem perder o que foi escrito, a coleção de documentos com editor próprio, e
 * o aviso que diz o que vai junto ao apagar.
 *
 * jsdom não faz layout: o que se observa aqui é a COMPOSIÇÃO (quais colunas
 * existem, quais estão ativas, o que foi gravado no storage), nunca o pixel.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import type { MeetingRecord } from '@/shared/types/domain';
import type { DocumentoGuardado } from '@/features/documents/store';
import type { Nota } from '@/features/annotations/notes';

class ResizeObserverMock implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const REUNIAO: MeetingRecord = {
  id: 'm-1',
  title: 'Planning da semana',
  startedAt: Date.parse('2026-09-18T13:00:00Z'),
  endedAt: Date.parse('2026-09-18T13:40:00Z'),
  durationSeconds: 2400,
  participants: [{ name: 'Ana Duarte', isHost: true }],
  segments: [
    {
      captionId: 'c1',
      speaker: 'Ana Duarte',
      text: 'A gente precisa fechar o escopo hoje.',
      startOffsetMs: 1000,
      endOffsetMs: 4000,
    },
  ],
  status: 'ready',
  metadata: {
    capturedCaptions: true,
    droppedSegments: 0,
    reconnectCount: 0,
    wasDiscardedAndRestarted: false,
  },
};

const DOCUMENTO: DocumentoGuardado = {
  id: 'd-1',
  title: 'Ata do planning',
  content: '# Ata\n\nFicou decidido que o escopo fecha hoje.',
  formato: 'markdown',
  createdAt: 1,
  updatedAt: Date.parse('2026-09-18T14:00:00Z'),
  meetingId: 'm-1',
  tipo: 'Ata de Reunião',
  origem: 'gerado',
};

let host: HTMLDivElement;
let root: Root;
let sendMessage: ReturnType<typeof vi.fn>;
let storage: ReturnType<typeof installChromeStorageMock>;

const q = <T extends Element>(sel: string): T => {
  const el = host.querySelector<T>(sel);
  if (!el) throw new Error(`não achei ${sel}`);
  return el;
};
const todos = <T extends Element>(sel: string) => [...host.querySelectorAll<T>(sel)];

const porTexto = (sel: string, texto: string) =>
  todos<HTMLElement>(sel).find((e) => e.textContent?.includes(texto));

const clicar = async (el: HTMLElement | undefined) => {
  if (!el) throw new Error('elemento não encontrado para clicar');
  await act(async () => el.click());
};

function digitar(el: HTMLTextAreaElement | HTMLInputElement, texto: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, texto);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** A largura da janela é o que decide uma ou duas colunas. */
function definirLargura(px: number) {
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true });
}

async function montar(
  opcoes: {
    largura?: number;
    documentos?: DocumentoGuardado[];
    notas?: Record<string, Nota>;
    url?: string;
  } = {},
) {
  definirLargura(opcoes.largura ?? 1280);
  window.history.replaceState({}, '', opcoes.url ?? '/');

  sendMessage = vi.fn(async () => ({ phase: 'idle', session: null }));
  storage = installChromeStorageMock({
    local: {
      [STORAGE_KEYS.history]: [REUNIAO],
      ...(opcoes.documentos ? { [STORAGE_KEYS.documents]: opcoes.documentos } : {}),
      ...(opcoes.notas ? { [STORAGE_KEYS.notes]: opcoes.notas } : {}),
    },
    extra: {
      runtime: {
        getURL: (p: string) => `chrome-extension://taqciti/${p}`,
        sendMessage,
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

beforeEach(() => {
  vi.resetModules();
  globalThis.ResizeObserver = ResizeObserverMock;
  /*
   * `matchMedia` de mentira, mas que RESPONDE a consulta.
   *
   * O stub comum devolve `matches: false` para tudo, e com isso
   * `useCabemDuasColunas` cairia sempre no layout estreito — o teste das duas
   * colunas passaria a testar a alternância, sem ninguém perceber.
   */
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const listeners = new Set<() => void>();
    return {
      get matches() {
        return min ? window.innerWidth >= Number(min[1]) : false;
      },
      media: query,
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    };
  });
  vi.stubGlobal('scrollTo', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a reunião na HOME', () => {
  /* O link antigo continua valendo: `?record=` abre a reunião correspondente. */
  it('abre pela URL, com transcrição e notas lado a lado', async () => {
    await montar({ url: '/?record=m-1' });

    expect(q('.tq-reuniao-corpo').classList.contains('lado-a-lado')).toBe(true);
    const colunas = todos<HTMLElement>('.tq-coluna').map((c) =>
      c.getAttribute('aria-label'),
    );
    expect(colunas).toEqual(['Transcrição', 'Notas da reunião']);
    // As duas alcançáveis ao mesmo tempo: nenhuma está escondida.
    expect(todos('.tq-coluna[aria-hidden="true"]')).toHaveLength(0);
  });

  /* Notas sempre acessíveis, inclusive vazias — sem botão para revelá-las. */
  it('mostra o campo de notas vazio, com o convite curto', async () => {
    await montar({ url: '/?record=m-1' });

    const campo = q<HTMLTextAreaElement>('.tq-notas-campo');
    expect(campo.value).toBe('');
    expect(campo.placeholder).toBe('Anote algo sobre esta reunião…');
  });

  it('a nota escrita aqui vai para a mesma chave que a sidebar lê', async () => {
    await montar({ url: '/?record=m-1' });

    await act(async () => {
      digitar(q<HTMLTextAreaElement>('.tq-notas-campo'), 'Combinado: avisar hoje');
    });
    // O gravador tem respiro; o teste espera pela gravação de verdade.
    await act(async () => {
      await vi.waitFor(() => {
        const notas = storage.local.values[STORAGE_KEYS.notes] as Record<string, Nota>;
        expect(notas?.['m-1']?.texto).toBe('Combinado: avisar hoje');
      });
    });
  });

  it('mostra a nota já guardada ao abrir', async () => {
    await montar({
      url: '/?record=m-1',
      notas: { 'm-1': { meetingId: 'm-1', texto: 'escrita na sidebar', updatedAt: 1 } },
    });

    expect(q<HTMLTextAreaElement>('.tq-notas-campo').value).toBe('escrita na sidebar');
  });

  it('não tem mais o cartão de cabeçalho nem o botão verde gigante', async () => {
    await montar({ url: '/?record=m-1' });

    // O título é um campo editável, não um `h1` dentro de um cartão de vidro.
    expect(q<HTMLInputElement>('.tq-titulo-editavel').value).toBe('Planning da semana');
    expect(host.querySelector('.glass')).toBeNull();
    // "Gerar documento" existe, como ação compacta entre as outras do rodapé.
    const gerar = porTexto('.tq-rodape-acoes .tq-acao', 'Gerar documento');
    expect(gerar).toBeDefined();
    expect(gerar!.classList.contains('tq-acao')).toBe(true);
  });

  it('apagar diz o que vai junto, e só depois do menu secundário', async () => {
    await montar({ url: '/?record=m-1' });

    // Não está solto na tela: mora atrás do menu.
    expect(porTexto('.tq-rodape-acoes > .tq-acao', 'Apagar')).toBeUndefined();

    await clicar(q<HTMLElement>('.tq-menu-secundario .tq-acao-icone'));
    await clicar(porTexto('.tq-menu button', 'Apagar reunião'));

    const aviso = q('.tq-confirma').textContent ?? '';
    expect(aviso).toContain('notas');
    expect(aviso).toContain('marcações');
    expect(aviso).toContain('prints');

    await clicar(porTexto('.tq-confirma .tq-acao-perigo', 'Apagar'));
    expect(sendMessage.mock.calls.map(([m]) => m)).toContainEqual({
      type: 'ui/history/delete',
      id: 'm-1',
    });
  });
});

describe('em largura estreita', () => {
  it('alterna entre transcrição e notas em vez de espremer as duas', async () => {
    await montar({ url: '/?record=m-1', largura: 560 });

    expect(q('.tq-reuniao-corpo').classList.contains('lado-a-lado')).toBe(false);
    // As duas existem; só uma está à vista.
    expect(
      q<HTMLElement>('.tq-coluna[aria-label="Transcrição"]').getAttribute('aria-hidden'),
    ).toBe('false');
    expect(
      q<HTMLElement>('.tq-coluna[aria-label="Notas da reunião"]').getAttribute(
        'aria-hidden',
      ),
    ).toBe('true');
  });

  it('a coluna escondida sai do alcance do teclado', async () => {
    await montar({ url: '/?record=m-1', largura: 560 });

    const notas = q<HTMLElement & { inert?: boolean }>(
      '.tq-coluna[aria-label="Notas da reunião"]',
    );
    expect(notas.inert).toBe(true);

    await clicar(porTexto('.tq-alternar button', 'Notas'));
    expect(notas.inert).toBe(false);
  });

  it('alternar não perde o que estava sendo escrito', async () => {
    await montar({ url: '/?record=m-1', largura: 560 });

    await clicar(porTexto('.tq-alternar button', 'Notas'));
    await act(async () => {
      digitar(q<HTMLTextAreaElement>('.tq-notas-campo'), 'frase pela metade');
    });

    await clicar(porTexto('.tq-alternar button', 'Transcrição'));
    await clicar(porTexto('.tq-alternar button', 'Notas'));

    expect(q<HTMLTextAreaElement>('.tq-notas-campo').value).toBe('frase pela metade');
    /*
     * E é o MESMO nó: a coluna não é desmontada ao sair, só escondida. Um nó
     * novo aqui significaria, onde há layout, a rolagem de volta ao topo.
     */
  });

  it('a coluna escondida continua montada — é o que preserva a rolagem', async () => {
    await montar({ url: '/?record=m-1', largura: 560 });

    const transcricao = q('.tq-coluna[aria-label="Transcrição"]');
    await clicar(porTexto('.tq-alternar button', 'Notas'));

    expect(q('.tq-coluna[aria-label="Transcrição"]')).toBe(transcricao);
  });
});

describe('a seção Documentos', () => {
  async function irParaDocumentos() {
    await clicar(q<HTMLElement>('.tq-edge'));
    await clicar(porTexto('.tq-navlinks button', 'Documentos'));
  }

  it('sem documentos, diz isso em uma linha e não lista reuniões', async () => {
    await montar();
    await irParaDocumentos();

    expect(q('.tq-vazio').textContent).toContain('Nenhum documento guardado ainda');
    // A lista de REUNIÕES como substituto era o problema.
    expect(host.textContent).not.toContain('Planning da semana');
    // E nada de explicar pendência de desenvolvimento.
    expect(host.textContent).not.toContain('trabalho pendente');
  });

  it('lista documentos de verdade, com atualização e origem', async () => {
    await montar({ documentos: [DOCUMENTO] });
    await irParaDocumentos();

    const item = q('.tq-item');
    expect(item.textContent).toContain('Ata do planning');
    expect(item.textContent).toContain('Ata de Reunião');
    expect(item.textContent).toContain('Planning da semana');
  });

  it('abrir prioriza o conteúdo editável', async () => {
    await montar({ documentos: [DOCUMENTO] });
    await irParaDocumentos();
    await clicar(q<HTMLElement>('.tq-item'));

    expect(q<HTMLTextAreaElement>('.tq-documento-campo').value).toContain(
      'Ficou decidido',
    );
    expect(q<HTMLInputElement>('.tq-titulo-editavel').value).toBe('Ata do planning');
  });

  it('editar e renomear persistem no storage', async () => {
    await montar({ documentos: [DOCUMENTO] });
    await irParaDocumentos();
    await clicar(q<HTMLElement>('.tq-item'));

    await act(async () => {
      digitar(q<HTMLInputElement>('.tq-titulo-editavel'), 'Ata revisada');
      digitar(q<HTMLTextAreaElement>('.tq-documento-campo'), 'conteúdo novo');
    });

    await act(async () => {
      await vi.waitFor(() => {
        const lista = storage.local.values[STORAGE_KEYS.documents] as DocumentoGuardado[];
        expect(lista[0]!.title).toBe('Ata revisada');
        expect(lista[0]!.content).toBe('conteúdo novo');
      });
    });
  });

  it('leva de volta à reunião de origem', async () => {
    await montar({ documentos: [DOCUMENTO] });
    await irParaDocumentos();
    await clicar(q<HTMLElement>('.tq-item'));
    await clicar(porTexto('.tq-vinculados .tq-chip', 'Planning da semana'));

    // Chegou na reunião, com as duas colunas.
    expect(q('.tq-reuniao-corpo')).toBeTruthy();
    expect(q<HTMLInputElement>('.tq-titulo-editavel').value).toBe('Planning da semana');
  });

  /* O caminho inverso: da reunião para o documento gerado a partir dela. */
  it('a reunião oferece atalho para os documentos dela', async () => {
    await montar({ url: '/?record=m-1', documentos: [DOCUMENTO] });

    await clicar(porTexto('.tq-vinculados .tq-chip', 'Ata do planning'));

    expect(q<HTMLTextAreaElement>('.tq-documento-campo').value).toContain(
      'Ficou decidido',
    );
  });

  it('um vínculo para reunião que não existe mais é dito, não escondido', async () => {
    await montar({
      documentos: [{ ...DOCUMENTO, meetingId: 'reuniao-apagada' }],
    });
    await irParaDocumentos();
    await clicar(q<HTMLElement>('.tq-item'));

    expect(host.textContent).toContain('não está mais no histórico');
  });
});
