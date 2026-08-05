/**
 * Dono do estado da reunião no service worker: aplica eventos na máquina de
 * estados, persiste e faz broadcast do estado novo para popup, side panel e
 * content script.
 *
 * Persistência em duas camadas:
 * - chrome.storage.session: estado vivo, sobrevive a restart do service worker.
 * - chrome.storage.local (histórico): a reunião em andamento é salva
 *   CONTINUAMENTE como registro "recording" — fechar o navegador, cair a
 *   conexão ou travar o Meet nunca perde a transcrição capturada até ali.
 */
import type { MeetingState } from '@/shared/types/domain';
import { IDLE_STATE } from '@/shared/types/domain';
import type { MeetingEvent } from '@/features/meeting/machine';
import { transition } from '@/features/meeting/machine';
import { buildMeetingRecord } from '@/features/meeting/payload';
import {
  LIVE_SAVE_THROTTLE_MS,
  STATE_FLUSH_INTERVAL_MS,
  STORAGE_KEYS,
} from '@/shared/config/constants';
import { readSession, writeSession } from '@/shared/services/storage';
import { logger } from '@/shared/services/log';
import { finalizeStaleRecordings, upsertRecord } from './history';
import { bumpMetrics } from './metrics';

let state: MeetingState = IDLE_STATE;
let lastLiveSaveAt = 0;

export function getState(): MeetingState {
  return state;
}

/** Recupera o estado vivo após restart do service worker. */
export async function hydrate(): Promise<void> {
  const saved = await readSession<MeetingState>(STORAGE_KEYS.state);
  if (saved) {
    state = saved;
    logger.debug('estado reidratado', { phase: state.phase });
  }
}

/**
 * Reuniões que ficaram presas em "recording" no histórico (navegador fechado
 * no meio da chamada) são finalizadas como "ready" — a transcrição salva até
 * a queda continua acessível.
 */
export async function recoverInterruptedMeetings(): Promise<void> {
  const liveId =
    state.phase === 'recording' || state.phase === 'paused'
      ? (state.session?.meetingId ?? null)
      : null;
  await finalizeStaleRecordings(liveId);
}

function isLive(s: MeetingState): boolean {
  return s.phase === 'recording' || s.phase === 'paused';
}

/** Salva a reunião viva no histórico. `force` ignora o throttle. */
async function saveLiveRecord(force: boolean, now: number): Promise<void> {
  if (!isLive(state) || !state.session || state.session.segments.length === 0) return;
  if (!force && now - lastLiveSaveAt < LIVE_SAVE_THROTTLE_MS) return;
  lastLiveSaveAt = now;
  await upsertRecord(buildMeetingRecord(state.session, 'recording', now));
}

function broadcast(): void {
  const message = { type: 'state/updated' as const, state };
  // Páginas da extensão (popup/side panel):
  chrome.runtime.sendMessage(message).catch(() => {
    /* nenhum contexto aberto — esperado */
  });
  // Content script da aba da reunião:
  const tabId = state.session?.tabId;
  if (tabId !== null && tabId !== undefined) {
    chrome.tabs.sendMessage(tabId, message).catch(() => {
      /* aba fechada — esperado */
    });
  }
}

async function runSideEffects(
  prev: MeetingState,
  event: MeetingEvent,
  now: number,
): Promise<void> {
  // Uma sessão nova substituiu uma anterior que tinha conteúdo (reunião nova
  // preemptou a antiga): a antiga é selada no histórico como pronta.
  if (
    event.type === 'MEETING_DETECTED' &&
    prev.session &&
    state.session &&
    prev.session.meetingId !== state.session.meetingId &&
    prev.session.segments.length > 0 &&
    prev.phase !== 'ended'
  ) {
    await upsertRecord(buildMeetingRecord(prev.session, 'ready', now));
  }

  // Fim de reunião COM conteúdo: registro final "ready" + métricas. Reunião
  // que não capturou nada não vira registro — a tela explica o que houve, o
  // histórico não ganha entrada vazia.
  if (
    state.phase === 'ended' &&
    prev.phase !== 'ended' &&
    state.session &&
    state.session.segments.length > 0
  ) {
    await upsertRecord(buildMeetingRecord(state.session, 'ready'));
    if (event.type === 'MEETING_FINISHED') {
      await bumpMetrics({
        meetingsCaptured: 1,
        totalDurationSeconds: Math.round(
          ((state.session.endedAt ?? 0) - state.session.startedAt) / 1000,
        ),
        droppedSegmentsTotal: state.session.droppedSegments,
        reconnectsTotal: state.session.reconnectCount,
      });
    }
  }

  // Rename precisa refletir no histórico imediatamente, em qualquer fase.
  if (event.type === 'RENAME' && state !== prev && state.session) {
    if (isLive(state)) {
      await saveLiveRecord(true, now);
    } else if (state.phase === 'ended') {
      await upsertRecord(buildMeetingRecord(state.session, 'ready'));
    }
  }

  if (event.type === 'CLEAR_TRANSCRIPT' && state !== prev) {
    await bumpMetrics({ clearTranscriptUsed: 1 });
  }

  // Salvamento contínuo da reunião viva (throttled).
  await saveLiveRecord(false, now);
}

/**
 * Persistir e retransmitir o estado INTEIRO a cada legenda fazia o custo
 * crescer com o quadrado da duração da reunião: numa chamada de uma hora, a
 * aba engasgava e o storage às vezes recusava a escrita. Chunks passam a ser
 * agrupados; qualquer outro evento continua imediato.
 */
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function isCoalescable(event: MeetingEvent): boolean {
  return event.type === 'CAPTION_CHUNK';
}

async function flushState(): Promise<void> {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await writeSession(STORAGE_KEYS.state, state);
  broadcast();
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushState().catch((error) => logger.error('flush do estado falhou', error));
  }, STATE_FLUSH_INTERVAL_MS);
}

/** Aplica um evento; retorna o estado resultante (inalterado se a transição for ilegal). */
export async function dispatch(event: MeetingEvent): Promise<MeetingState> {
  const prev = state;
  const next = transition(state, event);
  if (next === prev) return state;

  state = next;
  if (isCoalescable(event)) {
    scheduleFlush();
  } else {
    await flushState();
  }

  try {
    await runSideEffects(prev, event, Date.now());
  } catch (error) {
    logger.error('efeito colateral falhou', error);
    await bumpMetrics({ errorsTotal: 1 });
  }
  return state;
}
