import { vi } from 'vitest';

type StorageValues = Record<string, unknown>;
type ChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
) => void;

function makeArea(
  name: string,
  initial: StorageValues,
  emit: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void,
) {
  const values: StorageValues = { ...initial };
  return {
    values,
    get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
      if (keys == null) return { ...values };
      const requested =
        typeof keys === 'string'
          ? [keys]
          : Array.isArray(keys)
            ? keys
            : Object.keys(keys);
      const result: StorageValues = {};
      for (const key of requested) {
        if (values[key] !== undefined) result[key] = values[key];
        else if (keys && !Array.isArray(keys) && typeof keys === 'object') {
          result[key] = keys[key];
        }
      }
      return result;
    }),
    set: vi.fn(async (items: StorageValues) => {
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const [key, newValue] of Object.entries(items)) {
        changes[key] = { oldValue: values[key], newValue };
      }
      Object.assign(values, items);
      emit(changes, name);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const key of typeof keys === 'string' ? [keys] : keys) {
        changes[key] = { oldValue: values[key], newValue: undefined };
        delete values[key];
      }
      emit(changes, name);
    }),
    clear: vi.fn(async () => {
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const key of Object.keys(values)) {
        changes[key] = { oldValue: values[key], newValue: undefined };
        delete values[key];
      }
      emit(changes, name);
    }),
  };
}

/**
 * Mock de `chrome.storage` com `onChanged` DE VERDADE: gravar dispara os
 * listeners, como no Chrome.
 *
 * Isso não é conveniência de teste — é o que permite exercitar a fonte única de
 * verdade das preferências do painel (ver features/panel/prefsStore.ts), cujo
 * mecanismo inteiro é justamente esse evento. Um `addListener` que só registra e
 * nunca chama de volta deixaria passar a classe de bug que o store existe para
 * eliminar: superfícies com versões diferentes do mesmo estado.
 */
export function installChromeStorageMock(
  options: {
    local?: StorageValues;
    session?: StorageValues;
    /** Mescladas no mock do `chrome` global — outras APIs além de storage. */
    extra?: Record<string, unknown>;
  } = {},
) {
  const listeners = new Set<ChangeListener>();
  const emit = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    for (const listener of [...listeners]) listener(changes, area);
  };

  const local = makeArea('local', options.local ?? {}, emit);
  const session = makeArea('session', options.session ?? {}, emit);

  const chromeMock = {
    storage: {
      local,
      session,
      onChanged: {
        addListener: vi.fn((listener: ChangeListener) => listeners.add(listener)),
        removeListener: vi.fn((listener: ChangeListener) => listeners.delete(listener)),
      },
    },
    ...options.extra,
  };
  vi.stubGlobal('chrome', chromeMock);
  return { local, session, chrome: chromeMock, listeners };
}
