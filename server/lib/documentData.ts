/**
 * O JSON INTERMEDIÁRIO — `document_data` da especificação.
 *
 * É a camada canônica do documento. O Pensante produz DADOS, não prosa; o
 * Escritor redige a partir daqui; e a renderização da Fase 6 consome isto, e
 * não o markdown. O markdown já perdeu que Maria é participante com cargo de
 * origem `user`; renderizar dele obrigaria a reparsear o que a estrutura já
 * sabia.
 *
 * Duas propriedades sustentam a auditoria:
 *
 * - toda afirmação que entra em seção `audit: 'strict'` carrega as CITAÇÕES
 *   LITERAIS que a sustentam, já localizadas na transcrição bruta. Sem esse
 *   vínculo o Auditor não tem o que conferir;
 * - campo sem evidência fica AUSENTE e vira `Gap`. Nunca preenchido por
 *   inferência — ata com decisão inventada é pior que ata incompleta.
 *
 * A citação é do modelo; o offset é do código (ver `agents/anchoring.ts`).
 * Nunca se pede offset ao modelo: LLM erra offset sistematicamente, e âncora
 * errada é pior que âncora nenhuma porque dá falsa confiança à auditoria.
 */
import type { SectionSpec } from './templates/types';
import type { JsonSchema } from './ai';
import type { LocatedAnchor } from './agents/anchoring';

/** De onde veio o cargo de um participante. Vem do guidance da Ata. */
export type RoleSource = 'meeting' | 'user' | 'unknown';

export type DecisionConfidence = 'high' | 'medium' | 'low';

/**
 * Uma citação que o modelo ALEGA ter copiado da transcrição, mais onde o
 * código a encontrou.
 *
 * `anchor: null` significa que a citação não existe na transcrição nem sob
 * normalização leve. A afirmação é SUSPEITA: ou o modelo alucinou, ou
 * parafraseou onde devia copiar. De um jeito ou de outro ela não sustenta
 * nada — mas a citação é preservada como veio, porque é a evidência do que
 * ele afirmou ter lido.
 */
export interface AnchoredQuote {
  quote: string;
  anchor: LocatedAnchor | null;
}

/** Localizador de citação. Vem de `createLocator(transcript)`. */
export type Locate = (quote: string) => LocatedAnchor | null;

/** Citação bruta do modelo → citação ancorada. Descarta string vazia. */
export function anchorQuotes(raw: unknown, locate: Locate): AnchoredQuote[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((quote): quote is string => typeof quote === 'string' && quote.trim().length > 0)
    .map((quote) => ({ quote, anchor: locate(quote) }));
}

/** As âncoras que realmente se localizaram. É o que o Auditor pode recortar. */
export function located(quotes: AnchoredQuote[] | undefined): LocatedAnchor[] {
  return (quotes ?? [])
    .map((q) => q.anchor)
    .filter((anchor): anchor is LocatedAnchor => anchor !== null);
}

export interface Metadata {
  /** DD/MM/AAAA. Ausente quando não determinável — nunca inventada. */
  date?: string;
  projectName?: string;
}

export interface GeneralTopic {
  /** Nome do tema central. */
  topic: string;
  /** Estado geral do assunto tratado. */
  progress: string;
}

export interface Participant {
  name: string;
  /** Ausente quando não há evidência. Ausência é lacuna, não "desconhecido". */
  role?: string;
  roleSource: RoleSource;
  quotes: AnchoredQuote[];
}

export interface DiscussedTopic {
  title: string;
  summary: string;
  quotes: AnchoredQuote[];
}

