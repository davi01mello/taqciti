/**
 * `DocumentData` → PDF, irmão de `render/html.ts` — sai do MESMO dado
 * canônico, não de uma conversão do HTML.
 *
 * ── Duas bibliotecas, um propósito cada ──────────────────────────────────
 *
 * `pdfkit` desenha o CONTEÚDO (texto, seção por seção) — é bom nisso e
 * pagina sozinho quando o texto passa da margem. `pdf-lib` monta a CAPA,
 * porque só ele sabe reaproveitar um PDF existente: em vez de tentar
 * redesenhar à mão o gráfico ondulado do modelo (`example.pdf`) — a
 * primeira tentativa foi um gradiente aproximado, e não convenceu —,
 * `pdf-lib` embute o RECORTE de verdade da página do modelo como fundo, e a
 * gente só desenha o título por cima. `pdf-lib` também faz a MONTAGEM final:
 * junta a capa própria com as páginas de conteúdo que o `pdfkit` gerou.
 *
 * ── Paridade com o HTML é ESTRUTURAL, não visual exata ──────────────────
 *
 * Os motores de desenho são diferentes, então não vale a pena perseguir
 * pixel a pixel no CONTEÚDO. O que os três (HTML, PDF, markdown) têm que
 * concordar: mesmas seções, mesma ordem, mesmos rótulos, mesma disciplina de
 * lacuna (nunca omitir em silêncio), mesmo rodapé. Tamanhos de fonte e cores
 * vêm de `./typography.ts`, importado pelos dois motores — é o que impede
 * um ajuste num arquivo de silenciosamente destoar do outro. A CAPA é a
 * exceção: aí a paridade é visual de propósito, porque agora é o gráfico
 * real do modelo, não uma aproximação.
 *
 * ── Helvetica no lugar de Arial ──────────────────────────────────────────
 *
 * Arial não é uma das 14 fontes padrão do PDF; Helvetica é a substituta
 * visualmente quase idêntica e universal em qualquer leitor — mesma escolha
 * que o `font-family` do HTML já faz como fallback.
 *
 * ── Rodapé não fixado na base física da última página ───────────────────
 *
 * Fixar o rodapé no fim de CADA página impressa exigiria um hook por página
 * no `pdfkit`. Simplificação aceita para esta primeira versão: o rodapé
 * institucional sai logo após o conteúdo, não ancorado embaixo da folha.
 */
import PDFDocument from 'pdfkit';
import { PDFDocument as PDFLibDocument, StandardFonts, rgb } from 'pdf-lib';
import type { DocumentType } from '../documentTypes';
import { TEMPLATES } from '../templates';
import type { DocumentTemplate } from '../templates/types';
import { specForSection, textoDeLacuna, type DocumentData, type Gap } from '../documentData';
import { marcaBuffer, MARCA_ALTURA_PT, MARCA_LARGURA_PT } from './brand';
import { modeloAtaBuffer } from './modelo';
import { RODAPE, temCabecalho } from './html';
import {
  TAMANHO_CORPO_PT,
  TAMANHO_RODAPE_PT,
  TAMANHO_SECAO_PT,
  TAMANHO_SUBTITULO_PT,
  TAMANHO_TITULO_PT,
  TINTA,
  TINTA_FRACA,
} from './typography';

/** Igual ao `@page { margin: 2.5cm }` do HTML — 2,5cm em pontos. */
const MARGEM_PT = 2.5 * 28.3465;

/** A4 nos mesmos pontos que o `pdfkit` usa por padrão — a capa (pdf-lib)
 *  precisa ter o tamanho EXATO das páginas de conteúdo (pdfkit), senão o
 *  PDF final mistura tamanhos de página. */
const A4_LARGURA_PT = 595.28;
const A4_ALTURA_PT = 841.89;

type Doc = PDFKit.PDFDocument;

export interface RenderPdfInput {
  documentType: DocumentType;
  data: DocumentData;
  gaps: Gap[];
  title: string;
}

