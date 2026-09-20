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

function onChange<T>(
  area: 'local' | 'session',
  key: string,
  cb: (value: T | null) => void,
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    changedArea: string,
  ) => {
    if (changedArea === area && key in changes) {
      cb((changes[key]?.newValue as T | undefined) ?? null);
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/** Observa mudanças de uma chave no storage local (histórico, conversas, anotações). */
export function onLocalChange<T>(key: string, cb: (value: T | null) => void): () => void {
  return onChange('local', key, cb);
}

/**
 * Observa uma chave do storage de SESSÃO.
 *
 * É o canal entre o content script e o painel lateral para o que é estado de
 * sessão e não registro: a reunião detectada esperando resposta, e a resposta
 * em si. Os dois vivem em contextos que não se alcançam por `sendMessage`
 * direto — o painel é página da extensão, o content script precisa de
 * `tabs.sendMessage` endereçado —, e o storage é o único lugar onde os dois já
 * olham. Uma gravação de um lado vira um evento do outro, sem ninguém precisar
 * saber o id da aba do outro.
 */
export function onSessionChange<T>(key: string, cb: (value: T | null) => void): () => void {
  return onChange('session', key, cb);
}