export interface Decision {
  text: string;
  /**
   * A citação literal da CONCORDÂNCIA — o que, na reunião, transforma esta
   * proposta em decisão.
   *
   * É um campo próprio, ancorado e obrigatório, e não uma explicação em
   * prosa, por uma razão medida: com a evidência de concordância em prosa, o
   * Auditor recebia só a citação da proposta e tinha de procurar a
   * concordância na folga em volta — numa reunião onde quase toda fala é
   * seguida de "concordo", a folga quase sempre alcança ALGUMA concordância,
   * inclusive de outro assunto. Foi exatamente assim que uma proposta
   * ("avaliar desnormalizações") passou como decisão.
   *
   * Exigindo a concordância ancorada, a pergunta deixa de ser "existe alguma
   * concordância por perto?" e volta a ser "esta fala concorda com esta
   * proposta?". Concordância que não se localiza na transcrição derruba a
   * decisão em CÓDIGO, sem gastar chamada.
   */
  agreement: AnchoredQuote;
  confidence: DecisionConfidence;
  quotes: AnchoredQuote[];
}

export interface Outcome {
  text: string;
  quotes: AnchoredQuote[];
}

export interface Output {
  text: string;
  quotes: AnchoredQuote[];
}

export interface Conclusion {
  text: string;
}

export interface Signature {
  name?: string;
  role?: string;
}

/** Fallback dos templates placeholder (x1, daily, planning, review). */
export interface GenericItem {
  text: string;
  quotes: AnchoredQuote[];
}

export interface DocumentData {
  metadata?: Metadata;
  generalTopic?: GeneralTopic;
  participants?: Participant[];
  topicsDiscussed?: DiscussedTopic[];
  decisions?: Decision[];
  outcomes?: Outcome[];
  outputs?: Output[];
  conclusion?: Conclusion;
  signature?: Signature;
  /** Por seção, para os templates que ainda não têm estrutura própria. */
  generic?: Record<string, GenericItem[]>;
}

/** Campo que não pôde ser preenchido por falta de evidência. */
export interface Gap {
  sectionId: string;
  /** Nome do campo ausente, ex.: `participants[Maria].role`. */
  field: string;
  /** Pergunta objetiva ao usuário. Vem de `askWhenMissing` quando existe. */
  question: string;
  why: string;
}

/**
 * O texto da lacuna como o leitor do documento a vê.
 *
 * Mora aqui, e não em quem renderiza, porque markdown e HTML saem do MESMO
 * `DocumentData` e precisam mostrar a mesma coisa. Duas construções da mesma
 * frase divergem — e divergir aqui significaria a ata em HTML e a ata em
 * markdown discordarem sobre o que falta.
 */
export function textoDeLacuna(question: string): string {
  return `[A preencher: ${question}]`;
}

// ---------------------------------------------------------------------------
// Afirmações auditáveis
// ---------------------------------------------------------------------------

/**
 * Uma afirmação que o Auditor pode julgar.
 *
 * O Auditor é GENÉRICO de propósito: ele não conhece "participante" nem
 * "decisão", só recebe um texto e as âncoras que o sustentam. Cada seção sabe
 * extrair suas afirmações e sabe removê-las quando rejeitadas — assim
 * acrescentar uma seção nova não obriga a mexer no Auditor.
 */
export interface AuditableClaim {
  /** Identifica a afirmação dentro da seção, para poder removê-la depois. */
  path: string;
  /** A afirmação em linguagem natural, como o Auditor vai lê-la. */
  text: string;
  /** Âncoras já localizadas. Vazio = nada a conferir, e a afirmação cai. */
  anchors: LocatedAnchor[];
  /**
   * Motivo para rejeitar SEM gastar chamada ao modelo. Presente quando o
   * código já sabe que a afirmação não se sustenta — hoje, decisão cuja
   * concordância não foi localizada na transcrição.
   */
  blocker?: string;
}

