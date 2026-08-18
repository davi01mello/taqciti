/**
 * `DocumentData` → HTML, no estilo do modelo institucional da CITi.
 *
 * Renderiza a partir do JSON INTERMEDIÁRIO, nunca do markdown. O markdown já
 * perdeu que Maria é participante com cargo de origem `meeting` e que a
 * decisão tem uma concordância ancorada; renderizar dele obrigaria a
 * reparsear o que a estrutura já sabia, e a reparsear com heurística de
 * texto — que é onde a informação some sem ninguém notar.
 *
 * Pelo mesmo motivo o PDF, quando entrar, sai DESTE `DocumentData` e não
 * deste HTML. Os dois são irmãos, não um derivado do outro.
 *
 * ── De onde vêm as medidas ─────────────────────────────────────────────────
 *
 * De `public/assets-docs/ata-de-reuniao/example.pdf`, extraídas do arquivo e
 * não estimadas: A4 (596×842pt), Arial, texto preto, rodapé em cinza, e a
 * escala tipográfica 44 / 26,7 / 17,3 / 14,7 / 10,7pt. A marca é desenhada em
 * 160,5pt de largura, e é essa a medida usada aqui.
 *
 * ── Estilo INLINE, e não folha de estilo ───────────────────────────────────
 *
 * O destino é o import do Google Docs, que descarta quase toda regra de
 * `<style>` e preserva atributo `style` no elemento. A folha existe só para o
 * `@page` e para quem abre o arquivo no navegador; quem carrega a aparência
 * dentro do Docs é o inline. Escrever nos dois lugares é o preço de o mesmo
 * arquivo servir aos dois destinos.
 *
 * ── O que o Docs NÃO reproduz ──────────────────────────────────────────────
 *
 * Fundo sangrado de página e rodapé repetido em toda página são recursos de
 * página, e HTML não os expressa de um jeito que o conversor entenda. A capa
 * do modelo vira, aqui, um bloco de abertura na MESMA página do conteúdo, e o
 * rodapé institucional aparece uma vez, no fim.
 */
import type { DocumentType } from '../documentTypes';
import { TEMPLATES } from '../templates';
import { specForSection, textoDeLacuna, type DocumentData, type Gap } from '../documentData';
import type { SectionSpec } from '../templates/types';
import { marcaDataUri, MARCA_ALTURA_PT, MARCA_LARGURA_PT } from './brand';

/** Escapa o que vai virar texto. Tudo aqui veio de modelo — um `<` solto
 *  quebraria a estrutura, e um `<script>` seria pior que quebrar. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Tipografia do modelo
// ---------------------------------------------------------------------------

const FAMILIA = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
const TINTA = '#000000';
const TINTA_FRACA = '#888888';

const S = {
  titulo: `font-family:${FAMILIA};font-size:44pt;font-weight:bold;color:${TINTA};text-align:center;margin:0 0 28pt 0;line-height:1.1`,
  subtitulo: `font-family:${FAMILIA};font-size:17.3pt;font-weight:bold;color:${TINTA};text-align:center;margin:0 0 24pt 0`,
  secao: `font-family:${FAMILIA};font-size:26.7pt;font-weight:bold;color:${TINTA};margin:28pt 0 10pt 0;line-height:1.2`,
  corpo: `font-family:${FAMILIA};font-size:14.7pt;color:${TINTA};margin:0 0 10pt 0;line-height:1.45`,
  item: `font-family:${FAMILIA};font-size:14.7pt;color:${TINTA};margin:0 0 6pt 0;line-height:1.45`,
  lista: 'margin:0 0 10pt 0;padding-left:26pt',
  rotulo: 'font-weight:bold',
  rodape: `font-family:${FAMILIA};font-size:10.7pt;color:${TINTA_FRACA};text-align:center;margin:2pt 0;line-height:1.35`,
  lacuna: `font-weight:bold;color:${TINTA}`,
} as const;

const p = (conteudo: string, estilo: string = S.corpo): string =>
  `<p style="${estilo}">${conteudo}</p>`;

const lacuna = (question: string): string =>
  `<span style="${S.lacuna}">${escapeHtml(textoDeLacuna(question))}</span>`;

/** Linha `RÓTULO: valor`, que é como o modelo apresenta data, tópico e
 *  andamento — sem título de seção próprio. */
