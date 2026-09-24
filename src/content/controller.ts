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
import { logger } from '@/shared/services/log';
import { meetingStateSchema } from '@/shared/types/messages';
import { setNativeCaptionsHidden } from './captionsVisibility';
import { patchPanelPrefs, subscribePanelPrefs } from '@/features/panel/prefsStore';
import { PlatformProvider } from '@/shared/platform/context';
import { extensionPlatform } from '@/shared/platform/extension';
import { Capsula, type CapsulaCallbacks } from './ui/Capsula';
import { getMountPoint, unmountHost } from './ui/mount';
import {
  abrirParticipacao,
  anunciarReuniao,
  decisaoDe,
  esquecerReuniao,
  fecharParticipacao,
  guardarDecisao,
  observarDecisoes,
  type DecisaoDeRegistro,
} from '@/features/meeting/consent';
import { enviarNoChat } from './providers/googleMeet/chat';
import type { MeetingSession } from '@/features/meeting/provider';

const PARTICIPANTS_POLL_MS = 5000;

export class ContentController {
  private subscriptions: Unsubscribe[] = [];
  private participantsTimer: ReturnType<typeof setInterval> | null = null;
  private lastParticipantsJson = '';
  private lastAccountContextJson = '';
  private lastState: MeetingState | null = null;

  private root: Root | null = null;
  private prefs: PanelPrefs = { ...DEFAULT_PANEL_PREFS };
  /**
   * O primeiro quadro só é pintado depois de as preferências chegarem.
   *
   * Sem isto, o estado global e as preferências corriam soltos: quando o estado
   * chegava primeiro, o painel nascia com os PADRÕES e se corrigia no quadro
   * seguinte. Para quem tinha fechado o TaqCITi, isso é a cápsula piscando em
   * toda página visitada — a versão visível de "o estado não atravessou".
   */
  private prefsLoaded = false;

  private captionAttempts = 0;
  private captionRetryTimer: ReturnType<typeof setInterval> | null = null;
  /** false = há legenda na tela que a captura não está conseguindo ler. */
  private captureHealthy = true;

  /*
   * O PORTÃO DA CAPTURA.
   *
   * Detectar uma reunião não é mais o mesmo que começar a registrá-la: entre as
   * duas coisas existe uma pergunta. Estes três campos são a resposta a ela.
   *
   * `salaPerguntada` é a sala cuja decisão já está resolvida (aceita, recusada,
   * ou com a pergunta na tela). É ela que impede a pergunta de voltar a cada
   * re-render do Meet — que reemite `onMeetingStart` com frequência — e a cada
   * reconexão curta.
   */
  private salaAnunciada: string | null = null;
  private decisao: DecisaoDeRegistro | null = null;
  private reuniaoPendente: MeetingSession | null = null;
  /** A participação atual — a chave da autorização. Ver consent.ts. */
  private participacaoId: string | null = null;

  private readonly callbacks: CapsulaCallbacks = {
    /*
     * A cápsula pede a sidebar; o background tenta abrir o painel nativo. Quase
     * sempre o Chrome recusa, porque este clique acontece na PÁGINA e o gesto
     * não atravessa a mensageria — a cápsula então explica o caminho que
     * funciona. Ver src/background/sidePanel.ts.
     */
    onAbrirSidebar: () =>
      sendMessage<{ ok?: boolean }>({ type: 'ui/openSidePanel' }).then(
        (r) => r?.ok === true,
      ),
    onPrefsChange: (patch) => this.patchPrefs(patch),
    /*
     * A resposta dada NA PÁGINA. Grava exatamente onde a sidebar gravaria — a
     * decisão é uma só, e por isso responder num lugar apaga a pergunta no
     * outro, sem ninguém coordenar nada.
     */
    onResponder: (decisao) => {
      const id = this.participacaoId;
      if (id) void guardarDecisao(id, decisao);
    },
  };

  /**
   * Pedir uma mudança de preferência é GRAVAR, e só isso.
   *
   * Nada é aplicado localmente aqui, de propósito. O novo valor volta pela
   * assinatura do storage (ver `start`), que é o mesmo caminho por onde chegam
   * as mudanças feitas noutra aba ou no background. Um caminho só significa que
   * não existe versão local divergindo da salva — que era exatamente como o
   * painel de uma aba ficava aberto enquanto o da outra estava minimizado.
   */
  private patchPrefs(patch: Partial<PanelPrefs>): void {
    void patchPanelPrefs(patch);
  }

  constructor(private readonly provider: MeetingProvider) {}

