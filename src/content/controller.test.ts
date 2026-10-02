/**
 * O PORTÃO DA CAPTURA: nada é registrado antes de a pessoa dizer que sim.
 *
 * Este é o teste que impede a regressão mais cara do produto — a extensão
 * voltar a começar a transcrever sozinha ao detectar uma reunião. O que se
 * observa é a mensagem `meet/detected`, porque é ela, e só ela, que faz o
 * background abrir uma sessão e começar a guardar fala.
 *
 * O provider é falso de propósito: o que está em teste é a decisão do
 * controller, não o DOM do Meet (esse tem os testes do GoogleMeetProvider).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import type { MeetingProvider, MeetingSession } from '@/features/meeting/provider';
import type { ExtensionMessage } from '@/shared/types/messages';

const SALA: MeetingSession = { meetingCode: 'abc-defg-hij', title: 'Planning' };

/** Um provider que não observa nada: os eventos são disparados pelo teste. */
function fakeProvider() {
  const ouvintes: { start: Array<(s: MeetingSession) => void> } = { start: [] };
  let detectada: MeetingSession | null = null;

  const provider: MeetingProvider = {
    id: 'fake',
    detectMeeting: () => detectada,
    onMeetingStart: (cb) => {
      ouvintes.start.push(cb);
      return () => {};
    },
    onMeetingEnd: () => () => {},
    areCaptionsAvailable: () => true,
    areCaptionsEnabled: () => true,
    onCaptionChunk: () => () => {},
    getParticipants: () => null,
    onCaptionsStateChange: () => () => {},
    onReconnect: () => () => {},
    onSpeakersMerged: () => () => {},
    onCaptureHealth: () => () => {},
    requestEnableCaptions: () => true,
    recutCaptions: () => {},
    setCapturePaused: () => {},
    start: () => {},
    stop: () => {},
  };

  return {
    provider,
    entrarNaSala(sala = SALA) {
      detectada = sala;
      ouvintes.start.forEach((cb) => cb(sala));
    },
    /** A sala já estava aberta quando o script entrou (reload da aba). */
    jaEstavaNaSala(sala = SALA) {
      detectada = sala;
    },
    /**
     * O Meet re-renderizou e, por alguns quadros, `detectMeeting()` não
     * reconhece a sala — o botão de sair sumiu da árvore e voltará. A reunião
     * NÃO acabou: nenhum `onMeetingEnd` é disparado.
     */
    somePorUmInstante() {
      detectada = null;
    },
  };
}

function enviadas(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.map((c) => (c[0] as ExtensionMessage).type);
}

let sendMessage: ReturnType<typeof vi.fn>;

/**
 * Deixa as promessas de storage e de mensagem assentarem.
 *
 * Um tique de verdade, e não `Promise.resolve()` empilhado: o caminho até a
 * decisão passa por duas leituras de storage encadeadas, e contar microtasks à
 * mão é um teste que quebra sempre que alguém acrescenta um `await`.
 */
const assentar = (ms = 40) => new Promise((r) => setTimeout(r, ms));

async function montarControlador(fake: ReturnType<typeof fakeProvider>) {
  const { ContentController } = await import('./controller');
  const controller = new ContentController(fake.provider);
  controller.start();
  await assentar();
  return controller;
}

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
});

