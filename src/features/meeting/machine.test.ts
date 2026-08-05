import { describe, expect, it } from 'vitest';
import type { MeetingState } from '@/shared/types/domain';
import { IDLE_STATE } from '@/shared/types/domain';
import {
  LANGUAGE_DETECTION_CHUNK_INTERVAL,
  REJOIN_RESUME_WINDOW_MS,
} from '@/shared/config/constants';
import type { MeetingEvent } from './machine';
import { transition } from './machine';

const T0 = 1_000_000;

function detected(
  overrides: Partial<Extract<MeetingEvent, { type: 'MEETING_DETECTED' }>> = {},
): MeetingEvent {
  return {
    type: 'MEETING_DETECTED',
    meetingId: 'm-1',
    meetingCode: 'abc-defg-hij',
    provider: 'google-meet',
    tabId: 7,
    title: 'Reunião com cliente',
    captionsEnabled: false,
    at: T0,
    ...overrides,
  };
}

function chunk(id: string, text: string, atMs = T0 + 5000): MeetingEvent {
  return {
    type: 'CAPTION_CHUNK',
    chunk: { captionId: id, speaker: 'Ana', text, atMs },
  };
}

function recordingState(): MeetingState {
  return transition(IDLE_STATE, detected({ captionsEnabled: true }));
}

function endedState(): MeetingState {
  const rec = transition(recordingState(), chunk('c1', 'proposta orçamento contrato'));
  return transition(rec, { type: 'MEETING_FINISHED', at: T0 + 60_000 });
}

