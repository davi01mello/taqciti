/**
 * Variante "editorial" — capa gráfica, títulos grandes, rótulos técnicos em
 * monoespaçada, listas com marcador quadrado verde. Toda medida, cor e fonte
 * vem do perfil (`perfil.ts`, variante `editorial`); aqui só se decide ONDE
 * cada coisa vai. Nenhum número de estilo mora neste arquivo, exceto a
 * geometria da capa, medida da página 1 da apostila de referência.
 *
 * O cabeçalho e o rodapé são desenhados no FIM, com as páginas em buffer:
 * assim o cabeçalho de uma página mostra a seção que realmente começa nela,
 * e o rodapé conhece a contagem real.
 */
import { FONTE_NEGRITO, FONTE_REGULAR } from '../../render/fonts';
import type { Bloco, ContentTree } from '../contentTree';
import type { EstiloDoPerfil, PapelDeEstilo, VarianteVisual } from '../perfil';
import { FONTE_MONO, FONTE_MONO_NEGRITO, imagemEditorial } from './recursos';
import { desenharTabela, type TemaDeTabela } from './tabela';
import { escreverRico, textoPlano } from './texto';

type Doc = PDFKit.PDFDocument;

const LARGURA = 595.28;
const ALTURA = 841.89;

/** Geometria da capa, medida da página 1 da apostila (a partir do topo). */
const CAPA = {
  marcaX: 54,
  marcaTopo: 52,
  marcaLargura: 107,
  tituloLargura: 430,
  /** Base da última linha do título — ele cresce PARA CIMA a partir daqui. */
  tituloBase: 347,
  subtituloDistancia: 38,
  subtituloLargura: 400,
  formaX: 330,
  formaTopo: 405,
  formaLargura: 300,
  fileteTopo: 734,
  fileteLargura: 38,
  linha1Topo: 750,
  linha2Topo: 770,
} as const;

const HEADER_TOPO = 30;
const FILETE_TOPO = 49;
const RODAPE_TOPO = 800;
const MARGEM_SUPERIOR = 70;
const MARGEM_INFERIOR = 78;

export interface ContextoEditorial {
  doc: Doc;
  arvore: ContentTree;
  variante: VarianteVisual;
  avisos: string[];
  /** Seção (título de nível 1) que vale em cada página, pelo índice. */
  secaoPorPagina: string[];
  recursosUsados: Set<string>;
}

// --- perfil → PDF ---------------------------------------------------------

/**
 * Nome da fonte do perfil → fonte registrada no PDF. Só substituições que o
 * perfil AUTORIZA entram aqui (`varianteAplicavel` barra o resto antes de
 * compilar): Neue Haas → Barlow, monoespaçada → JetBrains Mono.
 */
export function fonteDoPdf(nome: string): string {
  if (nome.startsWith('Neue Haas')) {
    return /(Medium|Bold)$/.test(nome) ? FONTE_NEGRITO : FONTE_REGULAR;
  }
  if (nome.startsWith('Monoes')) return FONTE_MONO;
  throw new Error(`Fonte "${nome}" sem correspondência no compilador.`);
}

function estilo(ctx: ContextoEditorial, papel: PapelDeEstilo): EstiloDoPerfil & { fontePdf: string } {
  const regra = ctx.variante.estilos[papel];
  if (!regra) throw new Error(`Papel de estilo "${papel}" ausente na variante ${ctx.variante.id}.`);
  return { ...regra.valor, fontePdf: fonteDoPdf(regra.valor.fonte) };
}

const cor = (ctx: ContextoEditorial, nome: string): string => {
  const valor = ctx.variante.cores[nome]?.valor;
  if (!valor) throw new Error(`Cor "${nome}" ausente na variante ${ctx.variante.id}.`);
  return valor;
};

function aplicar(doc: Doc, e: ReturnType<typeof estilo>): void {
  doc.font(e.fontePdf).fontSize(e.tamanhoPt).fillColor(e.cor);
}

/** Folga para a entrelinha do perfil: passo entre linhas = tamanho × entrelinha. */
const folga = (doc: Doc, e: EstiloDoPerfil): number =>
  Math.max(0, e.tamanhoPt * e.entrelinha - doc.currentLineHeight(false));

function garantirEspaco(doc: Doc, altura: number): void {
  if (doc.y + altura > ALTURA - doc.page.margins.bottom) doc.addPage();
}

// --- capa -----------------------------------------------------------------

/** Maior tamanho (de 72 a 30 pt) em que o título cabe em até 3 linhas sem
 *  quebrar palavra no meio. Devolve também se foi preciso encolher. */
