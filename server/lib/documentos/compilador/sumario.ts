/**
 * Sumário com número de página REAL.
 *
 * O número só existe depois da paginação, e o sumário ocupa páginas que mudam a
 * paginação. A saída é compilar DUAS vezes: na primeira o sumário sai com
 * marcadores no lugar dos números — o mesmo número de linhas, portanto o mesmo
 * espaço —, e a posição de cada título é anotada; na segunda, os números
 * entram. Como o espaço ocupado é idêntico nas duas passadas, as páginas dos
 * títulos não se movem entre elas.
 */
import type { ContentTree } from '../contentTree';
import { textoPlano } from './texto';

type Doc = PDFKit.PDFDocument;

export interface EntradaDoSumario {
  blockId: string;
  nivel: 1 | 2;
  texto: string;
}

/** Títulos de nível 1 e 2, na ordem do documento. O nível 3 é detalhe demais. */
export function entradasDoSumario(arvore: ContentTree): EntradaDoSumario[] {
  const entradas: EntradaDoSumario[] = [];
  for (const bloco of arvore.blocos) {
    if (bloco.tipo === 'titulo' && bloco.nivel <= 2) {
      entradas.push({ blockId: bloco.blockId, nivel: bloco.nivel as 1 | 2, texto: textoPlano(bloco.texto) });
    }
  }
  return entradas;
}

export interface TemaDeSumario {
  x: number;
  largura: number;
  fonteNivel1: string;
  tamanhoNivel1: number;
  corNivel1: string;
  fonteNivel2: string;
  tamanhoNivel2: number;
  corNivel2: string;
  fontePagina: string;
  corPagina: string;
  corDoFilete: string;
  recuoNivel2: number;
  /** Folga vertical por entrada, em cima e embaixo. */
  paddingY: number;
  /** Largura reservada ao número, à direita. */
  larguraDoNumero: number;
}

/** O que aparece no lugar do número na primeira passada. */
export const MARCADOR_DE_PAGINA = '·';

export function desenharSumario(
  doc: Doc,
  entradas: readonly EntradaDoSumario[],
  paginas: ReadonlyMap<string, number> | undefined,
  tema: TemaDeSumario,
  limiteInferior: () => number,
): void {
  for (const entrada of entradas) {
    const n1 = entrada.nivel === 1;
    const fonte = n1 ? tema.fonteNivel1 : tema.fonteNivel2;
    const tamanho = n1 ? tema.tamanhoNivel1 : tema.tamanhoNivel2;
    const recuo = n1 ? 0 : tema.recuoNivel2;
    const larguraTexto = tema.largura - tema.larguraDoNumero - recuo;

    doc.font(fonte).fontSize(tamanho);
    const altura = doc.heightOfString(entrada.texto, { width: larguraTexto }) + tema.paddingY * 2;
    if (doc.y + altura > limiteInferior()) doc.addPage();

    const topo = doc.y;
    doc.fillColor(n1 ? tema.corNivel1 : tema.corNivel2);
    doc.text(entrada.texto, tema.x + recuo, topo + tema.paddingY, { width: larguraTexto });

    doc.font(tema.fontePagina).fontSize(tamanho).fillColor(tema.corPagina);
    const numero = paginas?.get(entrada.blockId);
    doc.text(numero === undefined ? MARCADOR_DE_PAGINA : String(numero), tema.x + tema.largura - tema.larguraDoNumero, topo + tema.paddingY, {
      width: tema.larguraDoNumero,
      align: 'right',
      lineBreak: false,
    });

    doc
      .moveTo(tema.x, topo + altura)
      .lineTo(tema.x + tema.largura, topo + altura)
      .lineWidth(0.5)
      .strokeColor(tema.corDoFilete)
      .stroke();
    doc.y = topo + altura;
  }
  // O último texto desenhado deixa o cursor na coluna do número: sem voltar à
  // margem, o que vem depois (na variante da Ata, que flui pelo cursor) sairia
  // espremido à direita.
  doc.x = tema.x;
  doc.y += 10;
}