describe('máquina de estados da reunião', () => {
  it('idle → captionsRequired quando legendas desligadas', () => {
    const state = transition(IDLE_STATE, detected());
    expect(state.phase).toBe('captionsRequired');
    expect(state.session?.title).toBe('Reunião com cliente');
    expect(state.session?.meetingCode).toBe('abc-defg-hij');
  });

  it('idle → recording quando legendas já ligadas', () => {
    expect(recordingState().phase).toBe('recording');
  });

  it('captionsRequired → recording quando legendas ativam', () => {
    const state = transition(IDLE_STATE, detected());
    const next = transition(state, { type: 'CAPTIONS_STATE', enabled: true });
    expect(next.phase).toBe('recording');
    expect(next.session?.captionsEnabled).toBe(true);
  });

  it('legendas desligadas no meio da gravação não mudam a fase', () => {
    const next = transition(recordingState(), { type: 'CAPTIONS_STATE', enabled: false });
    expect(next.phase).toBe('recording');
    expect(next.session?.captionsEnabled).toBe(false);
  });

  it('chunks só são aplicados em recording', () => {
    const rec = transition(recordingState(), chunk('c1', 'olá, vamos falar da proposta'));
    expect(rec.session?.segments).toHaveLength(1);

    const paused = transition(rec, { type: 'PAUSE' });
    const afterChunk = transition(paused, chunk('c2', 'isso não deve entrar'));
    expect(afterChunk.session?.segments).toHaveLength(1);
    expect(afterChunk.session?.droppedSegments).toBe(1);
  });

  it('pause sela falas em andamento: update tardio pós-resume é descartado', () => {
    const rec = transition(recordingState(), chunk('c1', 'texto parcial'));
    const paused = transition(rec, { type: 'PAUSE' });
    const resumed = transition(paused, { type: 'RESUME' });
    expect(resumed.phase).toBe('recording');

    const late = transition(resumed, chunk('c1', 'texto parcial com fala da pausa'));
    expect(late.session?.segments[0]?.text).toBe('texto parcial');
    expect(late.session?.droppedSegments).toBe(1);

    const fresh = transition(late, chunk('c9', 'fala nova pós-retomada'));
    expect(fresh.session?.segments).toHaveLength(2);
  });

  it('retomar volta exatamente de onde parou (segmentos preservados)', () => {
    const rec = transition(recordingState(), chunk('c1', 'antes da pausa'));
    const paused = transition(rec, { type: 'PAUSE' });
    const resumed = transition(paused, { type: 'RESUME' });
    expect(resumed.session?.segments).toEqual(rec.session?.segments);
  });

  it('apagar transcrição zera segmentos, marca flag e mantém a gravação', () => {
    const rec = transition(recordingState(), chunk('c1', 'conteúdo sensível'));
    const cleared = transition(rec, { type: 'CLEAR_TRANSCRIPT' });
    expect(cleared.phase).toBe('recording');
    expect(cleared.session?.segments).toHaveLength(0);
    expect(cleared.session?.wasDiscardedAndRestarted).toBe(true);

    // continua capturando novas falas depois da limpeza
    const after = transition(cleared, chunk('c2', 'novo conteúdo'));
    expect(after.session?.segments).toHaveLength(1);
  });

  it('finalizar → ended com endedAt', () => {
    const done = endedState();
    expect(done.phase).toBe('ended');
    expect(done.session?.endedAt).toBe(T0 + 60_000);
  });

  it('finalizar sem nenhuma fala capturada termina explicando, não sumindo', () => {
    // Voltar direto ao idle fazia o painel desaparecer, e desaparecer parece
    // defeito. A sessão termina vazia para a tela poder dizer o que houve; quem
    // decide não gravar registro vazio é o controller.
    const done = transition(recordingState(), {
      type: 'MEETING_FINISHED',
      at: T0 + 10_000,
    });
    expect(done.phase).toBe('ended');
    expect(done.session?.segments).toEqual([]);
    expect(done.session?.endedAt).toBe(T0 + 10_000);

    const abandoned = transition(transition(IDLE_STATE, detected()), {
      type: 'MEETING_FINISHED',
      at: T0 + 10_000,
    });
    expect(abandoned.phase).toBe('ended');
    expect(abandoned.session?.segments).toEqual([]);
  });

  it('ended → idle via reset', () => {
    expect(transition(endedState(), { type: 'RESET' })).toEqual(IDLE_STATE);
  });

  it('rename funciona durante e depois da reunião, ignorando vazio', () => {
    const rec = recordingState();
    const renamed = transition(rec, { type: 'RENAME', title: '  Kickoff Sympla  ' });
    expect(renamed.session?.title).toBe('Kickoff Sympla');
    expect(transition(rec, { type: 'RENAME', title: '   ' })).toBe(rec);
  });

  // ---- as garantias novas ----

  it('reunião NOVA preempta a tela de finalização (bug histórico)', () => {
    const next = transition(
      endedState(),
      detected({
        meetingId: 'm-2',
        meetingCode: 'zzz-nova-sala',
        captionsEnabled: true,
        at: T0 + 90_000,
      }),
    );
    expect(next.phase).toBe('recording');
    expect(next.session?.meetingId).toBe('m-2');
    expect(next.session?.segments).toHaveLength(0);
  });

  it('reunião nova preempta até uma sessão ativa de outra sala', () => {
    const rec = transition(recordingState(), chunk('c1', 'sala antiga'));
    const next = transition(
      rec,
      detected({
        meetingId: 'm-2',
        meetingCode: 'zzz-nova-sala',
        captionsEnabled: true,
        at: T0 + 30_000,
      }),
    );
    expect(next.session?.meetingId).toBe('m-2');
    expect(next.session?.segments).toHaveLength(0);
  });

  it('rejoin na MESMA sala dentro da janela retoma a sessão e a transcrição', () => {
    const resumed = transition(
      endedState(),
      detected({
        meetingId: 'm-nova-ignorada',
        captionsEnabled: true,
        at: T0 + 120_000,
      }),
    );
    expect(resumed.phase).toBe('recording');
    expect(resumed.session?.meetingId).toBe('m-1');
    expect(resumed.session?.segments).toHaveLength(1);
    expect(resumed.session?.endedAt).toBeNull();
    expect(resumed.session?.reconnectCount).toBe(1);
  });

  it('rejoin na mesma sala FORA da janela vira reunião nova', () => {
    const next = transition(
      endedState(),
      detected({
        meetingId: 'm-2',
        captionsEnabled: true,
        at: T0 + 60_000 + REJOIN_RESUME_WINDOW_MS + 1,
      }),
    );
    expect(next.session?.meetingId).toBe('m-2');
    expect(next.session?.segments).toHaveLength(0);
  });

  it('re-detecção da mesma sala com sessão ativa só atualiza aba/legendas', () => {
    const rec = transition(recordingState(), chunk('c1', 'fala'));
    const redetected = transition(
      rec,
      detected({ meetingId: 'm-ignorada', tabId: 12, captionsEnabled: true }),
    );
    expect(redetected.session?.meetingId).toBe('m-1');
    expect(redetected.session?.tabId).toBe(12);
    expect(redetected.session?.segments).toHaveLength(1);
  });

  it('transições ilegais retornam o estado inalterado', () => {
    expect(transition(IDLE_STATE, { type: 'PAUSE' })).toBe(IDLE_STATE);
    const rec = recordingState();
    expect(transition(rec, { type: 'RESUME' })).toBe(rec);
    expect(transition(rec, { type: 'RESET' })).toBe(rec);
  });
});

