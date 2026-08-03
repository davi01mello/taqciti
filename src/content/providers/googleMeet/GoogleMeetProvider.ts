/**
 * Implementação do MeetingProvider para o Google Meet: detecção de chamada por
 * poll leve + captura de legendas por MutationObserver. Cada linha de legenda
 * do DOM recebe um captionId estável (WeakMap), permitindo que o agregador
 * converta updates progressivos em um único segmento.
 *
 * Três garantias que este arquivo precisa dar, porque cada uma delas já falhou:
 * 1. NENHUMA exceção do DOM do Meet pode matar a captura — tudo que toca o DOM
 *    da página está sob try/catch.
 * 2. "Legendas ligadas" precisa ser verdade, não a mera existência da região:
 *    dizer "gravando" sem capturar nada é o pior estado possível.
 * 3. Se a captura parar, alguém precisa notar: o watchdog reata o observer e
 *    religa as legendas sozinho, e avisa a UI quando não consegue.
 */
import type { MeetingProvider, MeetingSession } from '@/features/meeting/provider';
import type {
  CaptionChunk,
  MeetAccountContext,
  Participant,
  Unsubscribe,
} from '@/shared/types/domain';
import {
  CAPTURE_STALL_TIMEOUT_MS,
  CAPTION_SCAN_INTERVAL_MS,
  MEET_END_CONFIRM_POLLS,
  MEET_POLL_INTERVAL_MS,
} from '@/shared/config/constants';
import { sanitizeCaptionText } from '@/features/transcription/sanitize';
import {
  SpeakerRegistry,
  identityKey,
  type SpeakerRename,
} from '@/features/transcription/speakerIdentity';
import { cleanMeetingTitle } from '@/features/meeting/naming';
import { resolveAgainstBaseline } from '@/features/transcription/recut';
import { logger } from '@/shared/services/log';
import { parseCaptionRegion } from './captionParser';
import { readMeetAccountContext } from './accountContext';
import {
  CAPTION_REGION_SELECTORS,
  CAPTIONS_TOGGLE_SELECTORS,
  LEAVE_CALL_SELECTORS,
  MEETING_CODE_PATTERN,
  PARTICIPANT_NAME_SELECTORS,
  PARTICIPANT_TILE_SELECTOR,
  SELF_NAME_SELECTORS,
  queryFirst,
} from './selectors';

type Callbacks<T> = Set<(value: T) => void>;

function subscribe<T>(set: Callbacks<T>, cb: (value: T) => void): Unsubscribe {
  set.add(cb);
  return () => set.delete(cb);
}

/**
 * Executa algo que toca o DOM do Meet. Falha vira log e valor padrão: o Meet
 * muda sozinho e uma exceção aqui derrubaria a captura inteira.
 */
function safely<T>(what: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (error) {
    logger.error(`meet: ${what} falhou`, error);
    return fallback;
  }
}

export class GoogleMeetProvider implements MeetingProvider {
  readonly id = 'google-meet';

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private inMeeting = false;
  private captionsOn = false;
  private endConfirmCount = 0;
  private currentSession: MeetingSession | null = null;
  private lastMeetingCode: string | null = null;

  private captionRegion: Element | null = null;
  private captionObserver: MutationObserver | null = null;
  private everHadRegion = false;
  /** Varredura agendada: o Meet dispara centenas de mutações por segundo. */
  private scanScheduled = false;
  private lastScanAt = 0;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;

