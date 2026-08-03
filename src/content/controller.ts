/**
 * Cola do content script: liga o MeetingProvider (só a interface — nunca o
 * Meet diretamente) à mensageria com o background, e comanda a experiência
 * "mágica" dentro do Meet:
 *
 * - entra na reunião → tenta ligar as legendas SOZINHO (com retries);
 * - legendas nativas ficam invisíveis na tela (a captura segue pelo DOM);
 * - o painel TaqCITi (React, no shadow DOM) reflete o estado global e devolve
 *   as intenções do usuário.
 */
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import type { MeetingProvider } from '@/features/meeting/provider';
import type {
  MeetingState,
  PanelPrefs,
  Participant,
  Unsubscribe,
} from '@/shared/types/domain';
import { DEFAULT_PANEL_PREFS } from '@/shared/types/domain';
import {
  AUTO_CAPTIONS_MAX_ATTEMPTS,
  MEET_POLL_INTERVAL_MS,
} from '@/shared/config/constants';
import { onMessage, sendMessage } from '@/shared/services/messaging';
import { meetingStateSchema } from '@/shared/types/messages';
import { setNativeCaptionsHidden } from './captionsVisibility';
import { loadPanelPrefs, savePanelPrefs } from './prefs';
import { PanelApp, type PanelCallbacks, type PanelContext } from './ui/PanelApp';
import { getMountPoint, unmountHost } from './ui/mount';

const PARTICIPANTS_POLL_MS = 5000;

export class ContentController {
  private subscriptions: Unsubscribe[] = [];
  private participantsTimer: ReturnType<typeof setInterval> | null = null;
  private lastParticipantsJson = '';
  private lastAccountContextJson = '';
  private lastState: MeetingState | null = null;

  private root: Root | null = null;
  private prefs: PanelPrefs = { ...DEFAULT_PANEL_PREFS };

  private captionAttempts = 0;
  private captionRetryTimer: ReturnType<typeof setInterval> | null = null;
  /** false = há legenda na tela que a captura não está conseguindo ler. */
  private captureHealthy = true;

  private readonly callbacks: PanelCallbacks = {
    // Pausa OTIMISTA: desliga a captura no mesmo tique do clique, sem esperar
    // o round-trip com o background. O que for dito nesse intervalo é
    // justamente o que a pessoa não quer capturar.
    onPause: () => {
      this.provider.setCapturePaused(true);
      void sendMessage({ type: 'ui/pause' });
    },
    onResume: () => {
      this.provider.setCapturePaused(false);
      void sendMessage({ type: 'ui/resume' });
    },
    onFinish: () => void sendMessage({ type: 'ui/finish' }),
    onRename: (title) => void sendMessage({ type: 'ui/rename', title }),
    onOpenHistory: () => void sendMessage({ type: 'panel/openRequest' }),
    onResumeCapture: () => this.redetect(),
    onCloseEnded: () => void sendMessage({ type: 'ui/reset' }),
    onEnableCaptions: () => this.attemptEnableCaptions(),
    onToggleNativeCaptions: (hidden) => {
      this.prefs = { ...this.prefs, hideMeetCaptions: hidden };
      savePanelPrefs(this.prefs);
      if (this.lastState) this.applyState(this.lastState);
    },
    onDockChange: (edge, offset) => {
      this.prefs = { ...this.prefs, edge, offset };
      savePanelPrefs(this.prefs);
    },
  };

  constructor(private readonly provider: MeetingProvider) {}