describe('SPEAKERS_MERGED — uma pessoa deixa de ser duas', () => {
  function withSelfSpeaking(): MeetingState {
    // As primeiras falas chegam como "Você": o Meet ainda não expôs o nome.
    const rec = transition(recordingState(), {
      type: 'CAPTION_CHUNK',
      chunk: { captionId: 'c1', speaker: 'Você', text: 'bom dia', atMs: T0 + 1000 },
    });
    return transition(rec, {
      type: 'PARTICIPANTS_UPDATED',
      participants: [
        { name: 'Você', isHost: null },
        { name: 'Bernardo Belfort', isHost: true },
      ],
    });
  }

  it('reescreve as falas já capturadas com o nome real', () => {
    const merged = transition(withSelfSpeaking(), {
      type: 'SPEAKERS_MERGED',
      renames: [{ from: 'Você', to: 'Bernardo Belfort' }],
    });
    expect(merged.session?.segments.map((s) => s.speaker)).toEqual(['Bernardo Belfort']);
  });

  it('deduplica os participantes e preserva quem é o anfitrião', () => {
    const merged = transition(withSelfSpeaking(), {
      type: 'SPEAKERS_MERGED',
      renames: [{ from: 'Você', to: 'Bernardo Belfort' }],
    });
    expect(merged.session?.participants).toEqual([
      { name: 'Bernardo Belfort', isHost: true },
    ]);
  });

  it('nunca nomeia a reunião de "Reunião com Você"', () => {
    const auto = transition(IDLE_STATE, detected({ title: '', titleAuto: true, captionsEnabled: true }));
    const base = transition(auto, {
      type: 'PARTICIPANTS_UPDATED',
      participants: [
        { name: 'Você', isHost: null },
        { name: 'Bernardo Belfort', isHost: true },
      ],
    });
    // Só existe a própria pessoa na sala: não há cliente para dar nome.
    expect(base.session?.title).toBe('');

    const comCliente = transition(base, {
      type: 'PARTICIPANTS_UPDATED',
      participants: [
        { name: 'Bernardo Belfort', isHost: true },
        { name: 'Ana Souza', isHost: null },
      ],
    });
    expect(comCliente.session?.title).toBe('Reunião com Ana');
  });

  it('lista vazia de renames não mexe no estado', () => {
    const state = withSelfSpeaking();
    expect(transition(state, { type: 'SPEAKERS_MERGED', renames: [] })).toBe(state);
  });
});

