import { beforeEach, describe, expect, it } from 'vitest';
import type { MeetingRecord } from '@/shared/types/domain';
import {
  ACTIVE_IDENTITY_NAMESPACE_KEY,
  ANONYMOUS_IDENTITY_NAMESPACE,
  LEGACY_STORAGE_KEYS,
  LOCAL_STORAGE_SCHEMA_VERSION,
  LOCAL_STORAGE_SCHEMA_VERSION_KEY,
  STORAGE_KEYS,
} from '@/shared/config/constants';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { migrateLocalStorage } from './storageMigrations';

function legacyMeeting(): MeetingRecord {
  return {
    id: 'legacy-meeting',
    title: 'Legada',
    startedAt: 1,
    endedAt: 2,
    durationSeconds: 1,
    participants: [],
    segments: [],
    commercialConfidence: 0,
    status: 'ready',
    metadata: {
      capturedCaptions: false,
      droppedSegments: 0,
      reconnectCount: 0,
      wasDiscardedAndRestarted: false,
    },
  };
}

beforeEach(() => installChromeStorageMock());

describe('migrações locais versionadas', () => {
  it('migra cfc:* uma vez, marca o workspace anônimo e grava a versão atual', async () => {
    await chrome.storage.local.set({
      [LEGACY_STORAGE_KEYS.history]: [legacyMeeting()],
      [LEGACY_STORAGE_KEYS.metrics]: { meetingsCaptured: 7 },
    });

    await migrateLocalStorage();
    const stored = await chrome.storage.local.get(null);
    expect((stored[STORAGE_KEYS.history] as MeetingRecord[])[0]?.id).toBe('legacy-meeting');
    expect(stored[STORAGE_KEYS.metrics]).toEqual({ meetingsCaptured: 7 });
    expect(stored[ACTIVE_IDENTITY_NAMESPACE_KEY]).toBe(ANONYMOUS_IDENTITY_NAMESPACE);
    expect(stored[LOCAL_STORAGE_SCHEMA_VERSION_KEY]).toBe(LOCAL_STORAGE_SCHEMA_VERSION);
    expect(stored[LEGACY_STORAGE_KEYS.history]).toBeUndefined();

    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [] });
    await migrateLocalStorage();
    expect((await chrome.storage.local.get(STORAGE_KEYS.history))[STORAGE_KEYS.history]).toEqual([]);
  });

  it('não tenta rebaixar storage criado por uma extensão mais nova', async () => {
    await chrome.storage.local.set({
      [LOCAL_STORAGE_SCHEMA_VERSION_KEY]: LOCAL_STORAGE_SCHEMA_VERSION + 1,
      [STORAGE_KEYS.history]: [legacyMeeting()],
    });
    await expect(migrateLocalStorage()).rejects.toThrow(/versão mais nova/);
    expect(
      ((await chrome.storage.local.get(STORAGE_KEYS.history))[STORAGE_KEYS.history] as MeetingRecord[])[0]?.id,
    ).toBe('legacy-meeting');
  });
});
