/**
 * A LIXEIRA das exclusões feitas pelo Taq — o que torna "apagar" desfazível.
 *
 * O aplicativo, pela tela, apaga para sempre (ver "Apagar reunião" em
 * `home/Paginas.tsx`). Pelo Taq, a exclusão acontece SEM perguntar — a pessoa
 * pediu, e o fluxo não pode parar para confirmar —, então precisa ter volta:
 * antes de chamar o mesmo `ui/history/delete` da tela, o Taq guarda aqui um
 * retrato de tudo que a exclusão leva (o registro, a nota, as marcações, os
 * prints e quais documentos perdem o vínculo). "Desfazer" devolve cada coisa
 * ao seu lugar. O retrato vale 30 dias.
 *
 * O retrato é o inverso exato de `limparVinculosDaReuniao`
 * (`features/annotations/vinculos.ts`): o que aquela função tira, esta guarda,
 * com a mesma regra de reconhecimento — chave igual ao id da reunião, ou
 * `meetingId` igual.
 *
 * Fica só neste computador, como o resto. A sincronização vê a reunião sumir e
 * a remove do servidor; restaurar a faz reaparecer na passada seguinte.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { readLocal, writeLocal, writeLocalBatch } from '@/shared/services/storage';
import { comTravaLocal } from '@/shared/services/storageLock';
import type { MeetingRecord } from '@/shared/types/domain';

export const DIAS_NA_LIXEIRA = 30;
const DIA_MS = 24 * 60 * 60 * 1000;

export interface ItemDaLixeira {
  /** O id da reunião apagada. */
  id: string;
  titulo: string;
  apagadaEm: number;
  expiraEm: number;
  registro: MeetingRecord;
  /** Entradas `[chave, valor]` tiradas dos mapas de notas e marcações. */
  notas: Array<[string, unknown]>;
  marcas: Array<[string, unknown]>;
  /** Itens de lista (prints) que pertenciam à reunião. */
  prints: unknown[];
  /** Documentos que perderam o vínculo e devem recuperá-lo. */
  documentos: string[];
}

function pertence(chave: string, valor: unknown, meetingId: string): boolean {
  return (
    chave === meetingId ||
    (!!valor &&
      typeof valor === 'object' &&
      'meetingId' in valor &&
      (valor as { meetingId?: unknown }).meetingId === meetingId)
  );
}

/** Entradas de um mapa que pertencem à reunião — inclusive itens de listas. */
function entradasDe(mapa: unknown, meetingId: string): Array<[string, unknown]> {
  if (!mapa || typeof mapa !== 'object' || Array.isArray(mapa)) return [];
  const achadas: Array<[string, unknown]> = [];
  for (const [chave, valor] of Object.entries(mapa)) {
    if (Array.isArray(valor)) {
      const itens = valor.filter(
        (v) =>
          v &&
          typeof v === 'object' &&
          (v as { meetingId?: unknown }).meetingId === meetingId,
      );
      if (itens.length) achadas.push([chave, itens]);
    } else if (pertence(chave, valor, meetingId)) {
      achadas.push([chave, valor]);
    }
  }
  return achadas;
}

async function lerItens(): Promise<ItemDaLixeira[]> {
  const bruto = await readLocal<unknown>(STORAGE_KEYS.taqLixeira);
  return Array.isArray(bruto) ? (bruto as ItemDaLixeira[]) : [];
}

/** Os itens ainda válidos. Os vencidos são descartados na mesma passada. */
export async function lerLixeira(agora: number = Date.now()): Promise<ItemDaLixeira[]> {
  return comTravaLocal(STORAGE_KEYS.taqLixeira, async () => {
    const itens = await lerItens();
    const validos = itens.filter((i) => i.expiraEm > agora);
    if (validos.length !== itens.length)
      await writeLocal(STORAGE_KEYS.taqLixeira, validos);
    return validos;
  });
}

/** Guarda o retrato da reunião ANTES de ela ser apagada. */
export async function guardarNaLixeira(registro: MeetingRecord): Promise<ItemDaLixeira> {
  const [notas, marcas, shots, documentos] = await Promise.all([
    readLocal<unknown>(STORAGE_KEYS.notes),
    readLocal<unknown>(STORAGE_KEYS.marks),
    readLocal<unknown>(STORAGE_KEYS.shots),
    readLocal<unknown>(STORAGE_KEYS.documents),
  ]);
  const agora = Date.now();
  const item: ItemDaLixeira = {
    id: registro.id,
    titulo: registro.title,
    apagadaEm: agora,
    expiraEm: agora + DIAS_NA_LIXEIRA * DIA_MS,
    registro,
    notas: entradasDe(notas, registro.id),
    marcas: entradasDe(marcas, registro.id),
    prints: Array.isArray(shots)
      ? shots.filter(
          (s) =>
            s &&
            typeof s === 'object' &&
            (s as { meetingId?: unknown }).meetingId === registro.id,
        )
      : [],
    documentos: Array.isArray(documentos)
      ? documentos
          .filter(
            (d) =>
              d &&
              typeof d === 'object' &&
              (d as { meetingId?: unknown }).meetingId === registro.id,
          )
          .map((d) => (d as { id: string }).id)
      : [],
  };
  await comTravaLocal(STORAGE_KEYS.taqLixeira, async () => {
    const itens = (await lerItens()).filter((i) => i.id !== item.id);
    await writeLocal(STORAGE_KEYS.taqLixeira, [item, ...itens]);
  });
  return item;
}

