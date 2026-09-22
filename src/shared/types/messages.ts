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
  captureHealthy: z.boolean().default(true),
  lastChunkAt: z.number().int().nonnegative().nullable().default(null),
  wasDiscardedAndRestarted: z.boolean(),
  captionLanguage: z.enum(['pt', 'en', 'unknown']).default('unknown'),
  languageWarningDismissed: z.boolean().default(false),
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
  /**
   * A captura voltou a ler as legendas.
   *
   * Existe porque a ida já era contada e a VOLTA não era: só a cápsula, dentro
   * da aba do Meet, sabia que a interrupção tinha acabado. A sidebar é página
   * da extensão e nunca enxergou o DOM da reunião — sem este recado, ela ficaria
   * avisando de uma interrupção resolvida até a reunião terminar.
   */
  z.object({ type: z.literal('meet/captureRecovered') }),
]);

/**
 * Mensagens do background → content script, endereçadas à aba da reunião.
 *
 * Separadas do broadcast porque só fazem sentido para UMA aba: quem as pede é o
 * painel lateral, que não alcança content script, e o background é quem sabe
 * qual é a aba da sessão.
 */
const paraAbaDaReuniao = z.discriminatedUnion('type', [
  /**
   * Escreve o aviso no chat do Meet. A resposta é `{ ok }` — e um `false` NÃO
   * pode virar confirmação na tela: o requisito é explícito sobre falha não
   * parecer sucesso.
   */
  z.object({ type: z.literal('meet/sendChatNotice'), text: z.string().min(1).max(300) }),
]);

/**
 * Mensagens das UIs (HOME / sidebar de reunião) → background.
 *
 * Exportado porque é exatamente a fronteira que a camada de plataforma
 * atravessa: é o conjunto de comandos que uma UI pode emitir, seja ela a
 * janela dentro do Chrome ou a janela do app nativo falando pela ponte. Ter o
 * schema de pé permite VALIDAR o que chega pelo socket com a mesma regra que
 * já valida o que chega por `chrome.runtime` — a ponte não afrouxa nada.
 */
export const homeSectionSchema = z.enum([
  'assistente',
  'reunioes',
  'documentos',
  'conexoes',
]);

export const uiMessageSchema = z.discriminatedUnion('type', [
  /**
   * Abre a HOME (`src/home/index.html`) — a página principal do TaqCiti.
   *
   * É o ÚNICO destino em aba do produto. Antes havia dois (`panel/openRequest`
   * abria a saída larga com o histórico antigo, este abria a tela nova), e
   * eram duas experiências concorrentes: o mesmo botão "Abrir numa aba"
   * levava a lugares diferentes conforme de onde saísse o clique. A saída
   * larga foi removida e o que ela fazia mora na navegação interna da HOME.
   *
   * Passa pelo background porque quem pede pode ser a sidebar de reunião, que
   * vive num content script — `window.open` de lá sai no contexto da página,
   * sujeito ao bloqueador de pop-up do site. E porque só o background sabe se
   * já existe uma aba da HOME para focar em vez de abrir outra.
   */
  z.object({
    type: z.literal('ui/openHome'),
    /** Seção em que a HOME deve abrir. Ausente = a que ela já mostrava. */
    secao: homeSectionSchema.optional(),
    /** Abre já nesta reunião do histórico, dentro de "Reuniões". */
    recordId: z.string().max(200).optional(),
  }),
  /**
   * "Estou aqui" — o painel se anuncia ao montar, e é assim que o estado ao
   * vivo o encontra.
   *
   * `chrome.runtime.sendMessage` do background alcança páginas da extensão e
   * NÃO alcança content script: para esse, a mensagem precisa ser endereçada
   * com `chrome.tabs.sendMessage(tabId, …)`, e a pergunta "quais abas?" precisa
   * de resposta. Quem sabe respondê-la é o próprio painel, que acabou de nascer
   * e conhece a sua aba.
   *
   * Anunciar-se a cada montagem — e não uma vez, quando alguém injeta — é o que
   * faz isso sobreviver à navegação: cada documento novo tem um painel novo, que
   * se registra de novo. Sem este recado, o painel de uma aba comum receberia o
   * estado uma única vez, ao montar, e congelaria: o relógio parado, a pausa sem
   * efeito visível, a transcrição travada na primeira fala.
   */
  z.object({ type: z.literal('panel/mounted') }),
  /**
   * Abre o painel lateral nativo.
   *
   * Pedido pela cápsula dentro do Meet. Pode FALHAR por regra do Chrome —
   * `sidePanel.open()` exige gesto do usuário no contexto da extensão, e um
   * clique na página vira mensagem, perdendo o gesto no caminho. A resposta diz
   * o motivo para a cápsula poder explicar em vez de não fazer nada.
   */
  z.object({ type: z.literal('ui/openSidePanel') }),
  /**
   * Captura a aba da reunião. O background confere que a aba da sessão é a que
   * está à vista antes de capturar — ver src/background/captura.ts.
   */
  z.object({ type: z.literal('ui/print') }),
  /** Manda o aviso para o chat do Meet da reunião em andamento. */
  z.object({ type: z.literal('ui/chatNotice'), text: z.string().min(1).max(300) }),
  z.object({ type: z.literal('ui/getState') }),
  z.object({ type: z.literal('ui/pause') }),
  z.object({ type: z.literal('ui/resume') }),
  z.object({ type: z.literal('ui/clearTranscript') }),
  z.object({ type: z.literal('ui/finish') }),
  z.object({ type: z.literal('ui/rename'), title: z.string().min(1).max(200) }),
  z.object({ type: z.literal('ui/reset') }),
  z.object({ type: z.literal('ui/dismissLanguageWarning') }),
  z.object({ type: z.literal('ui/history/delete'), id: z.string() }),
  z.object({
    type: z.literal('ui/history/rename'),
    id: z.string(),
    title: z.string().min(1).max(200),
  }),
]);

/** Broadcast do background → todos os contextos. */
const broadcastMessages = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state/updated'), state: meetingStateSchema }),
]);

export const messageSchema = z.union([
  contentMessages,
  uiMessageSchema,
  broadcastMessages,
  paraAbaDaReuniao,
]);

export type ExtensionMessage = z.infer<typeof messageSchema>;
/** Um comando emitido por uma UI — o vocabulário da camada de plataforma. */
export type UiCommand = z.infer<typeof uiMessageSchema>;
