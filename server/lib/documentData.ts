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
 * - toda afirmação que entra em seção `audit: 'strict'` carrega os `id` dos
 *   `CompactedStatement` que a sustentam. Sem esse vínculo o Auditor não tem
 *   o que conferir;
 * - campo sem evidência fica AUSENTE e vira `Gap`. Nunca preenchido por
 *   inferência — ata com decisão inventada é pior que ata incompleta.
 */
import type { SectionSpec } from './templates/types';
import type { JsonSchema } from './ai';

/** De onde veio o cargo de um participante. Vem do guidance da Ata. */
export type RoleSource = 'meeting' | 'user' | 'unknown';

export type DecisionConfidence = 'high' | 'medium' | 'low';

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
  statementIds: string[];
}

export interface DiscussedTopic {
  title: string;
  summary: string;
  statementIds: string[];
}

export interface Decision {
  text: string;
  /**
   * O que, na reunião, torna isto uma DECISÃO e não uma proposta — tipicamente
   * a concordância explícita. Não é a citação (essa se obtém pelo
   * `statementIds`): é a razão pela qual o martelo foi batido, que é
   * exatamente o que o Auditor precisa julgar.
   */
  evidence: string;
  confidence: DecisionConfidence;
  statementIds: string[];
}

export interface Outcome {
  text: string;
  statementIds: string[];
}

export interface Output {
  text: string;
  statementIds: string[];
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
  statementIds: string[];
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

// ---------------------------------------------------------------------------
// Afirmações auditáveis
// ---------------------------------------------------------------------------

/**
 * Uma afirmação que o Auditor pode julgar.
 *
 * O Auditor é GENÉRICO de propósito: ele não conhece "participante" nem
 * "decisão", só recebe um texto e os ids que o sustentam. Cada seção sabe
 * extrair suas afirmações e sabe removê-las quando rejeitadas — assim
 * acrescentar uma seção nova não obriga a mexer no Auditor.
 */
export interface AuditableClaim {
  /** Identifica a afirmação dentro da seção, para poder removê-la depois. */
  path: string;
  /** A afirmação em linguagem natural, como o Auditor vai lê-la. */
  text: string;
  statementIds: string[];
}

export interface SectionDataSpec {
  /** Schema que o Pensante deve satisfazer para esta seção. */
  schema: JsonSchema;
  /** Enxerta a resposta do modelo no DocumentData acumulado. */
  merge(data: DocumentData, payload: unknown, sectionId: string): void;
  /**
   * Afirmações que PODEM ser auditadas nesta seção — capacidade, não política.
   * Quem decide se a auditoria roda é o `audit` do `SectionSpec`, lido por
   * `runSection`. Espelhar a política aqui duplicaria a mesma decisão em dois
   * lugares, e é assim que eles divergem.
   */
  claims(data: DocumentData, sectionId: string): AuditableClaim[];
  /** Remove as afirmações rejeitadas pelo Auditor. */
  drop(data: DocumentData, paths: Set<string>, sectionId: string): void;
}

const STATEMENT_IDS: JsonSchema = {
  type: 'array',
  items: { type: 'string' },
  description: 'ids dos statements do contexto compactado que sustentam esta afirmação',
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
              statementIds: STATEMENT_IDS,
            },
            required: ['text', 'statementIds'],
          },
        },
      },
      required: ['items'],
    },
    merge(data, payload) {
      data[key] = ((payload as { items?: Outcome[] })?.items ?? []).filter((i) => i?.text);
    },
    claims(data) {
      return (data[key] ?? []).map((item, index) => ({
        path: `${key}[${index}]`,
        text: item.text,
        statementIds: item.statementIds ?? [],
      }));
    },
    drop(data, paths) {
      data[key] = (data[key] ?? []).filter((_, index) => !paths.has(`${key}[${index}]`));
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
            statementIds: STATEMENT_IDS,
          },
          required: ['text', 'statementIds'],
        },
      },
    },
    required: ['items'],
  },
  merge(data, payload, sectionId) {
    data.generic ??= {};
    data.generic[sectionId] = ((payload as { items?: GenericItem[] })?.items ?? []).filter(
      (i) => i?.text,
    );
  },
  claims(data, sectionId) {
    return (data.generic?.[sectionId] ?? []).map((item, index) => ({
      path: `generic.${sectionId}[${index}]`,
      text: item.text,
      statementIds: item.statementIds ?? [],
    }));
  },
  drop(data, paths, sectionId) {
    const items = data.generic?.[sectionId];
    if (!items) return;
    data.generic![sectionId] = items.filter(
      (_, index) => !paths.has(`generic.${sectionId}[${index}]`),
    );
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
              statementIds: STATEMENT_IDS,
            },
            required: ['name', 'roleSource', 'statementIds'],
          },
        },
      },
      required: ['participants'],
    },
    merge(data, payload) {
      data.participants = ((payload as { participants?: Participant[] })?.participants ?? [])
        .filter((p) => p?.name)
        .map((p) => ({
          name: p.name,
          ...(p.role ? { role: p.role } : {}),
          roleSource: p.role ? (p.roleSource ?? 'meeting') : 'unknown',
          statementIds: p.statementIds ?? [],
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
        statementIds: p.statementIds ?? [],
      }));
    },
    drop(data, paths) {
      data.participants = (data.participants ?? []).filter(
        (_, index) => !paths.has(`participants[${index}]`),
      );
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
              statementIds: STATEMENT_IDS,
            },
            required: ['title', 'summary', 'statementIds'],
          },
        },
      },
      required: ['topics'],
    },
    merge(data, payload) {
      data.topicsDiscussed = ((payload as { topics?: DiscussedTopic[] })?.topics ?? []).filter(
        (t) => t?.title && t?.summary,
      );
    },
    claims: () => [],
    drop: () => {},
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
              evidence: {
                type: 'string',
                description:
                  'O que na reunião torna isto uma decisão e não uma proposta — tipicamente a concordância explícita.',
              },
              confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              statementIds: STATEMENT_IDS,
            },
            required: ['text', 'evidence', 'confidence', 'statementIds'],
          },
        },
      },
      required: ['decisions'],
    },
    merge(data, payload) {
      data.decisions = ((payload as { decisions?: Decision[] })?.decisions ?? []).filter(
        (d) => d?.text,
      );
    },
    claims(data) {
      return (data.decisions ?? []).map((d, index) => ({
        path: `decisions[${index}]`,
        text: `Foi DECIDIDO na reunião: ${d.text}${d.evidence ? ` (evidência alegada: ${d.evidence})` : ''}`,
        statementIds: d.statementIds ?? [],
      }));
    },
    drop(data, paths) {
      data.decisions = (data.decisions ?? []).filter(
        (_, index) => !paths.has(`decisions[${index}]`),
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
  },
};

export function specForSection(section: SectionSpec): SectionDataSpec {
  return SECTION_DATA_SPECS[section.id] ?? GENERIC_SPEC;
}

export { GENERIC_SPEC };
