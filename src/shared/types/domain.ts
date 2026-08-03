/**
 * Tipos de domínio compartilhados por toda a extensão: o contrato de dados do
 * CITi Flow (MeetingPayload) e o estado da reunião que trafega entre contextos.
 */
import type { MeetingTemporalContext } from '@/shared/temporal';

export type { MeetingTemporalContext };

// ---------- Contrato de dados (consumido pelo primeiro agente do CITi Flow) ----------

export interface Participant {
  name: string;
  isHost: boolean | null;
  /** ID opaco do tile/roster; nunca é identidade de produto. */
  providerParticipantId?: string;
  firstSeenAt?: number;
  lastSeenAt?: number;
  source?: 'meet_tile' | 'meet_roster';
  confidence?: number;
}

export interface SpeakerObservation {
  name: string;
  firstSeenAt: number;
  lastSeenAt: number;
  source: 'caption';
  confidence: number;
  /** Falar não confirma presença: só um tile/roster permite true. */
  matchedParticipant: boolean;
}

/** Conta que a interface do Meet parece estar usando. Contexto, nunca autoridade. */
export interface MeetAccountContext {
  email: string;
  displayName: string | null;
  observedAt: number;
  source: 'meet_account_control';
  confidence: number;
}

/** Fronteira visível entre o contexto do Meet e a sessão real do CITi Flow. */
export interface AccountBoundaryState {
  meet: MeetAccountContext | null;
  product: {
    tenantId: string;
    userId: string;
    email: string;
    name: string;
  } | null;
  mismatch: boolean;
}

export interface TranscriptSegment {
  speaker: string | null;
  text: string;
  startOffsetMs: number;
  endOffsetMs: number;
}

/**
 * A configuração permanente da oportunidade (Fluxo A); espelha
 * `opportunityConfigSchema` (messages.ts) e `OpportunityConfigPayload`
 * (features/opportunity/flow.ts).
 */
export interface OpportunityConfig {
  service: 'discovery' | 'delivery' | 'synerg' | 'indefinido' | 'outro';
  serviceOther: string | null;
  /** Resposta humana explícita sobre diagnóstico técnico. Nunca inferida. */
  needsTechnical: boolean;
  areas: Array<'dados' | 'desenvolvimento' | 'produto'>;
  areaOther: string | null;
  coverageAtCreation:
    | 'so_qualificacao'
    | 'qualificacao_diagnostico_incompleto'
    | 'qualificacao_diagnostico'
    | null;
  by: string | null;
}

/**
 * As respostas do pós-reunião no formato ANTIGO (uma por reunião, tudo
 * nullable). Continua existindo porque o backend ainda aceita oportunidades
 * criadas antes da configuração permanente — mas o Fluxo A novo produz
 * `OpportunityConfig`, não isto.
 */
export interface FlowHumanInput {
  coverage:
    | 'so_qualificacao'
    | 'qualificacao_diagnostico_incompleto'
    | 'qualificacao_diagnostico'
    | null;
  needsTechnical: boolean | null;
  areas: Array<'dados' | 'desenvolvimento' | 'produto'> | null;
  areaOther: string | null;
  /** O serviço escolhido no fluxo (o vocabulário do funil, não o da tela). */
  direction: 'discovery' | 'delivery' | 'synerg' | 'indefinido' | 'outro' | null;
  directionOther: string | null;
  by: string | null;
}

/** O que o envio ao CITi Flow carrega além da transcrição. */
/** Espelhado de features/opportunity/nextAction para não acoplar a UI aqui. */
export interface NextActionInput {
  kind: 'reuniao';
  status: 'confirmada' | 'nao_definida';
  scheduledAt: string | null;
  timezone: string | null;
  objective:
    | 'qualificacao'
    | 'diagnostico'
    | 'diagnostico_tecnico'
    | 'apresentacao_proposta'
    | 'negociacao'
    | 'outro'
    | null;
  source: 'transcricao' | 'humano';
  evidence: string | null;
  /**
   * Quem conduziu a reunião — ver features/opportunity/nextAction.
   *
   * OPCIONAL de propósito, e alinhado com `nextActionSchema` (messages.ts), que
   * já era `.nullable().optional()`. A divergência entre os dois — obrigatório
   * aqui, opcional no schema — quebrava o typecheck em toda chamada que montava
   * o payload a partir do que veio da mensagem.
   */
  organizerEmail?: string | null;
}