/** A exclusão não aconteceu: o retrato não deve ficar prometendo volta. */
export async function descartarDaLixeira(meetingId: string): Promise<void> {
  await comTravaLocal(STORAGE_KEYS.taqLixeira, async () => {
    await writeLocal(
      STORAGE_KEYS.taqLixeira,
      (await lerItens()).filter((i) => i.id !== meetingId),
    );
  });
}

/**
 * Devolve a reunião e tudo o que foi com ela.
 *
 * O registro volta pelo BACKGROUND (`ui/history/restore`), que é o único dono
 * da escrita do histórico. Os anexos voltam daqui, sob as mesmas travas das
 * outras escritas — mesclados, nunca sobrescrevendo o que existir agora.
 */
export async function restaurarDaLixeira(
  meetingId: string,
  enviar: (mensagem: { type: string } & Record<string, unknown>) => Promise<unknown>,
): Promise<{ ok: true; item: ItemDaLixeira } | { ok: false; erro: string }> {
  const item = (await lerLixeira()).find((i) => i.id === meetingId);
  if (!item)
    return {
      ok: false,
      erro: 'Esta reunião não está na lixeira (ou já passou dos 30 dias).',
    };

  const resposta = (await enviar({
    type: 'ui/history/restore',
    record: item.registro,
  }).catch(() => null)) as {
    ok?: unknown;
  } | null;
  if (!resposta || resposta.ok !== true) {
    return {
      ok: false,
      erro: 'O aplicativo não confirmou a restauração. Nada foi alterado.',
    };
  }

  const chaves = [
    STORAGE_KEYS.notes,
    STORAGE_KEYS.marks,
    STORAGE_KEYS.shots,
    STORAGE_KEYS.documents,
  ].sort();
  const devolver = async () => {
    const bruto = Object.fromEntries(
      await Promise.all(
        chaves.map(async (k) => [k, await readLocal<unknown>(k)] as const),
      ),
    );
    const mesclarMapa = (atual: unknown, entradas: Array<[string, unknown]>) => {
      const mapa = {
        ...(atual && typeof atual === 'object' && !Array.isArray(atual) ? atual : {}),
      } as Record<string, unknown>;
      for (const [chave, valor] of entradas) {
        if (Array.isArray(valor)) {
          const existentes = Array.isArray(mapa[chave]) ? (mapa[chave] as unknown[]) : [];
          mapa[chave] = [...existentes, ...valor];
        } else if (mapa[chave] === undefined) {
          mapa[chave] = valor;
        }
      }
      return mapa;
    };
    const shots = Array.isArray(bruto[STORAGE_KEYS.shots])
      ? (bruto[STORAGE_KEYS.shots] as unknown[])
      : [];
    const idsDePrint = new Set(shots.map((s) => (s as { id?: unknown })?.id));
    const documentos = Array.isArray(bruto[STORAGE_KEYS.documents])
      ? (bruto[STORAGE_KEYS.documents] as Array<Record<string, unknown>>)
      : [];
    await writeLocalBatch({
      [STORAGE_KEYS.notes]: mesclarMapa(bruto[STORAGE_KEYS.notes], item.notas),
      [STORAGE_KEYS.marks]: mesclarMapa(bruto[STORAGE_KEYS.marks], item.marcas),
      [STORAGE_KEYS.shots]: [
        ...shots,
        ...item.prints.filter((p) => !idsDePrint.has((p as { id?: unknown })?.id)),
      ],
      [STORAGE_KEYS.documents]: documentos.map((d) =>
        item.documentos.includes(d.id as string) && !d.meetingId
          ? { ...d, meetingId }
          : d,
      ),
    });
  };
  const travar = (i: number): Promise<void> =>
    i === chaves.length ? devolver() : comTravaLocal(chaves[i]!, () => travar(i + 1));
  await travar(0);
  await descartarDaLixeira(meetingId);
  return { ok: true, item };
}
