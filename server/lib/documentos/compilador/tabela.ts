/**
 * Tabela que atravessa páginas: o cabeçalho se repete em cada página, uma linha
 * nunca é cortada no meio, e o cabeçalho nunca fica sozinho no pé (ele só é
 * desenhado se a primeira linha de dados cabe junto).
 *
 * É um desenhista GENÉRICO: cada variante visual entrega um `TemaDeTabela` com
 * as medidas e cores que vêm do perfil, e este arquivo só cuida da geometria.
 */
import { textoPlano } from './texto';

type Doc = PDFKit.PDFDocument;

export interface TemaDeTabela {
  x: number;
  largura: number;
  fonteCabecalho: string;
  tamanhoCabecalho: number;
  corCabecalho: string;
  /** Fundo da faixa do cabeçalho. `null` = só o texto, com filete embaixo. */
  fundoCabecalho: string | null;
  caixaAltaNoCabecalho: boolean;
  espacamentoDeLetras: number;
  fonteCelula: string;
  fonteCelulaNegrito: string;
  tamanhoCelula: number;
  corCelula: string;
  /** Entrelinha em múltiplos do tamanho. */
  entrelinha: number;
  corDoFilete: string;
  /** Fundo das linhas pares. `null` = sem listra. */
  fundoListra: string | null;
  /** Filete mais forte no fim da tabela. `null` = o mesmo dos demais. */
  corDoFileteFinal: string | null;
  paddingX: number;
  paddingY: number;
  /** Espaço depois da tabela. */
  espacoDepois: number;
}

/** Largura de cada coluna, proporcional ao maior conteúdo, com piso. */
export function larguraDasColunas(
  cabecalho: readonly string[],
  linhas: readonly (readonly string[])[],
  larguraTotal: number,
  piso = 46,
): number[] {
  const pesos = cabecalho.map((titulo, i) => {
    const maior = Math.max(
      titulo.length,
      ...linhas.map((l) => textoPlano(l[i] ?? '').length),
    );
    // Raiz: uma coluna de texto longo ganha mais, mas não esmaga as curtas.
    return Math.max(6, Math.sqrt(Math.min(maior, 400)));
  });
  const soma = pesos.reduce((a, b) => a + b, 0);
  let larguras = pesos.map((p) => Math.max(piso, (p / soma) * larguraTotal));
  // O piso pode estourar a soma: normaliza de volta, mantendo as proporções.
  const total = larguras.reduce((a, b) => a + b, 0);
  larguras = larguras.map((w) => (w / total) * larguraTotal);
  return larguras;
}

function alturaDaLinha(
  doc: Doc,
  celulas: readonly string[],
  larguras: readonly number[],
  fonte: string,
  tamanho: number,
  entrelinha: number,
  tema: TemaDeTabela,
  maiuscula = false,
): number {
  doc.font(fonte).fontSize(tamanho);
  const folga = Math.max(0, tamanho * entrelinha - doc.currentLineHeight(false));
  const alturas = celulas.map((c, i) =>
    doc.heightOfString(maiuscula ? textoPlano(c).toUpperCase() : textoPlano(c), {
      width: larguras[i]! - tema.paddingX * 2,
      lineGap: folga,
      ...(maiuscula ? { characterSpacing: tema.espacamentoDeLetras } : {}),
    }),
  );
  return Math.max(...alturas, tamanho) + tema.paddingY * 2;
}

export interface ResultadoDaTabela {
  paginasAdicionadas: number;
}

/**
 * Desenha a tabela a partir de `doc.y`. `limiteInferior` é o y máximo do corpo.
 * Devolve quantas páginas foram acrescentadas — o chamador pode precisar disso
 * para a contabilidade de seções por página.
 */
