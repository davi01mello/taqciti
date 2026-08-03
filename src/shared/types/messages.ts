/**
 * Contratos de mensageria entre content script, background e UIs.
 * Toda mensagem é validada em runtime com zod nas duas pontas — nada de `any`
 * atravessando fronteiras de contexto.
 */
import { z } from 'zod';

export const participantSchema = z.object({
  name: z.string().min(1).max(120),
  isHost: z.boolean().nullable(),
  providerParticipantId: z.string().max(200).optional(),
  firstSeenAt: z.number().int().nonnegative().optional(),
  lastSeenAt: z.number().int().nonnegative().optional(),
  source: z.enum(['meet_tile', 'meet_roster']).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const speakerObservationSchema = z.object({
  name: z.string().min(1).max(120),
  firstSeenAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative(),
  source: z.literal('caption'),
  confidence: z.number().min(0).max(1),
  matchedParticipant: z.boolean(),
});

const meetAccountContextSchema = z.object({
  email: z.string().email(),
  displayName: z.string().max(120).nullable(),
  observedAt: z.number().int().nonnegative(),
  source: z.literal('meet_account_control'),
  confidence: z.number().min(0).max(1),
});

const accountBoundarySchema = z.object({
  meet: meetAccountContextSchema.nullable(),
  product: z
    .object({
      tenantId: z.string().max(120),
      userId: z.string().max(120),
      email: z.string().email(),
      name: z.string().max(120),
    })
    .nullable(),
  mismatch: z.boolean(),
});

export const captionChunkSchema = z.object({
  captionId: z.string().min(1).max(64),
  speaker: z.string().max(120).nullable(),
  text: z.string().max(4000),
  atMs: z.number().int().nonnegative(),
});

const liveSegmentSchema = z.object({
  captionId: z.string(),
  speaker: z.string().nullable(),
  text: z.string(),
  startOffsetMs: z.number(),
  endOffsetMs: z.number(),
});

export const meetingPhaseSchema = z.enum([
  'idle',
  'captionsRequired',
  'recording',
  'paused',
  'ended',
  'sent',
]);

export const sessionStateSchema = z.object({
  meetingId: z.string(),
  meetingCode: z.string(),
  provider: z.string(),
  title: z.string(),
  titleAuto: z.boolean().optional(),
  tabId: z.number().nullable(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  captionsEnabled: z.boolean(),
  participants: z.array(participantSchema),
  presentNow: z.array(participantSchema).default([]),
  speakersObserved: z.array(speakerObservationSchema).default([]),
  accountBoundary: accountBoundarySchema.optional(),
  segments: z.array(liveSegmentSchema),
  sealedCaptionIds: z.array(z.string()),
  droppedSegments: z.number(),
  reconnectCount: z.number(),
  captureDegradedCount: z.number().int().nonnegative().default(0),
  lastChunkAt: z.number().int().nonnegative().nullable().default(null),
  wasDiscardedAndRestarted: z.boolean(),
  commercialConfidence: z.number().nullable(),
});

export const meetingStateSchema = z.object({
  phase: meetingPhaseSchema,
  session: sessionStateSchema.nullable(),
});

/** Mensagens do content script → background. */
const contentMessages = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('meet/detected'),
    meetingCode: z.string().min(1).max(64),
    title: z.string().max(300),
    captionsEnabled: z.boolean(),
  }),
  z.object({ type: z.literal('meet/ended') }),
  z.object({ type: z.literal('meet/captions'), enabled: z.boolean() }),
  z.object({ type: z.literal('meet/chunk'), chunk: captionChunkSchema }),
  z.object({
    type: z.literal('meet/participants'),
    participants: z.array(participantSchema).max(200),
  }),
  z.object({
    type: z.literal('meet/accountContext'),
    context: meetAccountContextSchema.nullable(),
  }),
  /** Duas grafias eram a mesma pessoa: corrige a transcrição já capturada. */
  z.object({
    type: z.literal('meet/speakersMerged'),
    renames: z
      .array(z.object({ from: z.string().min(1).max(120), to: z.string().min(1).max(120) }))
      .max(50),
  }),
  z.object({ type: z.literal('meet/reconnect') }),
  z.object({
    type: z.literal('meet/captureDegraded'),
    reason: z.enum(['parser', 'stall']),
  }),
  z.object({ type: z.literal('panel/openRequest') }),
]);