export interface FlowSendData {
  companyName: string;
  clientOrganizationId?: string | null;
  /**
   * Oportunidade que já existe no Flow — é o Fluxo B. Com ela preenchida,
   * `config` vem null: a configuração já existe e é imutável.
   */
  targetRunId: string | null;
  /** Versão lida ao escolher a oportunidade; detecta duas abas concorrentes. */
  expectedOpportunityVersion?: number;
  /** Fluxo A: a configuração que nasce junto com a oportunidade. */
  config: OpportunityConfig | null;
  /**
   * Rótulo desta reunião dentro do negócio ("Diagnóstico técnico"). É o que
   * diz ao agente de contexto o que cada conversa foi.
   */
  meetingLabel?: string | null;
  /**
   * O próximo compromisso, confirmado no último passo do fluxo. Viaja junto
   * com a reunião: uma ida só ao servidor, e nenhuma oportunidade nasce sem
   * próxima ação registrada.
   */
  nextAction?: NextActionInput | null;
}

export interface MeetingPayload {
  meetingId: string;
  provider: string;
  title: string; // nome editável pelo usuário
  startedAt: string; // ISO 8601
  endedAt: string; // ISO 8601
  /**
   * O CONTEXTO TEMPORAL da reunião: os mesmos instantes, mas com o fuso IANA de
   * quem capturou, o dia/hora locais e a confiança do fuso.
   *
   * Sem ele o backend recebia só um instante e não tinha como saber qual era o
   * dia LOCAL da conversa — que é exatamente contra o que "amanhã" e "terça"
   * precisam ser resolvidos. Uma reunião às 22h em Recife é 01h do dia seguinte
   * em UTC, e o servidor resolvia um dia à frente do que a extensão resolvia.
   *
   * OPCIONAL para não rejeitar nada que já esteja gravado: payloads antigos não
   * o têm, e o backend normaliza (ver `flow-engine/src/types.ts`) em vez de
   * recusar.
   */
  temporal?: MeetingTemporalContext;
  durationSeconds: number;
  participants: Participant[];
  /** Superfície reconciliada nesta leitura; nomes que saíram desaparecem. */
  presentNow?: Participant[];
  /** Falantes de legenda, separados da presença confirmada. */
  speakersObserved?: SpeakerObservation[];
  transcript: TranscriptSegment[];
  commercialConfidence: number; // 0–1, ver features/meeting/commercialConfidence.ts
  /** Preenchido no envio (empresa, negócio de destino, respostas do pop-up). */
  flow?: FlowSendData | null;
  metadata: {
    capturedCaptions: boolean;
    droppedSegments: number;
    reconnectCount: number;
    captureDegradedCount?: number;
    lastChunkAt?: number | null;
    wasDiscardedAndRestarted: boolean;
  };
  /** Relatório markdown do Agente Diagnóstico — presente quando sessão AD ativa. */
  diagnostic_report?: string | null;
  /** ID da sessão do Agente Diagnóstico — presente quando sessão AD ativa. */
  diagnostic_session_id?: string;
}

// ---------- Estado interno da reunião ----------

export type MeetingPhase =
  | 'idle'
  | 'captionsRequired'
  | 'recording'
  | 'paused'
  | 'ended'
  | 'sent';

/** Fatia de legenda emitida pelo provider. `captionId` é estável por linha de
 *  legenda no DOM — atualizações da mesma fala chegam com o mesmo id. */
export interface CaptionChunk {
  captionId: string;
  speaker: string | null;
  text: string;
  atMs: number; // epoch ms do momento da captura
}

/** Segmento em construção; `captionId` é interno e removido no payload final. */
export interface LiveSegment extends TranscriptSegment {
  captionId: string;
}

