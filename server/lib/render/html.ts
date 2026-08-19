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
 * De `public/assets-docs/ata-de-reuniao/example.pdf`, extraídas do CONTEÚDO
 * REAL do arquivo (stream de página decodificado, não leitura visual): A4
 * (596×842pt), margem de 1in (72pt), Arial, texto preto, rodapé em cinza com
 * linha fina acima, e a escala tipográfica 33 / 20 / 13 / 12 / 11 / 8pt —
 * título da capa, subtítulo da capa, título de seção, rótulo de campo,
 * corpo, rodapé (ver `./typography.ts`, que também documenta o fator ×0,75
 * entre o valor bruto do `Tf` no stream e o pt final). A marca é desenhada
 * em 160,5pt de largura na capa; nas páginas internas o modelo repete uma
 * versão menor no topo, que este HTML não reproduz — ver `blocoDeAbertura`.
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
import { marcaDataUri, MARCA_CAPA_ALTURA_PT, MARCA_CAPA_LARGURA_PT } from './brand';
import {
  CINZA_LINHA,
  COR_SUBTITULO_CAPA,
  TAMANHO_CORPO_PT,
  TAMANHO_ITEM_PT,
  TAMANHO_RODAPE_PT,
  TAMANHO_SECAO_PT,
  TAMANHO_SUBTITULO_CAPA_PT,
  TAMANHO_TITULO_PT,
  TINTA,
} from './typography';

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

const S = {
  titulo: `font-family:${FAMILIA};font-size:${TAMANHO_TITULO_PT}pt;font-weight:bold;color:${TINTA};text-align:center;margin:0;line-height:1.1`,
  // Subtítulo da capa ("[Projeto] - [Data]") — negrito e cinza próprio no
  // modelo, não regular/preto: ver `COR_SUBTITULO_CAPA` em `typography.ts`.
  subtitulo: `font-family:${FAMILIA};font-size:${TAMANHO_SUBTITULO_CAPA_PT}pt;font-weight:bold;color:${COR_SUBTITULO_CAPA};text-align:center;margin:12pt 0 0 0`,
  // Título de seção: alinhado à ESQUERDA. A centralização é da identidade da
  // capa, não das seções internas.
  secao: `font-family:${FAMILIA};font-size:${TAMANHO_SECAO_PT}pt;font-weight:bold;color:${TINTA};text-align:left;margin:28pt 0 10pt 0;line-height:1.2`,
  // Linha rotulada — "DATA:", "TÓPICO:", "ANDAMENTO:", "PARTICIPANTES –
  // CARGO:", "Gente e gestão:", "Entrevistado:". É CORPO (12pt), maior que o
  // item de lista (11pt) — no modelo não é o mesmo texto.
  rotuloLinha: `font-family:${FAMILIA};font-size:${TAMANHO_CORPO_PT}pt;color:${TINTA};margin:0 0 10pt 0;line-height:1.45`,
  corpo: `font-family:${FAMILIA};font-size:${TAMANHO_CORPO_PT}pt;color:${TINTA};margin:0 0 10pt 0;line-height:1.45`,
  item: `font-family:${FAMILIA};font-size:${TAMANHO_ITEM_PT}pt;color:${TINTA};margin:0 0 6pt 0;line-height:1.45`,
  // "[Nome] – [Cargo]" do participante sai em negrito no modelo — só o
  // marcador da lista (nativo do navegador) fica no peso normal.
  itemParticipante: `font-family:${FAMILIA};font-size:${TAMANHO_ITEM_PT}pt;font-weight:bold;color:${TINTA};margin:0 0 6pt 0;line-height:1.45`,
  lista: 'margin:0 0 10pt 0;padding-left:26pt',
  rotulo: 'font-weight:bold',
  // Rodapé em PRETO: no modelo o cinza é só do traço acima dele.
  rodape: `font-family:${FAMILIA};font-size:${TAMANHO_RODAPE_PT}pt;color:${TINTA};text-align:center;margin:2pt 0;line-height:1.35`,
  lacuna: `font-weight:bold;color:${TINTA}`,
} as const;

const p = (conteudo: string, estilo: string = S.corpo): string =>
  `<p style="${estilo}">${conteudo}</p>`;

const lacuna = (question: string): string =>
  `<span style="${S.lacuna}">${escapeHtml(textoDeLacuna(question))}</span>`;

/** Linha `RÓTULO: valor`, que é como o modelo apresenta data, tópico e
 *  andamento — sem título de seção próprio. */
const linhaRotulada = (rotulo: string, valor: string): string =>
  p(`<span style="${S.rotulo}">${escapeHtml(rotulo)}:</span> ${valor}`, S.rotuloLinha);