/**
 * A CONFIGURAÇÃO PERMANENTE da oportunidade — as respostas do Fluxo A.
 *
 * Nada aqui é opcional por design, ao contrário do formulário antigo: a
 * configuração é gravada uma vez e nunca mais perguntada, então não pode nascer
 * pela metade. Quem valida a navegação é `features/opportunity/flow.ts`.
 */
export const opportunityConfigSchema = z.object({
  service: z.enum(['discovery', 'delivery', 'synerg', 'indefinido', 'outro']),
  serviceOther: z.string().max(200).nullable(),
  /** Resposta humana explícita. Nunca inferida da conversa. */
  needsTechnical: z.boolean(),
  areas: z.array(z.enum(['dados', 'desenvolvimento', 'produto'])),
  areaOther: z.string().max(200).nullable(),
  coverageAtCreation: z
    .enum(['so_qualificacao', 'qualificacao_diagnostico_incompleto', 'qualificacao_diagnostico'])
    .nullable(),
  by: z.string().max(120).nullable(),
});

/**
 * O formato ANTIGO das respostas (uma por reunião, tudo nullable). Continua
 * aceito para oportunidades criadas antes da configuração permanente.
 */
export const flowHumanInputSchema = z.object({
  coverage: z
    .enum(['so_qualificacao', 'qualificacao_diagnostico_incompleto', 'qualificacao_diagnostico'])
    .nullable(),
  needsTechnical: z.boolean().nullable(),
  areas: z.array(z.enum(['dados', 'desenvolvimento', 'produto'])).nullable(),
  areaOther: z.string().max(200).nullable(),
  /** Os serviços do Fluxo A. `synerg` e `indefinido` entraram com ele. */
  direction: z
    .enum(['discovery', 'delivery', 'synerg', 'indefinido', 'outro'])
    .nullable(),
  directionOther: z.string().max(200).nullable(),
  by: z.string().max(120).nullable(),
});

export type OpportunityConfigMessage = z.infer<typeof opportunityConfigSchema>;

/**
 * A PRÓXIMA AÇÃO da oportunidade. Discriminada por `kind` desde já: follow-up,
 * envio de proposta e lembrete entram como variantes novas, sem quebrar o que
 * já estiver gravado.
 */
export const nextActionSchema = z.object({
  kind: z.literal('reuniao'),
  status: z.enum(['confirmada', 'nao_definida']),
  scheduledAt: z.string().datetime({ offset: true }).nullable(),
  timezone: z.string().max(64).nullable(),
  objective: z
    .enum([
      'qualificacao',
      'diagnostico',
      'diagnostico_tecnico',
      'apresentacao_proposta',
      'negociacao',
      'outro',
    ])
    .nullable(),
  source: z.enum(['transcricao', 'humano']),
  evidence: z.string().max(500).nullable(),
  /** Campo legado. A autoria real é sempre imposta pelo backend autenticado. */
  organizerEmail: z.string().max(200).nullable().optional(),
});

/** O que o envio ao Flow carrega além da transcrição. */
export const flowSendSchema = z.object({
  /** Sem organização não há envio: é a chave do card no CRM. */
  companyName: z.string().min(1).max(200),
  clientOrganizationId: z.string().uuid().nullable().optional(),
  /**
   * Oportunidade existente: é o Fluxo B. Quando presente, `config` vem null —
   * a configuração já existe no Flow e não pode ser reescrita.
   */
  targetRunId: z.string().max(80).nullable(),
  expectedOpportunityVersion: z.number().int().nonnegative().optional(),
  /** Fluxo A: a configuração que nasce com a oportunidade. */
  config: opportunityConfigSchema.nullable(),
  /** Rótulo da reunião dentro do negócio ("Diagnóstico técnico"). */
  meetingLabel: z.string().max(80).nullable().optional(),
  /** O próximo compromisso, confirmado no último passo do fluxo. */
  nextAction: nextActionSchema.nullable().optional(),
});