  private nodeIds = new WeakMap<Element, string>();
  /** Último falante emitido por nó: troca de pessoa no mesmo nó vira fala nova. */
  private nodeSpeakers = new WeakMap<Element, string>();
  private nodeIdCounter = 0;
  /** Quem é quem na reunião — inclusive a própria pessoa ("Você" → nome real). */
  private readonly speakers = new SpeakerRegistry();
  /** Histórico por tile. `getParticipants` devolve só a leitura atual. */
  private readonly attendanceByTile = new Map<string, Participant>();
  /** Prefixo único por carga da página: reload/rejoin nunca reusa captionIds
   *  da carga anterior (que podem estar selados na sessão retomada). */
  private readonly instanceTag = Math.random().toString(36).slice(2, 8);
  /** Geração dos captionIds. Sobe a cada recut (retomar/limpar). */
  private captionEpoch = 0;
  /** Texto já visível no momento do recut: só o que vier DEPOIS dele é fala nova. */
  private baselines = new WeakMap<Element, string>();
  /**
   * Nós que existiam no instante do recorte. O que eles disserem a mais nunca é
   * fala nova — é resto do que foi falado durante a pausa. Ver `emitChunk`.
   */
  private quarantined = new WeakSet<Element>();
  /** Captura pausada: o observer sai do ar e nada é emitido. */
  private capturePaused = false;
  private readonly lastEmittedText = new Map<string, string>();

  /** Instante do último chunk emitido — combustível do watchdog. */
  private lastChunkAt = 0;
  /** Momento em que a captura passou a ser esperada (legendas ligadas). */
  private captureExpectedSince = 0;
  private parserDegraded = false;
  private captureStalled = false;
  private healthDegraded = false;

  private readonly startCbs: Callbacks<MeetingSession> = new Set();
  private readonly endCbs: Callbacks<MeetingSession> = new Set();
  private readonly chunkCbs: Callbacks<CaptionChunk> = new Set();
  private readonly captionStateCbs: Callbacks<boolean> = new Set();
  private readonly reconnectCbs: Callbacks<void> = new Set();
  private readonly renameCbs: Callbacks<SpeakerRename[]> = new Set();
  private readonly healthCbs = new Set<
    (healthy: boolean, reason?: 'parser' | 'stall') => void
  >();

  start(): void {
    if (this.pollTimer !== null) return;
    this.pollTimer = setInterval(() => this.poll(), MEET_POLL_INTERVAL_MS);
    this.poll();
  }

  stop(): void {
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.detachCaptionObserver();
  }

  detectMeeting(): MeetingSession | null {
    return safely(
      'detecção de reunião',
      () => {
        const match = MEETING_CODE_PATTERN.exec(window.location.pathname);
        if (!match || !match[1]) return null;
        if (!queryFirst(document, LEAVE_CALL_SELECTORS)) return null;
        // Título vazio (código cru do Meet) é sinal para o background auto-nomear.
        return { meetingCode: match[1], title: cleanMeetingTitle(document.title, match[1]) };
      },
      null,
    );
  }

  onMeetingStart(cb: (session: MeetingSession) => void): Unsubscribe {
    return subscribe(this.startCbs, cb);
  }

  onMeetingEnd(cb: (session: MeetingSession) => void): Unsubscribe {
    return subscribe(this.endCbs, cb);
  }

  areCaptionsAvailable(): boolean {
    return safely(
      'busca do botão de legendas',
      () => queryFirst(document, CAPTIONS_TOGGLE_SELECTORS) !== null,
      false,
    );
  }

  /**
   * Legendas realmente LIGADAS.
   *
   * A versão antiga respondia "sim" só porque a região existia no DOM — e o
   * Meet mantém essa região montada e vazia com as legendas desligadas. O
   * resultado era o pior estado possível: o painel dizia "gravando", parava de
   * tentar religar, e nada era capturado. Agora a região só conta quando tem
   * conteúdo; fora isso, vale o estado do botão.
   */
  areCaptionsEnabled(): boolean {
    return safely(
      'leitura do estado das legendas',
      () => {
        const toggle = queryFirst(document, CAPTIONS_TOGGLE_SELECTORS);
        const pressed = toggle?.getAttribute('aria-pressed');
        if (pressed === 'true') return true;
        if (pressed === 'false') return false;

        const region = queryFirst(document, CAPTION_REGION_SELECTORS);
        return (region?.textContent ?? '').trim().length > 0;
      },
      false,
    );
  }