export interface SectionDataSpec {
  /** Schema que o Pensante deve satisfazer para esta seção. */
  schema: JsonSchema;
  /**
   * Enxerta a resposta do modelo no DocumentData acumulado, ancorando as
   * citações no caminho. `locate` vem da transcrição bruta desta geração.
   */
  merge(data: DocumentData, payload: unknown, sectionId: string, locate: Locate): void;
  /**
   * Afirmações que PODEM ser auditadas nesta seção — capacidade, não política.
   * Quem decide se a auditoria roda é o `audit` do `SectionSpec`, lido por
   * `runSection`. Espelhar a política aqui duplicaria a mesma decisão em dois
   * lugares, e é assim que eles divergem.
   */
  claims(data: DocumentData, sectionId: string): AuditableClaim[];
  /** Remove as afirmações rejeitadas pelo Auditor. */
  drop(data: DocumentData, paths: Set<string>, sectionId: string): void;
  /**
   * Os dados DESTA seção em texto, para o Escritor — ou `null` quando não há
   * nada.
   *
   * `null` é o que decide `omitWhenEmpty`: seção vazia com a marca some do
   * documento em vez de aparecer com um título e nada embaixo. Vive aqui, e
   * não no Escritor, porque saber o que é "vazio" nesta seção é conhecimento
   * da seção — e o Escritor é genérico de propósito.
   *
   * As citações NÃO entram: elas são evidência para a auditoria, não texto
   * para a ata. O Escritor redige a partir dos dados, e não da transcrição.
   */
  serialize(data: DocumentData, sectionId: string): string | null;
  /**
   * Markdown da seção montado em CÓDIGO, sem chamar modelo.
   *
   * Presente só onde a seção é pura estrutura — Identificação, Participantes,
   * Assinatura. Ali o Escritor não tem prosa para escrever: ele receberia uma
   * lista de nomes e devolveria a mesma lista de nomes. A chamada seria custo
   * pago por nada e risco de graça, porque um modelo que reescreve uma lista
   * de participantes pode perder um nome ou trocar um acento — e ninguém
   * confere lista de nome.
   *
   * Ausente = a seção tem prosa de verdade e vai para o Escritor.
   */
  renderPlain?(data: DocumentData, sectionId: string, gaps: Gap[]): string;
}

/** O marcador de lacuna em markdown. Igual ao do Escritor, e pelo mesmo
 *  `textoDeLacuna`, para as duas rotas não divergirem. */
function marcador(gap: Gap | undefined, campo: string): string {
  return `**${textoDeLacuna(gap ? gap.question : campo)}**`;
}

const lacunaDoCampo = (gaps: Gap[], field: string): Gap | undefined =>
  gaps.find((g) => g.field === field);

/** Lista para o Escritor, ou `null` quando não sobrou item. */
function bullets(items: string[]): string | null {
  const linhas = items.filter((linha) => linha.trim());
  return linhas.length > 0 ? linhas.map((linha) => `- ${linha}`).join('\n') : null;
}

const QUOTES: JsonSchema = {
  type: 'array',
  items: { type: 'string' },
  description:
    'Citações LITERAIS da transcrição que sustentam esta afirmação, copiadas ' +
    'caractere por caractere. Não parafraseie e não corrija: a citação é ' +
    'procurada na transcrição, e a que não for encontrada invalida a afirmação.',
};

function listSpec(
  key: 'outcomes' | 'outputs',
  itemDescription: string,
): SectionDataSpec {
  return {
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: itemDescription },
              quotes: QUOTES,
            },
            required: ['text', 'quotes'],
          },
        },
      },
      required: ['items'],
    },
    merge(data, payload, _sectionId, locate) {
      data[key] = ((payload as { items?: { text?: string; quotes?: unknown }[] })?.items ?? [])
        .filter((i) => i?.text)
        .map((i) => ({ text: i.text!, quotes: anchorQuotes(i.quotes, locate) }));
    },
    claims(data) {
      return (data[key] ?? []).map((item, index) => ({
        path: `${key}[${index}]`,
        text: item.text,
        anchors: located(item.quotes),
      }));
    },
    drop(data, paths) {
      data[key] = (data[key] ?? []).filter((_, index) => !paths.has(`${key}[${index}]`));
    },
    serialize(data) {
      return bullets((data[key] ?? []).map((item) => item.text));
    },
  };
}