export interface MeetingSessionState {
  meetingId: string;
  /** Código da sala (ex.: "abc-defg-hij") — chave da retomada pós-queda. */
  meetingCode: string;
  provider: string;
  title: string;
  /** Título ainda automático (data/cliente)? Um rename do usuário zera isto e
   *  passa a mandar — a extensão nunca sobrescreve nome que a pessoa deu. */
  titleAuto?: boolean;
  tabId: number | null;
  startedAt: number; // epoch ms
  endedAt: number | null;
  captionsEnabled: boolean;
  /** Histórico confirmado de presença (quem entrou, mesmo que já tenha saído). */
  participants: Participant[];
  /** Reconciliação atual da superfície confiável do Meet. */
  presentNow?: Participant[];
  /** Falantes observados; nunca promovidos implicitamente a participantes. */
  speakersObserved?: SpeakerObservation[];
  /** Expõe divergência sem conferir qualquer poder à conta observada no Meet. */
  accountBoundary?: AccountBoundaryState;
  segments: LiveSegment[];
  /** captionIds "selados" em pausa/limpeza: updates tardios são descartados. */
  sealedCaptionIds: string[];
  droppedSegments: number;
  reconnectCount: number;
  /** Entradas no modo degradado (parser sem estrutura ou lacuna observada). */
  captureDegradedCount?: number;
  /** Último trecho recebido, sem expor seu conteúdo em diagnóstico/log. */
  lastChunkAt?: number | null;
  wasDiscardedAndRestarted: boolean;
  /** Calculada ao entrar em `ended`; null durante a captura. */
  commercialConfidence: number | null;
}

export interface MeetingState {
  phase: MeetingPhase;
  session: MeetingSessionState | null;
}

export const IDLE_STATE: MeetingState = { phase: 'idle', session: null };

// ---------- Histórico ----------

/**
 * `recording` — reunião em andamento, salva continuamente (nada se perde);
 * `ready` — reunião concluída, guardada no histórico;
 * `sent` — enviada para o CITi Flow.
 */
export type HistoryStatus = 'recording' | 'ready' | 'sent';

export interface MeetingRecord {
  id: string; // = meetingId
  title: string;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
  participants: Participant[];
  presentNow?: Participant[];
  speakersObserved?: SpeakerObservation[];
  segments: LiveSegment[];
  commercialConfidence: number;
  status: HistoryStatus;
  /** Respostas já confirmadas, preservadas enquanto a sincronização aguarda. */
  pendingFlow?: FlowSendData | null;
  /** Relatório técnico já encerrado, para um retry não precisar recriá-lo. */
  pendingDiagnostic?: {
    report: string | null;
    sessionId: string;
  } | null;
  syncState?: {
    status: 'local' | 'pending' | 'syncing' | 'synced' | 'error';
    attempts: number;
    lastError: string | null;
    retryable: boolean;
    updatedAt: string;
    receipt: SyncReceipt | null;
  };
  metadata: MeetingPayload['metadata'];
}

// ---------- Preferências do painel no Meet ----------

export type DockEdge = 'left' | 'right' | 'bottom';

export interface PanelPrefs {
  /** Borda onde o painel fica ancorado. */
  edge: DockEdge;
  /** Posição ao longo da borda, fração 0..1 (robusto a resize). */
  offset: number;
  /** Esconder as legendas nativas do Meet enquanto a captura roda. */
  hideMeetCaptions: boolean;
}

export const DEFAULT_PANEL_PREFS: PanelPrefs = {
  edge: 'right',
  offset: 0.62,
  hideMeetCaptions: true,
};

// ---------- Sync ----------

export interface SyncReceipt {
  clientMeetingId: string;
  serverMeetingId: string;
  opportunityId: string;
  clientOrganizationId: string;
  version: number;
  etag: string;
  persistedAt: string;
  idempotentReplay: boolean;
  meetingSaved: true;
  processing: {
    status: 'pending' | 'running' | 'completed' | 'failed';
    jobId: string;
    attempts: number;
    lastError: string | null;
    statusUrl: string;
  };
}

export interface SyncResult {
  ok: boolean;
  /** Só existe quando o envio deu certo: falha não tem data de sincronização. */
  syncedAt?: string;
  /**
   * A oportunidade no CITi Flow, quando o envio a criou ou a encontrou. É o
   * que permite agir sobre ela depois — desqualificar, acompanhar o estado —
   * sem a pessoa ter que sair da reunião para procurar o card.
   */
  runId?: string;
  /** Presente em TODO sucesso real; sem recibo o registro local não vira sent. */
  receipt?: SyncReceipt;
  retryable?: boolean;
  error?: string;
}

export type Unsubscribe = () => void;
