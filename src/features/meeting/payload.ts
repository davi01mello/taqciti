/**
 * Montagem do MeetingPayload final (contrato do CITi Flow) e do registro de
 * histórico a partir do estado interno da sessão. Funções puras.
 */
import type {
  MeetingPayload,
  MeetingRecord,
  MeetingSessionState,
  TranscriptSegment,
} from '@/shared/types/domain';
import { buildTemporalContext, resolveLocalTimezone } from '@/shared/temporal';
import { computeCommercialConfidence } from './commercialConfidence';

function toPublicSegments(session: MeetingSessionState): TranscriptSegment[] {
  // captionId é detalhe interno de agregação — não faz parte do contrato.
  return session.segments.map(({ speaker, text, startOffsetMs, endOffsetMs }) => ({
    speaker,
    text,
    startOffsetMs,
    endOffsetMs,
  }));
}

export function buildMeetingPayload(
  session: MeetingSessionState,
  diagnostic?: { report: string | null; sessionId: string },
): MeetingPayload {
  const endedAt = session.endedAt ?? session.startedAt;
  const base: MeetingPayload = {
    meetingId: session.meetingId,
    provider: session.provider,
    title: session.title,
    startedAt: new Date(session.startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    /*
     * O fuso vem de quem CAPTUROU — o navegador que estava na reunião. É o
     * sinal mais forte que existe sobre em que dia a conversa aconteceu, e
     * viaja junto para o backend não precisar adivinhar (nem usar o próprio,
     * que num contêiner é UTC).
     */
    temporal: buildTemporalContext({
      startedAtMs: session.startedAt,
      endedAtMs: endedAt,
      timezone: resolveLocalTimezone(),
      source: 'extensao',
    }),
    durationSeconds: Math.max(0, Math.round((endedAt - session.startedAt) / 1000)),
    participants: session.participants,
    ...(session.presentNow !== undefined ? { presentNow: session.presentNow } : {}),
    ...(session.speakersObserved !== undefined
      ? { speakersObserved: session.speakersObserved }
      : {}),
    transcript: toPublicSegments(session),
    commercialConfidence:
      session.commercialConfidence ?? computeCommercialConfidence(session.segments),
    metadata: {
      capturedCaptions: session.segments.length > 0,
      droppedSegments: session.droppedSegments,
      reconnectCount: session.reconnectCount,
      captureDegradedCount: session.captureDegradedCount ?? 0,
      lastChunkAt: session.lastChunkAt ?? null,
      wasDiscardedAndRestarted: session.wasDiscardedAndRestarted,
    },
  };
  if (diagnostic) {
    base.diagnostic_report = diagnostic.report;
    base.diagnostic_session_id = diagnostic.sessionId;
  }
  return base;
}

export function buildMeetingRecord(
  session: MeetingSessionState,
  status: MeetingRecord['status'],
  endedAtFallback?: number,
): MeetingRecord {
  const endedAt = session.endedAt ?? endedAtFallback ?? session.startedAt;
  const normalized = { ...session, endedAt };
  const payload = buildMeetingPayload(normalized);
  return {
    id: session.meetingId,
    title: session.title,
    startedAt: session.startedAt,
    endedAt,
    durationSeconds: payload.durationSeconds,
    participants: session.participants,
    ...(session.presentNow !== undefined ? { presentNow: session.presentNow } : {}),
    ...(session.speakersObserved !== undefined
      ? { speakersObserved: session.speakersObserved }
      : {}),
    segments: session.segments,
    commercialConfidence: payload.commercialConfidence,
    status,
    metadata: payload.metadata,
  };
}

/** Payload de envio a partir de um registro do histórico (envio tardio). */
export function payloadFromRecord(record: MeetingRecord): MeetingPayload {
  return {
    meetingId: record.id,
    provider: 'google-meet',
    title: record.title,
    startedAt: new Date(record.startedAt).toISOString(),
    endedAt: new Date(record.endedAt).toISOString(),
    // Envio tardio a partir do histórico: o fuso continua sendo o desta
    // máquina, que é a mesma que capturou.
    temporal: buildTemporalContext({
      startedAtMs: record.startedAt,
      endedAtMs: record.endedAt,
      timezone: resolveLocalTimezone(),
      source: 'extensao',
    }),
    durationSeconds: record.durationSeconds,
    participants: record.participants,
    ...(record.presentNow !== undefined ? { presentNow: record.presentNow } : {}),
    ...(record.speakersObserved !== undefined
      ? { speakersObserved: record.speakersObserved }
      : {}),
    transcript: record.segments.map(({ speaker, text, startOffsetMs, endOffsetMs }) => ({
      speaker,
      text,
      startOffsetMs,
      endOffsetMs,
    })),
    commercialConfidence: record.commercialConfidence,
    metadata: record.metadata,
  };
}
