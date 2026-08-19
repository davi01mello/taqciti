/**
 * `DocumentData` → PDF, irmão de `render/html.ts` — sai do MESMO dado
 * canônico, não de uma conversão do HTML.
 *
 * ── Duas bibliotecas, um propósito cada ──────────────────────────────────
 *
 * `pdfkit` desenha o CONTEÚDO (texto, seção por seção) — é bom nisso e
 * pagina sozinho quando o texto passa da margem. `pdf-lib` monta a CAPA,
 * porque é ele que embute imagem em posição absoluta sem um fluxo de texto
 * no meio, e faz a MONTAGEM final: junta a capa com as páginas de conteúdo
 * que o `pdfkit` gerou.
 *
 * ── Fidelidade ao modelo: as coordenadas são as DELE ─────────────────────
 *
 * Praticamente todo número deste arquivo saiu do stream decodificado de
 * `public/assets-docs/ata-de-reuniao/example.pdf`, não de leitura visual —
 * posição da marca, do título, do subtítulo, do recorte do gráfico, da linha
 * do rodapé. O modelo trabalha em coordenadas de cima pra baixo (a primeira
 * coisa que o stream faz é `1 0 0 -1 0 842 cm`), que é também o sistema do
 * `pdfkit`; por isso as medidas de conteúdo abaixo são "distância a partir
 * do topo da página", batendo direto com o modelo. `pdf-lib` é de baixo pra
 * cima, então a capa converte com `A4_ALTURA_PT - medida`.
 *
 * O modelo tem MediaBox 596×842 e o A4 do `pdfkit` é 595,28×841,89 — 0,7pt e
 * 0,1pt de diferença, menos de 0,1%. As medidas entram sem reescala: corrigir
 * por um fator dessa ordem seria precisão falsa.
 *
 * ── Paridade com o HTML é ESTRUTURAL, não visual exata ──────────────────
 *
 * Os motores de desenho são diferentes, então não vale a pena perseguir
 * pixel a pixel no CONTEÚDO. O que os três (HTML, PDF, markdown) têm que
 * concordar: mesmas seções, mesma ordem, mesmos rótulos, mesma disciplina de
 * lacuna (nunca omitir em silêncio), mesmo rodapé. Tamanhos de fonte e cores
 * vêm de `./typography.ts`, importado pelos dois motores — é o que impede
 * um ajuste num arquivo de silenciosamente destoar do outro. A CAPA é a
 * exceção: aí a paridade é visual de propósito, porque é o gráfico real do
 * modelo com a marca real por cima.
 *
 * ── Helvetica no lugar de Arial ──────────────────────────────────────────
 *
 * Arial não é uma das 14 fontes padrão do PDF. Helvetica é — e não é "uma
 * sem serifa parecida": as duas têm a MESMA métrica (mesma largura por
 * glifo, mesma entrelinha), e a maior parte dos leitores em Windows resolve
 * o pedido de Helvetica desenhando Arial. É a substituição padrão do
 * formato, a mesma que o `font-family` do HTML já faz como fallback.
 *
 * ── Marca e rodapé em TODA página interna ───────────────────────────────
 *
 * O modelo desenha a marca menor no topo e o rodapé institucional na base de
 * toda página interna (confirmado: o XObject `/X4` e o par linha+texto
 * aparecem nas 3 páginas de `example.pdf`). `renderConteudoPdfkit` reproduz
 * os dois com o listener `pageAdded` do `pdfkit`, que dispara pra primeira
 * página e pra cada quebra automática.
 */
