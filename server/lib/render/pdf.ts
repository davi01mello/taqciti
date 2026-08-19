/**
 * `DocumentData` → PDF, irmão de `render/html.ts` — sai do MESMO dado
 * canônico, não de uma conversão do HTML. Ver a discussão da escolha
 * (`pdfkit` nativo em vez de imprimir o HTML com um navegador headless) em
 * `docs/HANDOFF.md`.
 *
 * ── Paridade com o HTML é ESTRUTURAL, não visual exata ──────────────────────
 *
 * Os dois motores de desenho são diferentes (CSS/navegador vs. `pdfkit`
 * imperativo), então não vale a pena perseguir pixel a pixel. O que os dois
 * têm que concordar: mesmas seções, mesma ordem, mesmos rótulos, mesma
 * disciplina de lacuna (nunca omitir em silêncio), mesma capa, mesmo rodapé.
 * Tamanhos de fonte e cores vêm de `./typography.ts`, importado pelos dois —
 * é o que impede um ajuste num arquivo de silenciosamente destoar do outro.
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
import type { DocumentType } from '../documentTypes';
import { TEMPLATES } from '../templates';
import { specForSection, textoDeLacuna, type DocumentData, type Gap } from '../documentData';
import { marcaBuffer, MARCA_ALTURA_PT, MARCA_LARGURA_PT } from './brand';
import { RODAPE, temCabecalho } from './html';
import {
  TAMANHO_CORPO_PT,
  TAMANHO_RODAPE_PT,
  TAMANHO_SECAO_PT,
  TAMANHO_TITULO_PT,
  TINTA,
  TINTA_FRACA,
} from './typography';

/** Igual ao `@page { margin: 2.5cm }` do HTML — 2,5cm em pontos. */
const MARGEM_PT = 2.5 * 28.3465;

type Doc = PDFKit.PDFDocument;

export interface RenderPdfInput {
  documentType: DocumentType;
  data: DocumentData;
  gaps: Gap[];
  title: string;
}

/**
 * Documento PDF completo, pronto pra download.
 *
 * `pdfkit` é baseado em stream: o Buffer só fecha quando o evento `end`
 * dispara, depois de `doc.end()` — por isso a assinatura é assíncrona.
 */
export function renderPdf(input: RenderPdfInput): Promise<Buffer> {
  const template = TEMPLATES[input.documentType];

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGEM_PT, bottom: MARGEM_PT, left: MARGEM_PT, right: MARGEM_PT },
    // Metadado do arquivo (aparece nas propriedades do PDF no leitor/SO) —
    // equivalente ao <title> do HTML, mesmo campo de entrada.
    info: { Title: input.title },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const pronto = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // Mesma fonte que blocoDeAbertura() em html.ts: o título da capa é o do
  // TIPO de documento, não o `input.title` (que carrega o nome específico da
  // reunião/entrevista) — os dois motores precisam concordar sobre isso.
  desenharCapa(doc, template.documentTitle ?? template.label);
  doc.addPage();

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

// ---------------------------------------------------------------------------
// Capa
// ---------------------------------------------------------------------------

function desenharCapa(doc: Doc, titulo: string): void {
  const alturaBloco = MARCA_ALTURA_PT + 24 + TAMANHO_TITULO_PT * 1.2;
  const y = Math.max(MARGEM_PT, (doc.page.height - alturaBloco) / 2);
  const centroX = doc.page.width / 2;

  doc.image(marcaBuffer(), centroX - MARCA_LARGURA_PT / 2, y, {
    width: MARCA_LARGURA_PT,
    height: MARCA_ALTURA_PT,
  });

  doc
    .font('Helvetica-Bold')
    .fontSize(TAMANHO_TITULO_PT)
    .fillColor(TINTA)
    .text(titulo, doc.page.margins.left, y + MARCA_ALTURA_PT + 24, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: 'center',
    });
}

// ---------------------------------------------------------------------------
// Seções
// ---------------------------------------------------------------------------

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

function desenharIdentificacao(doc: Doc, data: DocumentData, gaps: Gap[]): string {
  const projeto = data.metadata?.projectName ?? lacunaDe(gaps, 'metadata.projectName');
  const quando = data.metadata?.date ?? lacunaDe(gaps, 'metadata.date');

  doc
    .font('Helvetica-Bold')
    .fontSize(TAMANHO_CORPO_PT + 2.6)
    .fillColor(TINTA)
    .text(`${projeto} - ${quando}`, { align: 'center' });
  doc.moveDown(0.3);

  const linha = linhaRotulada(doc, 'DATA', quando);
  return `${projeto} - ${quando}\n${linha}`;
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