describe('detectar uma reunião não é começar a registrá-la', () => {
  it('sem resposta, `meet/detected` não é enviada', async () => {
    const fake = fakeProvider();
    await montarControlador(fake);

    fake.entrarNaSala();
    await assentar();

    expect(enviadas(sendMessage)).not.toContain('meet/detected');
  });

  it('a sala já aberta no carregamento também espera a resposta', async () => {
    const fake = fakeProvider();
    fake.jaEstavaNaSala();
    await montarControlador(fake);

    expect(enviadas(sendMessage)).not.toContain('meet/detected');
  });

  /*
   * A pergunta não pode voltar: o Meet reemite `onMeetingStart` a cada
   * re-render pesado da sala, e sem o guarda cada um desses eventos reabriria
   * uma pergunta já respondida.
   */
  it('recusar não faz a pergunta voltar no re-render seguinte', async () => {
    const fake = fakeProvider();
    await montarControlador(fake);

    fake.entrarNaSala();
    await assentar();

    // A resposta é gravada pela participação anunciada — é o que a sidebar (ou
    // a pergunta na página) faz.
    const { lerReuniaoDetectada, guardarDecisao } = await import(
      '@/features/meeting/consent'
    );
    const anunciada = await lerReuniaoDetectada();
    expect(anunciada?.participacaoId).toBeTruthy();
    await guardarDecisao(anunciada!.participacaoId, 'recusado');
    await assentar();

    // Re-render do Meet: o mesmo evento, de novo.
    fake.entrarNaSala();
    await assentar();

    expect(enviadas(sendMessage)).not.toContain('meet/detected');
  });

  /*
   * Reload da aba no meio de uma reunião JÁ aceita. A participação continua
   * ABERTA, então é a mesma — e a autorização dela vale sem perguntar de novo.
   */
  it('um aceite da participação em curso dispensa a pergunta e religa a captura', async () => {
    const { abrirParticipacao, guardarDecisao } = await import(
      '@/features/meeting/consent'
    );
    const participacao = await abrirParticipacao(SALA.meetingCode, Date.now());
    await guardarDecisao(participacao.id, 'aceito');

    const fake = fakeProvider();
    fake.jaEstavaNaSala();
    await montarControlador(fake);
    await assentar();

    expect(enviadas(sendMessage)).toContain('meet/detected');
  });

  /*
   * A REGRESSÃO que fazia o "sim" não ligar nada.
   *
   * Quem responde na sidebar responde de outro contexto: a decisão chega aqui
   * pelo storage, e nesse instante o `detectMeeting()` pode responder `null`
   * por alguns quadros, porque o Meet re-renderiza a sala inteira com
   * frequência. O controller guardava a reunião pendente para exatamente esse
   * caso — e a apagava uma linha ANTES de escolher o alvo, então o alvo era
   * sempre `null` e a captura não começava. A pergunta sumia das duas
   * superfícies, nada era gravado, e não havia erro nenhum para investigar.
   */
  it('o aceite liga a captura mesmo se o Meet não estiver reconhecível naquele instante', async () => {
    const fake = fakeProvider();
    await montarControlador(fake);

    fake.entrarNaSala();
    await assentar();

    const { lerReuniaoDetectada, guardarDecisao } = await import(
      '@/features/meeting/consent'
    );
    const anunciada = await lerReuniaoDetectada();
    expect(anunciada?.participacaoId).toBeTruthy();

    fake.somePorUmInstante();
    await guardarDecisao(anunciada!.participacaoId, 'aceito');
    await assentar();

    expect(enviadas(sendMessage)).toContain('meet/detected');
  });

  /*
   * O mesmo link, outra reunião. A participação anterior foi FECHADA há muito,
   * então entrar de novo abre uma nova — e a autorização antiga não acompanha.
   */
  it('um aceite antigo no mesmo link NÃO religa a captura sozinho', async () => {
    const { abrirParticipacao, fecharParticipacao, guardarDecisao } = await import(
      '@/features/meeting/consent'
    );
    const { REJOIN_RESUME_WINDOW_MS } = await import('@/shared/config/constants');

    const ontem = Date.now() - 24 * 60 * 60_000;
    const anterior = await abrirParticipacao(SALA.meetingCode, ontem);
    await guardarDecisao(anterior.id, 'aceito');
    await fecharParticipacao(ontem + REJOIN_RESUME_WINDOW_MS + 60_000);

    const fake = fakeProvider();
    fake.jaEstavaNaSala();
    await montarControlador(fake);
    await assentar();

    expect(enviadas(sendMessage)).not.toContain('meet/detected');

    // E a pergunta está de pé, para a nova participação.
    const { lerReuniaoDetectada } = await import('@/features/meeting/consent');
    const anunciada = await lerReuniaoDetectada();
    expect(anunciada?.participacaoId).toBeTruthy();
    expect(anunciada?.participacaoId).not.toBe(anterior.id);
  });
});
