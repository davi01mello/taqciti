/**
 * Heurística de confiança de reunião comercial (0–1).
 *
 * Como funciona (simples e documentado de propósito):
 * 1. O transcript inteiro é normalizado (minúsculas, sem acentos).
 * 2. Palavras-chave comerciais têm pesos por força de sinal:
 *    fortes (3) = vocabulário inequívoco de venda/proposta;
 *    médias (2) = negociação de escopo/valor;
 *    fracas (1) = contexto de projeto que aparece em reuniões comerciais.
 * 3. Cada palavra distinta encontrada soma `peso * (1 + 0.15 * repetições extras)`
 *    (repetições saturam em 4 — falar "orçamento" 20 vezes não vale 20x).
 * 4. O total vira confiança por saturação exponencial: 1 - e^(-total/12).
 *    Isso dá curva suave: poucos sinais ≈ 0.2–0.4, vocabulário comercial
 *    consistente ≈ 0.7+, e nunca ultrapassa 1.
 *
 * A UI nunca mostra o número cru — só badges por faixa (ver constants.ts).
 */
import type { TranscriptSegment } from '@/shared/types/domain';

const STRONG_KEYWORDS = [
  'proposta',
  'orcamento',
  'contrato',
  'precificacao',
  'comercial',
  'fechamento',
  'negociacao',
];

const MEDIUM_KEYWORDS = [
  'preco',
  'valor',
  'investimento',
  'escopo',
  'prazo',
  'entrega',
  'pagamento',
  'desconto',
  'custo',
  'parcela',
  'cronograma',
];

const WEAK_KEYWORDS = [
  'projeto',
  'cliente',
  'demanda',
  'necessidade',
  'solucao',
  'produto',
  'desenvolvimento',
  'dados',
  'sistema',
  'aplicativo',
];

const SATURATION = 12;
const REPEAT_BONUS = 0.15;
const MAX_COUNTED_REPEATS = 4;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function countOccurrences(haystack: string, word: string): number {
  const matches = haystack.match(new RegExp(`\\b${word}\\b`, 'g'));
  return matches ? matches.length : 0;
}

export function computeCommercialConfidence(
  transcript: readonly Pick<TranscriptSegment, 'text'>[],
): number {
  if (transcript.length === 0) return 0;

  const fullText = normalize(transcript.map((s) => s.text).join(' '));
  if (fullText.trim().length === 0) return 0;

  const groups: Array<[string[], number]> = [
    [STRONG_KEYWORDS, 3],
    [MEDIUM_KEYWORDS, 2],
    [WEAK_KEYWORDS, 1],
  ];

  let total = 0;
  for (const [keywords, weight] of groups) {
    for (const word of keywords) {
      const count = countOccurrences(fullText, word);
      if (count === 0) continue;
      const extraRepeats = Math.min(count - 1, MAX_COUNTED_REPEATS);
      total += weight * (1 + extraRepeats * REPEAT_BONUS);
    }
  }

  const confidence = 1 - Math.exp(-total / SATURATION);
  return Math.min(1, Math.max(0, Number(confidence.toFixed(4))));
}
