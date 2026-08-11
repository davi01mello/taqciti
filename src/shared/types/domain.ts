/**
 * Tipos de domínio compartilhados por toda a extensão: o formato do registro
 * salvo localmente (MeetingPayload) e o estado da reunião que trafega entre
 * contextos.
 */
import type { MeetingTemporalContext } from '@/shared/temporal';

export type { MeetingTemporalContext };

// ---------- Contrato de dados ----------

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
  metadata: {
    capturedCaptions: boolean;
    droppedSegments: number;
    reconnectCount: number;
    captureDegradedCount?: number;
    lastChunkAt?: number | null;
    wasDiscardedAndRestarted: boolean;
  };
}

// ---------- Estado interno da reunião ----------

export type MeetingPhase =
  | 'idle'
  | 'captionsRequired'
  | 'recording'
  | 'paused'
  | 'ended';

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

/** Idioma da legenda, estimado por heurística de stopwords — nunca automatiza o menu do Meet. */
export type CaptionLanguage = 'pt' | 'en' | 'unknown';

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
  /** Última leitura da heurística de idioma sobre a janela recente de texto. */
  captionLanguage: CaptionLanguage;
  /** "Não avisar de novo nesta reunião" — silencia o aviso só para esta sessão. */
  languageWarningDismissed: boolean;
  /** Throttle interno: chunks aplicados desde a última checagem de idioma. */
  chunksSinceLanguageCheck: number;
}

export interface MeetingState {
  phase: MeetingPhase;
  session: MeetingSessionState | null;
}

export const IDLE_STATE: MeetingState = { phase: 'idle', session: null };

// ---------- Histórico ----------

/**
 * `recording` — reunião em andamento, salva continuamente (nada se perde);
 * `ready` — reunião concluída, guardada no histórico.
 */
export type HistoryStatus = 'recording' | 'ready';

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
  status: HistoryStatus;
  metadata: MeetingPayload['metadata'];
}

// ---------- Preferências do painel flutuante ----------

/**
 * Os degraus de altura da janela.
 *
 * Degraus, e não arraste contínuo: o produto é um painel que muda de ESTADO, e
 * três alturas nomeadas são previsíveis de um clique — um arraste de borda
 * exige mira, produz alturas quebradas e ainda teria que ser normalizado na
 * volta. `tall` existe para o histórico respirar; `compact` para o painel sair
 * da frente sem virar cápsula.
 */
export type PanelSize = 'compact' | 'regular' | 'tall';

export interface PanelPrefs {
  /**
   * Canto superior esquerdo, como fração 0..1 do espaço DISPONÍVEL (viewport
   * menos a caixa, menos as margens). Fração e não pixel: a janela do
   * navegador muda de tamanho o tempo todo, e um pixel salvo em 1920px de
   * largura joga o painel para fora da tela em 1280px. Como é fração do espaço
   * livre, 1 significa "encostado no canto oposto" em qualquer tamanho de tela
   * — e vale igual para a cápsula e para o painel, que têm caixas diferentes.
   */
  x: number;
  y: number;
  /** Altura da janela quando aberta. */
  size: PanelSize;
  /**
   * O usuário fechou o TaqCITi (não minimizou).
   *
   * Persistido de propósito: fechar precisa durar mais que a aba, senão a
   * primeira navegação traria a interface de volta e "fechar" viraria
   * "esconder até recarregar". Volta a `false` só por ação explícita — clique
   * no ícone da extensão — ou quando uma reunião nova começa.
   */
  dismissed: boolean;
  /** Esconder as legendas nativas do Meet enquanto a captura roda. */
  hideMeetCaptions: boolean;
}

export const DEFAULT_PANEL_PREFS: PanelPrefs = {
  x: 0.97,
  y: 0.62,
  size: 'regular',
  dismissed: false,
  hideMeetCaptions: true,
};

export type Unsubscribe = () => void;