  start(): void {
    this.provider.start();

    this.subscriptions.push(
      this.provider.onMeetingStart((session) => {
        void sendMessage<MeetingState>({
          type: 'meet/detected',
          meetingCode: session.meetingCode,
          title: session.title,
          captionsEnabled: this.provider.areCaptionsEnabled(),
        }).then((state) => {
          this.applyState(state);
          this.pushAccountContext(true);
        });
      }),

      this.provider.onMeetingEnd(() => {
        void sendMessage<MeetingState>({ type: 'meet/ended' }).then((state) =>
          this.applyState(state),
        );
      }),

      this.provider.onCaptionsStateChange((enabled) => {
        if (enabled) this.stopCaptionRetries();
        void sendMessage({ type: 'meet/captions', enabled });
      }),

      this.provider.onCaptionChunk((chunk) => {
        // Segunda barreira. A primeira é o provider, que em pausa nem observa o
        // DOM — mas um guarda barato aqui cobre a janela entre o clique e o
        // estado novo chegar.
        if (this.lastState?.phase === 'paused') return;
        void sendMessage({ type: 'meet/chunk', chunk });
      }),

      this.provider.onReconnect(() => {
        void sendMessage({ type: 'meet/reconnect' });
      }),

      // A mesma pessoa estava com dois nomes: corrige o que já foi capturado.
      this.provider.onSpeakersMerged((renames) => {
        if (renames.length === 0) return;
        void sendMessage({ type: 'meet/speakersMerged', renames });
      }),

      // Captura parada com legenda na tela: o painel avisa em vez de mentir.
      this.provider.onCaptureHealth((healthy, reason) => {
        this.captureHealthy = healthy;
        if (!healthy) {
          this.attemptEnableCaptions();
          void sendMessage({ type: 'meet/captureDegraded', reason: reason ?? 'stall' });
        }
        if (this.lastState) this.applyState(this.lastState);
      }),

      onMessage((message) => {
        if (message.type !== 'state/updated') return undefined;
        this.applyState(message.state);
        return undefined;
      }),
    );

    this.participantsTimer = setInterval(
      () => {
        this.pushParticipants();
        this.pushAccountContext();
      },
      PARTICIPANTS_POLL_MS,
    );

    void loadPanelPrefs().then((prefs) => {
      this.prefs = prefs;
      if (this.lastState) this.applyState(this.lastState);
    });

    // Script pode ser injetado com a reunião já em andamento (reload da aba).
    const existing = this.provider.detectMeeting();
    if (existing) {
      void sendMessage<MeetingState>({
        type: 'meet/detected',
        meetingCode: existing.meetingCode,
        title: existing.title,
        captionsEnabled: this.provider.areCaptionsEnabled(),
      }).then((state) => {
        this.applyState(state);
        this.pushAccountContext(true);
      });
    }
  }

  stop(): void {
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
    this.subscriptions = [];
    if (this.participantsTimer !== null) clearInterval(this.participantsTimer);
    this.stopCaptionRetries();
    this.provider.stop();
    setNativeCaptionsHidden(false);
    this.root?.unmount();
    this.root = null;
    unmountHost();
  }

  /** Reenvia a detecção atual (usado pelo "Retomar captura" pós-finalização). */
  private redetect(): void {
    const session = this.provider.detectMeeting();
    if (!session) return;
    void sendMessage<MeetingState>({
      type: 'meet/detected',
      meetingCode: session.meetingCode,
      title: session.title,
      captionsEnabled: this.provider.areCaptionsEnabled(),
    }).then((state) => {
      this.applyState(state);
      this.pushAccountContext(true);
    });
  }

  private pushParticipants(): void {
    if (this.lastState === null || this.lastState.session === null) return;
    const participants: Participant[] | null = this.provider.getParticipants();
    if (!participants) return;
    const json = JSON.stringify(participants);
    if (json === this.lastParticipantsJson) return;
    this.lastParticipantsJson = json;
    void sendMessage({ type: 'meet/participants', participants });
  }

  private pushAccountContext(force = false): void {
    if (this.lastState?.session === null) return;
    const context = this.provider.getAccountContext?.() ?? null;
    const comparable = context
      ? { ...context, observedAt: 0 }
      : null;
    const json = JSON.stringify(comparable);
    if (!force && json === this.lastAccountContextJson) return;
    this.lastAccountContextJson = json;
    void sendMessage({ type: 'meet/accountContext', context });
  }

