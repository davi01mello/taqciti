/**
 * As garantias de CÓDIGO sobre o texto que sai para o cliente. Moravam no
 * Escritor; ficaram quando ele saiu, porque não dependiam dele:
 *
 * - **instrução do PDF não vaza.** As frases de autoria do modelo de Ata são
 *   procuradas na saída, e a geração FALHA se alguma aparecer;
 * - **lacuna aparece**, sempre com o mesmo marcador (`textoDeLacuna`), no
 *   markdown e no HTML;
 * - **a confiança da seção é decidida em código**, nunca perguntada ao modelo.
 */
import type { SectionSpec } from './templates/types';
import { textoDeLacuna, type Gap } from './documentData';
import type { SectionConfidence } from './generateStep';

/**
 * Instruções de autoria do `Modelo_Ata_de_Reunião.pdf`. São o que o autor do
 * modelo escreveu PARA QUEM PREENCHE, e viraram `guidance` do template — não
 * texto do documento.
 *
 * A comparação é sensível à caixa de propósito. São títulos em caixa alta de
 * início, e casar sem distinguir caixa transformaria prosa legítima ("definir
 * uma ação concreta para a próxima sprint") em falha de geração.
 */
export const FRASES_PROIBIDAS: readonly string[] = [
  'O que escrever aqui',
  'Narrativa Resumida',
  'O Veredito',
  'Ação Concreta',
  'Alinhamentos Abstratos',
  'Diferença para Decisões',
  'Produtos Gerados',
  'Resumo Executivo',
  '[Nome do Tópico]',
  '[Decisão A]',
  '[Nome] – [Cargo]',
];

export class VazamentoDeInstrucaoError extends Error {
  readonly frases: string[];
  readonly onde: string;

  constructor(frases: string[], onde: string) {
    super(
      `Instrução de autoria do modelo vazou para ${onde}: ${frases.map((f) => `"${f}"`).join(', ')}. ` +
        'Isso é texto do PDF dirigido a quem preenche a ata, não conteúdo do documento — ' +
        'se chegasse ao cliente, a ata sairia com a instrução dentro.',
    );
    this.frases = frases;
    this.onde = onde;
  }
}

/** Falha ALTO. Entregar calado seria entregar a instrução ao cliente. */
export function assertSemVazamento(texto: string, onde: string): void {
  const encontradas = FRASES_PROIBIDAS.filter((frase) => texto.includes(frase));
  if (encontradas.length > 0) throw new VazamentoDeInstrucaoError(encontradas, onde);
}

/** O marcador de lacuna em markdown. O texto vem de `documentData.ts`, para
 *  o HTML mostrar exatamente a mesma frase. */
export function marcadorDeLacuna(gap: Gap): string {
  return `**${textoDeLacuna(gap.question)}**`;
}

/**
 * Confiança da seção, decidida em código.
 *
 * Perguntar isso ao modelo seria pedir que ele avaliasse o próprio trabalho, e
 * a resposta útil (`missing`) é justamente a que ele tem menos incentivo a
 * dar.
 */
export function confidenceFor(
  section: SectionSpec,
  dados: string | null,
  gaps: Gap[],
): SectionConfidence {
  if (dados === null) return section.required ? 'missing' : 'partial';
  return gaps.length > 0 ? 'partial' : 'ok';
}