function tamanhoDoTitulo(doc: Doc, titulo: string, e: ReturnType<typeof estilo>) {
  for (const tamanho of [e.tamanhoPt, 64, 56, 48, 42, 36, 30]) {
    if (tamanho > e.tamanhoPt) continue;
    doc.font(e.fontePdf).fontSize(tamanho);
    const passo = tamanho * e.entrelinha;
    const maiorPalavra = Math.max(...titulo.split(/\s+/).map((p) => doc.widthOfString(p)));
    const altura = doc.heightOfString(titulo, { width: CAPA.tituloLargura, lineGap: passo - doc.currentLineHeight(false) });
    const linhas = Math.round(altura / passo);
    if (maiorPalavra <= CAPA.tituloLargura && linhas <= 3) return { tamanho, linhas, encolheu: tamanho < e.tamanhoPt };
  }
  doc.font(e.fontePdf).fontSize(30);
  const passo = 30 * e.entrelinha;
  const altura = doc.heightOfString(titulo, { width: CAPA.tituloLargura, lineGap: passo - doc.currentLineHeight(false) });
  return { tamanho: 30, linhas: Math.max(1, Math.round(altura / passo)), encolheu: true };
}

function desenharCapa(ctx: ContextoEditorial, capa: Extract<Bloco, { tipo: 'capa' }>): void {
  const { doc } = ctx;
  doc.addPage();
  // O pé da capa fica abaixo da margem do corpo: sem zerar, o pdfkit abriria
  // página nova ao escrever ali.
  const margemInferior = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  doc.image(imagemEditorial('fundo-capa.jpg'), 0, 0, { width: LARGURA, height: ALTURA });
  doc.image(imagemEditorial('forma-3d-1.png'), CAPA.formaX, CAPA.formaTopo, { width: CAPA.formaLargura });
  doc.image(imagemEditorial('marca-branca.png'), CAPA.marcaX, CAPA.marcaTopo, { width: CAPA.marcaLargura });
  for (const r of ['fundo-capa', 'forma-3d-1', 'marca-branca']) ctx.recursosUsados.add(r);

  const eTitulo = estilo(ctx, 'titulo_documento');
  const { tamanho, linhas, encolheu } = tamanhoDoTitulo(doc, capa.titulo, eTitulo);
  if (encolheu) {
    ctx.avisos.push(`O título da capa foi reduzido de ${eTitulo.tamanhoPt} para ${tamanho} pt para caber na área prevista.`);
  }
  const passo = tamanho * eTitulo.entrelinha;
  const topoDoTitulo = CAPA.tituloBase - tamanho * 0.8 - (linhas - 1) * passo;
  doc.font(eTitulo.fontePdf).fontSize(tamanho).fillColor(eTitulo.cor);
  doc.text(capa.titulo, 54, topoDoTitulo, {
    width: CAPA.tituloLargura,
    lineGap: passo - doc.currentLineHeight(false),
  });

  if (capa.subtitulo) {
    const eSub = estilo(ctx, 'subtitulo_capa');
    aplicar(doc, eSub);
    doc.text(capa.subtitulo, 54, CAPA.tituloBase + CAPA.subtituloDistancia, {
      width: CAPA.subtituloLargura,
      lineGap: folga(doc, eSub),
    });
  }

  doc.rect(54, CAPA.fileteTopo, CAPA.fileteLargura, 1.5).fill('#FFFFFF');
  const linha1 = [capa.cliente, capa.autor].filter(Boolean).join(' · ');
  if (linha1) {
    doc.font(FONTE_NEGRITO).fontSize(9.5).fillColor('#FFFFFF');
    doc.text(linha1, 54, CAPA.linha1Topo, { width: 400, lineBreak: false });
  }
  if (capa.data) {
    doc.font(FONTE_REGULAR).fontSize(9).fillColor('#FFFFFF');
    doc.text(capa.data, 54, CAPA.linha2Topo, { width: 400, lineBreak: false });
  }
  doc.page.margins.bottom = margemInferior;
}

// --- corpo ----------------------------------------------------------------