  onCaptionChunk(cb: (chunk: CaptionChunk) => void): Unsubscribe {
    return subscribe(this.chunkCbs, cb);
  }

  onCaptionsStateChange(cb: (enabled: boolean) => void): Unsubscribe {
    return subscribe(this.captionStateCbs, cb);
  }

  onReconnect(cb: () => void): Unsubscribe {
    this.reconnectCbs.add(cb as (value: void) => void);
    return () => this.reconnectCbs.delete(cb as (value: void) => void);
  }

  /** Fusões de identidade a aplicar na transcrição já capturada. */
  onSpeakersMerged(cb: (renames: SpeakerRename[]) => void): Unsubscribe {
    return subscribe(this.renameCbs, cb);
  }

  /** `true` = capturando normalmente; `false` = captura parada, religando. */
  onCaptureHealth(
    cb: (healthy: boolean, reason?: 'parser' | 'stall') => void,
  ): Unsubscribe {
    this.healthCbs.add(cb);
    return () => this.healthCbs.delete(cb);
  }

  requestEnableCaptions(): boolean {
    return safely(
      'clique no botão de legendas',
      () => {
        if (this.areCaptionsEnabled()) return true;
        const toggle = queryFirst(document, CAPTIONS_TOGGLE_SELECTORS);
        if (toggle instanceof HTMLElement) {
          toggle.click();
          return true;
        }
        return false;
      },
      false,
    );
  }

  /**
   * "Recorta" a captura no instante atual — chamado ao RETOMAR uma pausa e ao
   * APAGAR a transcrição.
   *
   * Existe por um detalhe crítico do Meet: ele REAPROVEITA os mesmos elementos
   * de legenda no DOM. Como pausar/limpar sela os captionIds das falas
   * visíveis, sem o recorte esses mesmos nós continuariam emitindo com ids
   * selados e TODA fala posterior seria descartada — a captura morreria em
   * silêncio ao retomar.
   *
   * O recorte troca a geração dos ids (nós viram falas novas) e guarda o texto
   * já na tela como linha de base, para que o que foi dito durante a pausa não
   * entre retroativamente na transcrição.
   */
  recutCaptions(): void {
    this.captionEpoch += 1;
    this.nodeIds = new WeakMap();
    this.baselines = new WeakMap();
    this.nodeSpeakers = new WeakMap();
    this.quarantined = new WeakSet();
    this.lastEmittedText.clear();

    const region = this.captionRegion;
    if (!region) return;

    safely(
      'recorte da captura',
      () => {
        for (const line of parseCaptionRegion(region).lines) {
          // Todo nó presente AGORA é passado: o que ele disser a mais é resto
          // do que foi falado durante a pausa, nunca fala nova.
          this.quarantined.add(line.node);
          const text = sanitizeCaptionText(line.text);
          if (text.length > 0) this.baselines.set(line.node, text);
        }
      },
      undefined,
    );
  }

  /**
   * Liga e desliga a captura de verdade.
   *
   * Pausar DESCONECTA o observer. O flag existe porque o poll de 1,5s chama
   * `ensureCaptionObserver` e religaria a observação sozinho — desconectar sem
   * o flag duraria menos de dois segundos.
   *
   * Retomar recorta a captura: nada do que foi dito durante a pausa entra.
   */
  setCapturePaused(paused: boolean): void {
    if (paused === this.capturePaused) return;
    this.capturePaused = paused;

    if (paused) {
      this.captionObserver?.disconnect();
      this.captionObserver = null;
      return;
    }

    // Ao retomar, o observer se recola no poll seguinte (ou já agora, se a
    // região continua na tela) e o recorte apaga o passado.
    this.ensureCaptionObserver(true);
    this.recutCaptions();
  }

