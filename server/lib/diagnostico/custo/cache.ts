/**
 * O CACHE DE RESULTADOS DE BUSCA — para não pagar duas vezes pela mesma
 * pergunta.
 *
 * ── Por que o relógio é injetado ─────────────────────────────────────────
 *
 * Porque validade é a única coisa interessante aqui, e testá-la com
 * `Date.now()` real exigiria `setTimeout` ou mock global de tempo: teste lento e
 * frágil. Com `agora()` como parâmetro, "passaram-se duas horas" é uma linha.
 *
 * ── Por que a chave é normalizada ────────────────────────────────────────
 *
 * "Prazo Sem Folga" e "prazo sem folga" são a mesma busca e custariam duas.
 * Ordenar os termos vai um passo além: "folga prazo" também é a mesma pergunta
 * para um buscador, e a ordem em que os termos saíram do texto é acidente.
 *
 * ── O que ele NÃO é ──────────────────────────────────────────────────────
 *
 * Persistente. Vive no processo, e some quando ele reinicia. Para esta fase
 * basta: o cache existe para o mesmo diagnóstico não repetir a mesma busca, e
 * um diagnóstico cabe num processo. Cache entre execuções é decisão junto com a
 * do banco — ver o README.
 */

export interface EntradaDoCache<T> {
  valor: T;
  /** Quando entrou, em ms. */
  em: number;
}

export interface CacheDeResultados<T> {
  /** O valor ainda válido, ou `undefined`. Não estende a validade. */
  obter(consulta: string): T | undefined;
  guardar(consulta: string, valor: T): void;
  /** Tem valor válido para esta consulta? É o que a decisão de busca pergunta. */
  tem(consulta: string): boolean;
  /** Remove o que venceu. Devolve quantos saíram. */
  limpar(): number;
  /** Quantas entradas guardadas, vencidas incluídas. */
  tamanho(): number;
  chaveDe(consulta: string): string;
}

export interface OpcoesDoCache {
  /** Validade de uma entrada. O padrão é uma hora. */
  ttlMs?: number;
  /** Teto de entradas. Ao estourar, a mais antiga sai. */
  tamanhoMaximo?: number;
  /** O relógio. Injetado para o teste poder adiantá-lo. */
  agora?: () => number;
}

export const TTL_PADRAO_MS = 60 * 60 * 1000;
export const TAMANHO_MAXIMO_PADRAO = 200;

/** A chave: minúscula, sem acento, termos únicos e ordenados. */
export function chaveDaConsulta(consulta: string): string {
  return [
    ...new Set(
      consulta
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
    ),
  ]
    .sort()
    .join(' ');
}

export function criarCacheDeResultados<T>(opcoes: OpcoesDoCache = {}): CacheDeResultados<T> {
  const ttlMs = opcoes.ttlMs ?? TTL_PADRAO_MS;
  const tamanhoMaximo = opcoes.tamanhoMaximo ?? TAMANHO_MAXIMO_PADRAO;
  const agora = opcoes.agora ?? (() => Date.now());

  // `Map` preserva a ordem de inserção, e é ela que diz quem é a mais antiga
  // quando o teto estoura.
  const entradas = new Map<string, EntradaDoCache<T>>();

  const valida = (entrada: EntradaDoCache<T> | undefined): boolean =>
    entrada !== undefined && agora() - entrada.em < ttlMs;

  return {
    chaveDe: chaveDaConsulta,

    obter(consulta) {
      const chave = chaveDaConsulta(consulta);
      const entrada = entradas.get(chave);
      if (!valida(entrada)) {
        // Vencida sai na hora: deixá-la ocupando espaço faria o teto expulsar
        // uma entrada boa para guardar uma morta.
        if (entrada) entradas.delete(chave);
        return undefined;
      }
      return entrada!.valor;
    },

    guardar(consulta, valor) {
      const chave = chaveDaConsulta(consulta);
      // Apagar antes de inserir renova a POSIÇÃO na ordem, além do instante —
      // sem isso, uma consulta repetida continuaria sendo a primeira a ser
      // expulsa por antiguidade.
      entradas.delete(chave);
      entradas.set(chave, { valor, em: agora() });

      while (entradas.size > tamanhoMaximo) {
        const maisAntiga = entradas.keys().next().value;
        if (maisAntiga === undefined) break;
        entradas.delete(maisAntiga);
      }
    },

    tem(consulta) {
      return valida(entradas.get(chaveDaConsulta(consulta)));
    },

    limpar() {
      let saíram = 0;
      for (const [chave, entrada] of entradas) {
        if (!valida(entrada)) {
          entradas.delete(chave);
          saíram += 1;
        }
      }
      return saíram;
    },

    tamanho() {
      return entradas.size;
    },
  };
}