const linhaRotulada = (rotulo: string, valor: string): string =>
  p(`<span style="${S.rotulo}">${escapeHtml(rotulo)}:</span> ${valor}`);

function lista(itens: string[], ordenada = false): string {
  if (itens.length === 0) return '';
  const tag = ordenada ? 'ol' : 'ul';
  return [
    `<${tag} style="${S.lista}">`,
    ...itens.map((i) => `  <li style="${S.item}">${i}</li>`),
    `</${tag}>`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Seções
// ---------------------------------------------------------------------------

type Lacunas = Gap[];

const daSecao = (gaps: Lacunas, sectionId: string): Gap[] =>
  gaps.filter((g) => g.sectionId === sectionId);

const doCampo = (gaps: Lacunas, field: string): Gap | undefined =>
  gaps.find((g) => g.field === field);

interface SectionRenderer {
  /**
   * false = a seção entra sem título próprio.
   *
   * O modelo não põe cabeçalho em Identificação, Tópico geral, Participantes
   * nem Assinatura: elas aparecem como linhas rotuladas e como o fecho da
   * carta. Só Tópicos discutidos, Decisões, Outcomes, Outputs e Conclusão
   * ganham cabeçalho.
   *
   * É a única divergência deliberada entre o HTML e o markdown do Escritor: o
   * markdown é rascunho de tela e mantém todos os cabeçalhos, para a pessoa
   * saber o que veio de onde. O que NÃO pode divergir — texto de lacuna e
   * regra de seção vazia — está preso por teste.
   */
  cabecalho: boolean;
  render: (data: DocumentData, gaps: Lacunas, section: SectionSpec) => string;
}

export const SECTION_RENDERERS: Record<string, SectionRenderer> = {
  identificacao: {
    cabecalho: false,
    render(data, gaps) {
      const projeto = data.metadata?.projectName;
      const quando = data.metadata?.date;
      return [
        // A linha "Projeto - Data" do modelo, logo abaixo do título.
        p(
          [
            projeto ? escapeHtml(projeto) : lacunaDe(gaps, 'metadata.projectName'),
            quando ? escapeHtml(quando) : lacunaDe(gaps, 'metadata.date'),
          ].join(' - '),
          S.subtitulo,
        ),
        linhaRotulada('DATA', quando ? escapeHtml(quando) : lacunaDe(gaps, 'metadata.date')),
      ].join('\n');
    },
  },

  topico_geral: {
    cabecalho: false,
    render(data) {
      if (!data.generalTopic) return '';
      return [
        linhaRotulada('TÓPICO', escapeHtml(data.generalTopic.topic)),
        linhaRotulada('ANDAMENTO', escapeHtml(data.generalTopic.progress)),
      ].join('\n');
    },
  },

  participantes: {
    cabecalho: false,
    render(data, gaps) {
      const itens = (data.participants ?? []).map((participante) => {
        const cargo = participante.role
          ? escapeHtml(participante.role)
          : lacunaDe(gaps, `participants[${participante.name}].role`);
        return `${escapeHtml(participante.name)} &ndash; ${cargo}`;
      });
      return [p(`<span style="${S.rotulo}">PARTICIPANTES &ndash; CARGO:</span>`), lista(itens)]
        .filter(Boolean)
        .join('\n');
    },
  },

  topicos_discutidos: {
    cabecalho: true,
    // Numerada porque o guidance da Ata pede numeração "para facilitar
    // referência futura", e o modelo também numera.
    render: (data) =>
      lista(
        (data.topicsDiscussed ?? []).map(
          (t) => `<span style="${S.rotulo}">${escapeHtml(t.title)}:</span> ${escapeHtml(t.summary)}`,
        ),
        true,
      ),
  },

  decisoes: {
    cabecalho: true,
    // Só `text`. A concordância ancorada é evidência para a auditoria, não
    // conteúdo da ata — e o markdown do Escritor também não a imprime.
    render: (data) => lista((data.decisions ?? []).map((d) => escapeHtml(d.text))),
  },

  outcomes: {
    cabecalho: true,
    render: (data) => lista((data.outcomes ?? []).map((o) => escapeHtml(o.text))),
  },

  outputs: {
    cabecalho: true,
    render: (data) => lista((data.outputs ?? []).map((o) => escapeHtml(o.text))),
  },

  conclusao: {
    cabecalho: true,
    render: (data) => (data.conclusion ? p(escapeHtml(data.conclusion.text)) : ''),
  },

  assinatura: {
    cabecalho: false,
    render(data, gaps) {
      const nome = data.signature?.name
        ? escapeHtml(data.signature.name)
        : lacunaDe(gaps, 'signature.name');
      const cargo = data.signature?.role
        ? escapeHtml(data.signature.role)
        : lacunaDe(gaps, 'signature.role');
      return [
        p('Atenciosamente,', `${S.corpo};margin-top:28pt`),
        p(`${nome} &ndash; ${cargo}`),
      ].join('\n');
    },
  },

  perguntas_respostas: {
    // Sem <h2> próprio — os pares aparecem como linhas rotuladas, no mesmo
    // estilo de DATA/TÓPICO/ANDAMENTO, não como uma seção narrativa. O
    // documento inteiro do X1 já é isto, então um título de seção por cima
    // seria redundante com o <h1> da abertura.
    cabecalho: false,
    render(data, gaps) {
      const pares = data.qa ?? [];
      return pares
        .map((par, index) => {
          const pergunta = par.pergunta
            ? escapeHtml(par.pergunta)
            : lacunaDe(gaps, `qa[${index}].pergunta`);
          const resposta = par.resposta
            ? escapeHtml(par.resposta)
            : lacunaDe(gaps, `qa[${index}].resposta`);
          return [
            linhaRotulada('Gente e gestão', pergunta),
            linhaRotulada('Entrevistado', resposta),
          ].join('\n');
        })
        .join(`\n<div style="margin:0 0 14pt 0"></div>\n`);
    },
  },
};

const GENERIC_RENDERER: SectionRenderer = {
  cabecalho: true,
  render: (data, _gaps, section) =>
    lista((data.generic?.[section.id] ?? []).map((item) => escapeHtml(item.text))),
};

/**
 * O marcador do campo, ou um marcador genérico quando a lacuna não chegou.
 *
 * O fallback existe porque campo ausente sem lacuna correspondente é possível
 * — `askWhenMissing` vazio faz a seção degradar em silêncio de propósito — e
 * ali o documento ainda precisa mostrar que falta algo. Deixar o campo vazio
 * diria ao leitor que a reunião não tinha aquilo, e não que não se conseguiu
 * determinar.
 */
function lacunaDe(gaps: Lacunas, field: string): string {
  const gap = doCampo(gaps, field);
  return gap ? lacuna(gap.question) : `<span style="${S.lacuna}">${escapeHtml(textoDeLacuna(field))}</span>`;
}

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

/** O rodapé institucional do modelo, palavra por palavra. */
const RODAPE = [
  'Centro Integrado de tecnologia da Informação',
  'Centro de Informática, Universidade Federal de Pernambuco - CIn, UFPE',
];

export interface RenderHtmlInput {
  documentType: DocumentType;
  data: DocumentData;
  /** Lacunas de todas as seções. Cada renderizador filtra as suas. */
  gaps: Gap[];
  /** Título do documento. Vira `<title>` da página. */
  title: string;
}

/**
 * Documento HTML completo, pronto para o `files.create` do Drive ou para a
 * pessoa subir à mão.
 *
 * Completo, e não fragmento, porque é um ARQUIVO que vai ser enviado — um
 * fragmento sem `<meta charset>` chega ao Google Docs com a acentuação
 * quebrada, e "gestão" virando "gestÃ£o" numa ata de cliente é o mesmo
 * defeito que a taxa de âncoras existe para pegar, só que na saída.
 */
export function renderHtml(input: RenderHtmlInput): string {
  const template = TEMPLATES[input.documentType];

  const corpo = template.sections
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((section) => {
      const spec = specForSection(section);
      const renderer = SECTION_RENDERERS[section.id] ?? GENERIC_RENDERER;

      // A MESMA regra de vazio que o Escritor usa (`serialize` devolvendo
      // null). Duas definições de "vazio" fariam o HTML e o markdown
      // discordarem sobre quais seções existem.
      const vazia = spec.serialize(input.data, section.id) === null;
      if (vazia && section.omitWhenEmpty) return '';

      const lacunasDaSecao = daSecao(input.gaps, section.id);
      const conteudo = renderer.render(input.data, lacunasDaSecao, section);
      const cabecalho = renderer.cabecalho
        ? `<h2 style="${S.secao}">${escapeHtml(section.title)}</h2>`
        : '';

      return [cabecalho, conteudo, pendenciasSoltas(lacunasDaSecao, conteudo)]
        .filter(Boolean)
        .join('\n');
    })
    .filter(Boolean)
    .join('\n\n');

  return [
    '<!doctype html>',
    '<html lang="pt-BR">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(input.title)}</title>`,
    '<style>',
    // Só o que o inline não alcança: tamanho de página e margens. O Docs
    // ignora, o navegador e a impressão obedecem.
    '  @page { size: A4; margin: 2.5cm; }',
    `  body { margin: 0; font-family: ${FAMILIA}; color: ${TINTA}; }`,
    '</style>',
    '</head>',
    '<body>',
    blocoDeAbertura(template.documentTitle ?? template.label),
    corpo,
    rodape(),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/**
 * A capa do modelo — folha própria, marca e título centralizados, quebra de
 * página antes do conteúdo.
 *
 * O modelo (`example.pdf`) usa uma página inteira só para isso, sobre um
 * fundo sangrado até a borda. O fundo sangrado não sobrevive a nada fora do
 * PDF — nem impressão, nem importação — e por isso não é reproduzido aqui.
 * A quebra de página (`page-break-after`/`break-after`) sobrevive à
 * impressão e a exportar/imprimir como PDF pelo navegador, que hoje é o
 * caminho mais comum (download do `.html` é o padrão; a entrega direta ao
 * Google Docs está inativa).
 *
 * **Import para o Google Docs continua sem capa própria.** O conversor do
 * Docs descarta `page-break`/`break-after` junto com o resto do que não é
 * atributo `style` inline — uma capa em branco sobrevivendo pela metade
 * (marca certa, sem quebra) seria pior que a capa compactada de antes. Quem
 * for importar pro Docs ainda vê marca + título como abertura da mesma
 * página do conteúdo, não como página própria.
 *
 * `min-height` aproxima a altura útil de uma página A4 (842pt) menos as
 * margens de `@page` (2,5cm ≈ 71pt de cada lado) — o suficiente para a
 * marca e o título ficarem centralizados verticalmente numa impressão ou
 * PDF de uma página só.
 */
function blocoDeAbertura(titulo: string): string {
  return [
    '<div style="page-break-after:always;break-after:page;min-height:700pt;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'text-align:center">',
    `  <img src="${marcaDataUri()}" alt="CITi 30 anos" ` +
      `width="${MARCA_LARGURA_PT}" height="${MARCA_ALTURA_PT}" ` +
      `style="width:${MARCA_LARGURA_PT}pt;height:${MARCA_ALTURA_PT}pt;margin:0 0 24pt 0">`,
    `  <h1 style="${S.titulo};margin:0">${escapeHtml(titulo)}</h1>`,
    '</div>',
  ].join('\n');
}

function rodape(): string {
  return [
    `<div style="margin-top:36pt;padding-top:10pt;border-top:1px solid ${TINTA_FRACA}">`,
    ...RODAPE.map((linha) => `  ${p(escapeHtml(linha), S.rodape)}`),
    '</div>',
  ].join('\n');
}

/**
 * Lacunas que nenhum campo colocou no texto — tipicamente as de afirmação
 * descartada pelo Auditor, que não têm um campo próprio para ocupar.
 *
 * Vão para o fim da seção em vez de sumirem. Mesma decisão do Escritor: fim
 * é pior que o lugar certo, e lacuna colada no parágrafo errado vira
 * afirmação errada.
 */
function pendenciasSoltas(gaps: Gap[], jaRenderizado: string): string {
  const soltas = gaps.filter((gap) => !jaRenderizado.includes(escapeHtml(gap.question)));
  if (soltas.length === 0) return '';
  return soltas.map((gap) => p(lacuna(gap.question))).join('\n');
}