/** `#rrggbb` → `{r,g,b}` 0–1, o formato que `pdf-lib` espera em `rgb(...)`. */
function hexParaRgb01(hex: string): { r: number; g: number; b: number } {
  const limpo = hex.replace('#', '');
  return {
    r: Number.parseInt(limpo.slice(0, 2), 16) / 255,
    g: Number.parseInt(limpo.slice(2, 4), 16) / 255,
    b: Number.parseInt(limpo.slice(4, 6), 16) / 255,
  };
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
// Capa (pdf-lib — reaproveita o gráfico real do modelo)
// ---------------------------------------------------------------------------

/**
 * Constrói a capa como página própria do documento final, embutindo a
 * página INTEIRA de `example.pdf` como fundo e depois MASCARANDO com um
 * retângulo branco tudo acima da faixa do gráfico — é ali que o modelo tem
 * seu próprio título/subtítulo placeholder, texto ESTÁTICO da página
 * original, e sem a máscara ele ficaria visível por baixo do nosso título
 * de verdade.
 *
 * Por que máscara e não `boundingBox` no `embedPage`: o `boundingBox` do
 * `pdf-lib` é referência de ESCALA pro `drawPage`, não recorte visual — a
 * página inteira desenha de qualquer jeito, só reposicionada/redimensionada
 * como se aquele box fosse a página inteira. Testado e confirmado: com
 * `boundingBox` só na faixa do gráfico, o placeholder do modelo ("Ata de
 * reunião [Nome do Projeto]...") ainda aparecia. A máscara branca cobre de
 * verdade, não depende de como o `pdf-lib` interpreta o box.
 *
 * A fração (45% da altura, a partir da base) é leitura visual do modelo,
 * não uma coordenada exata extraída do PDF.
 */
async function construirCapa(
  pdfLibDoc: PDFLibDocument,
  titulo: string,
  data: DocumentData,
  gaps: Gap[],
  temIdentificacao: boolean,
): Promise<void> {
  const modeloDoc = await PDFLibDocument.load(modeloAtaBuffer());
  const [paginaModelo] = modeloDoc.getPages();
  const fundoInteiro = await pdfLibDoc.embedPage(paginaModelo);

  const pagina = pdfLibDoc.addPage([A4_LARGURA_PT, A4_ALTURA_PT]);

  pagina.drawPage(fundoInteiro, {
    x: 0,
    y: 0,
    width: A4_LARGURA_PT,
    height: A4_ALTURA_PT,
  });

  // Máscara: tudo ACIMA da faixa do gráfico vira branco — some o
  // logo/título/subtítulo placeholder do modelo, sobra só a arte ondulada.
  const fracaoGrafico = 0.45;
  const topoGrafico = A4_ALTURA_PT * fracaoGrafico;
  pagina.drawRectangle({
    x: 0,
    y: topoGrafico,
    width: A4_LARGURA_PT,
    height: A4_ALTURA_PT - topoGrafico,
    color: rgb(1, 1, 1),
  });

  const logo = await pdfLibDoc.embedPng(marcaBuffer());
  pagina.drawImage(logo, {
    x: A4_LARGURA_PT / 2 - MARCA_LARGURA_PT / 2,
    y: A4_ALTURA_PT - MARGEM_PT - MARCA_ALTURA_PT,
    width: MARCA_LARGURA_PT,
    height: MARCA_ALTURA_PT,
  });

  const fonteNegrito = await pdfLibDoc.embedFont(StandardFonts.HelveticaBold);
  const fonteRegular = await pdfLibDoc.embedFont(StandardFonts.Helvetica);
  const tinta = hexParaRgb01(TINTA);
  const tintaFraca = hexParaRgb01(TINTA_FRACA);

  // Alinhado à ESQUERDA, não centralizado — é assim que o modelo desenha
  // (conferido visualmente contra `example.pdf`). Posição vertical
  // aproximada, 38% da altura da página a partir do topo — leitura visual,
  // não coordenada exata extraída do modelo.
  const yTitulo = A4_ALTURA_PT - A4_ALTURA_PT * 0.38 - TAMANHO_TITULO_PT * 0.8;
  pagina.drawText(titulo, {
    x: MARGEM_PT,
    y: yTitulo,
    size: TAMANHO_TITULO_PT,
    font: fonteNegrito,
    color: rgb(tinta.r, tinta.g, tinta.b),
  });

  // Subtítulo "{projeto} - {data}", cinza, logo abaixo — só quando o
  // documento TEM esse conceito. Mesmo fallback de lacuna que o resto do
  // documento usa, pra não sumir em silêncio se faltar.
  if (temIdentificacao) {
    const projeto = data.metadata?.projectName ?? lacunaDe(gaps, 'metadata.projectName');
    const quando = data.metadata?.date ?? lacunaDe(gaps, 'metadata.date');
    pagina.drawText(`${projeto} - ${quando}`, {
      x: MARGEM_PT,
      y: yTitulo - TAMANHO_SUBTITULO_PT - 8,
      size: TAMANHO_SUBTITULO_PT,
      font: fonteRegular,
      color: rgb(tintaFraca.r, tintaFraca.g, tintaFraca.b),
    });
  }
}

// ---------------------------------------------------------------------------
// Conteúdo (pdfkit)
// ---------------------------------------------------------------------------

/** Só as páginas de conteúdo — sem capa. `renderPdf` funde isto com a capa
 *  do pdf-lib depois. */
function renderConteudoPdfkit(input: RenderPdfInput, template: DocumentTemplate): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGEM_PT, bottom: MARGEM_PT, left: MARGEM_PT, right: MARGEM_PT },
  });

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
    doc.moveDown(0.6);
    desenharSobras(doc, gapsDaSecao, textoDesenhado);
  }

  desenharRodape(doc);
  doc.end();
  return pronto;
}