/** Fallback para seção sem estrutura própria — templates placeholder. */
const GENERIC_SPEC: SectionDataSpec = {
  schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            quotes: QUOTES,
          },
          required: ['text', 'quotes'],
        },
      },
    },
    required: ['items'],
  },
  merge(data, payload, sectionId, locate) {
    data.generic ??= {};
    data.generic[sectionId] = (
      (payload as { items?: { text?: string; quotes?: unknown }[] })?.items ?? []
    )
      .filter((i) => i?.text)
      .map((i) => ({ text: i.text!, quotes: anchorQuotes(i.quotes, locate) }));
  },
  claims(data, sectionId) {
    return (data.generic?.[sectionId] ?? []).map((item, index) => ({
      path: `generic.${sectionId}[${index}]`,
      text: item.text,
      anchors: located(item.quotes),
    }));
  },
  drop(data, paths, sectionId) {
    const items = data.generic?.[sectionId];
    if (!items) return;
    data.generic![sectionId] = items.filter(
      (_, index) => !paths.has(`generic.${sectionId}[${index}]`),
    );
  },
  serialize(data, sectionId) {
    return bullets((data.generic?.[sectionId] ?? []).map((item) => item.text));
  },
};

/**
 * Registro por id de seção da Ata. Seção fora daqui cai no genérico — é o que
 * mantém x1, daily, planning e review funcionando sem inventar estrutura que
 * a especificação deles ainda não define.
 */
