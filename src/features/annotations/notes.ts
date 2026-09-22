/**
 * As NOTAS de uma reunião — o que a pessoa escreveu, separado do que a
 * extensão capturou.
 *
 * Uma nota por reunião, indexada pelo `meetingId`. É um registro à parte da
 * transcrição de propósito, e o requisito é literal: escrever uma nota não pode
 * tocar uma palavra do que foi transcrito, e o `.txt` exportado continua sendo
 * só a transcrição.
 *
 * ── Salvar enquanto se escreve ────────────────────────────────────────────
 *
 * Numa reunião ninguém clica em "salvar". A tela grava sozinha, com um respiro
 * entre as teclas (ver `AGUARDAR_MS`): gravar a cada caractere encheria o
 * `storage.local` de escritas e faria o `onChanged` pulsar nas outras
 * superfícies dezenas de vezes por frase. O estado da gravação é devolvido para
 * a interface poder dizer, discretamente, "salvo" ou "não deu" — e uma falha
 * nunca pode se parecer com sucesso.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import {
  onLocalChange,
  readLocal,
  readSession,
  writeLocal,
} from '@/shared/services/storage';
import { comTravaLocal } from '@/shared/services/storageLock';
import { criarFilaDeGravacao } from '@/shared/services/saveQueue';

export interface Nota {
  /** A reunião a que a nota pertence. É ela que dá o vínculo pedido. */
  meetingId: string;
  texto: string;
  updatedAt: number;
  /** Originais preservados quando registros antigos foram agregados. */
  anteriores?: Nota[];
}

function ehNota(v: unknown): v is Nota {
  if (!v || typeof v !== 'object') return false;
  const n = v as Partial<Nota>;
  return typeof n.meetingId === 'string' && typeof n.texto === 'string';
}

export function agregarNotas(bruto: unknown): Record<string, Nota> {
  if (!bruto || typeof bruto !== 'object') return {};
  const grupos: Record<string, Nota[]> = {};
  for (const valor of Object.values(bruto)) {
    for (const nota of Array.isArray(valor) ? valor : [valor]) {
      if (ehNota(nota)) (grupos[nota.meetingId] ??= []).push(nota);
    }
  }
  return Object.fromEntries(
    Object.entries(grupos).map(([id, notas]) => [
      id,
      {
        meetingId: id,
        texto: notas.map((n) => n.texto).join('\n\n---\n\n'),
        updatedAt: Math.max(...notas.map((n) => n.updatedAt || 0)),
        ...(notas.length > 1
          ? { anteriores: notas }
          : notas[0]?.anteriores
            ? { anteriores: notas[0].anteriores }
            : {}),
      },
    ]),
  );
}

export function observarNotas(cb: (notas: Record<string, Nota>) => void): () => void {
  let vivo = true;
  let mudou = false;
  const parar = onLocalChange<unknown>(STORAGE_KEYS.notes, (valor) => {
    mudou = true;
    if (vivo) cb(agregarNotas(valor));
  });
  void readLocal<unknown>(STORAGE_KEYS.notes)
    .then((valor) => {
      if (vivo && !mudou) cb(agregarNotas(valor));
    })
    .catch(() => {});
  return () => {
    vivo = false;
    parar();
  };
}

export async function lerNota(meetingId: string): Promise<Nota | null> {
  return agregarNotas(await readLocal(STORAGE_KEYS.notes))[meetingId] ?? null;
}

/** Grava (ou apaga, se o texto ficou vazio) a nota de uma reunião. */
export async function gravarNota(meetingId: string, texto: string): Promise<void> {
  const limpo = texto.trim().length ? texto : '';
  await comTravaLocal(STORAGE_KEYS.history, () =>
    comTravaLocal(STORAGE_KEYS.notes, async () => {
      const historico = await readLocal<Array<{ id: string }>>(STORAGE_KEYS.history);
      if (Array.isArray(historico) && !historico.some((r) => r.id === meetingId)) {
        const sessao = await readSession<{ session?: { meetingId: string } }>(
          STORAGE_KEYS.state,
        );
        if (sessao?.session?.meetingId !== meetingId)
          throw new Error('A reunião não está mais no histórico.');
      }
      const bruto = (await readLocal<Record<string, unknown>>(STORAGE_KEYS.notes)) ?? {};
      if (typeof bruto !== 'object') throw new Error('Formato de notas não reconhecido');
      const atual = agregarNotas(bruto)[meetingId];
      const proximo: Record<string, unknown> = { ...bruto };
      for (const [id, valor] of Object.entries(proximo)) {
        if (ehNota(valor) && valor.meetingId === meetingId) delete proximo[id];
        else if (Array.isArray(valor))
          proximo[id] = valor.filter((n) => !ehNota(n) || n.meetingId !== meetingId);
      }
      if (limpo.length || atual?.anteriores)
        proximo[meetingId] = {
          meetingId,
          texto: limpo,
          updatedAt: Date.now(),
          ...(atual?.anteriores ? { anteriores: atual.anteriores } : {}),
        };
      await writeLocal(STORAGE_KEYS.notes, proximo);
    }),
  );
}

/** Respiro entre a última tecla e a gravação. */
export const AGUARDAR_MS = 700;

export type EstadoDaGravacao = 'parado' | 'gravando' | 'salvo' | 'falhou';

/**
 * Um gravador com respiro, por reunião.
 *
 * Fora do React de propósito: o componente da nota remonta ao trocar de aba
 * interna, e um temporizador dentro dele perderia a última tecla exatamente
 * quando a pessoa sai da tela — que é o momento em que perder dói mais.
 */
export function criarGravadorDeNota(aoMudarEstado: (estado: EstadoDaGravacao) => void) {
  return criarFilaDeGravacao<string>(
    gravarNota,
    (_anterior, novo) => novo,
    aoMudarEstado,
  );
}
