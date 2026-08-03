/**
 * Wrappers tipados sobre chrome.storage — nenhum outro arquivo toca a API crua.
 * `local` sobrevive a fechar o navegador; `session` sobrevive apenas a
 * restarts do service worker (é isso que queremos para o estado vivo).
 */

export async function readLocal<T>(key: string): Promise<T | null> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as T | undefined) ?? null;
}

export async function writeLocal<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function removeLocal(key: string): Promise<void> {
  await chrome.storage.local.remove(key);
}

export async function readSession<T>(key: string): Promise<T | null> {
  const result = await chrome.storage.session.get(key);
  return (result[key] as T | undefined) ?? null;
}

export async function writeSession<T>(key: string, value: T): Promise<void> {
  await chrome.storage.session.set({ [key]: value });
}

export async function removeSession(key: string): Promise<void> {
  await chrome.storage.session.remove(key);
}

/** Observa mudanças de uma chave no storage local (usado pelo histórico do popup). */
export function onLocalChange<T>(key: string, cb: (value: T | null) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area === 'local' && key in changes) {
      cb((changes[key]?.newValue as T | undefined) ?? null);
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
