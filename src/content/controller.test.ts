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
  };
}

function enviadas(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.map((c) => (c[0] as ExtensionMessage).type);
}

let sendMessage: ReturnType<typeof vi.fn>;

async function montarControlador(fake: ReturnType<typeof fakeProvider>) {
  const { ContentController } = await import('./controller');
  const controller = new ContentController(fake.provider);
  controller.start();
  // Deixa as promessas de storage e de mensagem assentarem.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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
    await Promise.resolve();
    await Promise.resolve();

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
   * re-render pesado da sala, e sem o guarda por código de sala cada um desses
   * eventos reabriria uma pergunta já respondida.
   */
  it('a decisão fica guardada por sala e a pergunta não se repete', async () => {
    const fake = fakeProvider();
    await montarControlador(fake);

    fake.entrarNaSala();
    await Promise.resolve();
    await Promise.resolve();

    const { STORAGE_KEYS } = await import('@/shared/config/constants');
    const { guardarDecisao } = await import('./consent');
    await guardarDecisao(SALA.meetingCode, 'recusado');

    // Re-render do Meet: o mesmo evento, de novo.
    fake.entrarNaSala();
    await Promise.resolve();
    await Promise.resolve();

    expect(enviadas(sendMessage)).not.toContain('meet/detected');
    const guardado = (await chrome.storage.session.get(STORAGE_KEYS.meetingConsent))[
      STORAGE_KEYS.meetingConsent
    ];
    expect(guardado).toEqual({ [SALA.meetingCode]: 'recusado' });
  });

  /* Reload da aba no meio de uma reunião JÁ aceita: a captura recomeça sem
     perguntar de novo, porque a decisão vale para a sessão do navegador. */
  it('um aceite anterior dispensa a pergunta e religa a captura', async () => {
    const { guardarDecisao } = await import('./consent');
    await guardarDecisao(SALA.meetingCode, 'aceito');

    const fake = fakeProvider();
    fake.jaEstavaNaSala();
    await montarControlador(fake);
    await Promise.resolve();

    expect(enviadas(sendMessage)).toContain('meet/detected');
  });
});
