/**
 * Observabilidade local: contadores agregados em chrome.storage.local.
 * Nunca contém conteúdo de transcript — apenas números.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { readLocal, writeLocal } from '@/shared/services/storage';

export interface LocalMetrics {
  meetingsCaptured: number;
  totalDurationSeconds: number;
  droppedSegmentsTotal: number;
  reconnectsTotal: number;
  clearTranscriptUsed: number;
  errorsTotal: number;
  captureDegradedTotal: number;
  parserFailuresTotal: number;
  syncAttemptsTotal: number;
  syncRetriesTotal: number;
  meetingsSynced: number;
  syncDeduplicatedTotal: number;
}

const EMPTY: LocalMetrics = {
  meetingsCaptured: 0,
  totalDurationSeconds: 0,
  droppedSegmentsTotal: 0,
  reconnectsTotal: 0,
  clearTranscriptUsed: 0,
  errorsTotal: 0,
  captureDegradedTotal: 0,
  parserFailuresTotal: 0,
  syncAttemptsTotal: 0,
  syncRetriesTotal: 0,
  meetingsSynced: 0,
  syncDeduplicatedTotal: 0,
};

export async function readMetrics(): Promise<LocalMetrics> {
  const current = (await readLocal<Partial<LocalMetrics>>(STORAGE_KEYS.metrics)) ?? {};
  return { ...EMPTY, ...current };
}

export async function bumpMetrics(patch: Partial<LocalMetrics>): Promise<void> {
  const current = await readMetrics();
  const next = { ...current };
  for (const [key, delta] of Object.entries(patch) as [keyof LocalMetrics, number][]) {
    next[key] = (current[key] ?? 0) + delta;
  }
  await writeLocal(STORAGE_KEYS.metrics, next);
}