export const SECTION_DATA_SPECS: Record<string, SectionDataSpec> = {
  identificacao: {
    schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'DD/MM/AAAA. Omita se não determinável.' },
        projectName: { type: 'string', description: 'Omita se não identificável com segurança.' },
      },
      required: [],
    },
    merge(data, payload) {
      const p = (payload ?? {}) as Metadata;
      data.metadata = {
        ...(p.date ? { date: p.date } : {}),
        ...(p.projectName ? { projectName: p.projectName } : {}),
      };
    },
    // `audit: 'light'` — não entra no laço do Auditor.
    claims: () => [],
    drop: () => {},
    serialize(data) {
      return bullets([
        data.metadata?.date ? `Data da reunião: ${data.metadata.date}` : '',
        data.metadata?.projectName ? `Projeto: ${data.metadata.projectName}` : '',
      ]);
    },
    renderPlain(data, _sectionId, gaps) {
      const projeto = data.metadata?.projectName ?? marcador(lacunaDoCampo(gaps, 'metadata.projectName'), 'projeto');
      const quando = data.metadata?.date ?? marcador(lacunaDoCampo(gaps, 'metadata.date'), 'data');
      return [
        '## Identificação',
        '',
        `${projeto} - ${quando}`,
        '',
        `**DATA:** ${quando}`,
      ].join('\n');
    },
  },

  topico_geral: {
    schema: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        progress: { type: 'string' },
      },
      required: ['topic', 'progress'],
    },
    merge(data, payload) {
      const p = (payload ?? {}) as GeneralTopic;
      if (p.topic && p.progress) data.generalTopic = { topic: p.topic, progress: p.progress };
    },
    claims: () => [],
    drop: () => {},
    serialize(data) {
      if (!data.generalTopic) return null;
      return bullets([
        `Tema central: ${data.generalTopic.topic}`,
        `Andamento: ${data.generalTopic.progress}`,
      ]);
    },
  },

  participantes: {
    schema: {
      type: 'object',
      properties: {
        participants: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              role: {
                type: 'string',
                description:
                  'OMITA quando não houver evidência na reunião. Não escreva "desconhecido".',
              },
              roleSource: { type: 'string', enum: ['meeting', 'user', 'unknown'] },
              quotes: QUOTES,
            },
            required: ['name', 'roleSource', 'quotes'],
          },
        },
      },
      required: ['participants'],
    },
    merge(data, payload, _sectionId, locate) {
      data.participants = (
        (payload as { participants?: (Omit<Participant, 'quotes'> & { quotes?: unknown })[] })
          ?.participants ?? []
      )
        .filter((p) => p?.name)
        .map((p) => ({
          name: p.name,
          ...(p.role ? { role: p.role } : {}),
          roleSource: p.role ? (p.roleSource ?? 'meeting') : 'unknown',
          quotes: anchorQuotes(p.quotes, locate),
        }));
    },
    claims(data) {
      return (data.participants ?? []).map((p, index) => ({
        path: `participants[${index}]`,
        // O que se audita é a afirmação inteira: quem participou E qual o
        // cargo. Auditar só o nome deixaria o cargo passar sem conferência,
        // e cargo inventado é o erro que a Ata mais precisa evitar.
        text: p.role
          ? `${p.name} participou da reunião e tem o cargo/papel de ${p.role}.`
          : `${p.name} participou da reunião.`,
        anchors: located(p.quotes),
      }));
    },
    drop(data, paths) {
      data.participants = (data.participants ?? []).filter(
        (_, index) => !paths.has(`participants[${index}]`),
      );
    },
    serialize(data) {
      return bullets(
        (data.participants ?? []).map(
          (p) => `${p.name} — ${p.role ?? 'cargo não determinado'} (origem: ${p.roleSource})`,
        ),
      );
    },
    renderPlain(data, _sectionId, gaps) {
      const linhas = (data.participants ?? []).map((p) => {
        const cargo =
          p.role ?? marcador(lacunaDoCampo(gaps, `participants[${p.name}].role`), `cargo de ${p.name}`);
        return `- ${p.name} – ${cargo}`;
      });
      return ['## Participantes e cargos', '', '**PARTICIPANTES – CARGO:**', '', ...linhas].join('\n');
    },
  },

  topicos_discutidos: {
    schema: {
      type: 'object',
      properties: {
        topics: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              summary: { type: 'string' },
              quotes: QUOTES,
            },
            required: ['title', 'summary', 'quotes'],
          },
        },
      },
      required: ['topics'],
    },
    merge(data, payload, _sectionId, locate) {
      data.topicsDiscussed = (
        (payload as { topics?: { title?: string; summary?: string; quotes?: unknown }[] })?.topics ??
        []
      )
        .filter((t) => t?.title && t?.summary)
        .map((t) => ({
          title: t.title!,
          summary: t.summary!,
          quotes: anchorQuotes(t.quotes, locate),
        }));
    },
    claims: () => [],
    drop: () => {},
    serialize(data) {
      return bullets((data.topicsDiscussed ?? []).map((t) => `${t.title}: ${t.summary}`));
    },
  },

  decisoes: {
    schema: {
      type: 'object',
      properties: {
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'Verbo no infinitivo ou imperativo: Manter, Iniciar, Cancelar, Adiar.',
              },
              agreementQuote: {
                type: 'string',
                description:
                  'A citação LITERAL da fala que ACEITA esta proposta específica — o ' +
                  'martelo batido. Copie da transcrição, caractere por caractere. Se ' +
                  'ninguém aceitou explicitamente ESTA proposta, isto não é uma decisão: ' +
                  'não a inclua na lista. Não use uma concordância genérica nem uma fala ' +
                  'que aceita outro assunto.',
              },
              confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              quotes: QUOTES,
            },
            required: ['text', 'agreementQuote', 'confidence', 'quotes'],
          },
        },
      },
      required: ['decisions'],
    },
    merge(data, payload, _sectionId, locate) {
      data.decisions = (
        (payload as {
          decisions?: {
            text?: string;
            agreementQuote?: string;
            confidence?: DecisionConfidence;
            quotes?: unknown;
          }[];
        })?.decisions ?? []
      )
        .filter((d) => d?.text)
        .map((d) => {
          const agreementQuote = typeof d.agreementQuote === 'string' ? d.agreementQuote : '';
          return {
            text: d.text!,
            agreement: {
              quote: agreementQuote,
              anchor: agreementQuote.trim() ? locate(agreementQuote) : null,
            },
            confidence: d.confidence ?? 'low',
            quotes: anchorQuotes(d.quotes, locate),
          };
        });
    },
    claims(data) {
      return (data.decisions ?? []).map((d, index) => ({
        path: `decisions[${index}]`,
        text: `Foi DECIDIDO na reunião: ${d.text}`,
        // A âncora da concordância entra junto com as da proposta: é ela que
        // o Auditor precisa ler para separar decisão de proposta.
        anchors: located([...(d.quotes ?? []), d.agreement]),
        ...(d.agreement?.anchor
          ? {}
          : {
              blocker: d.agreement?.quote
                ? `A concordância alegada ("${d.agreement.quote}") não existe na transcrição.`
                : 'Nenhuma concordância foi apontada — sem aceitação explícita é proposta, não decisão.',
            }),
      }));
    },
    drop(data, paths) {
      data.decisions = (data.decisions ?? []).filter(
        (_, index) => !paths.has(`decisions[${index}]`),
      );
    },
    serialize(data) {
      // A concordância entra porque o guidance da Ata pede para preservar a
      // concordância explícita do cliente quando houver. É o único lugar em
      // que uma citação chega ao Escritor, e chega como conteúdo pedido pela
      // especificação, não como evidência de auditoria.
      return bullets(
        (data.decisions ?? []).map(
          (d) =>
            `${d.text} (confiança: ${d.confidence}` +
            `${d.agreement?.quote ? `; concordância: "${d.agreement.quote}"` : ''})`,
        ),
      );
    },
  },

  outcomes: listSpec('outcomes', 'Alinhamento ou entendimento produzido pela conversa.'),
  outputs: listSpec('outputs', 'Resultado concreto ou artefato produzido na reunião.'),

  conclusao: {
    schema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Um único parágrafo executivo.' } },
      required: ['text'],
    },
    merge(data, payload) {
      const p = (payload ?? {}) as Conclusion;
      if (p.text) data.conclusion = { text: p.text };
    },
    claims: () => [],
    drop: () => {},
    serialize(data) {
      return data.conclusion?.text ?? null;
    },
  },

  assinatura: {
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Omita se não determinável.' },
        role: { type: 'string', description: 'Omita se não determinável.' },
      },
      required: [],
    },
    merge(data, payload) {
      const p = (payload ?? {}) as Signature;
      data.signature = {
        ...(p.name ? { name: p.name } : {}),
        ...(p.role ? { role: p.role } : {}),
      };
    },
    claims: () => [],
    drop: () => {},
    serialize(data) {
      // Nunca `null`: a assinatura é o fechamento da ata e existe mesmo sem
      // nome — nesse caso ela sai com lacuna, e não sumindo.
      return bullets([
        `Nome de quem assina: ${data.signature?.name ?? '(não determinado)'}`,
        `Cargo de quem assina: ${data.signature?.role ?? '(não determinado)'}`,
      ]);
    },
    renderPlain(data, _sectionId, gaps) {
      const nome = data.signature?.name ?? marcador(lacunaDoCampo(gaps, 'signature.name'), 'quem assina');
      const cargo = data.signature?.role ?? marcador(lacunaDoCampo(gaps, 'signature.role'), 'cargo de quem assina');
      return ['## Assinatura', '', 'Atenciosamente,', '', `${nome} – ${cargo}`].join('\n');
    },
  },
};

export function specForSection(section: SectionSpec): SectionDataSpec {
  return SECTION_DATA_SPECS[section.id] ?? GENERIC_SPEC;
}

export { GENERIC_SPEC };
