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
      segments: [
        ...segments,
        newSegment(nextSegmentId(segments), chunk.captionId, speaker, text, offsetMs),
      ],
      outcome: 'applied',
    };
  }

  const existing = segments[index] as LiveSegment;

  // Trocou de falante na mesma linha: é outra pessoa, é outra fala.
  if (speaker !== null && existing.speaker !== null && speaker !== existing.speaker) {
    return {
      segments: [
        ...segments,
        newSegment(nextSegmentId(segments), chunk.captionId, speaker, text, offsetMs),
      ],
      outcome: 'applied',
    };
  }

  const merged = mergeVisible(existing.text, text);

  if (merged.startNewSegment) {
    return {
      segments: [
        ...segments,
        newSegment(
          nextSegmentId(segments),
          chunk.captionId,
          speaker ?? existing.speaker,
          text,
          offsetMs,
        ),
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

/**
 * Id de linha lógica, derivado do tamanho atual do array. Determinístico e
 * sem estado externo: como o array só cresce (nunca há splice), a posição
 * ANTES do push é um contador monotônico único para toda a sessão — não
 * precisa de `crypto.randomUUID()` nem de contador à parte, e mantém
 * `applyCaptionChunk` 100% puro e testável.
 */
function nextSegmentId(segments: readonly LiveSegment[]): string {
  return `seg-${segments.length}`;
}

function newSegment(
  id: string,
  captionId: string,
  speaker: string | null,
  text: string,
  offsetMs: number,
): LiveSegment {
  return {
    id,
    captionId,
    speaker,
    text,
    startOffsetMs: offsetMs,
    endOffsetMs: offsetMs,
    source: 'caption',
    status: 'active',
  };
}

/**
 * Último índice com este `captionId` — a fala VIVA daquela linha do DOM.
 * `captionId === null` é o marcador de segmento manual: nunca casa com nada,
 * então nunca pode ser confundido com um chunk real (guard explícito, não só
 * consequência de `===` estrito).
 */
export function lastIndexOfCaption(
  segments: readonly LiveSegment[],
  captionId: string | null,
): number {
  if (captionId === null) return -1;
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

/** Ids atuais a selar ao pausar/limpar: falas em andamento não recebem mais updates.
 *  Segmentos manuais (`captionId: null`) não têm nó de DOM a selar. */
export function collectCaptionIds(segments: readonly LiveSegment[]): string[] {
  return segments
    .map((s) => s.captionId)
    .filter((captionId): captionId is string => captionId !== null);
}

export function mergeSealedIds(
  current: readonly string[],
  toSeal: readonly string[],
): string[] {
  return [...new Set([...current, ...toSeal])];
}

export interface SealIfLiveResult {
  /** Índice do segmento no array; -1 quando `segmentId` não existe. */
  index: number;
  sealedCaptionIds: string[];
}

/**
 * Decide se apagar/editar um segmento precisa selar o `captionId` dele.
 *
 * Um segmento só continua recebendo chunks do Meet quando é o ÚLTIMO da
 * lista com aquele `captionId` (é o que `applyCaptionChunk` consulta via
 * `lastIndexOfCaption`). Editar/apagar um segmento nessa condição sem selar
 * deixaria a linha "ressuscitar" no próximo ciclo de captura, se o nó do DOM
 * ainda estiver na tela mudando de texto. Um segmento já assentado (não é
 * mais o último do seu `captionId`) nunca mais é alvo de merge de qualquer
 * jeito — selar seria inofensivo, mas também não muda nada; por isso só
 * selamos quando é preciso.
 *
 * Segmentos manuais (`captionId: null`) nunca são "vivos" nesse sentido —
 * `lastIndexOfCaption(segments, null)` sempre devolve -1 — então caem
 * naturalmente no caminho "já assentado", sem selar nada.
 */
export function sealIfLive(
  segments: readonly LiveSegment[],
  sealedCaptionIds: readonly string[],
  segmentId: string,
): SealIfLiveResult {
  const index = segments.findIndex((segment) => segment.id === segmentId);
  if (index === -1) {
    return { index, sealedCaptionIds: [...sealedCaptionIds] };
  }

  const segment = segments[index] as LiveSegment;
  const isLive = lastIndexOfCaption(segments, segment.captionId) === index;

  return {
    index,
    sealedCaptionIds: isLive
      ? mergeSealedIds(sealedCaptionIds, [segment.captionId as string])
      : [...sealedCaptionIds],
  };
}
