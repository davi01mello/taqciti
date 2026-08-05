/**
 * Fonte de histórico para as UIs React: lê chrome.storage.local diretamente
 * (leitura pura, sem lógica de negócio), reage a mudanças e normaliza
 * statuses da era Companion — ações de escrita passam sempre pelo background.
 */
import { useEffect, useState } from 'react';
import type { HistoryStatus, MeetingRecord } from '@/shared/types/domain';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { onLocalChange, readLocal } from '@/shared/services/storage';

const VALID_STATUSES: readonly HistoryStatus[] = ['recording', 'ready'];

function normalize(records: MeetingRecord[] | null): MeetingRecord[] {
  if (!records) return [];
  return records.map((record) =>
    (VALID_STATUSES as readonly string[]).includes(record.status)
      ? record
      : { ...record, status: 'ready' as const },
  );
}

export function useHistory(): MeetingRecord[] {
  const [records, setRecords] = useState<MeetingRecord[]>([]);

  useEffect(() => {
    let mounted = true;
    void readLocal<MeetingRecord[]>(STORAGE_KEYS.history).then((list) => {
      if (mounted) setRecords(normalize(list));
    });
    const unsubscribe = onLocalChange<MeetingRecord[]>(STORAGE_KEYS.history, (list) =>
      setRecords(normalize(list)),
    );
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return records;
}