describe('presença, histórico de participação e falantes observados', () => {
  it('separa presentNow de quem participou e depois saiu', () => {
    const first = transition(recordingState(), {
      type: 'PARTICIPANTS_UPDATED',
      participants: [
        { name: 'Ana Souza', isHost: true, providerParticipantId: 'a' },
        { name: 'Bruno Lima', isHost: null, providerParticipantId: 'b' },
      ],
    });
    const afterExit = transition(first, {
      type: 'PARTICIPANTS_UPDATED',
      participants: [
        { name: 'Ana Souza', isHost: true, providerParticipantId: 'a' },
      ],
    });

    expect(afterExit.session?.presentNow?.map((entry) => entry.name)).toEqual([
      'Ana Souza',
    ]);
    expect(afterExit.session?.participants.map((entry) => entry.name)).toEqual([
      'Ana Souza',
      'Bruno Lima',
    ]);
  });

  it('convidado confirmado permanece no histórico mesmo sem falar', () => {
    const state = transition(recordingState(), {
      type: 'PARTICIPANTS_UPDATED',
      participants: [{ name: 'Convidada', isHost: null, providerParticipantId: 'guest' }],
    });
    expect(state.session?.participants).toHaveLength(1);
    expect(state.session?.speakersObserved ?? []).toEqual([]);
  });

  it('falante sem tile vira speakerOnly de baixa confiança, não participante', () => {
    const state = transition(recordingState(), {
      type: 'CAPTION_CHUNK',
      chunk: {
        captionId: 'speaker-only',
        speaker: 'Pessoa sem tile',
        text: 'fala preservada mesmo sem correspondência de presença',
        atMs: T0 + 2_000,
      },
    });

    expect(state.session?.participants).toEqual([]);
    expect(state.session?.speakersObserved).toEqual([
      expect.objectContaining({
        name: 'Pessoa sem tile',
        matchedParticipant: false,
        confidence: 0.35,
      }),
    ]);
  });

  it('mantém a conta do Meet como contexto e expõe divergência já calculada', () => {
    const boundary = {
      meet: {
        email: 'pessoal@gmail.com',
        displayName: 'Ana',
        observedAt: T0,
        source: 'meet_account_control' as const,
        confidence: 0.95,
      },
      product: {
        tenantId: 'tenant-citi',
        userId: 'user-ana',
        email: 'ana@citi.org.br',
        name: 'Ana',
      },
      mismatch: true,
    };
    const state = transition(recordingState(), {
      type: 'ACCOUNT_BOUNDARY_UPDATED',
      boundary,
    });
    expect(state.session?.accountBoundary).toEqual(boundary);
    expect(state.session?.participants).toEqual([]);
  });

  it('expõe último chunk e contagem de lacunas sem guardar conteúdo em métricas', () => {
    const withChunk = transition(recordingState(), {
      type: 'CAPTION_CHUNK',
      chunk: {
        captionId: 'health-1',
        speaker: null,
        text: 'fala sem identificação ainda é preservada',
        atMs: T0 + 3_000,
      },
    });
    const degraded = transition(withChunk, {
      type: 'CAPTURE_DEGRADED',
      at: T0 + 4_000,
    });
    expect(degraded.session?.lastChunkAt).toBe(T0 + 3_000);
    expect(degraded.session?.captureDegradedCount).toBe(1);
  });

  // ---- aviso de idioma da legenda ----

  it('idioma da legenda só é reavaliado a cada LANGUAGE_DETECTION_CHUNK_INTERVAL chunks aplicados', () => {
    let state = recordingState();
    expect(state.session?.captionLanguage).toBe('unknown');

    const english =
      "so I think that we are going to do this because you know what that is not what we have with the plan";
    for (let i = 0; i < LANGUAGE_DETECTION_CHUNK_INTERVAL - 1; i += 1) {
      state = transition(state, chunk(`c${i}`, english, T0 + 1000 * (i + 1)));
    }
    expect(state.session?.captionLanguage).toBe('unknown');

    state = transition(
      state,
      chunk('c-last', english, T0 + 1000 * LANGUAGE_DETECTION_CHUNK_INTERVAL),
    );
    expect(state.session?.captionLanguage).toBe('en');
  });

  it('LANGUAGE_WARNING_DISMISSED silencia o aviso só para a sessão atual', () => {
    const rec = recordingState();
    const dismissed = transition(rec, { type: 'LANGUAGE_WARNING_DISMISSED' });
    expect(dismissed.session?.languageWarningDismissed).toBe(true);

    // Reunião nova não herda a supressão da anterior.
    const next = transition(
      dismissed,
      detected({ meetingId: 'm-2', meetingCode: 'zzz-nova-sala', captionsEnabled: true }),
    );
    expect(next.session?.languageWarningDismissed).toBe(false);
  });

  it('LANGUAGE_WARNING_DISMISSED fora de uma sessão ativa não faz nada', () => {
    expect(transition(IDLE_STATE, { type: 'LANGUAGE_WARNING_DISMISSED' })).toBe(IDLE_STATE);
  });
});