export function desenharTabela(
  doc: Doc,
  cabecalho: readonly string[],
  linhas: readonly (readonly string[])[],
  tema: TemaDeTabela,
  limiteInferior: () => number,
): ResultadoDaTabela {
  // Linha irregular (de edição à mão, ou de um modelo distraído) nunca derruba o
  // arquivo: completa o que falta e ignora o que sobra.
  linhas = linhas.map((l) => cabecalho.map((_, i) => l[i] ?? ''));
  const larguras = larguraDasColunas(cabecalho, linhas, tema.largura);
  // Início de cada coluna: a borda esquerda mais a largura das anteriores.
  const inicios = larguras.map((_, i) => tema.x + larguras.slice(0, i).reduce((a, b) => a + b, 0));

  const alturaCab = alturaDaLinha(doc, cabecalho, larguras, tema.fonteCabecalho, tema.tamanhoCabecalho, 1.3, tema, tema.caixaAltaNoCabecalho);
  const alturasLinhas = linhas.map((l) =>
    alturaDaLinha(doc, l, larguras, tema.fonteCelula, tema.tamanhoCelula, tema.entrelinha, tema),
  );

  let paginasAdicionadas = 0;

  const desenharCabecalho = () => {
    const topo = doc.y;
    if (tema.fundoCabecalho) {
      doc.rect(tema.x, topo, tema.largura, alturaCab).fill(tema.fundoCabecalho);
    }
    doc.font(tema.fonteCabecalho).fontSize(tema.tamanhoCabecalho).fillColor(tema.corCabecalho);
    cabecalho.forEach((titulo, i) => {
      doc.text(
        tema.caixaAltaNoCabecalho ? textoPlano(titulo).toUpperCase() : textoPlano(titulo),
        inicios[i]! + tema.paddingX,
        topo + tema.paddingY,
        {
          width: larguras[i]! - tema.paddingX * 2,
          lineGap: Math.max(0, tema.tamanhoCabecalho * 1.3 - doc.currentLineHeight(false)),
          ...(tema.caixaAltaNoCabecalho ? { characterSpacing: tema.espacamentoDeLetras } : {}),
        },
      );
    });
    if (!tema.fundoCabecalho) {
      doc
        .moveTo(tema.x, topo + alturaCab)
        .lineTo(tema.x + tema.largura, topo + alturaCab)
        .lineWidth(1)
        .strokeColor(tema.corDoFilete)
        .stroke();
    }
    doc.y = topo + alturaCab;
  };

  // O cabeçalho só entra se a primeira linha cabe junto.
  const primeira = alturasLinhas[0] ?? 0;
  if (doc.y + alturaCab + primeira > limiteInferior()) {
    doc.addPage();
    paginasAdicionadas += 1;
  }
  desenharCabecalho();

  linhas.forEach((celulas, indice) => {
    const altura = alturasLinhas[indice]!;
    if (doc.y + altura > limiteInferior()) {
      doc.addPage();
      paginasAdicionadas += 1;
      desenharCabecalho();
    }
    const topo = doc.y;
    if (tema.fundoListra && indice % 2 === 1) {
      doc.rect(tema.x, topo, tema.largura, altura).fill(tema.fundoListra);
    }
    doc.font(tema.fonteCelula).fontSize(tema.tamanhoCelula).fillColor(tema.corCelula);
    const folga = Math.max(0, tema.tamanhoCelula * tema.entrelinha - doc.currentLineHeight(false));
    celulas.forEach((celula, i) => {
      // Negrito inline por célula: alterna os pesos sem sair da caixa.
      const partes = celula.split('**');
      partes.forEach((parte, k) => {
        if (parte === '' && partes.length > 1) return;
        doc.font(k % 2 === 1 ? tema.fonteCelulaNegrito : tema.fonteCelula);
        doc.text(parte, inicios[i]! + tema.paddingX, topo + tema.paddingY, {
          width: larguras[i]! - tema.paddingX * 2,
          lineGap: folga,
          continued: k < partes.length - 1,
        });
      });
    });
    const ultima = indice === linhas.length - 1;
    doc
      .moveTo(tema.x, topo + altura)
      .lineTo(tema.x + tema.largura, topo + altura)
      .lineWidth(ultima && tema.corDoFileteFinal ? 1 : 0.5)
      .strokeColor(ultima && tema.corDoFileteFinal ? tema.corDoFileteFinal : tema.corDoFilete)
      .stroke();
    doc.y = topo + altura;
  });

  // Mesma razão do sumário: o cursor fica na última coluna.
  doc.x = tema.x;
  doc.y += tema.espacoDepois;
  return { paginasAdicionadas };
}
