/**
 * Inspeção programática do layout — o que dá para medir sem olhar a imagem.
 *
 * Cada bloco desenhado registra onde terminou e em que página. Depois, as
 * regras abaixo procuram o que um revisor humano acharia feio: página quase
 * vazia no meio do documento, título largado no pé, última página com duas
 * linhas. São MEDIDAS do que o compilador fez, não opinião: por isso entram no
 * relatório de qualidade como achados, e só como achados — corrigir (cortar
 * texto, encolher fonte) continua sendo decisão de quem pediu o documento.
 *
 * NÃO é um revisor visual: não vê sobreposição de arte, contraste, glifo
 * ausente nem corte de imagem. O relatório diz isso.
 */
import type { ProblemaDeQualidade } from '../contratos';

type Doc = PDFKit.PDFDocument;

interface Pagina {
  /** O maior y alcançado por conteúdo nesta página. */
  fimY: number;
  /** Tipo do último bloco que terminou nela. */
  ultimo: string;
  blocos: number;
}

export interface RegistroDeLayout {
  paginas: Map<number, Pagina>;
}

export const novoRegistro = (): RegistroDeLayout => ({ paginas: new Map() });

/** Chame DEPOIS de desenhar um bloco: registra onde ele terminou. */
export function registrarBloco(registro: RegistroDeLayout, doc: Doc, tipo: string): void {
  // Com `bufferPages`, a página atual é sempre a última do buffer.
  const indice = doc.bufferedPageRange().count - 1;
  const atual = registro.paginas.get(indice) ?? { fimY: 0, ultimo: tipo, blocos: 0 };
  atual.fimY = Math.max(atual.fimY, doc.y);
  atual.ultimo = tipo;
  atual.blocos += 1;
  registro.paginas.set(indice, atual);
}

export interface LimitesDaPagina {
  /** y onde o conteúdo começa. */
  topo: number;
  /** y onde o conteúdo termina. */
  base: number;
}

/** Abaixo disto, a página tem tão pouco conteúdo que parece engano. */
export const OCUPACAO_MINIMA_DO_MEIO = 0.08;
/** A última página costuma ser curta; só avisa quando é só uma sobra. */
export const OCUPACAO_MINIMA_DA_ULTIMA = 0.12;

export function inspecionarLayout(
  registro: RegistroDeLayout,
  totalDePaginas: number,
  limites: LimitesDaPagina,
  /** Páginas que não são de corpo (a capa): ficam fora da inspeção. */
  paginasIgnoradas: ReadonlySet<number> = new Set([0]),
): ProblemaDeQualidade[] {
  const problemas: ProblemaDeQualidade[] = [];
  const altura = limites.base - limites.topo;

  for (const [indice, pagina] of [...registro.paginas.entries()].sort((a, b) => a[0] - b[0])) {
    if (paginasIgnoradas.has(indice)) continue;
    const numero = indice + 1;
    const ocupacao = Math.min(1, Math.max(0, (pagina.fimY - limites.topo) / altura));
    const ultima = indice === totalDePaginas - 1;

    if (pagina.ultimo === 'titulo') {
      problemas.push({
        tipo: 'visual',
        pagina: numero,
        descricao: `A página ${numero} termina num título, sem o texto dele.`,
      });
    }
    if (!ultima && ocupacao < OCUPACAO_MINIMA_DO_MEIO) {
      problemas.push({
        tipo: 'visual',
        pagina: numero,
        descricao: `A página ${numero} está quase vazia (${Math.round(ocupacao * 100)}% ocupada) e não é a última.`,
      });
    }
    if (ultima && totalDePaginas > 2 && ocupacao < OCUPACAO_MINIMA_DA_ULTIMA) {
      problemas.push({
        tipo: 'visual',
        pagina: numero,
        descricao: `A última página (${numero}) tem só ${Math.round(ocupacao * 100)}% de conteúdo: uma sobra que talvez caiba na página anterior.`,
      });
    }
  }
  return problemas;
}
