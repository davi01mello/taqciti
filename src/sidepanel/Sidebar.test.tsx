/**
 * A SIDEBAR com as duas atividades.
 *
 * O que está em teste é o que o requisito pede e o que é fácil regredir:
 *
 *  1. dois seletores, cada um com o SEU estado, lidos ao mesmo tempo;
 *  2. o sinal da captura não depende de a transcrição estar aberta;
 *  3. trocar de seletor não custa rascunho nem posição de leitura;
 *  4. as ações da reunião estão à vista, e "Perguntar" leva o contexto certo.
 *
 * O canvas é anulado (`getContext` devolve `null`): o que se verifica aqui é o
 * ESTADO que a animação recebe, em texto — a animação em si não tem como ser
 * observada em jsdom, e afirmar sobre ela seria teatro.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import type { MeetingSessionState, MeetingState } from '@/shared/types/domain';
import type { Conversation } from '@/home/conversations';
import { PlatformProvider } from '@/shared/platform/context';
import { extensionPlatform } from '@/shared/platform/extension';
import { App } from './App';

let host: HTMLDivElement;
let root: Root;
let storage: ReturnType<typeof installChromeStorageMock>;
let estado: MeetingState;

const q = <T extends Element>(selector: string) => host.querySelector<T>(selector)!;
const todos = <T extends Element>(selector: string) => [
  ...host.querySelectorAll<T>(selector),
];

/** O seletor pelo nome visível — é assim que quem usa o encontra. */
function seletor(nome: string): HTMLButtonElement {
  return todos<HTMLButtonElement>('.tq-modo').find((b) =>
    b.querySelector('.tq-modo-nome')?.textContent?.includes(nome),
  )!;
}

function estadoDe(seletorNome: string): string {
  return seletor(seletorNome).querySelector('.tq-modo-estado')!.textContent!.trim();
}

function acao(nome: string): HTMLButtonElement {
  return todos<HTMLButtonElement>('.tq-acao').find((b) =>
    b.textContent?.includes(nome),
  )!;
}

const clicar = async (el: HTMLElement) => {
  await act(async () => el.click());
};

/** Entrega um estado novo pelo mesmo caminho do background: o broadcast. */
const transmitir = async (novo: MeetingState) => {
  const listeners = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
  await act(async () => {
    for (const [listener] of listeners) {
      (listener as unknown as (m: unknown, s: unknown, r: unknown) => void)(
        { type: 'state/updated', state: novo },
        {},
        () => {},
      );
    }
  });
};

const escrever = async (campo: HTMLTextAreaElement, valor: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      campo,
      valor,
    );
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

function sessao(patch: Partial<MeetingSessionState> = {}): MeetingSessionState {
  return {
    meetingId: 'm-1',
    meetingCode: 'abc-defg-hij',
    provider: 'google-meet',
    title: 'Planning da semana',
    tabId: 7,
    startedAt: Date.now() - 5 * 60_000,
    endedAt: null,
    captionsEnabled: true,
    participants: [],
    presentNow: [],
    speakersObserved: [],
    segments: [
      {
        captionId: 'c1',
        speaker: 'Ana',
        text: 'A gente precisa fechar o escopo hoje.',
        startOffsetMs: 1000,
        endOffsetMs: 4000,
      },
      {
        captionId: 'c2',
        speaker: 'Bruno',
        text: 'Concordo, mas falta a regra de permissão.',
        startOffsetMs: 5000,
        endOffsetMs: 9000,
      },
    ],
    sealedCaptionIds: [],
    droppedSegments: 0,
    reconnectCount: 0,
    captureDegradedCount: 0,
    captureHealthy: true,
    lastChunkAt: Date.now(),
    wasDiscardedAndRestarted: false,
    captionLanguage: 'pt',
    languageWarningDismissed: false,
    chunksSinceLanguageCheck: 0,
    ...patch,
  };
}

async function montar() {
  await act(async () =>
    root.render(
      <PlatformProvider platform={extensionPlatform}>
        <App />
      </PlatformProvider>,
    ),
  );
}

