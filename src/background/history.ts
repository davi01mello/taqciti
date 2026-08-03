/**
 * Repositório do histórico de reuniões em chrome.storage.local — a fonte da
 * verdade das transcrições. Registros ordenados do mais recente para o mais
 * antigo, com teto de tamanho. Statuses da era Companion ("pending",
 * "ignored", "discarded") são normalizados para "ready" na leitura: nenhuma
 * transcrição antiga se perde na migração.
 */
import type { HistoryStatus, MeetingRecord } from '@/shared/types/domain';
import { MAX_HISTORY_RECORDS, STORAGE_KEYS } from '@/shared/config/constants';
import { readLocal, writeLocal } from '@/shared/services/storage';

const VALID_STATUSES: readonly HistoryStatus[] = ['recording', 'ready', 'sent'];

function normalizeRecord(record: MeetingRecord): MeetingRecord {
  if ((VALID_STATUSES as readonly string[]).includes(record.status)) return record;
  const legacy = record.status as string;
  return { ...record, status: legacy === 'sent' ? 'sent' : 'ready' };
}

export async function listHistory(): Promise<MeetingRecord[]> {
  const raw = (await readLocal<MeetingRecord[]>(STORAGE_KEYS.history)) ?? [];
  return raw.map(normalizeRecord);
}

export async function upsertRecord(record: MeetingRecord): Promise<void> {
  const history = await listHistory();
  const previous = history.find((item) => item.id === record.id);
  const merged = previous
    ? {
        ...previous,
        ...record,
        ...(record.pendingFlow === undefined
          ? { pendingFlow: previous.pendingFlow }
          : {}),
        ...(record.pendingDiagnostic === undefined
          ? { pendingDiagnostic: previous.pendingDiagnostic }
          : {}),
        ...(record.syncState === undefined
          ? { syncState: previous.syncState }
          : {}),
      }
    : record;
  const without = history.filter((r) => r.id !== record.id);
  const next = [merged, ...without]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, MAX_HISTORY_RECORDS);
  await writeLocal(STORAGE_KEYS.history, next);
}

export async function getRecord(id: string): Promise<MeetingRecord | null> {
  const history = await listHistory();
  return history.find((r) => r.id === id) ?? null;
}

export async function patchRecord(
  id: string,
  patch: Partial<
    Pick<
      MeetingRecord,
      'title' | 'status' | 'pendingFlow' | 'pendingDiagnostic' | 'syncState'
    >
  >,
): Promise<void> {
  const history = await listHistory();
  const next = history.map((r) => (r.id === id ? { ...r, ...patch } : r));
  await writeLocal(STORAGE_KEYS.history, next);
}

export async function deleteRecord(id: string): Promise<void> {
  const history = await listHistory();
  await writeLocal(
    STORAGE_KEYS.history,
    history.filter((r) => r.id !== id),
  );
}

/**
 * Registros presos em "recording" que não são a sessão viva (navegador caiu
 * no meio da reunião) viram "ready": a transcrição capturada até a queda
 * fica disponível no histórico — nada se perde.
 */
export async function finalizeStaleRecordings(liveMeetingId: string | null): Promise<void> {
  const history = await listHistory();
  let changed = false;
  const next = history.map((r) => {
    if (r.status === 'recording' && r.id !== liveMeetingId) {
      changed = true;
      return { ...r, status: 'ready' as const };
    }
    return r;
  });
  if (changed) await writeLocal(STORAGE_KEYS.history, next);
}
