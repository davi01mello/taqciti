/**
 * Heurística de idioma da legenda — pura, sem dependências externas.
 *
 * O Google Meet transcreve no idioma configurado no MENU DE LEGENDAS dele, que
 * a extensão não automatiza (fora de escopo por decisão de produto: os
 * seletores desse menu são ofuscados e não mapeados, e clicar neles às cegas é
 * arriscado demais). Esta função só serve para AVISAR: conta palavras
 * funcionais (stopwords) de cada idioma numa janela recente do texto captado.
 * Não é detecção de idioma de verdade (não troca com precisão diante de nomes
 * próprios, números, jargão) — é um sinal barato o bastante para acionar um
 * nudge, nunca uma decisão automática.
 */
import type { LiveSegment } from '@/shared/types/domain';

export type CaptionLanguage = 'pt' | 'en' | 'unknown';

export interface LanguageDetection {
  language: CaptionLanguage;
  confidence: number;
}

/** Só a cauda mais recente do texto: reage rápido quando o idioma muda no meio da reunião. */
const DEFAULT_WINDOW_CHARS = 800;

/** Poucas stopwords batidas não sustentam uma decisão — jargão e nomes soam como ruído. */
const MIN_STOPWORD_HITS = 4;

/** O idioma dominante precisa responder por boa parte dos acertos, não só a maioria simples. */
const MIN_DOMINANT_RATIO = 0.65;

// Palavras funcionais frequentes e pouco ambíguas entre os dois idiomas (com e
// sem acento, já que legendas às vezes chegam sem diacríticos).
const PT_STOPWORDS = new Set([
  'que', 'não', 'nao', 'para', 'com', 'uma', 'um', 'isso', 'então', 'entao',
  'você', 'voce', 'aqui', 'mas', 'também', 'tambem', 'porque', 'como', 'mais',
  'muito', 'já', 'ja', 'está', 'esta', 'são', 'sao', 'foi', 'ser', 'esse',
  'essa', 'pelo', 'pela', 'tudo', 'bem', 'gente', 'nós', 'nos', 'vamos',
  'obrigado', 'obrigada', 'sim', 'né', 'ne', 'coisa', 'agora', 'assim',
]);

const EN_STOPWORDS = new Set([
  'the', 'and', 'is', 'of', 'that', 'this', 'you', 'are', 'was', 'were',
  'have', 'has', 'with', 'for', 'not', 'but', 'so', 'we', 'they', 'what',
  'when', 'where', 'how', 'yeah', 'okay', 'going', 'think', 'know', 'like',
  'just', 'because', 'about', 'there', 'right', 'really', 'would', 'can',
]);

function tokenize(text: string): string[] {
  return text
    .toLocaleLowerCase('pt-BR')
    .split(/[^\p{L}']+/u)
    .filter((word) => word.length > 0);
}

/**
 * Classifica o idioma predominante de uma janela recente de texto de legenda.
 * `confidence` é a fração das stopwords batidas que pertencem ao idioma
 * escolhido — não é probabilidade calibrada, só um sinal de força do sinal.
 */
export function detectCaptionLanguage(
  accumulatedText: string,
  windowChars = DEFAULT_WINDOW_CHARS,
): LanguageDetection {
  const window = accumulatedText.slice(-windowChars);
  const words = tokenize(window);

  let ptHits = 0;
  let enHits = 0;
  for (const word of words) {
    if (PT_STOPWORDS.has(word)) ptHits += 1;
    else if (EN_STOPWORDS.has(word)) enHits += 1;
  }

  const totalHits = ptHits + enHits;
  if (totalHits < MIN_STOPWORD_HITS) return { language: 'unknown', confidence: 0 };

  const ptRatio = ptHits / totalHits;
  const enRatio = enHits / totalHits;

  if (ptRatio >= MIN_DOMINANT_RATIO) return { language: 'pt', confidence: ptRatio };
  if (enRatio >= MIN_DOMINANT_RATIO) return { language: 'en', confidence: enRatio };
  return { language: 'unknown', confidence: Math.max(ptRatio, enRatio) };
}

/** Texto das falas mais recentes, até `maxChars` — a janela que a heurística examina. */
export function recentSegmentsText(
  segments: readonly LiveSegment[],
  maxChars: number,
): string {
  const parts: string[] = [];
  let length = 0;
  for (let i = segments.length - 1; i >= 0 && length < maxChars; i -= 1) {
    const text = segments[i]?.text ?? '';
    if (text.length === 0) continue;
    parts.push(text);
    length += text.length + 1;
  }
  return parts.reverse().join(' ').slice(-maxChars);
}