  start(): void {
    this.provider.start();

    this.subscriptions.push(
      this.provider.onMeetingStart((session) => this.considerarReuniaoComLog(session)),

      this.provider.onMeetingEnd(() => {
        // Saiu da sala. A participação é FECHADA, não apagada: voltar em
        // seguida a retoma (queda de conexão), voltar horas depois começa uma
        // nova — com pergunta nova. Ver consent.ts.
        void fecharParticipacao(Date.now());
        this.salaAnunciada = null;
        this.decisao = null;
        this.reuniaoPendente = null;
        this.participacaoId = null;
        void esquecerReuniao();
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
        } else {
          // A VOLTA também é notícia. Só esta aba enxerga o DOM do Meet; sem
          // este recado a sidebar seguiria mostrando "interrompida" depois de a
          // captura já ter voltado a ler.
          void sendMessage({ type: 'meet/captureRecovered' });
        }
        if (this.lastState) this.applyState(this.lastState);
      }),

      onMessage((message) => {
        if (message.type === 'state/updated') {
          this.applyState(message.state);
          return undefined;
        }
        /*
         * O aviso no chat do Meet, pedido pela sidebar. Só esta aba consegue
         * escrever nele — a sidebar é página da extensão e não alcança o DOM
         * da reunião. A resposta é o resultado REAL do envio: um `false` aqui
         * vira "não deu" na tela, nunca uma confirmação.
         */
        if (message.type === 'meet/sendChatNotice') {
          return enviarNoChat(message.text).then((ok) => ({ ok }));
        }
        return undefined;
      }),

      /*
       * A resposta da pergunta chega pelo STORAGE, não por mensagem.
       *
       * Quem pergunta agora é o painel lateral, que é página da extensão: ele
       * não tem como endereçar este content script, e nós não temos como saber
       * quando ele abriu. O storage de sessão é o lugar onde os dois já olham —
       * o painel grava a decisão, o Chrome avisa, e a captura começa aqui.
       */
      observarDecisoes((registro) => {
        // A decisão é chaveada pela PARTICIPAÇÃO, não pela sala: é o que faz um
        // "sim" de ontem não valer para a reunião de hoje no mesmo link.
        const id = this.participacaoId;
        if (!id) return;
        const sessao = this.provider.detectMeeting();

        const decisao = registro[id];
        if (!decisao || decisao === this.decisao) return;

        /*
         * O alvo é escolhido ANTES de a pendência ser limpa.
         *
         * Estava ao contrário, e o "sim" dado na sidebar dependia de
         * `detectMeeting()` responder naquele exato instante: num re-render do
         * Meet ele responde `null` por alguns quadros, e como a pendência já
         * tinha sido apagada na linha anterior, o alvo era `null` — a decisão
         * era gravada, a pergunta sumia das duas superfícies, e a captura
         * simplesmente não começava. Sem erro, sem aviso, sem nada a
         * investigar.
         */
        const alvo = sessao ?? this.reuniaoPendente;

        this.decisao = decisao;
        this.reuniaoPendente = null;
        void esquecerReuniao();

        if (decisao === 'aceito' && alvo) this.iniciarCaptura(alvo);
        else this.rerender();
      }),
    );

    this.participantsTimer = setInterval(
      () => {
        this.pushParticipants();
        this.pushAccountContext();
      },
      PARTICIPANTS_POLL_MS,
    );

    /*
     * As preferências chegam por assinatura, não por leitura única.
     *
     * É o que faz o clique no ícone da extensão abrir ESTE painel: o background
     * grava `presence: 'open'` no storage e o evento chega aqui, sem precisar
     * alcançar a aba com uma mensagem nem reinjetar nada. Vale igual para
     * mudanças feitas noutra aba.
     */
    this.subscriptions.push(
      subscribePanelPrefs((prefs) => {
        this.prefs = prefs;
        this.prefsLoaded = true;
        if (this.lastState) this.applyState(this.lastState);
      }),
    );

    /*
     * A cápsula aparece IMEDIATAMENTE, com ou sem reunião.
     *
     * Antes o primeiro `render` só acontecia quando um estado chegava — de um
     * evento do provider ou de um broadcast. Fora de reunião nenhum dos dois
     * acontece, então em repouso o painel simplesmente nunca era montado. Isso
     * era coerente enquanto o painel só servia para gravar; agora que ele é o
     * produto inteiro, a ausência dele em repouso seria a ausência do TaqCITi.
     */
    void sendMessage<MeetingState>({ type: 'ui/getState' }).then((state) => {
      if (this.lastState === null) this.applyState(state);
    });

