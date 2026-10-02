/** Web Locks coordena HOME, sidebar e worker da mesma extensão. */
const filas = new Map<string, Promise<unknown>>();
export async function comTravaLocal<T>(
  chave: string,
  tarefa: () => Promise<T>,
): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return await navigator.locks.request(`taqciti:${chave}`, tarefa);
  }
  const proxima = (filas.get(chave) ?? Promise.resolve()).catch(() => {}).then(tarefa);
  filas.set(chave, proxima);
  return proxima;
}
