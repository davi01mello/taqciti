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
import { fundoCapaBuffer, marcaBuffer, MARCA_ALTURA_PT, MARCA_LARGURA_PT } from './brand';
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
  //
  // "Identificação" existe no template? Só a Ata tem — X1 não tem o conceito
  // de projeto/data, e forçar essa linha (ou uma lacuna pra ela) na capa de
  // uma entrevista seria inventar um campo que o documento não pede.
  const temIdentificacao = template.sections.some((s) => s.id === 'identificacao');
  desenharCapa(doc, template.documentTitle ?? template.label, input.data, input.gaps, temIdentificacao);
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

function desenharCapa(
  doc: Doc,
  titulo: string,
  data: DocumentData,
  gaps: Gap[],
  temIdentificacao: boolean,
): void {
  // Sangrado até a borda, ANTES de qualquer outra coisa — texto e marca
  // desenham por cima. `fundoCapaBuffer()` devolve `null` até alguém
  // exportar o gráfico do modelo pra
  // server/lib/render/assets/fundo-capa.png (cópia de
  // public/assets-docs/ata-de-reuniao/fundo-capa.png); até lá a capa sai só
  // com marca e título, sem quebrar nada.
  const fundo = fundoCapaBuffer();
  if (fundo) {
    const alturaFundo = doc.page.height * 0.45;
    doc.image(fundo, 0, doc.page.height - alturaFundo, {
      width: doc.page.width,
      height: alturaFundo,
    });
  }

  const centroX = doc.page.width / 2;
  doc.image(marcaBuffer(), centroX - MARCA_LARGURA_PT / 2, MARGEM_PT, {
    width: MARCA_LARGURA_PT,
    height: MARCA_ALTURA_PT,
  });

  // Título alinhado à ESQUERDA, não centralizado — é assim que o modelo
  // desenha (conferido visualmente contra `example.pdf`, ver a conversa que
  // motivou este ajuste). Posição vertical aproximada — 38% da altura da
  // página — porque não há coordenada exata extraída do modelo pra isto
  // ainda, só a leitura visual do PDF de referência.
  const larguraConteudo = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc
    .font('Helvetica-Bold')
    .fontSize(TAMANHO_TITULO_PT)
    .fillColor(TINTA)
    .text(titulo, doc.page.margins.left, doc.page.height * 0.38, {
      width: larguraConteudo,
      align: 'left',
    });

  // Subtítulo "{projeto} - {data}", cinza, logo abaixo — só quando o
  // documento TEM esse conceito (a Ata tem; X1 não). Mesmo fallback de
  // lacuna que o resto do documento usa, pra não sumir em silêncio se
  // faltar.
  if (temIdentificacao) {
    const projeto = data.metadata?.projectName ?? lacunaDe(gaps, 'metadata.projectName');
    const quando = data.metadata?.date ?? lacunaDe(gaps, 'metadata.date');
    doc.moveDown(0.2);
    doc
      .font('Helvetica')
      .fontSize(TAMANHO_SUBTITULO_PT)
      .fillColor(TINTA_FRACA)
      .text(`${projeto} - ${quando}`, doc.page.margins.left, doc.y, {
        width: larguraConteudo,
        align: 'left',
      });
  }
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

/**
 * Só DESENHA a linha DATA — o "{projeto} - {data}" que esta seção também
 * carrega já saiu na capa (`desenharCapa`), igual ao modelo (`example.pdf`
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
 * número; cai pro genérico aqui perderia a numeração que o modelo mostra.
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