import PDFDocument from 'pdfkit';
import { PDFDocument as PDFLibDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import type { DocumentType } from '../documentTypes';
import { TEMPLATES } from '../templates';
import type { DocumentTemplate } from '../templates/types';
import { specForSection, textoDeLacuna, type DocumentData, type Gap } from '../documentData';
import {
  marcaBuffer,
  MARCA_CABECALHO_ALTURA_PT,
  MARCA_CABECALHO_LARGURA_PT,
  MARCA_CABECALHO_TOPO_PT,
  MARCA_CAPA_ALTURA_PT,
  MARCA_CAPA_LARGURA_PT,
  MARCA_CAPA_TOPO_PT,
} from './brand';
import { capaGraficoBuffer } from './modelo';
import { RODAPE, temCabecalho } from './html';
import {
  CINZA_LINHA,
  COR_SUBTITULO_CAPA,
  ENTRELINHA,
  GAP_ANTES_DA_LISTA_PT,
  GAP_PARAGRAFO_PT,
  LISTA_MARCADOR_RECUO_PT,
  LISTA_TEXTO_RECUO_PT,
  TAMANHO_CORPO_PT,
  TAMANHO_ITEM_PT,
  TAMANHO_RODAPE_PT,
  TAMANHO_SECAO_PT,
  TAMANHO_SUBTITULO_CAPA_PT,
  TAMANHO_TITULO_PT,
  TINTA,
} from './typography';

/** Igual ao `@page { margin: 1in }` do HTML — o modelo usa 72pt real de
 *  margem (confirmado no `cm` de cada bloco de texto do stream: translada
 *  x=72 antes de desenhar), não 2,5cm como uma primeira leitura assumiu. */
const MARGEM_PT = 72;

/**
 * Margem INFERIOR do conteúdo — maior que as outras porque a base da página
 * é ocupada pelo rodapé institucional (ver `RODAPE_LINHA_TOPO_PT`). 140pt
 * deixa o texto parar ~14pt acima da linha fina, sem chance de encostar
 * nela. Não é assimetria decorativa: é a faixa que o modelo reserva.
 */
const MARGEM_INFERIOR_PT = 140;

/** A4 nos mesmos pontos que o `pdfkit` usa por padrão — a capa (pdf-lib)
 *  precisa ter o tamanho EXATO das páginas de conteúdo (pdfkit), senão o
 *  PDF final mistura tamanhos de página. */
const A4_LARGURA_PT = 595.28;
const A4_ALTURA_PT = 841.89;

// ── Capa: geometria do modelo, medida a partir do TOPO da página ──────────

/** `cm` do `/X9 Do`: `600 0 0 -840.88245 -2.25 846.20288`. O gráfico sangra
 *  pelos quatro lados de propósito — daí o x negativo e a largura maior que
 *  a página. */
const CAPA_GRAFICO_X_PT = -2.25;
const CAPA_GRAFICO_LARGURA_PT = 600;
const CAPA_GRAFICO_ALTURA_PT = 840.88245;
/** Base do gráfico, medida a partir do topo (ele desce 4,3pt abaixo da folha). */
const CAPA_GRAFICO_BASE_PT = 846.20288;
/** Topo do RECORTE do modelo (`-1 470.45288 598 372.54712 re`): acima disto
 *  o gráfico não aparece. Ver `./modelo.ts` — o arquivo é a capa inteira
 *  achatada, com um "Ata de reunião" em pixel que precisa ficar de fora. */
const CAPA_GRAFICO_RECORTE_TOPO_PT = 470.45288;

/** Linha de base do título e do subtítulo da capa, a partir do topo —
 *  calculadas do par `cm`+`Tm`+`Td` de cada bloco (`.75 0 0 .75 72 275.64771`
 *  e `.75 0 0 .75 72 319.2865`). */
const CAPA_TITULO_BASE_PT = 306.6;
const CAPA_SUBTITULO_BASE_PT = 338.05;

// ── Rodapé: geometria do modelo, também a partir do topo ──────────────────

/** Linha fina: `4 -2.3323567 m 597.33331 -2.3323567 l S` sob o `cm`
 *  `.75 0 0 .75 72 717.24927` — ou seja, de x=75 a x=520, em y=715,5. */
const RODAPE_LINHA_TOPO_PT = 715.5;
const RODAPE_LINHA_X_INICIO_PT = 75;
const RODAPE_LINHA_X_FIM_PT = 520;
/** Linha de base do primeiro texto do rodapé, e o salto até o segundo. */
const RODAPE_TEXTO_BASE_PT = 745.4;
const RODAPE_ENTRELINHA_PT = 21.2;

type Doc = PDFKit.PDFDocument;

export interface RenderPdfInput {
  documentType: DocumentType;
  data: DocumentData;
  gaps: Gap[];
  title: string;
}

/** `#rrggbb` → o `rgb(...)` 0–1 que `pdf-lib` espera. */
function corPdfLib(hex: string) {
  const limpo = hex.replace('#', '');
  return rgb(
    Number.parseInt(limpo.slice(0, 2), 16) / 255,
    Number.parseInt(limpo.slice(2, 4), 16) / 255,
    Number.parseInt(limpo.slice(4, 6), 16) / 255,
  );
}

/**
 * Documento PDF completo, pronto pra download: capa (pdf-lib, gráfico real
 * do modelo) + conteúdo (pdfkit, seção por seção) — montados num Buffer só.
 */
export async function renderPdf(input: RenderPdfInput): Promise<Buffer> {
  const template = TEMPLATES[input.documentType];
  // Só a Ata tem o conceito de projeto/data — X1 não, e forçar essa linha
  // (ou uma lacuna pra ela) na capa de uma entrevista seria inventar um
  // campo que o documento não pede.
  const temIdentificacao = template.sections.some((s) => s.id === 'identificacao');

  const conteudoBytes = await renderConteudoPdfkit(input, template);

  const pdfLibDoc = await PDFLibDocument.create();
  await construirCapa(
    pdfLibDoc,
    template.documentTitle ?? template.label,
    input.data,
    input.gaps,
    temIdentificacao,
  );

  const conteudoDoc = await PDFLibDocument.load(conteudoBytes);
  const paginasConteudo = await pdfLibDoc.copyPages(conteudoDoc, conteudoDoc.getPageIndices());
  for (const pagina of paginasConteudo) pdfLibDoc.addPage(pagina);

  pdfLibDoc.setTitle(input.title);

  const bytesFinais = await pdfLibDoc.save();
  return Buffer.from(bytesFinais);
}

// ---------------------------------------------------------------------------
// Capa (pdf-lib)
// ---------------------------------------------------------------------------

/**
 * A capa do modelo, remontada: gráfico sangrado recortado na faixa de baixo,
 * marca preta centralizada no topo, título e subtítulo centralizados.
 *
 * ── Máscara em vez de recorte ──────────────────────────────────────────
 *
 * O modelo limita o gráfico com um `re`+`W* n` (clip). `pdf-lib` não expõe
 * clip no `drawImage`, então aqui o gráfico entra inteiro e um retângulo
 * BRANCO cobre tudo acima da mesma fronteira. O resultado impresso é
 * idêntico — a página é branca de qualquer forma —, e diferente da versão
 * anterior (que mascarava a página do modelo embutida) não sobra texto
 * placeholder escondido sob a máscara: o que está por baixo é imagem.
 *
 * ── Centralizado, e é o que o modelo faz ────────────────────────────────
 *
 * O título do modelo começa em x=183,03 e termina em x=412,25 — centro
 * 297,6, que é metade de 595,28 na casa do décimo. O subtítulo idem. A marca
 * o modelo desenha 13,5pt à direita do centro; aqui ela vai no centro
 * geométrico mesmo, porque esse deslocamento é acidente do arquivo, não
 * regra da identidade, e ele salta aos olhos quando o título abaixo está
 * centrado de verdade.
 */
async function construirCapa(
  pdfLibDoc: PDFLibDocument,
  titulo: string,
  data: DocumentData,
  gaps: Gap[],
  temIdentificacao: boolean,
): Promise<void> {
  const pagina = pdfLibDoc.addPage([A4_LARGURA_PT, A4_ALTURA_PT]);

  const grafico = await pdfLibDoc.embedJpg(capaGraficoBuffer());
  pagina.drawImage(grafico, {
    x: CAPA_GRAFICO_X_PT,
    y: A4_ALTURA_PT - CAPA_GRAFICO_BASE_PT,
    width: CAPA_GRAFICO_LARGURA_PT,
    height: CAPA_GRAFICO_ALTURA_PT,
  });

  const fronteira = A4_ALTURA_PT - CAPA_GRAFICO_RECORTE_TOPO_PT;
  pagina.drawRectangle({
    x: 0,
    y: fronteira,
    width: A4_LARGURA_PT,
    height: A4_ALTURA_PT - fronteira,
    color: rgb(1, 1, 1),
  });

  const logo = await pdfLibDoc.embedPng(marcaBuffer());
  pagina.drawImage(logo, {
    x: (A4_LARGURA_PT - MARCA_CAPA_LARGURA_PT) / 2,
    y: A4_ALTURA_PT - MARCA_CAPA_TOPO_PT - MARCA_CAPA_ALTURA_PT,
    width: MARCA_CAPA_LARGURA_PT,
    height: MARCA_CAPA_ALTURA_PT,
  });

  const fonteNegrito = await pdfLibDoc.embedFont(StandardFonts.HelveticaBold);

  desenharCentralizado(pagina, titulo, {
    fonte: fonteNegrito,
    tamanho: TAMANHO_TITULO_PT,
    base: CAPA_TITULO_BASE_PT,
    cor: TINTA,
  });

  // Subtítulo "{projeto} - {data}", NEGRITO e cinza próprio (não regular,
  // não o cinza da linha do rodapé — confirmado no stream do modelo: `.6 .6
  // .6 rg` com a fonte `/F8`, a mesma do título). Só quando o documento TEM
  // esse conceito. Mesmo fallback de lacuna que o resto do documento usa, pra
  // não sumir em silêncio se faltar.
  if (temIdentificacao) {
    const projeto = data.metadata?.projectName ?? lacunaDe(gaps, 'metadata.projectName');
    const quando = data.metadata?.date ?? lacunaDe(gaps, 'metadata.date');
    desenharCentralizado(pagina, `${projeto} - ${quando}`, {
      fonte: fonteNegrito,
      tamanho: TAMANHO_SUBTITULO_CAPA_PT,
      base: CAPA_SUBTITULO_BASE_PT,
      cor: COR_SUBTITULO_CAPA,
    });
  }
}

/** Centraliza medindo o texto na própria fonte — `pdf-lib` não tem
 *  `align:'center'`, e chutar a largura desalinharia justo o elemento que o
 *  modelo mais depende de estar no eixo. `base` é a linha de base contada a
 *  partir do TOPO da página, como no modelo. */
function desenharCentralizado(
  pagina: ReturnType<PDFLibDocument['addPage']>,
  texto: string,
  opcoes: { fonte: PDFFont; tamanho: number; base: number; cor: string },
): void {
  const largura = opcoes.fonte.widthOfTextAtSize(texto, opcoes.tamanho);
  pagina.drawText(texto, {
    x: (A4_LARGURA_PT - largura) / 2,
    y: A4_ALTURA_PT - opcoes.base,
    size: opcoes.tamanho,
    font: opcoes.fonte,
    color: corPdfLib(opcoes.cor),
  });
}

// ---------------------------------------------------------------------------
// Conteúdo (pdfkit)
// ---------------------------------------------------------------------------

/** Só as páginas de conteúdo — sem capa. `renderPdf` funde isto com a capa
 *  do pdf-lib depois. */
function renderConteudoPdfkit(input: RenderPdfInput, template: DocumentTemplate): Promise<Buffer> {
  // `autoFirstPage: false` porque o construtor do pdfkit cria a página 1
  // ANTES de dar chance de registrar o listener de `pageAdded` abaixo — sem
  // isso a marca e o rodapé sairiam em toda página MENOS a primeira.
  const doc = new PDFDocument({
    size: 'A4',
    autoFirstPage: false,
    margins: {
      top: MARGEM_PT,
      bottom: MARGEM_INFERIOR_PT,
      left: MARGEM_PT,
      right: MARGEM_PT,
    },
  });

  doc.on('pageAdded', () => desenharMoldura(doc));
  doc.addPage();

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const pronto = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const ordenadas = template.sections.slice().sort((a, b) => a.order - b.order);
  for (const section of ordenadas) {
    const spec = specForSection(section);
    const dados = spec.serialize(input.data, section.id);

    // Mesmo teste de vazio que `html.ts`/`escritor.ts` usam — as três saídas
    // precisam concordar sobre quais seções o documento tem.
    if (dados === null && section.omitWhenEmpty) continue;

    const gapsDaSecao = input.gaps.filter((g) => g.sectionId === section.id);

    if (temCabecalho(section.id)) desenharTituloSecao(doc, section.title);

    const textoDesenhado = desenharConteudoSecao(doc, section.id, input.data, gapsDaSecao, dados);
    desenharSobras(doc, gapsDaSecao, textoDesenhado);
  }

  doc.end();
  return pronto;
}

/**
 * Marca no topo e rodapé na base — o que o modelo repete em toda página
 * interna. Desenhado em `pageAdded`, quando o `pdfkit` acabou de zerar o
 * cursor: por isso o cursor é DEVOLVIDO ao canto do texto no fim, senão a
 * primeira linha de conteúdo da página sairia de dentro do rodapé.
 */
function desenharMoldura(doc: Doc): void {
  doc.image(
    marcaBuffer(),
    (A4_LARGURA_PT - MARCA_CABECALHO_LARGURA_PT) / 2,
    MARCA_CABECALHO_TOPO_PT,
    { width: MARCA_CABECALHO_LARGURA_PT, height: MARCA_CABECALHO_ALTURA_PT },
  );

  doc
    .moveTo(RODAPE_LINHA_X_INICIO_PT, RODAPE_LINHA_TOPO_PT)
    .lineTo(RODAPE_LINHA_X_FIM_PT, RODAPE_LINHA_TOPO_PT)
    .lineWidth(1)
    .strokeColor(CINZA_LINHA)
    .stroke();

  // O rodapé mora ABAIXO da margem inferior, e pro `pdfkit` escrever fora da
  // caixa de texto é motivo pra abrir página nova — o que, saindo de
  // `pageAdded`, é recursão infinita (e foi, na primeira versão disto). Zerar
  // a margem enquanto se desenha é o jeito de dizer "este texto não pertence
  // ao fluxo"; ela volta logo abaixo, antes de qualquer conteúdo.
  const margemInferior = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  // Preto, como todo texto do modelo — o cinza é só do traço acima.
  doc.font('Helvetica').fontSize(TAMANHO_RODAPE_PT).fillColor(TINTA);
  RODAPE.forEach((linha, indice) => {
    // `pdfkit` posiciona pelo TOPO da caixa de linha, o modelo dá a linha de
    // base; a ascendente da Helvetica (0,718 em) faz a ponte.
    const topo = RODAPE_TEXTO_BASE_PT + indice * RODAPE_ENTRELINHA_PT - TAMANHO_RODAPE_PT * 0.718;
    doc.text(linha, MARGEM_PT, topo, {
      width: A4_LARGURA_PT - MARGEM_PT * 2,
      align: 'center',
      lineBreak: false,
    });
  });

  doc.page.margins.bottom = margemInferior;
  doc.x = doc.page.margins.left;
  doc.y = doc.page.margins.top;
}

// ── Ritmo vertical ────────────────────────────────────────────────────────
//
// Cada desenhador abaixo DEIXA o cursor no começo do próximo bloco: quem
// desenha um parágrafo empurra `GAP_PARAGRAFO_PT`, quem abre uma lista
// empurra `GAP_ANTES_DA_LISTA_PT`. Concentrar isso nos desenhadores (em vez
// de um `moveDown` no laço) é o que permite os dois espaços diferentes que o
// modelo usa — e o laço não tem como saber qual deles vale.

/** Folga de linha que o `pdfkit` precisa somar à altura natural da fonte pra
 *  chegar na entrelinha do modelo. A Helvetica ocupa 0,925em entre ascendente
 *  e descendente; o resto até `ENTRELINHA` é o `lineGap`. */
const folgaDeLinha = (tamanho: number): number => tamanho * (ENTRELINHA - 0.925);

/** Opções de fluxo pra um parágrafo de corpo — margem a margem. */
const fluxoDeParagrafo = (tamanho: number) => ({ lineGap: folgaDeLinha(tamanho) });

/**
 * Um item de lista, com o marcador na coluna dele e o texto na coluna do
 * texto: a linha que quebra volta alinhada sob o TEXTO, não sob o marcador,
 * que é o recuo pendente do modelo. `escrever` desenha o conteúdo do item e
 * pode alternar peso à vontade — recebe o cursor já posicionado.
 *
 * ── Por que MEDE antes de desenhar ──────────────────────────────────────
 *
 * Marcador e texto saem em duas chamadas que precisam compartilhar a mesma
 * coordenada de topo, e a segunda restaura `doc.y`. Se o `pdfkit` abrir
 * página entre as duas, esse `doc.y` restaurado é uma coordenada da página
 * ANTERIOR: cai abaixo da margem da página nova, dispara outra quebra, e o
 * item seguinte repete tudo. A primeira versão disto fazia exatamente isso e
 * produzia uma sequência de páginas quase em branco — uma com o "4." sozinho,
 * a seguinte vazia. Medir a altura e quebrar ANTES mantém os dois juntos e
 * ainda evita marcador órfão no pé da página.
 *
 * `textoPlano` é o conteúdo do item sem formatação, só pra medir — `escrever`
 * é que desenha de verdade, com os pesos certos.
 */
function desenharItemDeLista(
  doc: Doc,
  marcador: string,
  textoPlano: string,
  escrever: () => void,
): void {
  const xMarcador = MARGEM_PT + LISTA_MARCADOR_RECUO_PT;
  const xTexto = MARGEM_PT + LISTA_TEXTO_RECUO_PT;
  const fluxo = fluxoDeItem();

  doc.font('Helvetica').fontSize(TAMANHO_ITEM_PT).fillColor(TINTA);
  const altura = doc.heightOfString(textoPlano, fluxo);
  const baseDoTexto = A4_ALTURA_PT - MARGEM_INFERIOR_PT;
  // A segunda condição é a saída para o item mais alto que uma página
  // inteira: aí não existe página onde ele caiba, e abrir uma nova só
  // gastaria papel — deixa o `pdfkit` quebrar no meio dele.
  if (doc.y + altura > baseDoTexto && altura <= baseDoTexto - MARGEM_PT) doc.addPage();

  const topo = doc.y;
  doc.text(marcador, xMarcador, topo, { lineBreak: false, width: xTexto - xMarcador });

  doc.y = topo;
  doc.x = xTexto;
  escrever();
  doc.x = MARGEM_PT;
}

/** Opções de fluxo pro TEXTO de um item — largura reduzida pelo recuo. */
const fluxoDeItem = () => ({
  width: A4_LARGURA_PT - MARGEM_PT - (MARGEM_PT + LISTA_TEXTO_RECUO_PT),
  lineGap: folgaDeLinha(TAMANHO_ITEM_PT),
});

/** Lista de textos simples, um bullet cada — Decisões, Outcomes, Outputs. */
function desenharListaSimples(doc: Doc, textos: string[]): void {
  for (const texto of textos) {
    desenharItemDeLista(doc, '•', texto, () => {
      doc.font('Helvetica').fontSize(TAMANHO_ITEM_PT).fillColor(TINTA).text(texto, fluxoDeItem());
    });
  }
  if (textos.length > 0) doc.y += GAP_PARAGRAFO_PT;
}

function desenharTituloSecao(doc: Doc, titulo: string): void {
  doc
    .font('Helvetica-Bold')
    .fontSize(TAMANHO_SECAO_PT)
    .fillColor(TINTA)
    .text(titulo, fluxoDeParagrafo(TAMANHO_SECAO_PT));
  doc.y += GAP_ANTES_DA_LISTA_PT;
}

/** Rótulo em negrito seguido do valor — "DATA: 13/08/2026". Tamanho de CORPO
 *  (12pt), distinto do de item de lista (11pt); os dois já foram confundidos
 *  numa leitura anterior. Devolve o texto puro pro chamador acumular (ver
 *  `desenharSobras`). */
function linhaRotulada(doc: Doc, rotulo: string, valor: string): string {
  doc
    .font('Helvetica-Bold')
    .fontSize(TAMANHO_CORPO_PT)
    .fillColor(TINTA)
    .text(`${rotulo}: `, { ...fluxoDeParagrafo(TAMANHO_CORPO_PT), continued: true });
  doc.font('Helvetica').text(valor);
  doc.y += GAP_PARAGRAFO_PT;
  return `${rotulo}: ${valor}`;
}

const lacunaDoCampo = (gaps: Gap[], field: string): Gap | undefined =>
  gaps.find((g) => g.field === field);

/** Mesmo fallback de `lacunaDe` em `html.ts`: usa a pergunta da lacuna de
 *  verdade quando existe, senão um marcador genérico com o nome do campo. */
function lacunaDe(gaps: Gap[], field: string): string {
  const gap = lacunaDoCampo(gaps, field);
  return textoDeLacuna(gap ? gap.question : field);
}

/**
 * Só DESENHA a linha DATA — o "{projeto} - {data}" que esta seção também
 * carrega já saiu na capa (`construirCapa`), igual ao modelo (`example.pdf`
 * mostra essa linha uma vez só, embaixo do título, não de novo na página de
 * conteúdo).
 *
 * `projeto` entra no texto DEVOLVIDO mesmo sem ser desenhado aqui — é o que
 * faz `desenharSobras` reconhecer que a lacuna de `metadata.projectName` já
 * apareceu (na capa) e não desenhá-la de novo no fim desta seção.
 */
function desenharIdentificacao(doc: Doc, data: DocumentData, gaps: Gap[]): string {
  const projeto = data.metadata?.projectName ?? lacunaDe(gaps, 'metadata.projectName');
  const quando = data.metadata?.date ?? lacunaDe(gaps, 'metadata.date');
  const linha = linhaRotulada(doc, 'DATA', quando);
  return `${projeto}\n${linha}`;
}

/** "[Nome] – [Cargo]" sai em NEGRITO no modelo — só o marcador "●" fica no
 *  peso normal. Confirmado no stream decodificado (fonte `/F8` no texto do
 *  item, `/F7` só no bullet). */
function desenharParticipantes(doc: Doc, data: DocumentData, gaps: Gap[]): string {
  doc
    .font('Helvetica-Bold')
    .fontSize(TAMANHO_CORPO_PT)
    .fillColor(TINTA)
    .text('PARTICIPANTES – CARGO:', fluxoDeParagrafo(TAMANHO_CORPO_PT));
  doc.y += GAP_ANTES_DA_LISTA_PT;

  const linhas = (data.participants ?? []).map((participante) => {
    const cargo = participante.role ?? lacunaDe(gaps, `participants[${participante.name}].role`);
    return `${participante.name} – ${cargo}`;
  });
  for (const linha of linhas) {
    desenharItemDeLista(doc, '•', linha, () => {
      doc.font('Helvetica-Bold').fontSize(TAMANHO_ITEM_PT).fillColor(TINTA).text(linha, fluxoDeItem());
    });
  }
  doc.y += GAP_PARAGRAFO_PT;

  return `PARTICIPANTES – CARGO:\n${linhas.join('\n')}`;
}

/** "TÓPICO:"/"ANDAMENTO:" — mesmo par rotulado que `identificacao` desenha
 *  pra DATA, espelhando `SECTION_RENDERERS.topico_geral` do HTML. Sem esta
 *  função a seção caía no `default` genérico e perdia o rótulo em negrito. */
function desenharTopicoGeral(doc: Doc, data: DocumentData): string {
  if (!data.generalTopic) return '';
  const linhaTopico = linhaRotulada(doc, 'TÓPICO', data.generalTopic.topic);
  const linhaAndamento = linhaRotulada(doc, 'ANDAMENTO', data.generalTopic.progress);
  return `${linhaTopico}\n${linhaAndamento}`;
}

function desenharAssinatura(doc: Doc, data: DocumentData, gaps: Gap[]): string {
  const fluxo = fluxoDeParagrafo(TAMANHO_CORPO_PT);
  doc
    .font('Helvetica')
    .fontSize(TAMANHO_CORPO_PT)
    .fillColor(TINTA)
    .text('Atenciosamente,', fluxo);

  const nome = data.signature?.name ?? lacunaDe(gaps, 'signature.name');
  const cargo = data.signature?.role ?? lacunaDe(gaps, 'signature.role');
  doc.text(`${nome} – ${cargo}`, fluxo);
  doc.y += GAP_PARAGRAFO_PT;

  return `Atenciosamente,\n${nome} – ${cargo}`;
}

/**
 * Numerada — igual ao modelo e a `SECTION_RENDERERS.topicos_discutidos` do
 * HTML. O genérico (`spec.serialize()`) junta os tópicos com "- ", sem
 * número; cair pro genérico aqui perderia a numeração que o modelo mostra.
 */
function desenharTopicosDiscutidos(doc: Doc, data: DocumentData): string {
  const topicos = data.topicsDiscussed ?? [];
  const linhas: string[] = [];

  topicos.forEach((topico, index) => {
    const plano = `${topico.title}: ${topico.summary}`;
    desenharItemDeLista(doc, `${index + 1}.`, plano, () => {
      doc
        .font('Helvetica-Bold')
        .fontSize(TAMANHO_ITEM_PT)
        .fillColor(TINTA)
        .text(`${topico.title}: `, { ...fluxoDeItem(), continued: true });
      doc.font('Helvetica').text(topico.summary);
    });
    linhas.push(`${index + 1}. ${plano}`);
  });
  if (topicos.length > 0) doc.y += GAP_PARAGRAFO_PT;

  return linhas.join('\n');
}

/**
 * Só `text` — igual a `SECTION_RENDERERS.decisoes` do HTML. `spec.serialize()`
 * inclui confiança e a citação da concordância porque é isso que o Escritor
 * recebe pra redigir com contexto; mas a concordância é evidência da
 * auditoria, não conteúdo da ata, e o markdown do Escritor também não a
 * imprime — cair pro genérico aqui vazaria essa evidência pro documento
 * final, o que o HTML deliberadamente não faz.
 */
function desenharDecisoes(doc: Doc, data: DocumentData): string {
  const textos = (data.decisions ?? []).map((d) => d.text);
  desenharListaSimples(doc, textos);
  return textos.join('\n');
}

/** Outcomes e Outputs — lista de bullets, igual ao `lista(...)` que o HTML
 *  usa nessas duas seções. Sem isto elas caíam no genérico, que despeja o
 *  `spec.serialize()` inteiro como um parágrafo só, com "- " no meio do
 *  texto: mesma informação, mas com cara de rascunho, não de lista. */
function desenharTextosSimples(doc: Doc, itens: ReadonlyArray<{ text: string }>): string {
  const textos = itens.map((i) => i.text);
  desenharListaSimples(doc, textos);
  return textos.join('\n');
}

/**
 * X1 — o conteúdo principal do documento. Mesmo par "Gente e gestão" /
 * "Entrevistado" do HTML (`render/html.ts`, `SECTION_RENDERERS
 * .perguntas_respostas`) — não pode cair pro genérico mais pobre, é
 * literalmente o que o documento é.
 */
function desenharPerguntasRespostas(doc: Doc, data: DocumentData, gaps: Gap[]): string {
  const pares = data.qa ?? [];
  const partes: string[] = [];

  pares.forEach((par, index) => {
    const pergunta = par.pergunta ?? lacunaDe(gaps, `qa[${index}].pergunta`);
    const resposta = par.resposta ?? lacunaDe(gaps, `qa[${index}].resposta`);
    partes.push(linhaRotulada(doc, 'Gente e gestão', pergunta));
    partes.push(linhaRotulada(doc, 'Entrevistado', resposta));
    // Um respiro a MAIS entre um par e o próximo. Sem ele todos os espaços
    // ficam iguais e as seis linhas viram uma lista corrida, sem mostrar
    // qual resposta pertence a qual pergunta — que é a única estrutura que
    // este documento tem. O modelo não decide isto: ele é uma Ata, e não tem
    // par de pergunta e resposta.
    doc.y += GAP_PARAGRAFO_PT;
  });

  return partes.join('\n');
}

/** Dedicada pras seções com tratamento próprio no HTML; as demais caem no
 *  genérico — título (se `temCabecalho`) já foi desenhado por fora, aqui só
 *  o corpo, reaproveitando `spec.serialize()` em vez de duplicar a extração
 *  de cada campo por seção. */
function desenharConteudoSecao(
  doc: Doc,
  sectionId: string,
  data: DocumentData,
  gaps: Gap[],
  dados: string | null,
): string {
  switch (sectionId) {
    case 'identificacao':
      return desenharIdentificacao(doc, data, gaps);
    case 'topico_geral':
      return desenharTopicoGeral(doc, data);
    case 'participantes':
      return desenharParticipantes(doc, data, gaps);
    case 'assinatura':
      return desenharAssinatura(doc, data, gaps);
    case 'topicos_discutidos':
      return desenharTopicosDiscutidos(doc, data);
    case 'decisoes':
      return desenharDecisoes(doc, data);
    case 'outcomes':
      return desenharTextosSimples(doc, data.outcomes ?? []);
    case 'outputs':
      return desenharTextosSimples(doc, data.outputs ?? []);
    case 'perguntas_respostas':
      return desenharPerguntasRespostas(doc, data, gaps);
    default: {
      const texto = dados ?? '';
      if (texto) {
        doc
          .font('Helvetica')
          .fontSize(TAMANHO_CORPO_PT)
          .fillColor(TINTA)
          .text(texto, fluxoDeParagrafo(TAMANHO_CORPO_PT));
        doc.y += GAP_PARAGRAFO_PT;
      }
      return texto;
    }
  }
}

/**
 * Mesmo papel de `pendenciasSoltas()` em `html.ts`: lacuna que nenhum campo
 * mostrou (tipicamente afirmação descartada pelo Auditor, sem campo próprio
 * pra ocupar) vai pro fim da seção em vez de sumir.
 */
function desenharSobras(doc: Doc, gaps: Gap[], jaDesenhado: string): void {
  const soltas = gaps.filter((gap) => !jaDesenhado.includes(gap.question));
  if (soltas.length === 0) return;

  doc.font('Helvetica-Bold').fontSize(TAMANHO_CORPO_PT).fillColor(TINTA);
  for (const gap of soltas) {
    doc.text(textoDeLacuna(gap.question), fluxoDeParagrafo(TAMANHO_CORPO_PT));
  }
  doc.y += GAP_PARAGRAFO_PT;
}
