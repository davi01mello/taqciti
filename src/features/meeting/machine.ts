/**
 * Máquina de estados do ciclo de vida da reunião — um reducer puro.
 *
 *   idle → captionsRequired → recording ⇄ paused → ended → sent
 *
 * Toda transição é `transition(state, event) → state`: sem efeitos, sem
 * Date.now() interno (timestamps chegam nos eventos), 100% testável.
 * Eventos ilegais para a fase atual retornam o estado inalterado — a UI só
 * reflete o estado, nunca decide transições.
 *
 * Duas garantias centrais (corrigem os bugs históricos da extensão):
 * 1. MEETING_DETECTED nunca é ignorado por causa da fase: uma reunião nova
 *    SEMPRE começa a gravar, mesmo se a anterior ficou parada em `ended`.
 * 2. Reentrar na MESMA sala dentro da janela de retomada continua a sessão
 *    anterior (queda de conexão/reload não parte a transcrição em duas).
 */
import type {
  AccountBoundaryState,
  CaptionChunk,
  MeetingSessionState,
  MeetingState,
  Participant,
  SpeakerObservation,
} from '@/shared/types/domain';
import { IDLE_STATE } from '@/shared/types/domain';
import { REJOIN_RESUME_WINDOW_MS } from '@/shared/config/constants';
import {
  applyCaptionChunk,
  collectCaptionIds,
  mergeSealedIds,
  renameSpeaker,
} from '@/features/transcription/aggregator';
import type { SpeakerRename } from '@/features/transcription/speakerIdentity';
import { computeCommercialConfidence } from './commercialConfidence';
import { deriveMeetingTitle } from './naming';

export type MeetingEvent =
  | {
      type: 'MEETING_DETECTED';
      meetingId: string;
      meetingCode: string;
      provider: string;
      tabId: number | null;
      title: string;
      /** Título foi preenchido pela extensão (data/cliente), não pela pessoa. */
      titleAuto?: boolean;
      captionsEnabled: boolean;
      at: number;
    }
  | { type: 'CAPTIONS_STATE'; enabled: boolean }
  | { type: 'CAPTION_CHUNK'; chunk: CaptionChunk }
  | { type: 'PARTICIPANTS_UPDATED'; participants: Participant[] }
  | { type: 'ACCOUNT_BOUNDARY_UPDATED'; boundary: AccountBoundaryState }
  | { type: 'CAPTURE_DEGRADED'; at: number }
  /** Grafias que eram a mesma pessoa viraram uma: corrige o já capturado. */
  | { type: 'SPEAKERS_MERGED'; renames: SpeakerRename[] }
  | { type: 'RECONNECT' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'CLEAR_TRANSCRIPT' }
  | { type: 'RENAME'; title: string }
  | { type: 'MEETING_FINISHED'; at: number }
  | { type: 'MARK_SENT' }
  | { type: 'RESET' };

const ACTIVE_PHASES = ['captionsRequired', 'recording', 'paused'] as const;
const POST_MEETING_PHASES = ['ended', 'sent'] as const;

function isActive(state: MeetingState): boolean {
  return (ACTIVE_PHASES as readonly string[]).includes(state.phase);
}

function isPostMeeting(state: MeetingState): boolean {
  return (POST_MEETING_PHASES as readonly string[]).includes(state.phase);
}

function withSession(
  state: MeetingState,
  patch: Partial<MeetingSessionState>,
): MeetingState {
  if (state.session === null) return state;
  return { ...state, session: { ...state.session, ...patch } };
}

function participantKey(participant: Participant): string {
  return participant.providerParticipantId
    ? `id:${participant.providerParticipantId}`
    : `name:${participant.name.trim().toLocaleLowerCase('pt-BR')}`;
}

/** `participants` é histórico de presença; a leitura atual vive em presentNow. */
function mergeAttendance(
  attended: readonly Participant[],
  presentNow: readonly Participant[],
): Participant[] {
  const merged = new Map(attended.map((participant) => [participantKey(participant), participant]));
  for (const participant of presentNow) {
    const key = participantKey(participant);
    const previous = merged.get(key);
    merged.set(key, previous ? { ...previous, ...participant } : participant);
  }
  return [...merged.values()];
}

function observeSpeaker(
  session: MeetingSessionState,
  speaker: string | null,
  at: number,
): SpeakerObservation[] {
  const observations = session.speakersObserved ?? [];
  if (!speaker) return observations;
  const key = speaker.trim().toLocaleLowerCase('pt-BR');
  const matchedParticipant = (session.participants ?? []).some(
    (participant) => participant.name.trim().toLocaleLowerCase('pt-BR') === key,
  );
  const index = observations.findIndex(
    (entry) => entry.name.trim().toLocaleLowerCase('pt-BR') === key,
  );
  if (index < 0) {
    return [
      ...observations,
      {
        name: speaker,
        firstSeenAt: at,
        lastSeenAt: at,
        source: 'caption',
        confidence: matchedParticipant ? 0.9 : 0.35,
        matchedParticipant,
      },
    ];
  }
  const next = [...observations];
  const previous = observations[index]!;
  next[index] = {
    ...previous,
    lastSeenAt: Math.max(previous.lastSeenAt, at),
    matchedParticipant: previous.matchedParticipant || matchedParticipant,
    confidence: previous.matchedParticipant || matchedParticipant ? 0.9 : previous.confidence,
  };
  return next;
}