function lista(itens: string[], ordenada = false, estiloItem: string = S.item): string {
  if (itens.length === 0) return '';
  const tag = ordenada ? 'ol' : 'ul';
  return [
    `<${tag} style="${S.lista}">`,
    ...itens.map((i) => `  <li style="${estiloItem}">${i}</li>`),
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
    // Só a linha DATA. O "Projeto - Data" desta mesma seção é o SUBTÍTULO DA
    // CAPA (ver `subtituloDaCapa`), e no modelo ele aparece uma vez só, sob o
    // título — repeti-lo aqui era divergência, não redundância inofensiva.
    render(data, gaps) {
      const quando = data.metadata?.date;
      return linhaRotulada('DATA', quando ? escapeHtml(quando) : lacunaDe(gaps, 'metadata.date'));
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
      return [
        p(`<span style="${S.rotulo}">PARTICIPANTES &ndash; CARGO:</span>`, S.rotuloLinha),
        lista(itens, false, S.itemParticipante),
      ]
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

/** O rodapé institucional do modelo, palavra por palavra. Exportado porque
 *  `render/pdf.ts` desenha o mesmo rodapé — uma fonte só, pros dois nunca
 *  discordarem do texto oficial. */
export const RODAPE = [
  'Centro Integrado de tecnologia da Informação',
  'Centro de Informática, Universidade Federal de Pernambuco- CIn, UFPE',
];

/** Esta seção ganha `<h2>` no HTML, ou título de seção no PDF? Exportado
 *  pelo mesmo motivo de `RODAPE` — `pdf.ts` precisa da mesma resposta, e
 *  duas listas hardcoded divergem cedo ou tarde. */
export function temCabecalho(sectionId: string): boolean {
  return (SECTION_RENDERERS[sectionId] ?? GENERIC_RENDERER).cabecalho;
}

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

  // Só a Ata tem o conceito de projeto/data — X1 não, e forçar essa linha (ou
  // uma lacuna pra ela) na capa de uma entrevista seria inventar um campo que
  // o documento não pede. Mesma decisão que `render/pdf.ts`.
  const subtitulo = template.sections.some((s) => s.id === 'identificacao')
    ? subtituloDaCapa(input.data, daSecao(input.gaps, 'identificacao'))
    : '';

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

      // A capa conta como já renderizado: a lacuna do nome do projeto sai
      // NELA, e sem isso `pendenciasSoltas` a repetiria no fim da seção.
      return [cabecalho, conteudo, pendenciasSoltas(lacunasDaSecao, subtitulo + conteudo)]
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
    // 1in (72pt) — o modelo traduz cada bloco de texto com x=72 antes de
    // desenhar (ver `./typography.ts` sobre o `cm` de escala do stream); uma
    // primeira leitura tinha assumido 2,5cm.
    '  @page { size: A4; margin: 1in; }',
    `  body { margin: 0; font-family: ${FAMILIA}; color: ${TINTA}; }`,
    '</style>',
    '</head>',
    '<body>',
    blocoDeAbertura(template.documentTitle ?? template.label, subtitulo),
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
 * **A marca NÃO é centralizada por herança de `text-align`.** Ela é bloco com
 * `margin:0 auto`, que centra a CAIXA da imagem no eixo da página. Um `<img>`
 * inline centralizado por `text-align` do pai depende de o pai ocupar a
 * largura toda, e dentro do Docs — que reescreve a árvore — isso é
 * exatamente o tipo de coisa que escorrega pra esquerda.
 *
 * **A vertical é aproximada, a horizontal não.** No modelo a marca fica a
 * 21,6pt do topo da FOLHA, dentro da faixa de cabeçalho; com `@page
 * { margin: 1in }` o HTML não alcança essa faixa, então ela começa na margem
 * e o espaçador abaixo aproxima a distância até o título (linha de base a
 * ~306pt do topo, no modelo). `render/pdf.ts` usa a coordenada exata.
 *
 * **Sem marca repetida no topo das páginas internas.** O modelo repete uma
 * versão menor da marca no cabeçalho de cada página (`render/pdf.ts`
 * reproduz isso via `pageAdded` do `pdfkit`) — HTML não tem o conceito de
 * "topo de cada página impressa" fora de `@page`, que o Docs também
 * descarta. Reproduzir exigiria JS de impressão (`window.print()` com
 * `position:fixed` só funciona em alguns motores) fora do escopo de um
 * arquivo estático.
 */
function blocoDeAbertura(titulo: string, subtitulo: string): string {
  const largura = Math.round(MARCA_CAPA_LARGURA_PT);
  const altura = Math.round(MARCA_CAPA_ALTURA_PT);
  return [
    '<div style="page-break-after:always;break-after:page;min-height:640pt;text-align:center">',
    `  <img src="${marcaDataUri()}" alt="CITi — Centro Integrado de Tecnologia da Informação" ` +
      `width="${largura}" height="${altura}" ` +
      `style="display:block;margin:0 auto;width:${largura}pt;height:${altura}pt">`,
    '  <div style="height:190pt"></div>',
    `  <h1 style="${S.titulo}">${escapeHtml(titulo)}</h1>`,
    subtitulo,
    '</div>',
  ]
    .filter(Boolean)
    .join('\n');
}

/** "[Projeto] - [Data]", o subtítulo que o modelo põe sob o título da CAPA —
 *  não na página de conteúdo. Devolve '' pros tipos de documento sem o
 *  conceito de projeto/data. */
function subtituloDaCapa(data: DocumentData, gaps: Lacunas): string {
  const projeto = data.metadata?.projectName;
  const quando = data.metadata?.date;
  return p(
    [
      projeto ? escapeHtml(projeto) : lacunaDe(gaps, 'metadata.projectName'),
      quando ? escapeHtml(quando) : lacunaDe(gaps, 'metadata.date'),
    ].join(' - '),
    S.subtitulo,
  );
}

/** Linha fina cinza, texto preto — no modelo o cinza é só do traço. */
function rodape(): string {
  return [
    `<div style="margin-top:36pt;padding-top:10pt;border-top:1px solid ${CINZA_LINHA}">`,
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