  // ---------- legendas automáticas ----------

  private attemptEnableCaptions(): void {
    this.captionAttempts += 1;
    this.provider.requestEnableCaptions();
  }

  private ensureCaptionRetries(): void {
    if (this.captionRetryTimer !== null) return;
    this.attemptEnableCaptions();
    this.captionRetryTimer = setInterval(() => {
      if (
        this.provider.areCaptionsEnabled() ||
        this.captionAttempts >= AUTO_CAPTIONS_MAX_ATTEMPTS
      ) {
        this.stopCaptionRetries();
        if (this.lastState) this.applyState(this.lastState);
        return;
      }
      this.attemptEnableCaptions();
    }, MEET_POLL_INTERVAL_MS);
  }

  private stopCaptionRetries(): void {
    if (this.captionRetryTimer !== null) clearInterval(this.captionRetryTimer);
    this.captionRetryTimer = null;
  }

  /**
   * Retomar uma pausa (ou apagar a transcrição) exige recortar a captura no
   * provider: os nós de legenda do Meet são reaproveitados e seus ids ficaram
   * selados pela pausa/limpeza. Sem o recorte, a captura para de valer para
   * sempre — o painel continua "gravando" e nada mais entra.
   */
  private recutIfNeeded(prev: MeetingState | null, next: MeetingState): void {
    // A pausa vale para QUALQUER origem: o botão do painel injetado já pausou
    // otimista, mas o side panel e o popup chegam só por aqui.
    if (next.phase === 'paused') {
      this.provider.setCapturePaused(true);
      return;
    }
    // `setCapturePaused(false)` já recorta por dentro; chamar sempre que a fase
    // sai de pausada cobre também o resume vindo de outra superfície.
    if (prev?.phase === 'paused' && next.phase === 'recording') {
      this.provider.setCapturePaused(false);
      return;
    }

    const sameSession =
      prev?.session != null &&
      next.session != null &&
      prev.session.meetingId === next.session.meetingId;
    const cleared =
      sameSession &&
      (prev?.session?.segments.length ?? 0) > 0 &&
      next.session?.segments.length === 0;

    if (cleared) this.provider.recutCaptions();
  }

  // ---------- reflexo do estado global ----------

  private applyState(raw: unknown): void {
    const parsed = meetingStateSchema.safeParse(raw);
    if (!parsed.success) return;
    const state = parsed.data as MeetingState;
    const prev = this.lastState;
    this.lastState = state;

    this.recutIfNeeded(prev, state);

    const inMeeting = this.provider.detectMeeting() !== null;

    // Legendas: liga sozinho enquanto a reunião espera por elas.
    if (state.phase === 'captionsRequired' && inMeeting) {
      this.ensureCaptionRetries();
    } else if (state.phase !== 'captionsRequired') {
      this.stopCaptionRetries();
      this.captionAttempts = 0;
    }

    // Tela limpa: legendas nativas invisíveis enquanto a sessão vive.
    const sessionActive =
      state.phase === 'captionsRequired' ||
      state.phase === 'recording' ||
      state.phase === 'paused';
    setNativeCaptionsHidden(sessionActive && this.prefs.hideMeetCaptions);

    const ctx: PanelContext = {
      inMeeting,
      captionsAutoFailed:
        this.captionAttempts >= AUTO_CAPTIONS_MAX_ATTEMPTS &&
        this.captionRetryTimer === null,
      nativeCaptionsHidden: this.prefs.hideMeetCaptions,
      captureHealthy: this.captureHealthy,
    };

    this.render(state, ctx);
  }

  private render(state: MeetingState, ctx: PanelContext): void {
    if (this.root === null) this.root = createRoot(getMountPoint());
    this.root.render(
      createElement(PanelApp, {
        state,
        ctx,
        prefs: this.prefs,
        callbacks: this.callbacks,
      }),
    );
  }
}
