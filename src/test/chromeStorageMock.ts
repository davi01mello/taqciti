import { vi } from 'vitest';

type StorageValues = Record<string, unknown>;

function makeArea(initial: StorageValues = {}) {
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
      Object.assign(values, items);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of typeof keys === 'string' ? [keys] : keys) delete values[key];
    }),
    clear: vi.fn(async () => {
      for (const key of Object.keys(values)) delete values[key];
    }),
  };
}

export function installChromeStorageMock(options: {
  local?: StorageValues;
  session?: StorageValues;
} = {}) {
  const local = makeArea(options.local);
  const session = makeArea(options.session);
  const chromeMock = {
    storage: {
      local,
      session,
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  };
  vi.stubGlobal('chrome', chromeMock);
  return { local, session, chrome: chromeMock };
}
