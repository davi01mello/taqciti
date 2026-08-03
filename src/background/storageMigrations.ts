/** Migrações numeradas do storage local, executadas antes da hidratação. */
import {
  ACTIVE_IDENTITY_NAMESPACE_KEY,
  ANONYMOUS_IDENTITY_NAMESPACE,
  LEGACY_STORAGE_KEYS,
  LOCAL_STORAGE_SCHEMA_VERSION,
  LOCAL_STORAGE_SCHEMA_VERSION_KEY,
  STORAGE_KEYS,
} from '@/shared/config/constants';
import { readLocal, removeLocal, writeLocal } from '@/shared/services/storage';
import { logger } from '@/shared/services/log';
import type { MeetingRecord, MeetingState } from '@/shared/types/domain';
import { buildMeetingRecord } from '@/features/meeting/payload';
import { upsertRecord } from './history';

export async function migrateLocalStorage(): Promise<void> {
  const rawVersion = await readLocal<number>(LOCAL_STORAGE_SCHEMA_VERSION_KEY);
  const version = Number.isInteger(rawVersion) && (rawVersion ?? 0) >= 0 ? rawVersion! : 0;
  if (version > LOCAL_STORAGE_SCHEMA_VERSION) {
    throw new Error('storage local pertence a uma versão mais nova da extensão');
  }

  if (version < 1) {
    await migrateCompanionKeys();
    await writeLocal(LOCAL_STORAGE_SCHEMA_VERSION_KEY, 1);
  }

  if (version < 2) {
    // Dados que existiam antes do login pertencem explicitamente ao workspace
    // anônimo. Somente o ato de vincular uma conta pode reivindicá-los.
    const marker = await readLocal<string>(ACTIVE_IDENTITY_NAMESPACE_KEY);
    if (marker === null) {
      await writeLocal(ACTIVE_IDENTITY_NAMESPACE_KEY, ANONYMOUS_IDENTITY_NAMESPACE);
    }
    await writeLocal(LOCAL_STORAGE_SCHEMA_VERSION_KEY, 2);
  }
}

/** Era "CITi Flow Companion" (`cfc:*`) → chaves TaqCITi (`taq:*`). */
async function migrateCompanionKeys(): Promise<void> {
  const [history, legacyHistory] = await Promise.all([
    readLocal<MeetingRecord[]>(STORAGE_KEYS.history),
    readLocal<MeetingRecord[]>(LEGACY_STORAGE_KEYS.history),
  ]);
  if (history === null && legacyHistory !== null) {
    await writeLocal(STORAGE_KEYS.history, legacyHistory);
  }

  for (const key of ['outbox', 'metrics'] as const) {
    const [current, legacy] = await Promise.all([
      readLocal(STORAGE_KEYS[key]),
      readLocal(LEGACY_STORAGE_KEYS[key]),
    ]);
    if (current === null && legacy !== null) {
      await writeLocal(STORAGE_KEYS[key], legacy);
    }
  }

  const snapshot = await readLocal<MeetingState>(LEGACY_STORAGE_KEYS.activeSnapshot);
  if (snapshot?.session && snapshot.session.segments.length > 0) {
    const session = {
      ...snapshot.session,
      meetingCode: snapshot.session.meetingCode ?? '',
      endedAt: snapshot.session.startedAt,
    };
    await upsertRecord(buildMeetingRecord(session, 'ready'));
    logger.info('reunião órfã da era Companion recuperada para o histórico');
  }

  await Promise.all(Object.values(LEGACY_STORAGE_KEYS).map((key) => removeLocal(key)));
}