beforeEach(() => {
  estado = { phase: 'idle', session: null };
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  storage = installChromeStorageMock({
    extra: {
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
        sendMessage: vi.fn(async (message: { type: string }) =>
          message.type === 'ui/getState' ? estado : { ok: true },
        ),
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

describe('os dois seletores', () => {
  it('mostram o estado de cada seção ao mesmo tempo', async () => {
    estado = { phase: 'recording', session: sessao() };
    await montar();

    expect(estadoDe('Transcrição')).toBe('ON');
    // Sem agente trabalhando não há palavra nenhuma: o silêncio é o estado
    // honesto de um assistente que não está conectado a lugar nenhum.
    expect(estadoDe('Conversa')).toBe('');
  });

  /*
   * O requisito é literal: o sinal da captura não pode depender de a seção
   * "Transcrição" estar aberta. Este é o teste que impede que alguém "otimize"
   * a animação para dentro do painel da transcrição.
   */
  it('a captura continua anunciada com a conversa aberta', async () => {
    estado = { phase: 'recording', session: sessao() };
    await montar();

    await clicar(seletor('Conversa'));

    expect(seletor('Conversa').getAttribute('aria-current')).toBe('page');
    expect(seletor('Transcrição').getAttribute('aria-current')).toBeNull();
    expect(estadoDe('Transcrição')).toBe('ON');
  });

  it.each([
    ['paused' as const, true, 'PAUSADA'],
    ['recording' as const, false, 'INTERROMPIDA'],
    ['captionsRequired' as const, true, 'PREPARANDO'],
    ['ended' as const, true, 'SALVA'],
  ])('fase %s com captura saudável=%s lê "%s"', async (phase, saudavel, palavra) => {
    estado = { phase, session: sessao({ captureHealthy: saudavel }) };
    await montar();

    expect(estadoDe('Transcrição').toUpperCase()).toBe(palavra);
  });

  it('sem reunião nenhuma, a captura está desligada', async () => {
    await montar();
    expect(estadoDe('Transcrição').toUpperCase()).toBe('DESLIGADA');
  });

  /* Cor não é o único canal: a palavra do estado precisa estar lá. */
  it('cada estado tem texto, e não só cor', async () => {
    estado = { phase: 'recording', session: sessao({ captureHealthy: false }) };
    await montar();

    const rotulo = seletor('Transcrição').querySelector('.tq-modo-estado')!;
    expect(rotulo.textContent!.trim().length).toBeGreaterThan(0);
    expect(seletor('Transcrição').textContent).toContain('captura interrompida');
  });
});

describe('trocar de seção não custa nada', () => {
  it('preserva o rascunho da conversa e a seção da transcrição', async () => {
    estado = { phase: 'recording', session: sessao() };
    await montar();

    await clicar(seletor('Conversa'));
    await escrever(q<HTMLTextAreaElement>('.tq-compositor textarea'), 'Pergunta pela metade');

    const falasAntes = q('.tq-falas');

    await clicar(seletor('Transcrição'));
    await clicar(seletor('Conversa'));

    expect(q<HTMLTextAreaElement>('.tq-compositor textarea').value).toBe(
      'Pergunta pela metade',
    );
    /*
     * O MESMO nó do DOM. É isso que preserva a posição de leitura: a seção não
     * é desmontada ao sair, só escondida. Um nó novo aqui significaria rolagem
     * de volta ao topo na vida real, onde há layout.
     */
    expect(q('.tq-falas')).toBe(falasAntes);
  });

  it('a seção que não está em uso fica fora do alcance do teclado', async () => {
    estado = { phase: 'recording', session: sessao() };
    await montar();

    const paineis = todos<HTMLDivElement & { inert?: boolean }>('.tq-painel');
    const conversa = paineis.find((p) => p.getAttribute('aria-label') === 'Conversa')!;

    expect(conversa.inert).toBe(true);
    expect(conversa.getAttribute('aria-hidden')).toBe('true');

    await clicar(seletor('Conversa'));

    expect(conversa.inert).toBe(false);
  });
});

describe('as ações da reunião', () => {
  it('estão as quatro à vista, sem menu nenhum', async () => {
    estado = { phase: 'recording', session: sessao() };
    await montar();

    const nomes = todos<HTMLButtonElement>('.tq-acao').map((b) => b.textContent);
    expect(nomes.some((n) => n?.includes('Nota'))).toBe(true);
    expect(nomes.some((n) => n?.includes('Print'))).toBe(true);
    expect(nomes.some((n) => n?.includes('Pausar'))).toBe(true);
    expect(nomes.some((n) => n?.includes('Perguntar'))).toBe(true);
  });

  it('o editor de nota abre, recolhe e não perde o que foi escrito', async () => {
    estado = { phase: 'recording', session: sessao() };
    await montar();

    await clicar(acao('Nota'));
    await escrever(q<HTMLTextAreaElement>('#tq-editor-de-nota'), 'Combinado: avisar hoje');

    await clicar(acao('Nota'));
    expect(host.querySelector('#tq-editor-de-nota')).toBeNull();

    await clicar(acao('Nota'));
    expect(q<HTMLTextAreaElement>('#tq-editor-de-nota').value).toBe(
      'Combinado: avisar hoje',
    );
  });

  it('pausar pede a pausa ao background, e não muda o estado por conta própria', async () => {
    estado = { phase: 'recording', session: sessao() };
    await montar();

    await clicar(acao('Pausar'));

    expect(vi.mocked(chrome.runtime.sendMessage).mock.calls.map(([m]) => m)).toContainEqual(
      { type: 'ui/pause' },
    );
    // A fase só muda quando o background disser que mudou.
    expect(estadoDe('Transcrição')).toBe('ON');
  });

  it('"Perguntar" leva a reunião como contexto e abre a conversa', async () => {
    estado = { phase: 'recording', session: sessao() };
    await montar();

    await clicar(acao('Perguntar'));

    expect(seletor('Conversa').getAttribute('aria-current')).toBe('page');
    expect(q('.tq-contexto-pendente').textContent).toContain('Planning da semana');
  });

  /*
   * A REGRESSÃO que tirava as ações da tela sozinha.
   *
   * Acompanhar a última fala com `scrollIntoView` rola TODOS os ancestrais
   * roláveis — e o ancestral aqui é a coluna inteira da reunião. Poucos
   * segundos depois do começo, o título e os quatro botões tinham subido para
   * fora da tela sem ninguém ter tocado em nada.
   */
  it('a última fala rola a lista, e não a coluna inteira', async () => {
    estado = { phase: 'recording', session: sessao() };
    await montar();

    const coluna = q<HTMLElement>('.tq-rolavel');
    const lista = q<HTMLElement>('.tq-falas');
    Object.defineProperties(lista, {
      scrollHeight: { value: 1200 },
      clientHeight: { value: 300 },
    });
    Object.defineProperties(coluna, {
      scrollHeight: { value: 900 },
      clientHeight: { value: 400 },
    });

    await transmitir({
      phase: 'recording',
      session: sessao({
        segments: [
          ...sessao().segments,
          {
            captionId: 'c3',
            speaker: 'Carla',
            text: 'Fala nova chegando na transcrição.',
            startOffsetMs: 10_000,
            endOffsetMs: 13_000,
          },
        ],
      }),
    });

    expect(host.textContent).toContain('Fala nova chegando na transcrição.');
    expect(lista.scrollTop).toBe(1200);
    // A coluna não se mexeu: as ações continuam onde estavam.
    expect(coluna.scrollTop).toBe(0);
  });

  it('marcar um trecho continua pertencendo ao trecho', async () => {
    estado = { phase: 'recording', session: sessao() };
    await montar();

    await clicar(q<HTMLButtonElement>('.tq-fala-corpo'));
    const destaque = todos<HTMLButtonElement>('.tq-fala-acoes .marca')[0]!;
    await clicar(destaque);
    await act(async () => {});

    expect(storage.local.values[STORAGE_KEYS.marks]).toEqual({
      'm-1': { c1: 'destaque' },
    });
  });
});

describe('a conversa', () => {
  it('mostra o selo de demonstração numa resposta semeada', async () => {
    const conversa: Conversation = {
      id: 'demo-c',
      title: 'Demonstração · Resumo',
      createdAt: 1,
      updatedAt: 2,
      messages: [
        { id: 'u', role: 'user', text: 'O que ficou decidido?', at: 1 },
        { id: 'a', role: 'assistant', text: 'Ficou decidido que…', at: 2, demo: true },
      ],
    };
    await storage.local.set({ [STORAGE_KEYS.conversations]: [conversa] });
    await montar();

    expect(q('.tq-selo-demo').textContent).toBe('Demonstração');
    expect(host.textContent).toContain('Ficou decidido que…');
  });

  /* A linha honesta continua de pé: não há assistente conectado. */
  it('continua dizendo que o assistente não está conectado', async () => {
    await montar();
    expect(host.textContent).toContain('Assistente não conectado');
  });
});
