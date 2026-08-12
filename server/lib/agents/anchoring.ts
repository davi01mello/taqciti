/**
 * Localiza a citação do modelo dentro da transcrição bruta e devolve offsets
 * de verdade.
 *
 * É aqui que mora a correção mais importante da Fase 2: o modelo NUNCA
 * informa `start`/`end`. Ele entrega `quote`, e este arquivo procura. LLM
 * erra offset de caractere sistematicamente; âncora errada é pior que
 * âncora nenhuma, porque a auditoria da Fase 4 confiaria nela.
 *
 * Duas passadas, nesta ordem:
 *
 * 1. busca literal, caractere por caractere;
 * 2. busca normalizada — espaços colapsados, aspas curvas unificadas, caixa
 *    ignorada. O offset devolvido continua sendo o da transcrição ORIGINAL,
 *    porque a normalização carrega um mapa de índices de volta.
 *
 * Acento NÃO é normalizado, de propósito. Foi exatamente por aí que um
 * modelo falhou no bench: devolveu "gesto" onde a transcrição diz "gestão",
 * com o caractere multibyte apagado. Tolerar isso aqui esconderia o defeito
 * justamente na métrica que existe para pegá-lo.
 */

export interface NormalizedIndex {
  /** Texto normalizado, para buscar dentro. */
  text: string;
  /** `originalOffset[i]` = posição, no texto original, do i-ésimo caractere
   *  do texto normalizado. */
  originalOffset: number[];
}

/**
 * Normaliza preservando o mapa de volta para o original. Sem esse mapa, um
 * acerto na versão normalizada não vira offset utilizável.
 */
export function buildNormalizedIndex(source: string): NormalizedIndex {
  const chars: string[] = [];
  const originalOffset: number[] = [];

  let previousWasSpace = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;

    if (/\s/.test(char)) {
      // Uma corrida de espaços/quebras vira um único espaço, ancorado no
      // primeiro deles.
      if (!previousWasSpace) {
        chars.push(' ');
        originalOffset.push(i);
        previousWasSpace = true;
      }
      continue;
    }

    previousWasSpace = false;
    chars.push(unifyPunctuation(char).toLowerCase());
    originalOffset.push(i);
  }

  return { text: chars.join(''), originalOffset };
}

function unifyPunctuation(char: string): string {
  if (char === '“' || char === '”') return '"';
  if (char === '‘' || char === '’') return "'";
  if (char === '–' || char === '—') return '-';
  return char;
}

function normalizeQuery(query: string): string {
  return buildNormalizedIndex(query).text.trim();
}

export interface LocatedAnchor {
  start: number;
  end: number;
  exact: boolean;
}

export interface Locator {
  /** Localiza `quote`, ou devolve `null` quando não existe na transcrição. */
  locate(quote: string): LocatedAnchor | null;
}

/**
 * Cria um localizador para uma transcrição. O índice normalizado é montado
 * uma vez só: montá-lo por citação seria O(n) por statement numa transcrição
 * que pode ter centenas de milhares de caracteres.
 *
 * O localizador guarda onde terminou a última âncora e tenta dali primeiro.
 * Isso resolve o caso da citação curta que aparece várias vezes ("Concordo.",
 * "Sim."): sem isso, todas as ocorrências apontariam para a primeira, e a
 * auditoria leria o trecho errado. As afirmações costumam vir na ordem da
 * transcrição, então a dica acerta na maioria das vezes — e quando erra, o
 * fallback busca desde o começo e nada se perde.
 */
export function createLocator(transcript: string): Locator {
  const normalized = buildNormalizedIndex(transcript);
  let cursor = 0;

  return {
    locate(quote: string): LocatedAnchor | null {
      if (!quote || !quote.trim()) return null;

      const exact = findExact(transcript, quote, cursor);
      if (exact) {
        cursor = exact.end;
        return exact;
      }

      const loose = findNormalized(normalized, quote, cursor);
      if (loose) {
        cursor = loose.end;
        return loose;
      }

      return null;
    },
  };
}

function findExact(transcript: string, quote: string, from: number): LocatedAnchor | null {
  let index = transcript.indexOf(quote, from);
  if (index === -1 && from > 0) index = transcript.indexOf(quote);
  if (index === -1) return null;
  return { start: index, end: index + quote.length, exact: true };
}

function findNormalized(
  normalized: NormalizedIndex,
  quote: string,
  fromOriginal: number,
): LocatedAnchor | null {
  const needle = normalizeQuery(quote);
  if (!needle) return null;

  // Converte a dica de posição (offset original) para o espaço normalizado.
  const fromNormalized = normalized.originalOffset.findIndex((offset) => offset >= fromOriginal);

  let index = fromNormalized === -1 ? -1 : normalized.text.indexOf(needle, fromNormalized);
  if (index === -1) index = normalized.text.indexOf(needle);
  if (index === -1) return null;

  const start = normalized.originalOffset[index]!;
  // O fim é o início do caractere seguinte ao último casado; quando o casamento
  // termina no fim do texto, não há caractere seguinte.
  const lastMatched = index + needle.length - 1;
  const afterLast = normalized.originalOffset[lastMatched + 1];
  const end = afterLast ?? (normalized.originalOffset[lastMatched] ?? start) + 1;

  return { start, end, exact: false };
}

/** O trecho que a âncora realmente aponta — o que o Auditor vai ler. */
export function excerptFor(
  transcript: string,
  anchor: { start: number; end: number },
  padding = 0,
): string {
  const start = Math.max(0, anchor.start - padding);
  const end = Math.min(transcript.length, anchor.end + padding);
  return transcript.slice(start, end);
}
