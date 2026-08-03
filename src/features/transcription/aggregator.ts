/**
 * Agregação de legendas em segmentos de transcrição — funções puras.
 *
 * O Google Meet atualiza a MESMA linha de legenda progressivamente enquanto a
 * pessoa fala, e ainda rola a janela cortando o começo dela. O provider atribui
 * um `captionId` estável por linha do DOM; aqui cada chunk é fundido no
 * segmento correspondente por `mergeVisible`, que sabe distinguir "a fala
 * cresceu" de "a janela rolou" e de "esta linha agora é outra fala".
 *
 * Antes daqui o texto era simplesmente sobrescrito, e por isso a transcrição
 * encolhia quando o Meet cortava o começo da linha.
 */
import type { CaptionChunk, LiveSegment } from '@/shared/types/domain';
import { mergeVisible } from './mergeCaption';
import { sanitizeCaptionText, sanitizeSpeakerName } from './sanitize';

export type ChunkOutcome = 'applied' | 'ignored' | 'dropped';

export interface ChunkApplication {
  segments: LiveSegment[];
  outcome: ChunkOutcome;
}

/**
 * Aplica um chunk à lista de segmentos.
 * - `dropped`: captionId foi selado (pausa/limpeza) — updates tardios de falas
 *   antigas não podem reaparecer depois de retomar.
 * - `ignored`: chunk vazio ou sem mudança de texto.
 * - `applied`: segmento criado, estendido ou aberto de novo (imutável).
 */
export function applyCaptionChunk(
  segments: readonly LiveSegment[],
  sealedCaptionIds: readonly string[],
  chunk: CaptionChunk,
  startedAtMs: number,
): ChunkApplication {
  if (sealedCaptionIds.includes(chunk.captionId)) {
    return { segments: [...segments], outcome: 'dropped' };
  }

  const text = sanitizeCaptionText(chunk.text);
  if (text.length === 0) {
    return { segments: [...segments], outcome: 'ignored' };
  }

  const offsetMs = Math.max(0, chunk.atMs - startedAtMs);
  const speaker = sanitizeSpeakerName(chunk.speaker);

  // O segmento vivo de uma linha é o ÚLTIMO com aquele captionId: a mesma
  // linha do DOM pode ter gerado várias falas ao longo da reunião.
  const index = lastIndexOfCaption(segments, chunk.captionId);

  if (index === -1) {
    return {
      segments: [...segments, newSegment(chunk.captionId, speaker, text, offsetMs)],
      outcome: 'applied',
    };
  }

  const existing = segments[index] as LiveSegment;

  // Trocou de falante na mesma linha: é outra pessoa, é outra fala.
  if (speaker !== null && existing.speaker !== null && speaker !== existing.speaker) {
    return {
      segments: [...segments, newSegment(chunk.captionId, speaker, text, offsetMs)],
      outcome: 'applied',
    };
  }

  const merged = mergeVisible(existing.text, text);

  if (merged.startNewSegment) {
    return {
      segments: [
        ...segments,
        newSegment(chunk.captionId, speaker ?? existing.speaker, text, offsetMs),
      ],
      outcome: 'applied',
    };
  }

  if (merged.text === existing.text && existing.endOffsetMs >= offsetMs) {
    return { segments: [...segments], outcome: 'ignored' };
  }

  const updated: LiveSegment = {
    ...existing,
    speaker: existing.speaker ?? speaker,
    text: merged.text,
    endOffsetMs: Math.max(existing.endOffsetMs, offsetMs),
  };
  const next = [...segments];
  next[index] = updated;
  return { segments: next, outcome: 'applied' };
}

function newSegment(
  captionId: string,
  speaker: string | null,
  text: string,
  offsetMs: number,
): LiveSegment {
  return {
    captionId,
    speaker,
    text,
    startOffsetMs: offsetMs,
    endOffsetMs: offsetMs,
  };
}

function lastIndexOfCaption(
  segments: readonly LiveSegment[],
  captionId: string,
): number {
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (segments[i]?.captionId === captionId) return i;
  }
  return -1;
}

/**
 * Reescreve o falante de todos os segmentos afetados por uma fusão de
 * identidade ("Você" virou "Bernardo Belfort" quando o nome real apareceu).
 * Devolve a MESMA lista quando nada muda, para o chamador poder comparar por
 * referência.
 */
export function renameSpeaker(
  segments: readonly LiveSegment[],
  from: string,
  to: string,
): LiveSegment[] {
  let changed = false;
  const next = segments.map((segment) => {
    if (segment.speaker !== from) return segment;
    changed = true;
    return { ...segment, speaker: to };
  });
  return changed ? next : (segments as LiveSegment[]);
}

/** Ids atuais a selar ao pausar/limpar: falas em andamento não recebem mais updates. */
export function collectCaptionIds(segments: readonly LiveSegment[]): string[] {
  return segments.map((s) => s.captionId);
}

export function mergeSealedIds(
  current: readonly string[],
  toSeal: readonly string[],
): string[] {
  return [...new Set([...current, ...toSeal])];
}
