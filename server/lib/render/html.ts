/**
 * `DocumentData` → HTML.
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
 * O alvo é o import do Google Docs (Drive API `files.create`), que aceita um
 * subconjunto pequeno de HTML: cabeçalhos, parágrafos, listas, `strong` e
 * `em`. Nada de CSS, classe ou tabela de layout — o que não sobrevive ao
 * import vira ruído no documento do cliente.
 */
import type { DocumentType } from '../documentTypes';
import { TEMPLATES } from '../templates';
import { specForSection, textoDeLacuna, type DocumentData, type Gap } from '../documentData';
import type { SectionSpec } from '../templates/types';

/** Escapa o que vai virar texto. Tudo aqui veio de modelo — um `<` solto
 *  quebraria a estrutura, e um `<script>` seria pior que quebrar. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const lacuna = (question: string): string =>
  `<strong>${escapeHtml(textoDeLacuna(question))}</strong>`;

const p = (conteudo: string): string => `<p>${conteudo}</p>`;

function lista(itens: string[], ordenada = false): string {
  if (itens.length === 0) return '';
  const tag = ordenada ? 'ol' : 'ul';
  return `<${tag}>\n${itens.map((i) => `  <li>${i}</li>`).join('\n')}\n</${tag}>`;
}

/** As lacunas desta seção, na ordem em que vieram. */
type Lacunas = Gap[];

const daSecao = (gaps: Lacunas, sectionId: string): Gap[] =>
  gaps.filter((g) => g.sectionId === sectionId);

const doCampo = (gaps: Lacunas, field: string): Gap | undefined =>
  gaps.find((g) => g.field === field);

type SectionRenderer = (data: DocumentData, gaps: Lacunas, section: SectionSpec) => string;

/**
 * Um renderizador por seção da Ata. Seção fora daqui cai no genérico, que é o
 * que mantém x1, daily, planning e review funcionando sem inventar estrutura
 * que a especificação deles ainda não define.
 */
export const SECTION_RENDERERS: Record<string, SectionRenderer> = {
  identificacao(data, gaps) {
    const data_ = data.metadata?.date;
    const projeto = data.metadata?.projectName;
    return [
      p(`<strong>Data:</strong> ${data_ ? escapeHtml(data_) : lacunaDe(gaps, 'metadata.date')}`),
      p(
        `<strong>Projeto:</strong> ${
          projeto ? escapeHtml(projeto) : lacunaDe(gaps, 'metadata.projectName')
        }`,
      ),
    ].join('\n');
  },

  topico_geral(data) {
    if (!data.generalTopic) return '';
    return [
      p(`<strong>Tópico:</strong> ${escapeHtml(data.generalTopic.topic)}`),
      p(escapeHtml(data.generalTopic.progress)),
    ].join('\n');
  },

  participantes(data, gaps) {
    return lista(
      (data.participants ?? []).map((participante) => {
        const cargo = participante.role
          ? escapeHtml(participante.role)
          : lacunaDe(gaps, `participants[${participante.name}].role`);
        return `${escapeHtml(participante.name)} &ndash; ${cargo}`;
      }),
    );
  },

  topicos_discutidos(data) {
    // Numerada porque o guidance da Ata pede numeração "para facilitar
    // referência futura".
    return lista(
      (data.topicsDiscussed ?? []).map(
        (t) => `<strong>${escapeHtml(t.title)}</strong> &ndash; ${escapeHtml(t.summary)}`,
      ),
      true,
    );
  },

  decisoes(data) {
    // Só `text`. A concordância ancorada é evidência para a auditoria, não
    // conteúdo da ata — e o markdown do Escritor também não a imprime. Os
    // dois formatos precisam dizer a mesma coisa.
    return lista((data.decisions ?? []).map((d) => escapeHtml(d.text)));
  },

  outcomes(data) {
    return lista((data.outcomes ?? []).map((o) => escapeHtml(o.text)));
  },

  outputs(data) {
    return lista((data.outputs ?? []).map((o) => escapeHtml(o.text)));
  },

  conclusao(data) {
    return data.conclusion ? p(escapeHtml(data.conclusion.text)) : '';
  },

  assinatura(data, gaps) {
    const nome = data.signature?.name
      ? escapeHtml(data.signature.name)
      : lacunaDe(gaps, 'signature.name');
    const cargo = data.signature?.role
      ? escapeHtml(data.signature.role)
      : lacunaDe(gaps, 'signature.role');
    return [p('Atenciosamente,'), p(`${nome} &ndash; ${cargo}`)].join('\n');
  },
};

const GENERIC_RENDERER: SectionRenderer = (data, _gaps, section) =>
  lista((data.generic?.[section.id] ?? []).map((item) => escapeHtml(item.text)));

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
  return gap ? lacuna(gap.question) : `<strong>${escapeHtml(textoDeLacuna(field))}</strong>`;
}

export interface RenderHtmlInput {
  documentType: DocumentType;
  data: DocumentData;
  /** Lacunas de todas as seções. Cada renderizador filtra as suas. */
  gaps: Gap[];
  /** Título do documento. Vira `<title>` e `<h1>`. */
  title: string;
}

/**
 * Documento HTML completo, pronto para o `files.create` do Drive.
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
      const lacunasDaSecao = daSecao(input.gaps, section.id);
      if (vazia && section.omitWhenEmpty) return '';

      const conteudo = renderer(input.data, lacunasDaSecao, section);
      const pendencias = pendenciasSoltas(lacunasDaSecao, conteudo);

      return [`<h2>${escapeHtml(section.title)}</h2>`, conteudo, pendencias]
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
    '</head>',
    '<body>',
    `<h1>${escapeHtml(input.title)}</h1>`,
    corpo,
    '</body>',
    '</html>',
    '',
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
