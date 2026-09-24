/**
 * O que acontece com o que estava PRESO a uma reunião quando ela é apagada.
 *
 * ── Por que isto precisa ser explícito ───────────────────────────────────
 *
 * Apagar uma reunião tirava só o registro dela do histórico. A nota, as
 * marcações e os prints continuavam no storage, indexados por um `meetingId`
 * que não existia mais: invisíveis em toda a interface, consumindo cota, e
 * impossíveis de recuperar ou apagar. Órfãos silenciosos.
 *
 * O tratamento não é o mesmo para todos, porque a natureza deles não é a
 * mesma:
 *
 *   • NOTA, MARCAÇÕES e PRINTS **vão junto**. Eles existem SOBRE a
 *     transcrição: a marcação aponta para um trecho que deixou de existir, o
 *     print é da tela daquela reunião, e a nota não tem nenhuma superfície que
 *     a mostre fora dela. Mantê-los seria guardar o que ninguém consegue
 *     alcançar. Quem apaga precisa ser avisado disso ANTES — ver o texto da
 *     confirmação em `Paginas.tsx`.
 *
 *   • DOCUMENTOS **ficam**. Um documento é trabalho próprio, com conteúdo que
 *     vale sozinho, e não um derivado descartável da transcrição. O que some é
 *     o vínculo (ver `features/documents/store.ts`): sem a reunião, "abrir a
 *     reunião de origem" levaria a lugar nenhum.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { readLocal, writeLocalBatch } from '@/shared/services/storage';
import { comTravaLocal } from '@/shared/services/storageLock';

export interface ResultadoDaLimpeza {
  /** Havia nota escrita para esta reunião. */
  nota: boolean;
  /** Quantos trechos estavam marcados. */
  marcas: number;
  prints: number;
  /** Documentos que perderam o vínculo, mas continuam guardados. */
  documentosDesvinculados: number;
}

/** A exclusão e seus vínculos são confirmados juntos pelo storage. */
export async function limparVinculosDaReuniao(
  meetingId: string,
): Promise<ResultadoDaLimpeza> {
  const chaves = [
    STORAGE_KEYS.history,
    STORAGE_KEYS.notes,
    STORAGE_KEYS.marks,
    STORAGE_KEYS.shots,
    STORAGE_KEYS.documents,
  ].sort();
  const executar = async (): Promise<ResultadoDaLimpeza> => {
    const bruto = Object.fromEntries(
      await Promise.all(chaves.map(async (k) => [k, await readLocal<unknown>(k)])),
    );
    const alteracoes: Record<string, unknown> = {};
    const tirarMapa = (chave: string) => {
      const mapa = bruto[chave];
      if (!mapa || typeof mapa !== 'object' || Array.isArray(mapa)) return 0;
      const copia = { ...mapa } as Record<string, unknown>;
      let quantidade = 0;
      for (const [id, valor] of Object.entries(copia)) {
        if (Array.isArray(valor)) {
          const restantes = valor.filter(
            (v) => !v || typeof v !== 'object' || v.meetingId !== meetingId,
          );
          quantidade += valor.length - restantes.length;
          copia[id] = restantes;
          continue;
        }
        if (
          id === meetingId ||
          (valor &&
            typeof valor === 'object' &&
            'meetingId' in valor &&
            valor.meetingId === meetingId)
        ) {
          quantidade +=
            chave === STORAGE_KEYS.marks && valor && typeof valor === 'object'
              ? Object.keys(valor).length
              : 1;
          delete copia[id];
        }
      }
      if (quantidade) alteracoes[chave] = copia;
      return quantidade;
    };
    const nota = tirarMapa(STORAGE_KEYS.notes) > 0;
    const marcas = tirarMapa(STORAGE_KEYS.marks);
    const tirarLista = (chave: string, campo: string) => {
      const lista = bruto[chave];
      if (!Array.isArray(lista)) return 0;
      const restante = lista.filter(
        (v) => !v || typeof v !== 'object' || v[campo] !== meetingId,
      );
      if (restante.length !== lista.length) alteracoes[chave] = restante;
      return lista.length - restante.length;
    };
    const prints = tirarLista(STORAGE_KEYS.shots, 'meetingId');
    tirarLista(STORAGE_KEYS.history, 'id');
    let documentosDesvinculados = 0;
    const documentos = bruto[STORAGE_KEYS.documents];
    if (Array.isArray(documentos)) {
      const restantes = documentos.map((d) => {
        if (!d || typeof d !== 'object' || d.meetingId !== meetingId) return d;
        documentosDesvinculados++;
        const copia = { ...d };
        delete copia.meetingId;
        return copia;
      });
      if (documentosDesvinculados) alteracoes[STORAGE_KEYS.documents] = restantes;
    }
    if (Object.keys(alteracoes).length) await writeLocalBatch(alteracoes);
    return { nota, marcas, prints, documentosDesvinculados };
  };
  const travar = (i: number): Promise<ResultadoDaLimpeza> =>
    i === chaves.length ? executar() : comTravaLocal(chaves[i]!, () => travar(i + 1));
  return travar(0);
}
