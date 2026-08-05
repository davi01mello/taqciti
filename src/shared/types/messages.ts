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
  id: z.string(),
  captionId: z.string().nullable(),
  speaker: z.string().nullable(),
  text: z.string(),
  editedText: z.string().optional(),
  startOffsetMs: z.number(),
  endOffsetMs: z.number(),
  source: z.enum(['caption', 'manual']).default('caption'),
  status: z.enum(['active', 'deleted']).default('active'),
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
  z.object({ type: z.literal('panel/openRequest') }),
]);

/** Mensagens das UIs (popup / side panel / painel no Meet) → background. */
const uiMessages = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ui/getState') }),
  z.object({ type: z.literal('ui/pause') }),
  z.object({ type: z.literal('ui/resume') }),
  z.object({ type: z.literal('ui/clearTranscript') }),
  z.object({ type: z.literal('ui/finish') }),
  z.object({ type: z.literal('ui/rename'), title: z.string().min(1).max(200) }),
  z.object({ type: z.literal('ui/reset') }),
  z.object({ type: z.literal('ui/dismissLanguageWarning') }),
  z.object({ type: z.literal('ui/deleteSegment'), segmentId: z.string().min(1) }),
  z.object({
    type: z.literal('ui/editSegment'),
    segmentId: z.string().min(1),
    text: z.string().min(1).max(4000),
  }),
  z.object({ type: z.literal('ui/restoreSegment'), segmentId: z.string().min(1) }),
  z.object({
    type: z.literal('ui/addManualSegment'),
    text: z.string().min(1).max(4000),
    speaker: z.string().max(120).optional(),
  }),
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

export const messageSchema = z.union([contentMessages, uiMessages, broadcastMessages]);

export type ExtensionMessage = z.infer<typeof messageSchema>;
export type MessageOf<T extends ExtensionMessage['type']> = Extract<
  ExtensionMessage,
  { type: T }
>;

/** Respostas possíveis a mensagens que esperam retorno. */
export const stateResponseSchema = meetingStateSchema;
