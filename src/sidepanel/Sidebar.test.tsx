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

/** A aba da reunião pelo nome visível: é por elas que se chega às notas. */
function aba(nome: string): HTMLButtonElement {
  return todos<HTMLButtonElement>('.tq-reuniao-abas button').find((b) =>
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

    expect(estadoDe('Reunião')).toBe('Ao vivo');
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
    expect(seletor('Reunião').getAttribute('aria-current')).toBeNull();
    expect(estadoDe('Reunião')).toBe('Ao vivo');
  });

  it.each([
    ['paused' as const, true, 'PAUSADA'],
    ['recording' as const, false, 'INTERROMPIDA'],
    ['captionsRequired' as const, true, 'PREPARANDO'],
    ['ended' as const, true, 'SALVA'],
  ])('fase %s com captura saudável=%s lê "%s"', async (phase, saudavel, palavra) => {
    estado = { phase, session: sessao({ captureHealthy: saudavel }) };
    await montar();

    expect(estadoDe('Reunião').toUpperCase()).toBe(palavra);
  });

  /* A encerrada vai para o histórico: a seção não fica presa nela. */
  it('ao encerrar, a reunião sai da tela e a seção fica no histórico', async () => {
    estado = { phase: 'recording', session: sessao() };
    await montar();
    expect(host.textContent).toContain('Finalizar reunião');

    await transmitir({ phase: 'ended', session: sessao({ endedAt: Date.now() }) });

    // A tela ao vivo saiu; no lugar dela, o histórico.
    expect(host.textContent).not.toContain('Finalizar reunião');
    expect(host.textContent).not.toContain('Transcrevendo');
    expect(q('.tq-secao-titulo').textContent).toBe('Reuniões');
    expect(seletor('Reunião').getAttribute('aria-current')).toBe('page');
  });

  /*
   * O histórico se abre no MEIO da reunião, pelo ícone do topo, sem encerrar
   * nada — e a reunião ao vivo continua montada embaixo, com a rolagem dela.
   */
  it('o ícone de lista abre o histórico sem tirar a reunião ao vivo', async () => {
    estado = { phase: 'recording', session: sessao() };
    await montar();
    const falas = q('.tq-falas');

    await clicar(q<HTMLButtonElement>('button[aria-label="Reuniões"]'));
    expect(q('.tq-secao-titulo').textContent).toBe('Reuniões');
    expect(falas.closest('[aria-hidden="true"]')).not.toBeNull();

    await clicar(seletor('Reunião'));
    expect(host.querySelector('.tq-secao-titulo')).toBeNull();
    expect(q('.tq-falas')).toBe(falas);
  });

  it('sem reunião nenhuma, a captura está desligada', async () => {
    await montar();
    expect(estadoDe('Reunião').toUpperCase()).toBe('DESLIGADA');
  });

  /* Cor não é o único canal: a palavra do estado precisa estar lá. */
  it('cada estado tem texto, e não só cor', async () => {
    estado = { phase: 'recording', session: sessao({ captureHealthy: false }) };
    await montar();

    const rotulo = seletor('Reunião').querySelector('.tq-modo-estado')!;
    expect(rotulo.textContent!.trim().length).toBeGreaterThan(0);
    // A frase por extenso é anunciada FORA do botão (senão entra no nome dele).
    expect(q('.tq-modos').textContent).toContain('Reunião: captura interrompida');
  });
});