function desenharTitulo(ctx: ContextoEditorial, bloco: Extract<Bloco, { tipo: 'titulo' }>, primeiroDaPagina: boolean): void {
  const { doc } = ctx;
  const e = estilo(ctx, bloco.nivel === 1 ? 'titulo_secao' : bloco.nivel === 2 ? 'subtitulo_secao' : 'rotulo');
  const tamanho = bloco.nivel === 3 ? 11.2 : e.tamanhoPt;
  const antes = primeiroDaPagina ? 0 : bloco.nivel === 1 ? 14 : 10;

  doc.font(e.fontePdf).fontSize(tamanho);
  const altura = doc.heightOfString(textoPlano(bloco.texto), { width: LARGURA - 108 });
  // Título nunca fica sozinho no pé: reserva espaço para o título e três
  // linhas de texto (ou quebra layout pedida).
  if (bloco.layout === 'quebra_antes') doc.addPage();
  else garantirEspaco(doc, antes + altura + e.espacoDepoisPt + 3 * 15);

  doc.y += doc.y > doc.page.margins.top ? antes : 0;
  doc.font(e.fontePdf).fontSize(tamanho).fillColor(e.cor);
  doc.text(textoPlano(bloco.texto), 54, doc.y, { width: LARGURA - 108, lineGap: Math.max(0, tamanho * e.entrelinha - doc.currentLineHeight(false)) });
  doc.y += e.espacoDepoisPt;
}

function desenharParagrafo(ctx: ContextoEditorial, bloco: Extract<Bloco, { tipo: 'paragrafo' }>): void {
  const { doc } = ctx;
  const e = estilo(ctx, 'corpo');
  aplicar(doc, e);
  escreverRico(doc, bloco.texto, FONTE_REGULAR, FONTE_NEGRITO, {
    width: LARGURA - 108,
    lineGap: folga(doc, e),
  });
  doc.y += e.espacoDepoisPt;
}

function desenharLista(ctx: ContextoEditorial, bloco: Extract<Bloco, { tipo: 'lista' }>): void {
  const { doc } = ctx;
  const e = estilo(ctx, 'item_lista');
  const verde = cor(ctx, 'verde');
  const xTexto = 54 + 22;

  bloco.itens.forEach((item, indice) => {
    aplicar(doc, e);
    const lineGap = folga(doc, e);
    const altura = doc.heightOfString(textoPlano(item), { width: LARGURA - 54 - xTexto, lineGap });
    garantirEspaco(doc, altura);

    const topo = doc.y;
    if (bloco.ordenada) {
      doc.font(FONTE_NEGRITO).fillColor(verde).fontSize(e.tamanhoPt);
      doc.text(`${indice + 1}.`, 54 + 6, topo, { width: 16, lineBreak: false });
    } else {
      // Quadrado verde centrado na primeira linha.
      doc.rect(54 + 8, topo + e.tamanhoPt * 0.32, 4.2, 4.2).fill(verde);
    }
    aplicar(doc, e);
    doc.y = topo;
    doc.x = xTexto;
    escreverRico(doc, item, FONTE_REGULAR, FONTE_NEGRITO, { width: LARGURA - 54 - xTexto, lineGap });
    doc.x = 54;
    doc.y += e.espacoDepoisPt;
  });
  doc.y += 3;
}

function desenharTabelaEditorial(ctx: ContextoEditorial, bloco: Extract<Bloco, { tipo: 'tabela' }>): void {
  const { doc } = ctx;
  const cab = estilo(ctx, 'tabela_cabecalho');
  const cel = estilo(ctx, 'tabela_celula');
  const tema: TemaDeTabela = {
    x: 54,
    largura: LARGURA - 108,
    fonteCabecalho: cab.fontePdf,
    tamanhoCabecalho: cab.tamanhoPt,
    corCabecalho: cab.cor,
    fundoCabecalho: cor(ctx, 'fundoDestaqueEscuro'),
    caixaAltaNoCabecalho: true,
    espacamentoDeLetras: 1.1,
    fonteCelula: cel.fontePdf,
    fonteCelulaNegrito: FONTE_NEGRITO,
    tamanhoCelula: cel.tamanhoPt,
    corCelula: cel.cor,
    entrelinha: cel.entrelinha,
    corDoFilete: cor(ctx, 'filete'),
    fundoListra: cor(ctx, 'fundoTabelaSuave'),
    corDoFileteFinal: cor(ctx, 'tinta'),
    paddingX: 9,
    paddingY: 7,
    espacoDepois: 8,
  };
  desenharTabela(doc, bloco.cabecalho, bloco.linhas, tema, () => ALTURA - doc.page.margins.bottom);
  if (bloco.legenda) {
    const leg = estilo(ctx, 'legenda');
    aplicar(doc, leg);
    doc.text(bloco.legenda, 54, doc.y, { width: LARGURA - 108, lineGap: folga(doc, leg) });
    doc.y += leg.espacoDepoisPt;
  }
  doc.y += 6;
}

// --- cabeçalho e rodapé (no fim) --------------------------------------------

const aparar = (texto: string, max: number): string =>
  texto.length > max ? `${texto.slice(0, max - 1).trimEnd()}…` : texto;