  /**
   * Presença atual vem somente de tiles/roster confiáveis e é reconciliada em
   * toda leitura. Legendas alimentam `speakersObserved`, nunca esta lista. O
   * registro ainda normaliza "Você" e sufixos quando há sinal estável.
   */
  getParticipants(): Participant[] | null {
    return safely(
      'leitura dos participantes',
      () => {
        this.refreshSelfName();
        const candidates = [...document.querySelectorAll(PARTICIPANT_TILE_SELECTOR)];
        if (candidates.length === 0) return null;
        const captionSelector = CAPTION_REGION_SELECTORS.join(',');
        const present: Participant[] = [];
        let trustedTiles = 0;
        const now = Date.now();

        for (const tile of candidates) {
          // Avatares de legenda podem carregar data-participant-id, mas não são
          // uma superfície de presença e nunca entram nesta lista.
          if (tile.closest(captionSelector)) continue;
          trustedTiles += 1;
          let resolved: string | null = null;
          const rawStableId =
            tile.getAttribute('data-participant-id') ??
            tile.getAttribute('data-user-id') ??
            '';
          for (const selector of PARTICIPANT_NAME_SELECTORS) {
            const el = tile.matches(selector) ? tile : tile.querySelector(selector);
            const raw = el?.getAttribute('data-self-name') ?? el?.textContent ?? null;
            const stableId = rawStableId || `name:${identityKey(raw ?? '')}`;
            if (raw) resolved = this.speakers.observeParticipant(raw, stableId);
            if (resolved) break;
          }
          if (!resolved) continue;

          const stableId = rawStableId || `name:${identityKey(resolved)}`;
          const previous = this.attendanceByTile.get(stableId);
          const participant: Participant = {
            name: resolved,
            isHost: this.speakers.getSelfName() === null ? null : this.speakers.isSelf(resolved),
            providerParticipantId: stableId,
            firstSeenAt: previous?.firstSeenAt ?? now,
            lastSeenAt: now,
            source: tile.closest('[role="list"], [role="listitem"]')
              ? 'meet_roster'
              : 'meet_tile',
            confidence: 0.95,
          };
          this.attendanceByTile.set(stableId, participant);
          present.push(participant);
        }
        this.flushRenames();
        if (trustedTiles === 0) return null;
        return present;
      },
      null,
    );
  }

  getAccountContext(): MeetAccountContext | null {
    return safely(
      'leitura do contexto da conta do Meet',
      () => readMeetAccountContext(document),
      null,
    );
  }

  // ---------------- interno ----------------

