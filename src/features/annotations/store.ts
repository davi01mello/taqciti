/**
 * O mecanismo comum das anotações: ler, gravar e OBSERVAR um mapa guardado no
 * `chrome.storage.local`.
 *
 * ── Por que um helper, e não três módulos parecidos ───────────────────────
 *
 * Nota, marcação e print têm formas diferentes e a mesma mecânica: um objeto
 * indexado por reunião, escrito de duas superfícies (a sidebar e a HOME) e lido
 * pelas duas ao mesmo tempo. Escrito três vezes, o `onChanged` acabaria
 * assinado de um jeito num lugar e de outro noutro — e a diferença só
 * apareceria como "a HOME não atualizou" depois de alguém editar na sidebar.
 *
 * ── Por que observar, e não só ler ────────────────────────────────────────
 *
 * É isto que cumpre a continuidade pedida entre as duas interfaces. Não existe
 * sincronização escrita à mão em lugar nenhum: as duas telas assinam a mesma
 * chave, o Chrome avisa as duas, e quem editou não precisa contar a ninguém.
 *
 * ── Por que a escrita é um "atualizador", e não um `set` ──────────────────
 *
 * `ler → mudar → gravar` com duas superfícies abertas perde escrita: as duas
 * leem o mesmo mapa, cada uma muda a sua parte, e a segunda gravação apaga a
 * primeira. Aqui a leitura acontece DENTRO da gravação, no instante dela, e o
 * atualizador recebe o valor fresco. A janela de corrida não desaparece (o
 * storage não tem transação), mas encolhe de "o tempo que a pessoa levou
 * digitando" para "o tempo de uma leitura".
 */
import { comTravaLocal } from '@/shared/services/storageLock';
import { onLocalChange, readLocal, writeLocal } from '@/shared/services/storage';

export interface MapaGuardado<T> {
  ler(): Promise<Record<string, T>>;
  lerDe(chave: string): Promise<T | null>;
  /** Grava o resultado do atualizador. `null` remove a entrada. */
  atualizar(chave: string, mudar: (atual: T | null) => T | null): Promise<void>;
  observar(cb: (mapa: Record<string, T>) => void): () => void;
}

/**
 * @param chaveDoStorage chave em `chrome.storage.local`
 * @param valido filtro defensivo: registros gravados por uma versão anterior, ou
 *   corrompidos por uma escrita interrompida, não podem derrubar a tela inteira
 */
export function mapaGuardado<T>(
  chaveDoStorage: string,
  valido: (v: unknown) => v is T,
): MapaGuardado<T> {
  const limpar = (bruto: unknown): Record<string, T> => {
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return {};
    const saida: Record<string, T> = {};
    for (const [k, v] of Object.entries(bruto as Record<string, unknown>)) {
      if (valido(v)) saida[k] = v;
    }
    return saida;
  };

  const ler = async (): Promise<Record<string, T>> =>
    limpar(await readLocal<unknown>(chaveDoStorage));

  return {
    ler,
    async lerDe(chave) {
      return (await ler())[chave] ?? null;
    },
    async atualizar(chave, mudar) {
      return comTravaLocal(chaveDoStorage, async () => {
        const bruto = await readLocal<Record<string, unknown>>(chaveDoStorage);
        const atual = bruto && !Array.isArray(bruto) ? bruto : {};
        const proximo = mudar(valido(atual[chave]) ? (atual[chave] as T) : null);
        if (proximo === null) {
          if (!(chave in atual)) return;
          const resto = { ...atual };
          delete resto[chave];
          await writeLocal(chaveDoStorage, resto);
          return;
        }
        await writeLocal(chaveDoStorage, { ...atual, [chave]: proximo });
      });
    },
    observar(cb) {
      let vivo = true;
      void ler().then((m) => {
        if (vivo) cb(m);
      });
      const parar = onLocalChange<unknown>(chaveDoStorage, (valor) => {
        if (vivo) cb(limpar(valor));
      });
      return () => {
        vivo = false;
        parar();
      };
    },
  };
}