describe('trocar de seção não custa nada', () => {
  it('preserva o rascunho da conversa e a seção da transcrição', async () => {
    estado = { phase: 'recording', session: sessao() };
    await montar();

    await clicar(seletor('Conversa'));
    await escrever(q<HTMLTextAreaElement>('.tq-compositor textarea'), 'Pergunta pela metade');

    const falasAntes = q('.tq-falas');

    await clicar(seletor('Reunião'));
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
  it('estão as três à vista, sem menu nenhum', async () => {
    estado = { phase: 'recording', session: sessao() };
    await montar();

    const nomes = todos<HTMLButtonElement>('.tq-acao').map((b) => b.textContent);
    expect(nomes.some((n) => n?.includes('Print'))).toBe(true);
    expect(nomes.some((n) => n?.includes('Pausar'))).toBe(true);
    expect(nomes.some((n) => n?.includes('Pergunta rápida'))).toBe(true);
  });

  /*
   * A DUPLICIDADE que saiu: havia um botão "Nota" aqui em cima E uma aba
   * "Notas" logo abaixo, abrindo o mesmo editor. O caminho agora é um só, e
   * este teste existe para ninguém devolver o segundo sem perceber.
   */
  it('não há botão de nota na fileira de ações — a nota é a aba', async () => {
    estado = { phase: 'recording', session: sessao() };
    await montar();

    const nomes = todos<HTMLButtonElement>('.tq-acao').map((b) => b.textContent);
    expect(nomes.some((n) => n?.includes('Nota'))).toBe(false);
    expect(aba('Notas')).toBeTruthy();
  });

  it('o editor de nota abre pela aba, recolhe e não perde o que foi escrito', async () => {
    estado = { phase: 'recording', session: sessao() };
    await montar();

    await clicar(aba('Notas'));
    await escrever(q<HTMLTextAreaElement>('#tq-editor-de-nota'), 'Combinado: avisar hoje');

    await clicar(aba('Transcrição'));
    expect(q('#tq-editor-de-nota').closest('[aria-hidden="true"]')).not.toBeNull();

    await clicar(aba('Notas'));
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
    expect(estadoDe('Reunião')).toBe('Ao vivo');
  });

  /*
   * Finalizar é a única ação da reunião que não se desfaz. O primeiro toque só
   * arma o botão; é o segundo que pede o fim ao background.
   */
  it('finalizar pede confirmação antes de encerrar a captura', async () => {
    estado = { phase: 'recording', session: sessao() };
    await montar();

    const finalizar = q<HTMLButtonElement>('.tq-finalizar');
    const pedidos = () =>
      vi.mocked(chrome.runtime.sendMessage).mock.calls.map(([m]) => m);

    await clicar(finalizar);
    expect(pedidos()).not.toContainEqual({ type: 'ui/finish' });
    expect(finalizar.textContent).toContain('Encerrar agora');

    await clicar(finalizar);
    expect(pedidos()).toContainEqual({ type: 'ui/finish' });
  });

  /*
   * A pergunta rápida não é atalho de mentira: a pergunta vai para uma
   * conversa de verdade, com a reunião como contexto, e "Continuar na
   * conversa" abre exatamente essa conversa. Sem assistente conectado, ela diz
   * isso no lugar da resposta — e não finge uma.
   */
  it('a pergunta rápida grava a pergunta com a reunião e continua na conversa', async () => {
    estado = { phase: 'recording', session: sessao() };
    await montar();

    await clicar(acao('Pergunta rápida'));
    expect(acao('Pergunta rápida').getAttribute('aria-expanded')).toBe('true');
    // Continua na reunião: nada de pular para a conversa.
    expect(seletor('Reunião').getAttribute('aria-current')).toBe('page');

    const campo = q<HTMLInputElement>('.tq-rapida-campo input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        campo,
        'Quem ficou com o protótipo?',
      );
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      q<HTMLFormElement>('.tq-rapida-campo').requestSubmit();
    });
    await act(async () => {});

    expect(q('.tq-rapida-aviso').textContent).toContain('não está conectado');
    const gravadas = storage.local.values[STORAGE_KEYS.conversations] as Conversation[];
    expect(gravadas).toHaveLength(1);
    expect(gravadas[0]!.meetingId).toBe('m-1');
    expect(gravadas[0]!.messages[0]!.text).toBe('Quem ficou com o protótipo?');

    const continuar = todos<HTMLButtonElement>('.tq-rapida-pe button').find((b) =>
      b.textContent?.includes('Continuar na conversa'),
    )!;
    await clicar(continuar);

    expect(seletor('Conversa').getAttribute('aria-current')).toBe('page');
    expect(q('.tq-msg-voce').textContent).toBe('Quem ficou com o protótipo?');
  });

  /*
   * As perguntas prontas de condução só aparecem com o assistente conectado, e
   * cada uma é uma pergunta comum: o clique manda exatamente aquele texto. Quem
   * decide o que está decidido ou em aberto é o copiloto, não esta tela.
   */
  it('as perguntas prontas enviam a pergunta e só existem com o assistente conectado', async () => {
    estado = { phase: 'recording', session: sessao() };
    await montar();
    await clicar(acao('Pergunta rápida'));
    expect(todos('.tq-rapida-atalhos button')).toHaveLength(0);

    const { _definirTaq } = await import('@/features/taq/interface');
    const executar = vi.fn(async () => ({
      execucaoId: 'x1',
      estado: 'concluido',
      resposta: 'Falta fechar o responsável pela regra de permissão.',
      evidencias: [],
      documentos: [],
      informacoesAusentes: [],
      limitacoes: [],
      erros: [],
      metricas: { duracaoMs: 1, passos: 1, chamadasDeFerramenta: 0, uso: { entrada: 1, saida: 1 } },
    }));
    _definirTaq({
      adaptador: {
        turno: async () => {
          throw new Error('não deveria chamar o modelo direto');
        },
        estado: async () => ({
          pronto: true,
          provedor: 'teste',
          modelo: 'teste',
          instrucoesVersao: 'taq-v7',
          politicaDeDados: 'private',
          pendencias: [],
        }),
      },
      orquestrador: { agentes: {}, executar } as never,
    });
    try {
      // Remonta para o assistente ser verificado como conectado.
      await act(async () => root.unmount());
      root = createRoot(host);
      await montar();
      await act(async () => new Promise((r) => setTimeout(r, 20)));
      await clicar(acao('Pergunta rápida'));

      const atalhos = todos<HTMLButtonElement>('.tq-rapida-atalhos button');
      expect(atalhos.map((b) => b.textContent)).toEqual([
        'O que falta fechar',
        'Me ajude a fechar',
        'Sugerir acompanhamentos',
      ]);
      // Os dois primeiros não perguntam nada ao copiloto: só abrem o cartão do estado.
      expect(executar).not.toHaveBeenCalled();

      // "O que falta fechar" e "Me ajude a fechar" abrem o cartão do estado: não são
      // perguntas ao copiloto. "Sugerir acompanhamentos" é uma pergunta comum,
      // enviada exatamente como está escrita.
      await clicar(atalhos[2]!);
      await act(async () => new Promise((r) => setTimeout(r, 20)));
      expect(executar).toHaveBeenCalledTimes(1);
      expect((executar.mock.calls[0] as unknown as [{ texto: string }])[0].texto).toBe(
        'Sugira os compromissos desta reunião para eu revisar.',
      );
      expect(q('.tq-rapida-texto').textContent).toContain('Falta fechar o responsável');
    } finally {
      _definirTaq({ adaptador: null, orquestrador: null });
    }
  });

  it('"Perguntar sobre o trecho" leva o trecho como contexto e abre a conversa', async () => {
    estado = { phase: 'recording', session: sessao() };
    await montar();

    await clicar(q<HTMLButtonElement>('.tq-fala-corpo'));
    const perguntar = todos<HTMLButtonElement>('.tq-fala-acoes button').find((b) =>
      b.textContent?.includes('Perguntar sobre o trecho'),
    )!;
    await clicar(perguntar);

    expect(seletor('Conversa').getAttribute('aria-current')).toBe('page');
    expect(q('.tq-contexto-pendente').textContent).toContain('Planning da semana');
    expect(q('.tq-contexto-pendente').textContent).toContain('fechar o escopo');
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