function desenharTituloSecao(doc: Doc, titulo: string): void {
  doc.font('Helvetica-Bold').fontSize(TAMANHO_SECAO_PT).fillColor(TINTA).text(titulo);
  doc.moveDown(0.4);
}

/** Rótulo em negrito seguido do valor — "DATA: 13/08/2026". Devolve o texto
 *  puro pro chamador acumular (ver `desenharSobras`). */
function linhaRotulada(doc: Doc, rotulo: string, valor: string): string {
  doc
    .font('Helvetica-Bold')
    .fontSize(TAMANHO_CORPO_PT)
    .fillColor(TINTA)
    .text(`${rotulo}: `, { continued: true });
  doc.font('Helvetica').text(valor);
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

function desenharParticipantes(doc: Doc, data: DocumentData, gaps: Gap[]): string {
  doc.font('Helvetica-Bold').fontSize(TAMANHO_CORPO_PT).fillColor(TINTA).text('PARTICIPANTES – CARGO:');
  doc.font('Helvetica');

  const linhas = (data.participants ?? []).map((participante) => {
    const cargo = participante.role ?? lacunaDe(gaps, `participants[${participante.name}].role`);
    return `${participante.name} – ${cargo}`;
  });
  for (const linha of linhas) doc.text(`•  ${linha}`);

  return `PARTICIPANTES – CARGO:\n${linhas.join('\n')}`;
}

function desenharAssinatura(doc: Doc, data: DocumentData, gaps: Gap[]): string {
  doc.font('Helvetica').fontSize(TAMANHO_CORPO_PT).fillColor(TINTA).text('Atenciosamente,');
  doc.moveDown(0.3);

  const nome = data.signature?.name ?? lacunaDe(gaps, 'signature.name');
  const cargo = data.signature?.role ?? lacunaDe(gaps, 'signature.role');
  doc.text(`${nome} – ${cargo}`);

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
    doc
      .font('Helvetica-Bold')
      .fontSize(TAMANHO_CORPO_PT)
      .fillColor(TINTA)
      .text(`${index + 1}. ${topico.title}: `, { continued: true });
    doc.font('Helvetica').text(topico.summary);
    linhas.push(`${index + 1}. ${topico.title}: ${topico.summary}`);
  });

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
  const decisoes = data.decisions ?? [];
  doc.font('Helvetica').fontSize(TAMANHO_CORPO_PT).fillColor(TINTA);
  for (const decisao of decisoes) doc.text(`•  ${decisao.text}`);
  return decisoes.map((d) => d.text).join('\n');
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
    doc.moveDown(0.5);
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
    case 'participantes':
      return desenharParticipantes(doc, data, gaps);
    case 'assinatura':
      return desenharAssinatura(doc, data, gaps);
    case 'topicos_discutidos':
      return desenharTopicosDiscutidos(doc, data);
    case 'decisoes':
      return desenharDecisoes(doc, data);
    case 'perguntas_respostas':
      return desenharPerguntasRespostas(doc, data, gaps);
    default: {
      const texto = dados ?? '';
      if (texto) doc.font('Helvetica').fontSize(TAMANHO_CORPO_PT).fillColor(TINTA).text(texto);
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
  for (const gap of soltas) doc.text(textoDeLacuna(gap.question));
}

// ---------------------------------------------------------------------------
// Rodapé
// ---------------------------------------------------------------------------

function desenharRodape(doc: Doc): void {
  doc.moveDown(1.5);
  doc.font('Helvetica').fontSize(TAMANHO_RODAPE_PT).fillColor(TINTA_FRACA);
  for (const linha of RODAPE) doc.text(linha, { align: 'center' });
}
