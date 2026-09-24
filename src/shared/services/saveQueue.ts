/** Serializa gravações e mantém a edição mais recente quando uma escrita falha. */
export function criarFilaDeGravacao<T>(
  salvar: (id: string, valor: T) => Promise<unknown>,
  combinar: (anterior: T, novo: T) => T,
  estado: (valor: 'parado' | 'gravando' | 'salvo' | 'falhou') => void,
) {
  const pendentes = new Map<string, T>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let emCurso: Promise<boolean> | undefined;
  const descarregar = (): Promise<boolean> => {
    clearTimeout(timer);
    if (emCurso) return emCurso;
    emCurso = (async () => {
      while (pendentes.size) {
        const [id, valor] = pendentes.entries().next().value!;
        pendentes.delete(id);
        estado('gravando');
        try {
          await salvar(id, valor);
        } catch {
          const recente = pendentes.get(id);
          pendentes.set(id, recente === undefined ? valor : combinar(valor, recente));
          estado('falhou');
          return false;
        }
      }
      estado('salvo');
      return true;
    })().finally(() => {
      emCurso = undefined;
    });
    return emCurso;
  };
  return {
    agendar(id: string, valor: T) {
      const anterior = pendentes.get(id);
      pendentes.set(id, anterior === undefined ? valor : combinar(anterior, valor));
      estado('gravando');
      clearTimeout(timer);
      timer = setTimeout(() => void descarregar(), 700);
    },
    descarregar,
    temPendente: () => pendentes.size > 0 || emCurso !== undefined,
    cancelar() {
      clearTimeout(timer);
      pendentes.clear();
    },
  };
}