  /** Procura o nome real de quem está na máquina e alimenta o registro. */
  private refreshSelfName(): void {
    if (this.speakers.getSelfName() !== null) return;
    for (const selector of SELF_NAME_SELECTORS) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const raw = el.getAttribute('data-self-name') ?? el.textContent ?? null;
      if (raw && raw.trim().length > 0) {
        this.speakers.setSelfName(raw);
        if (this.speakers.getSelfName() !== null) return;
      }
    }
  }

  /** Publica as fusões de identidade para a máquina corrigir o já capturado. */
  private flushRenames(): void {
    const renames = this.speakers.drainRenames();
    if (renames.length > 0) this.renameCbs.forEach((cb) => cb(renames));
  }

  private poll(): void {
    const session = this.detectMeeting();

    if (session && !this.inMeeting) {
      if (session.meetingCode !== this.lastMeetingCode) {
        this.resetRoomIdentity();
        this.lastMeetingCode = session.meetingCode;
      }
      this.inMeeting = true;
      this.endConfirmCount = 0;
      this.currentSession = session;
      this.startCbs.forEach((cb) => cb(session));
    } else if (!session && this.inMeeting) {
      // Confirmação dupla evita falso fim durante re-render do Meet.
      this.endConfirmCount += 1;
      if (this.endConfirmCount >= MEET_END_CONFIRM_POLLS) {
        this.inMeeting = false;
        const ended = this.currentSession;
        this.currentSession = null;
        this.detachCaptionObserver();
        if (ended) this.endCbs.forEach((cb) => cb(ended));
      }
    } else {
      this.endConfirmCount = 0;
    }

    if (!this.inMeeting) return;

    const captionsNow = this.areCaptionsEnabled();
    if (captionsNow !== this.captionsOn) {
      this.captionsOn = captionsNow;
      this.captureExpectedSince = captionsNow ? Date.now() : 0;
      this.captionStateCbs.forEach((cb) => cb(captionsNow));
    }
    this.ensureCaptionObserver();
    this.refreshSelfName();
    this.flushRenames();
    this.checkCaptureHealth();
  }

  /** Uma sala diferente não herda falantes, tiles nem ids de legenda. */
  private resetRoomIdentity(): void {
    this.speakers.reset();
    this.attendanceByTile.clear();
    this.nodeIds = new WeakMap();
    this.nodeSpeakers = new WeakMap();
    this.baselines = new WeakMap();
    this.quarantined = new WeakSet();
    this.lastEmittedText.clear();
    this.captionEpoch += 1;
    this.nodeIdCounter = 0;
    this.lastChunkAt = 0;
    this.captureExpectedSince = 0;
    this.parserDegraded = false;
    this.captureStalled = false;
    this.healthDegraded = false;
  }

  /**
   * Watchdog: legendas ligadas há tempo suficiente e nenhum chunk chegando
   * significa que a captura morreu em silêncio (o Meet recriou a região, o
   * observer descolou, ou as legendas caíram sem avisar). Reata tudo e conta
   * para a UI — o painel avisa em vez de fingir que está gravando.
   */
  private checkCaptureHealth(): void {
    if (!this.captionsOn || this.captureExpectedSince === 0) {
      this.setCaptureStalled(false);
      return;
    }

    const since = Math.max(this.lastChunkAt, this.captureExpectedSince);
    const stalled = Date.now() - since > CAPTURE_STALL_TIMEOUT_MS;
    if (!stalled) {
      this.setCaptureStalled(false);
      return;
    }

    // Silêncio de verdade não é falha: só reagimos quando há legenda na tela
    // que não estamos conseguindo ler.
    const region = queryFirst(document, CAPTION_REGION_SELECTORS);
    const hasVisibleCaption = (region?.textContent ?? '').trim().length > 0;
    if (!hasVisibleCaption) return;

    logger.debug('meet: captura parada, reatando o observer');
    this.setCaptureStalled(true);
    this.detachCaptionObserver();
    this.ensureCaptionObserver();
  }

  private setParserDegraded(degraded: boolean): void {
    this.parserDegraded = degraded;
    this.publishCaptureHealth();
  }

  private setCaptureStalled(stalled: boolean): void {
    this.captureStalled = stalled;
    this.publishCaptureHealth();
  }

  private publishCaptureHealth(): void {
    const degraded = this.parserDegraded || this.captureStalled;
    if (this.healthDegraded === degraded) return;
    this.healthDegraded = degraded;
    const reason = degraded
      ? this.parserDegraded
        ? ('parser' as const)
        : ('stall' as const)
      : undefined;
    this.healthCbs.forEach((cb) => cb(!degraded, reason));
  }

  /** `force` reobserva a mesma região (usado ao retomar da pausa). */
  private ensureCaptionObserver(force = false): void {
    // Pausado é pausado: nem o poll religa a observação.
    if (this.capturePaused) return;

    const region = queryFirst(document, CAPTION_REGION_SELECTORS);
    if (region === this.captionRegion && !force) return;
    if (region === this.captionRegion && this.captionObserver) return;

    this.detachCaptionObserver();
    this.captionRegion = region;
    if (!region) return;

    if (this.everHadRegion) {
      // Região recriada pelo Meet → o observer precisou se recolar.
      this.reconnectCbs.forEach((cb) => cb());
    }
    this.everHadRegion = true;

    this.captionObserver = new MutationObserver(() => this.scheduleScan());
    this.captionObserver.observe(region, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    this.scanCaptions();
  }

  private detachCaptionObserver(): void {
    this.captionObserver?.disconnect();
    this.captionObserver = null;
    this.captionRegion = null;
    if (this.scanTimer !== null) clearTimeout(this.scanTimer);
    this.scanTimer = null;
    this.scanScheduled = false;
  }

  /**
   * Agrupa as mutações numa varredura periódica. O Meet reescreve a região de
   * legendas dezenas de vezes por segundo; varrer a cada mutação torrava CPU
   * na aba da reunião sem capturar nada a mais.
   */
  private scheduleScan(): void {
    if (this.scanScheduled) return;
    this.scanScheduled = true;

    const elapsed = Date.now() - this.lastScanAt;
    const wait = Math.max(0, CAPTION_SCAN_INTERVAL_MS - elapsed);
    this.scanTimer = setTimeout(() => {
      this.scanScheduled = false;
      this.scanTimer = null;
      this.scanCaptions();
    }, wait);
  }

  private scanCaptions(): void {
    if (this.capturePaused) return;
    const region = this.captionRegion;
    if (!region) return;
    this.lastScanAt = Date.now();

    safely(
      'varredura das legendas',
      () => {
        this.refreshSelfName();

        // O parser cuida da atribuição de falante (estrutural, imune à troca de
        // classe do Meet) e filtra o chrome nativo ("Ir para o final" etc.).
        const parsed = parseCaptionRegion(region);
        for (const line of parsed.lines) {
          const speaker = this.speakers.resolve(line.speaker);
          const text = sanitizeCaptionText(line.text);
          this.emitChunk(line.node, speaker, text);
        }
        this.setParserDegraded(parsed.source === 'degraded');
        this.flushRenames();
      },
      undefined,
    );
  }

  private emitChunk(node: Element, speaker: string | null, rawText: string): void {
    if (this.capturePaused) return;
    let text = rawText;
    if (text.length === 0) return;

    // O Meet reaproveita nós de legenda: se o falante DESTE nó mudou, é outra
    // fala — solta o id antigo pra nascer um segmento novo, senão a fala de
    // quem entrou grudaria na linha de quem já estava (o bug de mistura).
    const prevSpeaker = this.nodeSpeakers.get(node);
    if (speaker !== null && prevSpeaker !== undefined && prevSpeaker !== speaker) {
      this.nodeIds.delete(node);
      this.baselines.delete(node);
    }
    if (speaker !== null) this.nodeSpeakers.set(node, speaker);

    // Linha de base do recorte: a regra vive em `recut.ts`, pura e testada.
    const decision = resolveAgainstBaseline(
      text,
      this.baselines.get(node),
      this.quarantined.has(node),
    );
    if (decision.action === 'skip') return;
    if (decision.action === 'rebaseline') {
      // Nó de quarentena com a base quebrada: é resto da pausa, não fala nova.
      this.baselines.set(node, decision.baseline);
      return;
    }
    if (decision.action === 'reset') {
      // Nó nascido depois do recorte: aí sim, o Meet trocou a fala da linha.
      this.baselines.delete(node);
      this.nodeIds.delete(node);
    }
    text = decision.text;

    let captionId = this.nodeIds.get(node);
    if (!captionId) {
      this.nodeIdCounter += 1;
      captionId = `cap-${this.instanceTag}-${this.captionEpoch}-${this.nodeIdCounter}`;
      this.nodeIds.set(node, captionId);
    }

    if (this.lastEmittedText.get(captionId) === text) return;
    this.lastEmittedText.set(captionId, text);
    if (this.lastEmittedText.size > 500) {
      const oldest = this.lastEmittedText.keys().next().value;
      if (oldest !== undefined) this.lastEmittedText.delete(oldest);
    }

    this.lastChunkAt = Date.now();
    this.setCaptureStalled(false);
    const chunk: CaptionChunk = { captionId, speaker, text, atMs: this.lastChunkAt };
    this.chunkCbs.forEach((cb) => cb(chunk));
  }
}
