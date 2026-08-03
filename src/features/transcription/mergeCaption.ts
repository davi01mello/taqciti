/**
 * Fusão do texto visível de uma linha de legenda com o que já foi capturado —
 * função pura, e a peça que decide se a transcrição fica inteira ou sai porca.
 *
 * O Google Meet NÃO entrega falas prontas. Ele mantém uma janela rolante de
 * legendas e mexe nela o tempo todo:
 *
 *  1. a fala cresce      "bom dia"        → "bom dia pessoal"
 *  2. o fim é reescrito  "o orcamento"    → "o orçamento."      (correção)
 *  3. o começo é CORTADO "bom dia pessoal vamos" → "pessoal vamos falar"
 *     (a janela rolou; o começo saiu do DOM, mas foi dito)
 *  4. a linha é reusada  "bom dia pessoal" → "então sobre o orçamento"
 *     (o Meet reaproveita o nó para outra fala)
 *
 * O código antigo tratava tudo como o caso 1: sobrescrevia o texto do segmento
 * com o visível. No caso 3 isso ENCOLHE a transcrição (o que foi dito some da
 * tela, o bug do "eu falo e não aparece") e no caso 4 gruda duas falas numa só.
 *
 * A comparação é feita em PALAVRAS NORMALIZADAS (sem acento, sem pontuação,
 * minúsculas) porque o reconhecedor do Meet reescreve acento e pontuação no
 * meio da frase o tempo todo: comparar caractere a caractere daria "fala nova"
 * a cada correção de acento.
 */

export interface CaptionMerge {
  /** O texto que o segmento deve passar a ter. */
  text: string;
  /** true quando o visível é outra fala: o chamador abre um segmento novo. */
  startNewSegment: boolean;
}

/** Palavras em comum necessárias para acreditar num corte de cabeça (caso 3). */
const MIN_OVERLAP_WORDS = 3;

/** Palavras iniciais iguais que caracterizam "mesma fala, fim reescrito". */
const REWRITE_HEAD_WORDS = 3;

/** Teto de crescimento de um segmento, em caracteres. */
const MAX_SEGMENT_CHARS = 4000;

const DIACRITICS = /[̀-ͯ]/g;
const NON_WORD = /[^\p{L}\p{N}]/gu;

/** Palavra comparável: sem acento, sem pontuação, minúscula. */
function keyOf(word: string): string {
  return word
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .replace(NON_WORD, '')
    .toLowerCase();
}

interface Words {
  raw: string[];
  key: string[];
}

function wordsOf(text: string): Words {
  const raw = text.split(' ').filter((word) => word.length > 0);
  return { raw, key: raw.map(keyOf) };
}

function startsWithWords(outer: readonly string[], inner: readonly string[]): boolean {
  if (inner.length === 0 || inner.length > outer.length) return false;
  return inner.every((word, index) => outer[index] === word);
}

/**
 * Maior número de palavras em que o FIM do que já temos é o COMEÇO do que está
 * visível. É a assinatura do caso 3: a janela rolou e o miolo ficou repetido
 * dos dois lados.
 */
function headCutOverlap(committed: Words, visible: Words): number {
  const max = Math.min(committed.key.length, visible.key.length);
  for (let k = max; k >= MIN_OVERLAP_WORDS; k -= 1) {
    const tail = committed.key.slice(committed.key.length - k);
    if (startsWithWords(visible.key, tail)) return k;
  }
  return 0;
}

/**
 * Decide o texto do segmento a partir do que já foi capturado (`committed`) e
 * do que está visível agora na linha de legenda (`visible`). Ambos já
 * sanitizados (espaço simples, sem caracteres de controle).
 *
 * Idempotente: reaplicar com o mesmo `visible` devolve o mesmo texto.
 */
export function mergeVisible(committed: string, visible: string): CaptionMerge {
  if (visible.length === 0) return keep(committed);
  if (committed.length === 0) return keep(visible);
  if (committed === visible) return keep(committed);

  const before = wordsOf(committed);
  const now = wordsOf(visible);

  // Caso 1 e 2a: a fala cresceu (ou só ganhou acento/pontuação no caminho).
  if (startsWithWords(now.key, before.key)) return keep(cap(visible));

  // A linha encolheu mantendo o começo: é a MESMA fala, o Meet ainda não
  // redesenhou o fim. Fica com o texto maior para não perder palavra por causa
  // de um frame intermediário.
  if (startsWithWords(before.key, now.key)) return keep(committed);

  // Caso 3: a janela rolante cortou a cabeça. Cola só o que é novo.
  const overlap = headCutOverlap(before, now);
  if (overlap > 0) {
    const tail = now.raw.slice(overlap);
    const text = tail.length > 0 ? `${committed} ${tail.join(' ')}` : committed;
    return keep(cap(text));
  }

  // Caso 2b: mesmo começo, fim trocado (o reconhecedor corrigiu a frase).
  const head = Math.min(REWRITE_HEAD_WORDS, before.key.length, now.key.length);
  if (
    head >= REWRITE_HEAD_WORDS &&
    startsWithWords(now.key, before.key.slice(0, head))
  ) {
    return keep(cap(visible));
  }

  // Caso 4: nada em comum. O nó foi reaproveitado para outra fala.
  return { text: visible, startNewSegment: true };
}

function keep(text: string): CaptionMerge {
  return { text, startNewSegment: false };
}

/**
 * Um segmento não cresce para sempre: passando do teto o corte sai num limite
 * de palavra, nunca no meio dela.
 */
function cap(text: string): string {
  if (text.length <= MAX_SEGMENT_CHARS) return text;
  const cut = text.slice(0, MAX_SEGMENT_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > MAX_SEGMENT_CHARS * 0.8 ? cut.slice(0, lastSpace) : cut;
}
