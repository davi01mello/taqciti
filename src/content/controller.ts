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
import { DEFAULT_PANEL_PREFS, IDLE_STATE } from '@/shared/types/domain';
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
  autorizaCaptura,
  decisaoDe,
  esquecerReuniao,
  fecharParticipacao,
  gravacaoAContinuar,
  gravacaoAnteriorDaSala,
  guardarDecisao,
  observarDecisoes,
  type DecisaoDeRegistro,
  type GravacaoAnterior,
} from '@/features/meeting/consent';
import { enviarNoChat } from './providers/googleMeet/chat';
import { BotaoNaBarra, type TomDoBotao } from './providers/googleMeet/botaoNaBarra';
import { derivarEstadoDaCaptura, LEITURA_DO_ESTADO } from '@/shared/ui/estadoDaCaptura';
import type { MeetingSession } from '@/features/meeting/provider';

/** Novas tentativas do portão da captura quando o storage de sessão falha. */
const TENTATIVAS_DO_PORTAO = 3;
/** Espera antes da 1ª nova tentativa; triplica a cada uma (1 s, 3 s, 9 s). */
const ESPERA_DO_PORTAO_MS = 1_000;

const PARTICIPANTS_POLL_MS = 5000;

/** Quanto tempo, depois de sair de uma sala registrada, o "sim" vale para a próxima. */
const HERANCA_ENTRE_SALAS_MS = 90_000;

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
  /** A leitura falhou nesta sala: as legendas do Meet ficam visíveis até ela acabar. */
  private legendasLiberadasPorFalha = false;
  /** Até quando o "sim" da sala que acabou de acabar vale para a próxima. */
  private herancaAteEm = 0;

  /**
   * O botão na barra de baixo do Meet. Quando ele está montado, a cápsula
   * flutuante sai da frente (ver `render`); quando a barra não é achada, a
   * cápsula continua como sempre foi.
   */
  private readonly botaoNaBarra = new BotaoNaBarra(() => this.cliqueNaBarra());
  private barraAtiva = false;
  private barraTimer: ReturnType<typeof setInterval> | null = null;

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
  /** A sala em que se está agora, para o "sim" que chega num re-render. */
  private salaAtual: MeetingSession | null = null;
  /**
   * A sala que ESTA aba começou a capturar. O estado global é um só para o
   * navegador; sem saber se ele é desta aba, uma aba do Meet sem "sim" nenhum
   * escondia as próprias legendas, ligava-as sozinha e mostrava na cápsula o
   * relógio da reunião de outra aba.
   */
  private salaDaCaptura: string | null = null;
  /** A última gravação desta sala, oferecida para continuar na pergunta. */
  private gravacaoAnterior: GravacaoAnterior | null = null;

  private readonly callbacks: CapsulaCallbacks = {
    /*
     * A cápsula pede a sidebar; o background abre o painel nativo da aba que
     * mandou a mensagem (ui/openSidePanel, tratada antes de qualquer `await`,
     * para preservar o gesto do clique). Se o Chrome recusar, a cápsula explica
     * o caminho manual. Ver src/background/sidePanel.ts.
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
    onGravarAgora: () => void this.gravarAgora(),
    // (a sidebar chega aqui pela mensagem `meet/gravarAgora`, no `onMessage`)
    salaDisponivel: () => this.provider.salaDaPagina?.() ?? null,
  };

  /**
   * O clique no botão da barra do Meet: abre a sidebar — sempre, e primeiro,
   * porque é o gesto do clique que a autoriza — e, se não há captura nem
   * pergunta pendente, começa a gravar. Com a pergunta de pé, só abre: quem
   * decide registrar é a pessoa, na pergunta.
   */
  private cliqueNaBarra(): void {
    void this.callbacks.onAbrirSidebar();
    const capturando = this.estadoDaCapturaAgora() !== 'desligada' && this.estadoDaCapturaAgora() !== 'salva';
    if (!capturando && this.reuniaoPendente === null) void this.gravarAgora();
  }

  private estadoDaCapturaAgora() {
    const state = this.lastState ?? IDLE_STATE;
    const minha = state.session !== null && state.session.meetingCode === this.salaDaCaptura;
    const eff = minha ? state : IDLE_STATE;
    return derivarEstadoDaCaptura(
      {
        phase: eff.phase,
        captureHealthy: this.captureHealthy,
        startedAt: eff.session?.startedAt ?? null,
        lastChunkAt: eff.session?.lastChunkAt ?? null,
        falas: eff.session?.segments.length ?? 0,
      },
      Date.now(),
    );
  }

  /** Mantém o botão da barra no lugar e conta à cápsula se ele está lá. */
  private sincronizarBarra(): void {
    // A cápsula escondida pela pessoa (o X) esconde também o botão da barra,
    // salvo se há pergunta: uma pergunta sem ninguém para vê-la não anda.
    if (this.prefs.presence === 'closed' && this.reuniaoPendente === null) {
      this.botaoNaBarra.remover();
      if (this.barraAtiva) {
        this.barraAtiva = false;
        this.rerender();
      }
      return;
    }
    const estado = this.estadoDaCapturaAgora();
    const perguntando = this.reuniaoPendente !== null;
    const tom: TomDoBotao = perguntando
      ? 'ambar'
      : estado === 'erro'
        ? 'vermelho'
        : estado === 'capturando'
          ? 'verde'
          : estado === 'desligada' || estado === 'salva'
            ? 'neutro'
            : 'ambar';
    const rotulo = perguntando
      ? 'TaqCiti: registrar esta reunião? Abrir a sidebar'
      : estado === 'desligada' || estado === 'salva'
        ? 'Gravar esta reunião e abrir a sidebar do TaqCiti'
        : `${LEITURA_DO_ESTADO[estado]}. Abrir a sidebar do TaqCiti`;
    const montado = this.botaoNaBarra.sincronizar({
      tom,
      pulsando: estado === 'capturando' && !perguntando,
      rotulo,
    });
    if (montado !== this.barraAtiva) {
      this.barraAtiva = montado;
      this.rerender();
    }
  }

  /**
   * "Gravar esta reunião" — o caminho à mão, quando o automático não pergunta.
   *
   * O automático depende de reconhecer a chamada no DOM do Meet (o botão de
   * sair) e a sala na URL; qualquer mudança do Meet pode silenciá-lo. Aqui a
   * pessoa, que está DENTRO da reunião, diz "grave": o provider passa a tratar
   * a sala como chamada, a decisão vira "aceito" e a captura começa. Não
   * depende de a pergunta ter aparecido nem de storage.onChanged disparar.
   */
  private async gravarAgora(): Promise<boolean> {
    const sala = this.provider.salaDaPagina?.();
    if (!sala) return false;
    // Também é o "tentar de novo": zera as tentativas de ligar as legendas
    // (que desistem em poucas) e religa a leitura.
    this.captionAttempts = 0;
    this.stopCaptionRetries();
    this.provider.reattachCaptions?.();
    // Religar à mão com a leitura falhando: o Meet volta a desenhar as legendas
    // (escondidas elas podem não atualizar), e a pessoa pediu isso.
    if (!this.captureHealthy) {
      this.legendasLiberadasPorFalha = true;
      this.rerender();
    }
    try {
      this.salaAnunciada = sala.meetingCode;
      this.salaAtual = sala;
      const participacao = await abrirParticipacao(sala.meetingCode, Date.now());
      this.participacaoId = participacao.id;
      await guardarDecisao(participacao.id, 'aceito');
      this.decisao = 'aceito';
      this.reuniaoPendente = null;
      void esquecerReuniao();
      this.provider.forceMeeting?.(sala);
      this.iniciarCaptura(sala);
      return true;
    } catch (error) {
      this.salaAnunciada = null;
      logger.error('gravar agora falhou', error);
      return false;
    }
  }

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

      this.provider.onMeetingEnd((encerrada) => {
        // Saiu da sala. A participação é FECHADA, não apagada: voltar em
        // seguida a retoma (queda de conexão), voltar horas depois começa uma
        // nova — com pergunta nova. Ver consent.ts.
        //
        // Participação e pergunta são uma chave só para o navegador inteiro:
        // mexe só se forem DESTA sala. Outra aba pode já ter aberto a sua, e
        // apagá-la aqui sumia com a pergunta da reunião nova.
        void fecharParticipacao(Date.now(), encerrada.meetingCode);
        // Saltar entre salas (de grupo, e de volta) tira a pessoa da chamada por
        // alguns segundos. Quem já tinha dito "sim" não é perguntado de novo se
        // entrar numa sala logo em seguida, NESTA aba.
        this.herancaAteEm = autorizaCaptura(this.decisao) ? Date.now() + HERANCA_ENTRE_SALAS_MS : 0;
        this.salaAnunciada = null;
        this.decisao = null;
        this.reuniaoPendente = null;
        this.gravacaoAnterior = null;
        this.participacaoId = null;
        this.salaAtual = null;
        this.captureHealthy = true;
        void esquecerReuniao(encerrada.meetingCode);
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
        // Nada sai desta aba antes do "sim" a ESTA sala.
        if (!autorizaCaptura(this.decisao)) return;
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
        if (message.type === 'meet/gravarAgora') {
          return this.gravarAgora().then((ok) => ({ ok }));
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
        const alvo = sessao ?? this.reuniaoPendente ?? this.salaAtual;

        this.decisao = decisao;
        this.reuniaoPendente = null;
        void esquecerReuniao();

        if (autorizaCaptura(decisao) && alvo) this.iniciarCaptura(alvo, gravacaoAContinuar(decisao));
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
    this.barraTimer = setInterval(() => this.sincronizarBarra(), MEET_POLL_INTERVAL_MS);

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
  private considerarReuniaoComLog(session: MeetingSession, tentativa = 0): void {
    void this.considerarReuniao(session).catch((error) => {
      /*
       * A sala era marcada como "já anunciada" ANTES das leituras do storage
       * de sessão. Se a primeira falhava — a aba do Meet carregou antes de o
       * service worker liberar a área de sessão, o caso de abrir o navegador
       * com a reunião restaurada —, todo `onMeetingStart` seguinte daquela sala
       * era ignorado, e a pergunta nunca aparecia naquela reunião. Agora a sala
       * volta a poder ser anunciada, e a tentativa se repete (acordando o
       * background, que libera a área no boot) enquanto a pessoa estiver nela.
       */
      if (this.salaAnunciada === session.meetingCode) this.salaAnunciada = null;
      if (tentativa >= TENTATIVAS_DO_PORTAO) {
        logger.error('portão da captura falhou: a pergunta não vai aparecer', error);
        return;
      }
      logger.warn('portão da captura falhou; tentando de novo', { tentativa: tentativa + 1 });
      setTimeout(() => {
        const aindaNaSala =
          this.salaAtual?.meetingCode === session.meetingCode ||
          this.provider.detectMeeting()?.meetingCode === session.meetingCode;
        if (!aindaNaSala || this.salaAnunciada === session.meetingCode) return;
        void sendMessage({ type: 'ui/getState' })
          .catch(() => undefined)
          .finally(() => this.considerarReuniaoComLog(session, tentativa + 1));
      }, ESPERA_DO_PORTAO_MS * 3 ** tentativa);
    });
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
    this.salaAtual = session;

    /*
     * Qual PARTICIPAÇÃO é esta? A mesma de antes se o Meet só re-renderizou ou
     * a aba recarregou; uma nova se a pessoa entrou de novo no mesmo link
     * horas depois. É isso que impede um "sim" de hoje de ligar a captura
     * sozinha na reunião de amanhã, que tem o mesmo endereço. Ver consent.ts.
     */
    const participacao = await abrirParticipacao(session.meetingCode, Date.now());
    this.participacaoId = participacao.id;

    const previa = await decisaoDe(participacao.id);
    if (autorizaCaptura(previa)) {
      this.decisao = previa;
      await esquecerReuniao();
      this.iniciarCaptura(session, gravacaoAContinuar(previa));
      return;
    }
    if (previa === 'recusado') {
      this.decisao = 'recusado';
      await esquecerReuniao();
      this.rerender();
      return;
    }
    if (previa === null && Date.now() < this.herancaAteEm) {
      // Veio de uma sala que já estava sendo registrada, há poucos segundos:
      // segue registrando, sem a pergunta (e a decisão fica guardada).
      this.herancaAteEm = 0;
      await guardarDecisao(participacao.id, 'aceito');
      this.decisao = 'aceito';
      await esquecerReuniao();
      this.iniciarCaptura(session);
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
    // A última gravação desta sala, se houver: a pergunta oferece continuá-la.
    this.gravacaoAnterior = await gravacaoAnteriorDaSala(session.meetingCode).catch(() => null);
    await anunciarReuniao({
      meetingCode: session.meetingCode,
      title: session.title,
      participacaoId: participacao.id,
      tabId: null,
      at: Date.now(),
      ...(this.gravacaoAnterior ? { anterior: this.gravacaoAnterior } : {}),
    });
    this.rerender();
  }


  /** O único lugar que conta ao background que existe uma reunião a registrar. */
  private iniciarCaptura(session: MeetingSession, continuarId: string | null = null): void {
    this.salaDaCaptura = session.meetingCode;
    void sendMessage<MeetingState>({
      type: 'meet/detected',
      meetingCode: session.meetingCode,
      title: session.title,
      captionsEnabled: this.provider.areCaptionsEnabled(),
      ...(continuarId ? { continuarId } : {}),
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
    if (this.barraTimer !== null) clearInterval(this.barraTimer);
    this.botaoNaBarra.remover();
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
    // Qualquer saída da pausa — inclusive direto para o fim —, não só a volta
    // a gravar: pausar e sair deixava a próxima reunião sem captura.
    if (prev?.phase === 'paused') {
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
    const minha =
      state.session !== null && state.session.meetingCode === this.salaDaCaptura;

    // Legendas: liga sozinho enquanto a reunião (DESTA aba) espera por elas.
    if (state.phase === 'captionsRequired' && inMeeting && minha) {
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
    /*
     * As legendas do Meet só voltam à tela por PEDIDO da pessoa ("Religar
     * agora" / "Tentar de novo"): fazê-las aparecer sozinhas, no meio da fala,
     * assustava — e a pessoa pediu que não. Zera quando a sala acaba.
     */
    if (!sessionActive || !minha) this.legendasLiberadasPorFalha = false;
    setNativeCaptionsHidden(
      minha && sessionActive && this.prefs.hideMeetCaptions && !this.legendasLiberadasPorFalha,
    );

    // A aba do Meet fica "visível" para a página enquanto ESTA aba captura:
    // sem isso, atrás de outra aba, o Meet para de atualizar as legendas.
    document.dispatchEvent(
      new CustomEvent('taqciti:visibilidade', { detail: { ativa: minha && sessionActive } }),
    );

    // Nada na tela antes de saber COMO ele deve estar. O estado fica guardado e
    // a assinatura das preferências pinta o primeiro quadro já correto.
    if (!this.prefsLoaded) return;

    // A reunião de OUTRA aba não aparece aqui: esta cápsula fala desta sala.
    this.render(minha ? state : IDLE_STATE);
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
          gravacaoAnterior: this.reuniaoPendente ? this.gravacaoAnterior : null,
          recusado: this.decisao === 'recusado',
          // Só esta aba enxerga a saúde da captura (é o DOM do Meet que a
          // revela), então é a cápsula que a mostra — e é aqui que a pessoa
          // está olhando quando a legenda para de chegar.
          saudavel: this.captureHealthy,
          ultimoTrechoEm: state.session?.lastChunkAt ?? null,
          falas: state.session?.segments.length ?? 0,
          prefs: this.prefs,
          barraAtiva: this.barraAtiva,
          callbacks: this.callbacks,
        }),
      }),
    );
  }
}
