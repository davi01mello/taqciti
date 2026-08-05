/**
 * Montagem do MeetingPayload final e do registro de histórico a partir do
 * estado interno da sessão. Funções puras.
 */
import type {
  MeetingPayload,
  MeetingRecord,
  MeetingSessionState,
  TranscriptSegment,
} from '@/shared/types/domain';
import { getSegmentDisplayText } from '@/shared/types/domain';
import { buildTemporalContext, resolveLocalTimezone } from '@/shared/temporal';

/**
 * O contrato público não é o array bruto: `captionId`/`id`/`source`/`status`
 * são detalhe interno de agregação, linhas apagadas (soft-delete) não fazem
 * parte da transcrição "de verdade", e o texto é o que a pessoa CORRIGIU
 * (`getSegmentDisplayText`), não o bruto da captura. `MeetingRecord.segments`
 * (histórico) continua com o array completo — é ele que alimenta o "mostrar
 * linhas removidas" do painel.
 */
function toPublicSegments(session: MeetingSessionState): TranscriptSegment[] {
  return session.segments
    .filter((segment) => segment.status !== 'deleted')
    .map((segment) => ({
      speaker: segment.speaker,
      text: getSegmentDisplayText(segment),
      startOffsetMs: segment.startOffsetMs,
      endOffsetMs: segment.endOffsetMs,
    }));
}

export function buildMeetingPayload(session: MeetingSessionState): MeetingPayload {
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
    metadata: {
      capturedCaptions: session.segments.length > 0,
      droppedSegments: session.droppedSegments,
      reconnectCount: session.reconnectCount,
      captureDegradedCount: session.captureDegradedCount ?? 0,
      lastChunkAt: session.lastChunkAt ?? null,
      wasDiscardedAndRestarted: session.wasDiscardedAndRestarted,
    },
  };
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
    status,
    metadata: payload.metadata,
  };
}
