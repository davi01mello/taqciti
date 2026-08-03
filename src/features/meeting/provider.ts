/**
 * Abstração central de provedor de reunião. A feature `meeting/` (e todo o
 * resto da extensão) só conhece esta interface — nunca o Google Meet.
 * Trocar GoogleMeetProvider por um mock não exige mudança em nenhum outro arquivo.
 */
import type {
  CaptionChunk,
  MeetAccountContext,
  Participant,
  Unsubscribe,
} from '@/shared/types/domain';
import type { SpeakerRename } from '@/features/transcription/speakerIdentity';

export interface MeetingSession {
  /** Código estável da reunião (ex.: "abc-defg-hij" no Meet). */
  meetingCode: string;
  /** Título sugerido (ex.: título da aba), usado como nome padrão editável. */
  title: string;
}

export interface MeetingProvider {
  readonly id: string;

  detectMeeting(): MeetingSession | null;
  onMeetingStart(cb: (session: MeetingSession) => void): Unsubscribe;
  onMeetingEnd(cb: (session: MeetingSession) => void): Unsubscribe;

  areCaptionsAvailable(): boolean;
  areCaptionsEnabled(): boolean;
  onCaptionChunk(cb: (chunk: CaptionChunk) => void): Unsubscribe;

  getParticipants(): Participant[] | null;
  /** Contexto visual do Meet; opcional porque mocks/provedores podem não expor conta. */
  getAccountContext?(): MeetAccountContext | null;

  // --- Extensões além do contrato mínimo (necessárias para a UX) ---

  /** Notifica quando o estado das legendas muda (overlay auto-dismiss). */
  onCaptionsStateChange(cb: (enabled: boolean) => void): Unsubscribe;
  /** Notifica quando o observer de legendas precisa se recolar (métrica de reconexão). */
  onReconnect(cb: () => void): Unsubscribe;
  /**
   * Duas grafias que eram a MESMA pessoa viraram uma ("Você" → "Bernardo
   * Belfort" quando o nome real aparece). A transcrição já capturada precisa
   * ser corrigida no lugar, senão a pessoa aparece duas vezes.
   */
  onSpeakersMerged(cb: (renames: SpeakerRename[]) => void): Unsubscribe;
  /**
   * Saúde da captura: `false` quando há legenda na tela que não estamos
   * conseguindo ler (o painel avisa em vez de fingir que grava).
   */
  onCaptureHealth(
    cb: (healthy: boolean, reason?: 'parser' | 'stall') => void,
  ): Unsubscribe;
  /** Tenta ativar as legendas em nome do usuário. Retorna false se não achou o botão. */
  requestEnableCaptions(): boolean;
  /**
   * "Recorta" a captura agora: falas já na tela viram passado e as próximas
   * nascem com identidade nova. Chamado ao retomar uma pausa e ao apagar a
   * transcrição — sem isso a captura morre em silêncio (ver implementação).
   */
  recutCaptions(): void;

  /**
   * PAUSA DE VERDADE, na fonte.
   *
   * Filtrar o chunk depois de capturado não basta: o observer continua rodando,
   * a legenda continua acumulando no DOM, e qualquer atraso entre o clique e a
   * chegada do estado novo (broadcast em voo, service worker hibernando, aba
   * recarregada) deixa passar fala do período pausado. Com `paused = true` o
   * provider desliga a observação e não emite mais nada, ponto.
   */
  setCapturePaused(paused: boolean): void;

  /** Liga/desliga a observação do DOM. */
  start(): void;
  stop(): void;
}