function freshSession(
  event: Extract<MeetingEvent, { type: 'MEETING_DETECTED' }>,
): MeetingState {
  const session: MeetingSessionState = {
    meetingId: event.meetingId,
    meetingCode: event.meetingCode,
    provider: event.provider,
    tabId: event.tabId,
    title: event.title,
    titleAuto: event.titleAuto ?? false,
    startedAt: event.at,
    endedAt: null,
    captionsEnabled: event.captionsEnabled,
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
    commercialConfidence: null,
  };
  return {
    phase: event.captionsEnabled ? 'recording' : 'captionsRequired',
    session,
  };
}

export function transition(state: MeetingState, event: MeetingEvent): MeetingState {
  switch (event.type) {
    case 'MEETING_DETECTED': {
      const current = state.session;

      // Mesma sala com sessão ativa (reload da aba, re-render do Meet):
      // a sessão continua — só atualizamos aba e estado das legendas.
      if (isActive(state) && current?.meetingCode === event.meetingCode) {
        const next = withSession(state, {
          tabId: event.tabId,
          captionsEnabled: event.captionsEnabled,
        });
        if (state.phase === 'captionsRequired' && event.captionsEnabled) {
          return { ...next, phase: 'recording' };
        }
        return next;
      }

      // Mesma sala logo depois de encerrar (queda, reload, "finalizar" por
      // engano + rejoin): retoma a MESMA sessão e segue transcrevendo.
      if (
        isPostMeeting(state) &&
        current?.meetingCode === event.meetingCode &&
        current.endedAt !== null &&
        event.at - current.endedAt <= REJOIN_RESUME_WINDOW_MS
      ) {
        return {
          phase: event.captionsEnabled ? 'recording' : 'captionsRequired',
          session: {
            ...current,
            tabId: event.tabId,
            captionsEnabled: event.captionsEnabled,
            endedAt: null,
            reconnectCount: current.reconnectCount + 1,
            commercialConfidence: null,
          },
        };
      }

      // Qualquer outro cenário — idle, pós-reunião antiga, ou até uma sala
      // DIFERENTE com sessão ativa — começa uma sessão nova imediatamente.
      // (A anterior já está persistida no histórico pelo salvamento contínuo.)
      return freshSession(event);
    }

    case 'CAPTIONS_STATE': {
      if (!isActive(state) || state.session === null) return state;
      const next = withSession(state, { captionsEnabled: event.enabled });
      if (state.phase === 'captionsRequired' && event.enabled) {
        return { ...next, phase: 'recording' };
      }
      // Legendas desligadas no meio da gravação: a fase não muda — os chunks
      // simplesmente param de chegar e o content script tenta religar.
      return next;
    }

    case 'CAPTION_CHUNK': {
      if (state.session === null) return state;
      if (state.phase === 'paused') {
        // Pausado = captura desligada de verdade: chunk contabilizado como perdido.
        return withSession(state, {
          droppedSegments: state.session.droppedSegments + 1,
        });
      }
      if (state.phase !== 'recording') return state;
      const { segments, outcome } = applyCaptionChunk(
        state.session.segments,
        state.session.sealedCaptionIds,
        event.chunk,
        state.session.startedAt,
      );
      const speakersObserved = observeSpeaker(
        state.session,
        event.chunk.speaker,
        event.chunk.atMs,
      );
      if (outcome === 'ignored') {
        return speakersObserved === state.session.speakersObserved
          ? state
          : withSession(state, { speakersObserved });
      }
      if (outcome === 'dropped') {
        return withSession(state, {
          droppedSegments: state.session.droppedSegments + 1,
          speakersObserved,
        });
      }
      return withSession(state, {
        segments,
        speakersObserved,
        lastChunkAt: event.chunk.atMs,
      });
    }

    case 'PARTICIPANTS_UPDATED': {
      if (!isActive(state) || state.session === null) return state;
      const participants = mergeAttendance(state.session.participants, event.participants);
      const patch: Partial<MeetingSessionState> = {
        participants,
        presentNow: event.participants,
      };
      // Título ainda automático: enquanto a pessoa não deu nome, a sala herda o
      // nome do cliente ("Reunião com Ana") conforme os participantes aparecem.
      if (state.session.titleAuto) {
        const derived = deriveMeetingTitle(event.participants);
        if (derived) patch.title = derived;
      }
      return withSession(state, patch);
    }

    case 'ACCOUNT_BOUNDARY_UPDATED': {
      if (!isActive(state) || state.session === null) return state;
      return withSession(state, { accountBoundary: event.boundary });
    }

    case 'CAPTURE_DEGRADED': {
      if (!isActive(state) || state.session === null) return state;
      return withSession(state, {
        captureDegradedCount: (state.session.captureDegradedCount ?? 0) + 1,
      });
    }

    /**
     * A mesma pessoa estava com dois nomes na transcrição — tipicamente "Você"
     * nas primeiras falas e o nome real depois que o DOM do Meet o expôs.
     * Reescreve o passado: falas, participantes e o título automático.
     */
    case 'SPEAKERS_MERGED': {
      if (state.session === null || event.renames.length === 0) return state;

      let segments = state.session.segments;
      for (const { from, to } of event.renames) {
        segments = renameSpeaker(segments, from, to);
      }

      const renameOf = (name: string): string => {
        let current = name;
        for (const { from, to } of event.renames) {
          if (current === from) current = to;
        }
        return current;
      };
      const participants: Participant[] = [];
      for (const participant of state.session.participants) {
        const name = renameOf(participant.name);
        const existing = participants.find((entry) => entry.name === name);
        if (existing) {
          // Quem já era anfitrião continua sendo depois da fusão.
          if (participant.isHost === true) existing.isHost = true;
          continue;
        }
        participants.push({ ...participant, name });
      }
      const presentNow = (state.session.presentNow ?? []).map((participant) => ({
        ...participant,
        name: renameOf(participant.name),
      }));
      const speakersObserved = (state.session.speakersObserved ?? []).map((observation) => ({
        ...observation,
        name: renameOf(observation.name),
      }));

      const changed =
        segments !== state.session.segments ||
        participants.length !== state.session.participants.length ||
        participants.some(
          (participant, index) => participant.name !== state.session?.participants[index]?.name,
        ) ||
        presentNow.some(
          (participant, index) =>
            participant.name !== state.session?.presentNow?.[index]?.name,
        ) ||
        speakersObserved.some(
          (observation, index) =>
            observation.name !== state.session?.speakersObserved?.[index]?.name,
        );
      if (!changed) return state;

      const patch: Partial<MeetingSessionState> = {
        segments,
        participants,
        presentNow,
        speakersObserved,
      };
      if (state.session.titleAuto) {
        const derived = deriveMeetingTitle(participants);
        if (derived) patch.title = derived;
      }
      return withSession(state, patch);
    }

    case 'RECONNECT': {
      if (!isActive(state) || state.session === null) return state;
      return withSession(state, {
        reconnectCount: state.session.reconnectCount + 1,
      });
    }

    case 'PAUSE': {
      if (state.phase !== 'recording' || state.session === null) return state;
      // Sela as falas em andamento: updates tardios delas não entram no resume.
      const sealed = mergeSealedIds(
        state.session.sealedCaptionIds,
        collectCaptionIds(state.session.segments),
      );
      return { ...withSession(state, { sealedCaptionIds: sealed }), phase: 'paused' };
    }

    case 'RESUME': {
      if (state.phase !== 'paused') return state;
      return { ...state, phase: 'recording' };
    }

    case 'CLEAR_TRANSCRIPT': {
      if (
        (state.phase !== 'recording' && state.phase !== 'paused') ||
        state.session === null
      ) {
        return state;
      }
      const sealed = mergeSealedIds(
        state.session.sealedCaptionIds,
        collectCaptionIds(state.session.segments),
      );
      return withSession(state, {
        segments: [],
        sealedCaptionIds: sealed,
        wasDiscardedAndRestarted: true,
      });
    }

    case 'RENAME': {
      if (state.session === null) return state;
      const title = event.title.trim();
      if (title.length === 0) return state;
      // A pessoa deu nome: trava o auto-nome, este passa a mandar para sempre.
      return withSession(state, { title, titleAuto: false });
    }

    case 'MEETING_FINISHED': {
      if (!isActive(state) || state.session === null) return state;
      // Nada foi capturado (legendas nunca ligaram, ninguém falou). A versão
      // antiga voltava direto ao idle: o painel sumia e parecia defeito. Agora
      // termina com a sessão vazia e a tela DIZ o que aconteceu — quem grava um
      // registro no histórico é o controller, que ignora sessão sem fala.
      return {
        phase: 'ended',
        session: {
          ...state.session,
          endedAt: event.at,
          commercialConfidence: computeCommercialConfidence(state.session.segments),
        },
      };
    }

    case 'MARK_SENT': {
      if (state.phase !== 'ended') return state;
      return { ...state, phase: 'sent' };
    }

    case 'RESET': {
      if (!isPostMeeting(state)) return state;
      return IDLE_STATE;
    }
  }
}