    // Script pode ser injetado com a reunião já em andamento (reload da aba).
    const existing = this.provider.detectMeeting();
    if (existing) this.considerarReuniaoComLog(existing);
  }

  /**
   * O portão da captura, com a falha VISÍVEL.
   *
   * `considerarReuniao` é assíncrona e toca o `chrome.storage.session`. Chamada
   * com um `void` solto, qualquer rejeição dela virava uma unhandled rejection
   * que não aparecia em lugar nenhum — e foi assim que a extensão passou a não
   * perguntar mais nada sem ninguém notar: a área de sessão é negada a content
   * scripts por padrão no MV3, a promessa rejeitava, e a pergunta simplesmente
   * não nascia. Ver `background/sessionAccess.ts`.
   *
   * O silêncio é o problema a evitar aqui, não a exceção.
   */
  private considerarReuniaoComLog(session: MeetingSession): void {
    void this.considerarReuniao(session).catch((error) =>
      logger.error('portão da captura falhou: a pergunta não vai aparecer', error),
    );
  }

  // ---------- o portão: registrar esta reunião? ----------

  /**
   * Uma reunião apareceu. Registrar ou não é decisão de quem está nela.
   *
   * Três caminhos, e o que os separa é o que já foi decidido ANTES:
   *
   *   - decisão guardada `aceito`  → a captura recomeça sem perguntar de novo
   *     (é o caso do reload da aba no meio de uma reunião já aceita);
   *   - decisão guardada `recusado` → nada é enviado, e a sidebar mostra que
   *     não há captura, com o caminho de ligar;
   *   - nada guardado → a pergunta aparece, e é só ela que aparece.
   *
   * O guarda do começo é o que impede a pergunta de piscar: o Meet reemite
   * `onMeetingStart` a cada re-render pesado da sala, e sem ele cada um desses
   * eventos reabriria uma pergunta já respondida.
   */
  private async considerarReuniao(session: MeetingSession): Promise<void> {
    if (this.salaAnunciada === session.meetingCode) return;
    this.salaAnunciada = session.meetingCode;

    /*
     * Qual PARTICIPAÇÃO é esta? A mesma de antes se o Meet só re-renderizou ou
     * a aba recarregou; uma nova se a pessoa entrou de novo no mesmo link
     * horas depois. É isso que impede um "sim" de hoje de ligar a captura
     * sozinha na reunião de amanhã, que tem o mesmo endereço. Ver consent.ts.
     */
    const participacao = await abrirParticipacao(session.meetingCode, Date.now());
    this.participacaoId = participacao.id;

    const previa = await decisaoDe(participacao.id);
    if (previa === 'aceito') {
      this.decisao = 'aceito';
      await esquecerReuniao();
      this.iniciarCaptura(session);
      return;
    }
    if (previa === 'recusado') {
      this.decisao = 'recusado';
      await esquecerReuniao();
      this.rerender();
      return;
    }

    /*
     * Sem decisão: ANUNCIA a reunião e para por aqui. Nada é enviado ao
     * background — o que existe é uma sala detectada, não uma captura. Quem
     * pergunta é o painel lateral, que lê este anúncio; e ele pode abrir dez
     * minutos depois e ainda encontrar a pergunta de pé, porque ela é um estado
     * guardado, não um evento que passou.
     */
    this.decisao = null;
    this.reuniaoPendente = session;
    await anunciarReuniao({
      meetingCode: session.meetingCode,
      title: session.title,
      participacaoId: participacao.id,
      tabId: null,
      at: Date.now(),
    });
    this.rerender();
  }


  /** O único lugar que conta ao background que existe uma reunião a registrar. */
  private iniciarCaptura(session: MeetingSession): void {
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

  /** Repinta com o último estado conhecido — o que mudou foi só o daqui. */
  private rerender(): void {
    this.applyState(this.lastState ?? { phase: 'idle', session: null });
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
    // A pausa vale para QUALQUER origem: o botão da sidebar já pausou
    // otimista, mas uma pausa vinda de outra superfície chega só por aqui.
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

    // Nada na tela antes de saber COMO ele deve estar. O estado fica guardado e
    // a assinatura das preferências pinta o primeiro quadro já correto.
    if (!this.prefsLoaded) return;

    this.render(state);
  }

  /**
   * O que esta aba desenha é UMA cápsula.
   *
   * Todo o resto — transcrição, notas, conversa, histórico — mora no painel
   * lateral nativo, que é página da extensão. Aqui ficou só o que precisa estar
   * por cima da reunião: o sinal de que a captura está viva e o caminho de
   * volta para a sidebar.
   *
   * A camada de plataforma continua entrando porque os componentes do kit que a
   * cápsula reaproveita falam com o background por ela.
   */
  private render(state: MeetingState): void {
    if (this.root === null) this.root = createRoot(getMountPoint());
    this.root.render(
      createElement(PlatformProvider, {
        platform: extensionPlatform,
        children: createElement(Capsula, {
          phase: state.phase,
          startedAt: state.session?.startedAt ?? null,
          // O título da sala vai junto: a pergunta na página nomeia a reunião
          // sobre a qual está perguntando.
          perguntandoSobre: this.reuniaoPendente?.title ?? null,
          recusado: this.decisao === 'recusado',
          // Só esta aba enxerga a saúde da captura (é o DOM do Meet que a
          // revela), então é a cápsula que a mostra — e é aqui que a pessoa
          // está olhando quando a legenda para de chegar.
          saudavel: this.captureHealthy,
          prefs: this.prefs,
          callbacks: this.callbacks,
        }),
      }),
    );
  }
}