export type FlowSendData = z.infer<typeof flowSendSchema>;

/** Mensagens das UIs (popup / side panel / painel no Meet) → background. */
const uiMessages = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ui/getState') }),
  z.object({ type: z.literal('ui/pause') }),
  z.object({ type: z.literal('ui/resume') }),
  z.object({ type: z.literal('ui/clearTranscript') }),
  z.object({ type: z.literal('ui/finish') }),
  z.object({ type: z.literal('ui/rename'), title: z.string().min(1).max(200) }),
  z.object({ type: z.literal('ui/send'), flow: flowSendSchema }),
  z.object({ type: z.literal('ui/reset') }),
  z.object({ type: z.literal('ui/history/delete'), id: z.string() }),
  z.object({
    type: z.literal('ui/history/rename'),
    id: z.string(),
    title: z.string().min(1).max(200),
  }),
  z.object({ type: z.literal('ui/history/send'), id: z.string(), flow: flowSendSchema }),
  z.object({ type: z.literal('ui/meeting/reprocess'), id: z.string().uuid() }),
  /** Negócios vivos no Flow, para anexar a reunião ao certo. */
  z.object({ type: z.literal('ui/openRuns') }),
  /** Organizações conhecidas — a busca do passo 1 filtra em memória. */
  z.object({ type: z.literal('ui/organizations') }),
  z.object({ type: z.literal('ui/auth/me') }),
  z.object({ type: z.literal('ui/auth/link'), code: z.string().trim().min(8).max(32) }),
  z.object({ type: z.literal('ui/auth/logout') }),
  /** O contexto do Fluxo B: config e variáveis, para NÃO reperguntar nada. */
  z.object({ type: z.literal('ui/runContext'), runId: z.string().min(1).max(80) }),
  /**
   * REFAZ a leitura rápida com o contexto da oportunidade.
   *
   * A leitura disparada no fim da reunião roda sem contexto — a organização
   * ainda não foi escolhida. Quando ela é escolhida e tem oportunidade aberta, a
   * leitura anterior deixa de valer: foi produzida sob a premissa de que a
   * oportunidade não tem diagnóstico técnico. Esta mensagem a invalida e refaz.
   */
  z.object({
    type: z.literal('ui/refazerLeitura'),
    config: opportunityConfigSchema.nullable(),
  }),
  /**
   * O resultado da leitura rápida desta reunião. A tela pergunta; ela não
   * dispara nada — quem dispara é o fim da reunião, e a resposta pode ser
   * "ainda analisando".
   */
  z.object({ type: z.literal('ui/quickRead'), meetingId: z.string().min(1).max(120) }),
  /** Encerra a oportunidade com o motivo — disponível em toda a jornada. */
  z.object({
    type: z.literal('ui/disqualify'),
    reason: z.string().trim().min(3).max(500),
  }),
  /** Ativa o Modo Diagnóstico Técnico de Dados no TaqCITi (enviado pela CITi Flow Web). */
  z.object({
    type: z.literal('diagnostic/modeOn'),
    sessionId: z.string().min(1),
    backendUrl: z.string().url(),
  }),
  /** Desativa o Modo Diagnóstico. */
  z.object({ type: z.literal('diagnostic/modeOff') }),
  /** Ativa modo diagnóstico técnico interno (a partir do modal de vinculação). */
  z.object({
    type: z.literal('diagnostic/activate'),
    sessionId: z.string().min(1),
    projectId: z.string().min(1),
    runId: z.string().optional(),
    backendUrl: z.string().url(),
  }),
  /** Desativa e limpa estado do diagnóstico. */
  z.object({ type: z.literal('diagnostic/deactivate') }),
  /** Sidepanel solicita estado atual das perguntas. */
  z.object({ type: z.literal('diagnostic/questions') }),
  /** Sidepanel envia ação sobre uma pergunta. */
  z.object({
    type: z.literal('diagnostic/question_action'),
    questionId: z.string().min(1),
    action: z.enum(['pin', 'use', 'dismiss']),
  }),
  /** Sidepanel solicita geração de novas perguntas pela IA. */
  z.object({ type: z.literal('diagnostic/generateQuestions') }),
]);

const diagnosticQuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  block: z.string().nullable(),
  status: z.enum(['queued', 'pinned']),
});

export type DiagnosticQuestion = z.infer<typeof diagnosticQuestionSchema>;

/** Broadcast do background → todos os contextos. */
const broadcastMessages = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state/updated'), state: meetingStateSchema }),
  z.object({
    type: z.literal('diagnostic/stateUpdated'),
    questions: z.array(diagnosticQuestionSchema),
  }),
]);

export const messageSchema = z.union([contentMessages, uiMessages, broadcastMessages]);

export type ExtensionMessage = z.infer<typeof messageSchema>;
export type MessageOf<T extends ExtensionMessage['type']> = Extract<
  ExtensionMessage,
  { type: T }
>;

/** Respostas possíveis a mensagens que esperam retorno. */
export const stateResponseSchema = meetingStateSchema;
export const ackResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  receipt: z
    .object({
      clientMeetingId: z.string().uuid(),
      serverMeetingId: z.string().uuid(),
      opportunityId: z.string().uuid(),
      clientOrganizationId: z.string().uuid(),
      version: z.number().int().nonnegative(),
      etag: z.string(),
      persistedAt: z.string(),
    })
    .optional(),
});
export type AckResponse = z.infer<typeof ackResponseSchema>;

/** Resposta de ui/openRuns: os negócios vivos no Flow (ou o porquê de nada). */
export const openRunsResponseSchema = z.object({
  ok: z.boolean(),
  items: z.array(
    z.object({
      id: z.string(),
      companyName: z.string(),
      stage: z.string(),
      meetings: z.number(),
    }),
  ),
  error: z.string().optional(),
});
export type OpenRunsResponse = z.infer<typeof openRunsResponseSchema>;


const layerStateSchema = z.enum(['nao_necessario', 'nao_iniciado', 'em_andamento', 'concluido']);
const commercialStateSchema = z.enum(['nao_iniciada', 'em_andamento', 'concluida']);

/** Uma lacuna do checklist, como a política a declara. */
export const triageGapSchema = z.object({
  id: z.string(),
  question: z.string(),
  why: z.string(),
});

/**
 * Resposta de `ui/runContext`: tudo que uma reunião SEGUINTE precisa para
 * continuar a oportunidade em vez de reconfigurá-la.
 *
 * Espelha `GET /api/v1/runs/:id/contexto`. Validado com zod na borda porque o
 * que vem da rede não é confiável — e porque o fetcher antes devolvia `unknown`
 * cru, o que fazia qualquer mudança de contrato virar erro em tempo de execução
 * longe da causa.
 */
