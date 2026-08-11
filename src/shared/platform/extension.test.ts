/**
 * O que vale a pena testar aqui é UMA coisa: a corrida entre o snapshot e o
 * broadcast.
 *
 * `subscribeMeeting` faz duas perguntas ao mesmo tempo — "qual é o estado
 * agora?" (resposta assíncrona) e "me avise quando mudar" (imediato). Se a
 * reunião avançar no intervalo entre a pergunta e a resposta, o snapshot que
 * chega já está VELHO, e aplicá-lo por cima do broadcast recém-recebido faz a
 * tela voltar no tempo: a transcrição pisca de volta para o estado anterior, ou
 * a janela recém-aberta mostra "aguardando reunião" durante uma gravação.
 *
 * É um defeito que só aparece sob latência, o que o torna raro na extensão e
 * quase garantido por um socket. Daí o teste.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeetingState } from '@/shared/types/domain';
import { IDLE_STATE } from '@/shared/types/domain';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { extensionPlatform } from './extension';

/** Um estado de gravação mínimo que passa pelo schema. */
function recordingState(title: string): MeetingState {
  return {
    phase: 'recording',
    session: {
      meetingId: 'm-1',
      meetingCode: 'abc-defg-hij',
      provider: 'googleMeet',
      title,
      tabId: null,
      startedAt: 1_700_000_000_000,
      endedAt: null,
      captionsEnabled: true,
      participants: [],
      presentNow: [],
      speakersObserved: [],
      segments: [],
      sealedCaptionIds: [],
      droppedSegments: 0,
      reconnectCount: 0,
      captureDegradedCount: 0,
      lastChunkAt: null,
      wasDiscardedAndRestarted: false,
      captionLanguage: 'unknown',
      languageWarningDismissed: false,
      chunksSinceLanguageCheck: 0,
    },
  };
}

describe('extensionPlatform.subscribeMeeting', () => {
  /** Handler registrado via chrome.runtime.onMessage, para disparar broadcasts. */
  let broadcast: (message: unknown) => void;
  /** Resolve a resposta pendente de `ui/getState`. */
  let answerGetState: (state: MeetingState) => void;

  beforeEach(() => {
    installChromeStorageMock({
      extra: {
        runtime: {
          sendMessage: vi.fn(
            () => new Promise<MeetingState>((resolve) => (answerGetState = resolve)),
          ),
          onMessage: {
            addListener: vi.fn((listener: (m: unknown, s: unknown, r: unknown) => void) => {
              broadcast = (message) => listener(message, {}, () => {});
            }),
            removeListener: vi.fn(),
          },
        },
      },
    });
  });

  it('descarta o snapshot velho quando um broadcast chegou antes dele', async () => {
    const seen: MeetingState[] = [];
    extensionPlatform.subscribeMeeting((state) => seen.push(state));

    // A reunião avança enquanto o `ui/getState` ainda está no ar.
    broadcast({ type: 'state/updated', state: recordingState('novo') });
    // ...e só então o background responde, com o estado de antes.
    answerGetState(recordingState('velho'));
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.session?.title).toBe('novo');
  });

  it('aplica o snapshot quando nada chegou antes', async () => {
    const seen: MeetingState[] = [];
    extensionPlatform.subscribeMeeting((state) => seen.push(state));

    answerGetState(recordingState('do snapshot'));
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    expect(seen[0]?.session?.title).toBe('do snapshot');
  });

  it('cai para o estado ocioso quando a resposta é inválida', async () => {
    const seen: MeetingState[] = [];
    extensionPlatform.subscribeMeeting((state) => seen.push(state));

    answerGetState(null as unknown as MeetingState);
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    expect(seen[0]).toEqual(IDLE_STATE);
  });

  it('para de emitir depois de cancelada a assinatura', async () => {
    const seen: MeetingState[] = [];
    const unsubscribe = extensionPlatform.subscribeMeeting((state) => seen.push(state));

    unsubscribe();
    broadcast({ type: 'state/updated', state: recordingState('tarde demais') });
    answerGetState(recordingState('tarde demais'));
    await Promise.resolve();

    expect(seen).toHaveLength(0);
  });
});