function moldura(ctx: ContextoEditorial, total: number): void {
  const { doc } = ctx;
  const mono = estilo(ctx, 'rotulo_tecnico');
  const numero = estilo(ctx, 'rodape');
  const filete = cor(ctx, 'filete');
  const titulo = ctx.arvore.titulo;
  const larguraUtil = LARGURA - 108;

  for (let i = 1; i < total; i++) {
    doc.switchToPage(i);
    // Fora da caixa de texto: sem isto o pdfkit abriria página nova.
    const margemInferior = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc.font(FONTE_MONO).fontSize(mono.tamanhoPt).fillColor(mono.cor).fillColor(mono.cor);
    doc.text(aparar(titulo.toUpperCase(), 42), 54, HEADER_TOPO, {
      width: larguraUtil / 2,
      characterSpacing: 1.1,
      lineBreak: false,
    });
    const secao = ctx.secaoPorPagina[i];
    if (secao) {
      doc.text(aparar(secao.toUpperCase(), 48), 54 + larguraUtil / 2, HEADER_TOPO, {
        width: larguraUtil / 2,
        align: 'right',
        characterSpacing: 1.1,
        lineBreak: false,
      });
    }
    doc.moveTo(54, FILETE_TOPO).lineTo(LARGURA - 54, FILETE_TOPO).lineWidth(0.75).strokeColor(filete).stroke();

    doc.font(FONTE_MONO).fontSize(mono.tamanhoPt).fillColor(mono.cor);
    doc.text(aparar(`CITi · ${titulo}`, 60), 54, RODAPE_TOPO, {
      width: larguraUtil - 40,
      characterSpacing: 1.1,
      lineBreak: false,
    });
    doc.font(fonteDoPdf(numero.fonte)).fontSize(numero.tamanhoPt).fillColor(numero.cor);
    doc.text(String(i + 1), 54, RODAPE_TOPO - 1.5, {
      width: larguraUtil,
      align: 'right',
      lineBreak: false,
    });

    doc.page.margins.bottom = margemInferior;
  }
  ctx.recursosUsados.add('fonte-mono');
}

// --- entrada ----------------------------------------------------------------

/** Margens do documento nesta variante. */
export const MARGENS_EDITORIAL = {
  top: MARGEM_SUPERIOR,
  bottom: MARGEM_INFERIOR,
  left: 54,
  right: 54,
} as const;

export function desenharEditorial(ctx: ContextoEditorial): void {
  const { doc, arvore } = ctx;
  let primeiroDaPagina = true;
  let indicePagina = -1;
  let ultimaSecao = '';
  /** Páginas cujo cabeçalho já vale por um título que começa nelas. */
  const comTituloProprio = new Set<number>();
  doc.on('pageAdded', () => {
    indicePagina += 1;
    primeiroDaPagina = true;
    ctx.secaoPorPagina[indicePagina] = ultimaSecao;
  });

  for (const bloco of arvore.blocos) {
    switch (bloco.tipo) {
      case 'capa':
        desenharCapa(ctx, bloco);
        // O conteúdo começa na página seguinte, com as margens do corpo.
        doc.addPage();
        break;
      case 'titulo':
        if (!doc.page) doc.addPage();
        desenharTitulo(ctx, bloco, primeiroDaPagina);
        primeiroDaPagina = false;
        // O cabeçalho mostra a PRIMEIRA seção que começa na página; as
        // seguintes só valem a partir da próxima.
        if (bloco.nivel === 1 && !comTituloProprio.has(indicePagina)) {
          ctx.secaoPorPagina[indicePagina] = textoPlano(bloco.texto);
          comTituloProprio.add(indicePagina);
        }
        // Páginas seguintes herdam o último título de nível 1.
        if (bloco.nivel === 1) ultimaSecao = textoPlano(bloco.texto);
        break;
      case 'paragrafo':
        if (!doc.page) doc.addPage();
        desenharParagrafo(ctx, bloco);
        primeiroDaPagina = false;
        break;
      case 'lista':
        if (!doc.page) doc.addPage();
        desenharLista(ctx, bloco);
        primeiroDaPagina = false;
        break;
      case 'tabela':
        if (!doc.page) doc.addPage();
        desenharTabelaEditorial(ctx, bloco);
        primeiroDaPagina = false;
        break;
      case 'quebra_de_secao':
        doc.addPage();
        break;
      default:
        throw new Error(`Bloco "${bloco.tipo}" ainda não é suportado pelo compilador.`);
    }
  }
}

export function finalizarEditorial(ctx: ContextoEditorial): number {
  const total = ctx.doc.bufferedPageRange().count;
  moldura(ctx, total);
  return total;
}