export const runContextResponseSchema = z.object({
  ok: z.boolean(),
  context: z
    .object({
      runId: z.string(),
      version: z.number().int().nonnegative(),
      clientOrganizationId: z.string().uuid().nullable(),
      organizationName: z.string(),
      stage: z.string(),
      /** A configuração PERMANENTE. Presente = NÃO pergunte nada disto de novo. */
      config: opportunityConfigSchema.nullable(),
      variables: z
        .object({
          qualificacaoComercial: commercialStateSchema,
          diagnosticoComercial: commercialStateSchema,
          diagnosticoTecnico: layerStateSchema,
          /** Camada de dimensionamento não-técnico; ausente em runs antigas. */
          dimensionamento: layerStateSchema.default('nao_necessario'),
        })
        .nullable(),
      verdict: z.string().nullable(),
      /** Camadas cobertas e camadas que ESTE produto exige. */
      covered: z.array(z.string()).default([]),
      required: z.array(z.string()).default([]),
      /** Quem precisa estar na próxima conversa. */
      nextMeetingOwner: z
        .enum(['comercial', 'comercial_e_solucoes', 'institucional'])
        .nullable()
        .default(null),
      /** A PAUTA: o que a reunião atual precisa resolver. */
      agenda: z.array(z.string()).default([]),
      openQualification: z.array(z.string()).default([]),
      openCommercial: z.array(z.string()).default([]),
      openTechnical: z.array(triageGapSchema).default([]),
      openDimensioning: z.array(triageGapSchema).default([]),
      /**
       * A próxima ação confirmada na reunião ANTERIOR. Primeira fonte da
       * finalidade da reunião atual, antes do estágio e antes da triagem.
       */
      nextAction: nextActionSchema
        .extend({
          confirmedAt: z.string().optional(),
        })
        .nullable()
        .default(null),
      /** O portão da primeira etapa, já avaliado pela política do servidor. */
      releaseState: z
        .enum([
          'rascunho_incompleto',
          'pronto_para_publicar',
          'publicando',
          'falha_publicacao',
          'publicado',
          'liberado',
        ])
        .default('rascunho_incompleto'),
      gate: z
        .object({
          ok: z.boolean(),
          reason: z.string().nullable(),
          missing: z.array(z.string()),
          mode: z.enum(['automatica', 'manual']),
          auto: z.boolean(),
        })
        .nullable()
        .default(null),
      extensionClosed: z.boolean(),
      /** `false` = a oportunidade NÃO aceita reunião nova. Nunca degrade para criar outra. */
      acceptsMeetings: z.boolean(),
      meetings: z.array(
        z.object({
          id: z.string(),
          date: z.string(),
          label: z.string(),
          source: z.string(),
          summary: z.string().nullable().default(null),
        }),
      ),
    })
    .nullable(),
  error: z.string().optional(),
});
export type RunContextResponse = z.infer<typeof runContextResponseSchema>;
export type RunContext = NonNullable<RunContextResponse['context']>;
export type TriageGap = z.infer<typeof triageGapSchema>;

export const diagnosticQuestionsResponseSchema = z.object({
  questions: z.array(diagnosticQuestionSchema),
});
export type DiagnosticQuestionsResponse = z.infer<typeof diagnosticQuestionsResponseSchema>;

/**
 * Resposta de ui/organizations: as organizações conhecidas pelo Flow, com a
 * oportunidade aberta de cada uma (quando existe). `fromCache` avisa que o
 * backend não respondeu e a lista veio do último download — a busca continua
 * funcionando, e criar organização nova nunca fica bloqueado.
 */
export const organizationsResponseSchema = z.object({
  ok: z.boolean(),
  items: z.array(
    z.object({
      id: z.string().nullable().optional(),
      name: z.string(),
      openRunId: z.string().nullable(),
      openStage: z.string().nullable(),
      runs: z.number(),
      lastActivityAt: z.string().nullable(),
    }),
  ),
  fromCache: z.boolean().optional(),
  error: z.string().optional(),
});
export type OrganizationsResponse = z.infer<typeof organizationsResponseSchema>;

/** Conta autenticada do produto; a conta percebida no Meet não autoriza nada. */
export const authAccountResponseSchema = z.object({
  account: z
    .object({
      tenantId: z.string(),
      userId: z.string(),
      email: z.string().email(),
      name: z.string(),
      role: z.enum(['admin', 'member']),
    })
    .nullable(),
});
export type AuthAccountResponse = z.infer<typeof authAccountResponseSchema>;
export const authMutationResponseSchema = authAccountResponseSchema.extend({
  ok: z.boolean(),
  error: z.string().optional(),
});
export type AuthMutationResponse = z.infer<typeof authMutationResponseSchema>;
