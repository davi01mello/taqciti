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
import { mapaGuardado } from './store';

export interface Nota {
  /** A reunião a que a nota pertence. É ela que dá o vínculo pedido. */
  meetingId: string;
  texto: string;
  updatedAt: number;
}

function ehNota(v: unknown): v is Nota {
  if (!v || typeof v !== 'object') return false;
  const n = v as Partial<Nota>;
  return typeof n.meetingId === 'string' && typeof n.texto === 'string';
}

const mapa = mapaGuardado<Nota>(STORAGE_KEYS.notes, ehNota);

export const observarNotas = mapa.observar;

export async function lerNota(meetingId: string): Promise<Nota | null> {
  return mapa.lerDe(meetingId);
}

/** Grava (ou apaga, se o texto ficou vazio) a nota de uma reunião. */
export async function gravarNota(meetingId: string, texto: string): Promise<void> {
  const limpo = texto.trimEnd();
  await mapa.atualizar(meetingId, () =>
    limpo.length === 0 ? null : { meetingId, texto: limpo, updatedAt: Date.now() },
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
export function criarGravadorDeNota(
  aoMudarEstado: (estado: EstadoDaGravacao) => void,
): {
  agendar: (meetingId: string, texto: string) => void;
  /** Grava agora o que estiver pendente. Chamado ao sair da tela. */
  descarregar: () => Promise<void>;
  cancelar: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendente: { meetingId: string; texto: string } | null = null;

  const gravarAgora = async () => {
    const alvo = pendente;
    pendente = null;
    if (!alvo) return;
    aoMudarEstado('gravando');
    try {
      await gravarNota(alvo.meetingId, alvo.texto);
      aoMudarEstado('salvo');
    } catch {
      // Devolve o pendente: a próxima tentativa (ou o descarregar) reescreve.
      pendente = alvo;
      aoMudarEstado('falhou');
    }
  };

  return {
    agendar(meetingId, texto) {
      pendente = { meetingId, texto };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void gravarAgora();
      }, AGUARDAR_MS);
    },
    async descarregar() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await gravarAgora();
    },
    cancelar() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pendente = null;
    },
  };
}
