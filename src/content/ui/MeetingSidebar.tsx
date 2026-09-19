/**
 * A SIDEBAR DE REUNIÃO — a única superfície do TaqCiti dentro do Meet.
 *
 * ── O que ela deixou de ser ────────────────────────────────────────────────
 *
 * Era uma janela flutuante que abria em QUALQUER aba e trazia junto o histórico
 * inteiro, a busca, o detalhe de uma reunião antiga e o gerador de documento.
 * Fazia sentido enquanto ela era o produto. Agora o produto é a HOME, e o que
 * sobra aqui é o que só existe DURANTE uma reunião: perguntar se é para
 * registrar, mostrar o estado real da captura e oferecer os controles dela.
 *
 * Histórico, documentos e conversas moram na HOME — a um clique daqui, e sem
 * duas telas mostrando a mesma lista de jeitos diferentes.
 *
 * ── Por que é uma sidebar encostada, e não uma janelinha ───────────────────
 *
 * Numa chamada, o que está no centro da tela é a chamada. Uma janela flutuante
 * disputa esse centro e precisa ser arrastada para sair da frente; uma faixa
 * encostada na direita ocupa o lugar onde o Meet já põe painéis (chat, pessoas)
 * e é lida como parte do ambiente. A cápsula continua sendo a porta: recolhida,
 * ela é um botão pequeno e arrastável; aberta, a faixa desliza de fora.
 *
 * ── Os dois eixos que sobraram ─────────────────────────────────────────────
 *
 *   PRESENÇA   closed → minimized → open   (some / cápsula / faixa)
 *   CONTEÚDO   é função do estado da reunião, e de mais nada
 *
 * A ROTA acabou: ela existia para navegar no histórico de dentro do painel.
 * `closed` e `minimized` continuam sendo coisas diferentes — minimizar deixa a
 * cápsula à mão, fechar tira o TaqCiti da tela até um gesto explícito.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type {
  CaptionLanguage,
  MeetingRecord,
  MeetingSessionState,
  MeetingState,
  PanelPrefs,
} from '@/shared/types/domain';
import { EXPECTED_CAPTION_LANGUAGE } from '@/shared/config/constants';
import { buildMeetingRecord } from '@/features/meeting/payload';
import { downloadTranscript, transcriptToText } from '@/features/history/export';
import { Button } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Sheen, SHEEN_HOST, SHEEN_HOST_POSITIONED, trackSheen } from '@/shared/ui/Sheen';
import { TranscriptView } from '@/shared/ui/TranscriptView';
import { Wave } from '@/shared/ui/Wave';
import { Wordmark } from '@/shared/ui/Wordmark';
import { AccountBoundaryNotice } from '@/shared/ui/AccountBoundaryNotice';
import { countWords, formatCount, formatElapsedClock, hostName } from '@/shared/ui/format';
import { detectNextMeeting, type NextMeetingHypothesis } from '@/features/meeting/nextMeeting';
import { useFloating } from './useFloating';
import { PANEL_OPEN_EVENT } from './mount';

export interface PanelCallbacks {
  onPause(): void;
  onResume(): void;
  onFinish(): void;
  onRename(title: string): void;
  /** Abre a HOME numa aba — a página principal. Com `recordId`, já na reunião. */
  onOpenHome(target?: { recordId?: string }): void;
  onResumeCapture(): void;
  onCloseEnded(): void;
  onEnableCaptions(): void;
  onDismissLanguageWarning(): void;
  onToggleNativeCaptions(hidden: boolean): void;
  /** Grava preferências (posição, presença). Sempre um patch. */
  onPrefsChange(patch: Partial<PanelPrefs>): void;
  /** "Sim, registre": é ISTO que liga a captura, e nada antes disso. */
  onAceitarRegistro(): void;
  /** "Agora não". A captura fica desligada; dá para começar depois. */
  onRecusarRegistro(): void;
}

export interface PanelContext {
  inMeeting: boolean;
  captionsAutoFailed: boolean;
  nativeCaptionsHidden: boolean;
  /** false = há legenda na tela que a captura não está lendo (religando). */
  captureHealthy: boolean;
  /** Reunião detectada esperando a resposta de "registrar?". `null` = não há. */
  aguardandoResposta: { title: string } | null;
  /** A pessoa disse "agora não" para esta reunião. */
  registroRecusado: boolean;
}

interface Props {
  state: MeetingState;
  ctx: PanelContext;
  prefs: PanelPrefs;
  callbacks: PanelCallbacks;
}

const TOAST_MS = 2200;
const SIDEBAR_WIDTH = 372;

export function MeetingSidebar({ state, ctx, prefs, callbacks }: Props) {
  /*
   * A presença vive nas PREFERÊNCIAS, não aqui: a navegação do Meet desmonta
   * este componente inteiro, e o que precisa atravessar isso tem que estar no
   * storage antes de a página descarregar.
   */
  const expanded = prefs.presence === 'open';
  const [toast, setToast] = useState<string | null>(null);

  const session = state.session;
  const phase = state.phase;
  const live = phase === 'recording' || phase === 'paused';
  const perguntando = ctx.aguardandoResposta !== null;

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  /*
   * A cápsula é a única caixa que flutua, então é a única que o hook posiciona.
   * A faixa é docada na direita pelo CSS — daí o painel entrar aqui com caixa
   * zerada, e a geometria dele ser ignorada.
   */
  const semCaixa = useMemo(() => ({ width: 0, height: 0 }), []);
  const floating = useFloating({
    x: prefs.x,
    y: prefs.y,
    panel: semCaixa,
    onMove: (x, y) => callbacks.onPrefsChange({ x, y }),
  });

  const open = useCallback(
    () => callbacks.onPrefsChange({ presence: 'open' }),
    [callbacks],
  );
  const minimize = useCallback(
    () => callbacks.onPrefsChange({ presence: 'minimized' }),
    [callbacks],
  );
  const close = useCallback(
    () => callbacks.onPrefsChange({ presence: 'closed' }),
    [callbacks],
  );

  // Relógio: só corre enquanto a reunião está viva.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);

  /*
   * A pergunta precisa ser VISTA: uma reunião detectada abre a faixa, mesmo se
   * ela estava recolhida ou fechada. É o único momento em que o TaqCiti reabre
   * sozinho, e é justificado — sem isso a pergunta ficaria atrás de uma cápsula
   * e a captura nunca começaria. O fim da reunião abre pelo mesmo motivo: a
   * transcrição recém-salva não pode ficar escondida.
   */
  useEffect(() => {
    if (perguntando || phase === 'ended') callbacks.onPrefsChange({ presence: 'open' });
    // Reage à MUDANÇA, não a cada gravação de preferência: com `callbacks` e
    // `prefs` nas dependências este efeito desfaria o "minimizar" no quadro
    // seguinte ao clique.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perguntando, phase]);

  // Esc recolhe; Alt+Shift+T abre e fecha sem tirar a mão do teclado.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && expanded) {
        minimize();
        return;
      }
      if (event.altKey && event.shiftKey && event.code === 'KeyT') {
        event.preventDefault();
        if (expanded) minimize();
        else open();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded, open, minimize]);

  // Clicar no ícone na aba da reunião: ver PANEL_OPEN_EVENT.
  useEffect(() => {
    const onOpenRequest = () => open();
    document.addEventListener(PANEL_OPEN_EVENT, onOpenRequest);
    return () => document.removeEventListener(PANEL_OPEN_EVENT, onOpenRequest);
  }, [open]);

  const elapsed = useMemo(() => {
    if (!session) return '00:00';
    return formatElapsedClock((session.endedAt ?? now) - session.startedAt);
  }, [session, now]);

  const hypothesis = useMemo(
    () => detectNextMeeting(session?.segments ?? [], session?.startedAt ?? 0),
    [session?.segments, session?.startedAt],
  );

  const copySegments = (segments: MeetingRecord['segments']) => {
    if (segments.length === 0) {
      showToast('Nada capturado ainda');
      return;
    }
    void navigator.clipboard
      .writeText(transcriptToText(segments))
      .then(() => showToast('Transcrição copiada'))
      .catch(() => showToast('Não foi possível copiar'));
  };

  /** Sem captura acontecendo a cápsula fica apagada, não verde. */
  const tone = perguntando
    ? 'amber'
    : phase === 'recording'
      ? 'green'
      : phase === 'paused' || phase === 'captionsRequired'
        ? 'amber'
        : 'dim';

  // O estado "fechado" inteiro: nem cápsula, nem resíduo.
  if (prefs.presence === 'closed') return null;

  const rotuloCapsula = perguntando
    ? 'registrar?'
    : live
      ? elapsed
      : phase === 'captionsRequired'
        ? 'preparando…'
        : phase === 'ended'
          ? 'salva'
          : ctx.registroRecusado
            ? 'sem registro'
            : 'TaqCiti';

  return (
    <>
      {/* ---------- cápsula recolhida ---------- */}
      <button
        ref={floating.capsuleRef as RefObject<HTMLButtonElement>}
        type="button"
        title="TaqCiti — clique para abrir, arraste para mover"
        {...floating.dragHandlers}
        onPointerMove={(event) => {
          floating.dragHandlers.onPointerMove(event);
          trackSheen(event);
        }}
        onPointerUp={(event) => {
          floating.dragHandlers.onPointerUp(event);
          if (floating.wasClick()) open();
        }}
        style={{ left: floating.geometry.capsule.left, top: floating.geometry.capsule.top }}
        className={`glass ${SHEEN_HOST_POSITIONED} fixed z-[2147483000] flex items-center gap-2.5 rounded-full py-2.5 pl-3.5 pr-4 text-body font-semibold tabular-nums text-foreground transition-[opacity,transform] duration-300 ease-flow animate-dock-in ${
          floating.dragging ? 'cursor-grabbing' : 'cursor-grab'
        } ${expanded ? 'pointer-events-none scale-90 opacity-0' : 'opacity-100'}`}
      >
        <Sheen />
        <Wave size={16} animated={phase === 'recording'} tone={tone} />
        <span className={live ? '' : 'text-muted'}>{rotuloCapsula}</span>
        {phase === 'recording' && (
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-dot" />
        )}
      </button>

      {/* ---------- a faixa ---------- */}
      <aside
        aria-label="TaqCiti nesta reunião"
        style={{ width: SIDEBAR_WIDTH }}
        className={`glass fixed bottom-0 right-0 top-0 z-[2147483001] grid max-w-[92vw] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-l-card border-l border-white/[0.07] transition-[transform,opacity] duration-300 ease-flow ${
          expanded
            ? 'pointer-events-auto translate-x-0 opacity-100'
            : 'pointer-events-none translate-x-6 opacity-0'
        }`}
      >
        <SidebarHeader
          status={
            perguntando
              ? 'Aguardando'
              : phase === 'recording'
                ? elapsed
                : phase === 'paused'
                  ? `Pausado · ${elapsed}`
                  : phase === 'captionsRequired'
                    ? 'Preparando'
                    : phase === 'ended'
                      ? `Salva · ${elapsed}`
                      : ctx.registroRecusado
                        ? 'Sem registro'
                        : 'Nesta reunião'
          }
          onOpenHome={() => callbacks.onOpenHome()}
          onMinimize={minimize}
          onClose={close}
        />

        <div className="flex min-h-0 flex-col px-3.5 pb-3.5">
          <SidebarBody
            state={state}
            ctx={ctx}
            toast={toast}
            hypothesis={hypothesis}
            callbacks={callbacks}
            onCopy={copySegments}
            onToast={showToast}
          />
        </div>
      </aside>
    </>
  );
}

// ---------- o corpo, pelo estado real da reunião ----------

function SidebarBody({
  state,
  ctx,
  toast,
  hypothesis,
  callbacks,
  onCopy,
  onToast,
}: {
  state: MeetingState;
  ctx: PanelContext;
  toast: string | null;
  hypothesis: NextMeetingHypothesis;
  callbacks: PanelCallbacks;
  onCopy: (segments: MeetingRecord['segments']) => void;
  onToast: (message: string) => void;
}) {
  const session = state.session;
  const phase = state.phase;

  /*
   * A pergunta vem ANTES de tudo, inclusive de um estado antigo na tela: é o
   * momento em que nada foi capturado ainda e a decisão é de quem está na sala.
   */
  if (ctx.aguardandoResposta) {
    return (
      <AskToRecordScreen
        title={ctx.aguardandoResposta.title}
        onAccept={callbacks.onAceitarRegistro}
        onDecline={callbacks.onRecusarRegistro}
      />
    );
  }

  if (phase === 'captionsRequired') {
    return (
      <PreparingScreen failed={ctx.captionsAutoFailed} onEnable={callbacks.onEnableCaptions} />
    );
  }

  if (phase === 'ended' && session) {
    if (session.segments.length === 0) {
      return (
        <EmptyCaptureScreen
          inMeeting={ctx.inMeeting}
          onResumeCapture={callbacks.onResumeCapture}
          onClose={callbacks.onCloseEnded}
        />
      );
    }
    const record = buildMeetingRecord(session, 'ready');
    return (
      <SavedScreen
        record={record}
        onCopy={() => onCopy(record.segments)}
        onDownload={() => {
          downloadTranscript(record);
          onToast('Baixando .txt');
        }}
        onOpenHome={() => callbacks.onOpenHome({ recordId: record.id })}
        onClose={callbacks.onCloseEnded}
      />
    );
  }

  if (session && (phase === 'recording' || phase === 'paused')) {
    return (
      <LiveBody
        session={session}
        phase={phase}
        ctx={ctx}
        toast={toast}
        hypothesis={hypothesis}
        callbacks={callbacks}
        onCopy={() => onCopy(session.segments)}
        onToast={onToast}
      />
    );
  }

  /*
   * Em repouso dentro de uma reunião: ou a pessoa recusou, ou a sala ainda não
   * foi detectada. Nos dois casos a tela DIZ que não há captura, em vez de
   * mostrar um painel vazio que parece quebrado — e oferece o caminho de ligar.
   */
  return (
    <IdleScreen
      recusado={ctx.registroRecusado}
      inMeeting={ctx.inMeeting}
      onStart={callbacks.onAceitarRegistro}
      onOpenHome={() => callbacks.onOpenHome()}
    />
  );
}

/**
 * A PERGUNTA. Nada é capturado antes de ela ser respondida.
 *
 * O texto diz o que é capturado — as legendas do Meet — porque "gravar a
 * reunião" faria pensar em áudio e vídeo, que esta extensão nunca tocou.
 */
function AskToRecordScreen({
  title,
  onAccept,
  onDecline,
}: {
  title: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center px-1 py-2 animate-fade-in motion-reduce:animate-none">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-full border border-primary/25 bg-primary/[0.07]">
        <Wave size={22} tone="green" animated />
      </div>
      <h2 className="text-title font-semibold">Registrar esta reunião?</h2>
      <p className="mt-1.5 text-body leading-relaxed text-muted">
        O TaqCiti pode acompanhar <strong className="font-medium text-foreground">
        {title}</strong> e guardar a transcrição neste computador.
      </p>
      <p className="mt-2.5 text-caption leading-relaxed text-muted/85">
        O que é lido são as <strong className="font-medium">legendas do Meet</strong> — não
        há gravação de áudio nem de vídeo, e nada sai daqui.
      </p>

      <div className="mt-5 flex flex-col gap-2">
        <Button variant="primary" className="w-full" onClick={onAccept}>
          Registrar
        </Button>
        <Button variant="ghost" className="w-full" onClick={onDecline}>
          Agora não
        </Button>
      </div>
      <p className="mt-3 text-micro leading-relaxed text-muted/75">
        Dizendo não, nada é capturado. Dá para começar depois, por aqui mesmo.
      </p>
    </div>
  );
}

/** Reunião sem captura: o estado real, e o caminho de ligar. */
function IdleScreen({
  recusado,
  inMeeting,
  onStart,
  onOpenHome,
}: {
  recusado: boolean;
  inMeeting: boolean;
  onStart: () => void;
  onOpenHome: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-3 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-full border border-white/10 bg-white/[0.04]">
        <Wave size={20} tone="dim" />
      </div>
      <h2 className="text-title font-semibold">
        {recusado ? 'Captura desligada' : 'Nada sendo capturado'}
      </h2>
      <p className="mt-1.5 max-w-[260px] text-body leading-relaxed text-muted">
        {recusado
          ? 'Esta reunião não está sendo registrada. Você pode começar quando quiser.'
          : 'Ainda não há reunião detectada nesta aba.'}
      </p>
      {inMeeting && (
        <Button variant="primary" className="mt-5 w-full" onClick={onStart}>
          Começar a registrar
        </Button>
      )}
      <Button variant="ghost" size="compact" className="mt-2 w-full" onClick={onOpenHome}>
        <Icon name="sparkles" size={14} />
        Abrir o TaqCiti
      </Button>
    </div>
  );
}

/** A transcrição foi salva. A leitura inteira é na HOME; aqui, o essencial. */
function SavedScreen({
  record,
  onCopy,
  onDownload,
  onOpenHome,
  onClose,
}: {
  record: MeetingRecord;
  onCopy: () => void;
  onDownload: () => void;
  onOpenHome: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 py-1 animate-fade-in motion-reduce:animate-none">
      <div className="shrink-0">
        <h2 className="truncate text-title font-semibold">Transcrição salva</h2>
        <p className="mt-1 text-body leading-relaxed text-muted">
          {record.segments.length}{' '}
          {record.segments.length === 1 ? 'fala guardada' : 'falas guardadas'} no
          histórico deste computador.
        </p>
      </div>

      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" size="compact" className="flex-1" onClick={onCopy}>
          Copiar
        </Button>
        <Button variant="secondary" size="compact" className="flex-1" onClick={onDownload}>
          Baixar .txt
        </Button>
      </div>

      <div className="scroll-region min-h-0 flex-1">
        <TranscriptView
          segments={record.segments}
          selfName={hostName(record.participants)}
          emptyMessage="Nenhuma fala foi capturada nesta reunião."
          scroll={false}
        />
      </div>

      {/*
       * O documento e o histórico completo são da HOME. Antes o painel também
       * gerava documento, listava reuniões antigas e abria uma "saída larga" —
       * três caminhos para o mesmo lugar, cada um com uma tela diferente.
       */}
      <div className="flex shrink-0 gap-1.5">
        <Button variant="primary" className="flex-1" onClick={onOpenHome}>
          Abrir no TaqCiti
        </Button>
        <Button variant="ghost" className="!px-3" title="Dispensar" onClick={onClose}>
          <Icon name="close" size={14} />
        </Button>
      </div>
    </div>
  );
}

function LiveBody({
  session,
  phase,
  ctx,
  toast,
  hypothesis,
  callbacks,
  onCopy,
  onToast,
}: {
  session: MeetingSessionState;
  phase: MeetingState['phase'];
  ctx: PanelContext;
  toast: string | null;
  hypothesis: NextMeetingHypothesis;
  callbacks: PanelCallbacks;
  onCopy: () => void;
  onToast: (message: string) => void;
}) {
  return (
    <>
      <div className="mb-2 shrink-0">
        <AccountBoundaryNotice boundary={session.accountBoundary} compact />
      </div>
      {session.captionLanguage !== 'unknown' &&
        session.captionLanguage !== EXPECTED_CAPTION_LANGUAGE &&
        !session.languageWarningDismissed && (
          <LanguageWarningBanner
            key={session.captionLanguage}
            language={session.captionLanguage}
            onDismissMeeting={callbacks.onDismissLanguageWarning}
          />
        )}
      {!ctx.captureHealthy && (
        <p className="mb-2 shrink-0 rounded-control border border-[#f2c94c]/25 bg-[#f2c94c]/10 px-3 py-2 text-caption leading-relaxed text-[#f7dd8f]">
          As legendas do Meet pararam de chegar. Religando sozinho.
        </p>
      )}
      <TranscriptView
        segments={session.segments}
        selfName={hostName(session.participants)}
        live={phase === 'recording'}
        dimmed={phase === 'paused'}
        emptyMessage="Capturando. As falas aparecem aqui conforme as legendas chegam."
      />
      <LiveStats session={session} toast={toast} hypothesis={hypothesis} />
      <LiveControls
        paused={phase === 'paused'}
        captionsHidden={ctx.nativeCaptionsHidden}
        canToggleCaptions={ctx.inMeeting}
        onPauseToggle={() => {
          if (phase === 'paused') {
            callbacks.onResume();
            onToast('Captura retomada');
          } else {
            callbacks.onPause();
            onToast('Captura pausada');
          }
        }}
        onToggleCaptions={() => {
          const next = !ctx.nativeCaptionsHidden;
          callbacks.onToggleNativeCaptions(next);
          onToast(next ? 'Legendas ocultas na tela' : 'Legendas visíveis na tela');
        }}
        onCopy={onCopy}
        onFinish={callbacks.onFinish}
      />
    </>
  );
}

// ---------- cabeçalho ----------

/**
 * O cabeçalho da faixa. Não é mais barra de título: a faixa é docada, não se
 * arrasta. Sobraram a marca, o estado e os três controles que ainda fazem
 * sentido — ir para a HOME, recolher na cápsula, fechar.
 */
function SidebarHeader({
  status,
  onOpenHome,
  onMinimize,
  onClose,
}: {
  status: string;
  onOpenHome: () => void;
  onMinimize: () => void;
  onClose: () => void;
}) {
  return (
    <header className="select-none px-3.5 pb-2.5 pt-3.5">
      <div className="flex items-center justify-between gap-2">
        <Wordmark height={24} />

        <div className="flex items-center gap-0.5">
          <span className="mr-1 truncate rounded-full bg-white/[0.06] px-2.5 py-1 text-micro font-semibold tabular-nums text-muted">
            {status}
          </span>
          <HeaderButton label="Abrir o TaqCiti numa aba" onClick={onOpenHome}>
            <Icon name="sparkles" size={14} />
          </HeaderButton>
          <HeaderButton label="Recolher na cápsula" onClick={onMinimize}>
            <Icon name="minimize" size={14} />
          </HeaderButton>
          <HeaderButton label="Fechar o TaqCiti" onClick={onClose}>
            <Icon name="close" size={14} />
          </HeaderButton>
        </div>
      </div>
    </header>
  );
}

function HeaderButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      onPointerMove={trackSheen}
      className={`${SHEEN_HOST} grid h-7 w-7 place-items-center rounded-full text-muted transition-colors duration-200 ease-flow hover:bg-white/[0.07] hover:text-foreground`}
    >
      <Sheen />
      {children}
    </button>
  );
}

// ---------- pedaços da reunião ao vivo ----------

function LiveStats({
  session,
  toast,
  hypothesis,
}: {
  session: MeetingSessionState;
  toast: string | null;
  hypothesis: NextMeetingHypothesis;
}) {
  const people = new Set(
    session.segments
      .map((segment) => segment.speaker)
      .filter((name): name is string => name !== null),
  ).size;
  const words = countWords(session.segments.map((segment) => segment.text));

  const summary = [
    `${session.segments.length} ${session.segments.length === 1 ? 'fala' : 'falas'}`,
    people > 0 ? `${people} ${people === 1 ? 'pessoa' : 'pessoas'}` : null,
    words > 0 ? `${formatCount(words)} palavras` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const proxima =
    hypothesis.found && hypothesis.date
      ? `próxima: ${formatShortDate(hypothesis.date)}${hypothesis.time ? ` ${hypothesis.time}` : ''}`
      : null;

  return (
    <p
      className={`mt-2.5 shrink-0 px-1 text-caption transition-colors duration-200 ease-flow ${
        toast ? 'font-semibold text-glow' : 'text-muted/70'
      }`}
    >
      {toast ?? (
        <>
          {summary}
          {proxima && (
            <span className="ml-2 text-glow/80" title={hypothesis.evidence ?? undefined}>
              · {proxima}
            </span>
          )}
        </>
      )}
    </p>
  );
}

/** "17/09" — curto, cabe ao lado das estatísticas sem quebrar linha. */
function formatShortDate(date: string): string {
  const [, month, day] = date.split('-');
  return day && month ? `${day}/${month}` : date;
}

function LiveControls({
  paused,
  captionsHidden,
  canToggleCaptions,
  onPauseToggle,
  onToggleCaptions,
  onCopy,
  onFinish,
}: {
  paused: boolean;
  captionsHidden: boolean;
  canToggleCaptions: boolean;
  onPauseToggle: () => void;
  onToggleCaptions: () => void;
  onCopy: () => void;
  onFinish: () => void;
}) {
  const ghost = `${SHEEN_HOST} grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted transition-all duration-200 ease-flow hover:bg-white/8 hover:text-foreground active:scale-95`;

  return (
    <div className="mt-2.5 flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={onPauseToggle}
        onPointerMove={trackSheen}
        title={paused ? 'Retomar captura' : 'Pausar captura'}
        className={ghost}
      >
        <Sheen />
        <Icon name={paused ? 'play' : 'pause'} size={15} />
      </button>
      {canToggleCaptions && (
        <button
          type="button"
          onClick={onToggleCaptions}
          onPointerMove={trackSheen}
          title={
            captionsHidden
              ? 'Mostrar as legendas do Meet na tela'
              : 'Ocultar as legendas do Meet da tela'
          }
          className={`${ghost} ${captionsHidden ? '' : 'text-glow'}`}
        >
          <Sheen />
          <CaptionsIcon crossed={captionsHidden} />
        </button>
      )}
      <button
        type="button"
        onClick={onCopy}
        onPointerMove={trackSheen}
        title="Copiar transcrição"
        className={ghost}
      >
        <Sheen />
        <CopyIcon />
      </button>
      <Button variant="secondary" className="ml-auto !min-h-[40px] !px-5" onClick={onFinish}>
        <Icon name="stop" size={13} />
        Finalizar
      </Button>
    </div>
  );
}

/** Nomes de exibição só para os idiomas que a heurística sabe distinguir. */
const LANGUAGE_NAMES: Record<Exclude<CaptionLanguage, 'unknown'>, string> = {
  pt: 'português',
  en: 'inglês',
};

/**
 * Nudge de idioma: a extensão detecta, mas NUNCA mexe no menu de legendas do
 * Meet sozinha (seletores ofuscados, risco alto demais para automatizar).
 */
function LanguageWarningBanner({
  language,
  onDismissMeeting,
}: {
  language: Exclude<CaptionLanguage, 'unknown'>;
  onDismissMeeting: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  return (
    <div className="mb-2 shrink-0 rounded-control border border-[#f2c94c]/25 bg-[#f2c94c]/10 px-3 py-2 text-caption leading-relaxed text-[#f7dd8f]">
      <div className="flex items-start justify-between gap-2">
        <p>
          A legenda parece estar em {LANGUAGE_NAMES[language]}. O Google Meet tem um
          seletor de idioma da legenda no próprio menu de legendas — abra o menu de
          legendas do Meet e escolha &quot;Português&quot; para melhorar a precisão.
        </p>
        <button
          type="button"
          onClick={() => setHidden(true)}
          title="Fechar"
          aria-label="Fechar aviso"
          className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-sm leading-none text-[#f7dd8f]/70 transition-colors duration-200 ease-flow hover:bg-white/10 hover:text-[#f7dd8f]"
        >
          ×
        </button>
      </div>
      <button
        type="button"
        onClick={onDismissMeeting}
        className="mt-1.5 text-micro font-semibold underline decoration-dotted underline-offset-2 hover:text-[#f7dd8f]"
      >
        Não avisar de novo nesta reunião
      </button>
    </div>
  );
}

/**
 * Entre o "sim" e a primeira fala capturada.
 *
 * O texto NÃO diz mais "a captura começa sozinha": ela não começa — começou
 * porque alguém disse que sim, e prometer o contrário é o texto contradizendo
 * a pergunta que acabou de ser feita.
 */
function PreparingScreen({ failed, onEnable }: { failed: boolean; onEnable: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-full border border-[#f2c94c]/25 bg-[#f2c94c]/10">
        {failed ? (
          <CaptionsIcon />
        ) : (
          <span className="h-5 w-5 rounded-full border-2 border-[#f2c94c]/30 border-t-[#f2c94c] animate-spin-slow motion-reduce:animate-none" />
        )}
      </div>
      <h2 className="text-title font-semibold">
        {failed ? 'Ative as legendas' : 'Preparando a transcrição…'}
      </h2>
      <p className="mt-1.5 max-w-[250px] text-body leading-relaxed text-muted">
        {failed
          ? 'O Meet não deixou ligar sozinho. Toque abaixo — pode ser preciso escolher o idioma uma única vez.'
          : 'Ligando as legendas do Meet e escondendo-as da tela. A captura começa assim que elas aparecerem.'}
      </p>
      {failed && (
        <Button variant="secondary" className="mt-4" onClick={onEnable}>
          Ativar legendas
        </Button>
      )}
    </div>
  );
}

/** A reunião terminou sem uma palavra capturada. */
function EmptyCaptureScreen({
  inMeeting,
  onResumeCapture,
  onClose,
}: {
  inMeeting: boolean;
  onResumeCapture: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-3 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-full border border-white/10 bg-white/[0.04]">
        <Wave size={22} tone="dim" />
      </div>
      <h2 className="text-title font-semibold">Nada foi capturado</h2>
      <p className="mt-1.5 max-w-[260px] text-body leading-relaxed text-muted">
        As legendas do Meet não chegaram a produzir fala nenhuma nesta reunião.
      </p>
      <div className="mt-5 flex w-full flex-col gap-2">
        {inMeeting && (
          <Button variant="secondary" className="w-full" onClick={onResumeCapture}>
            Tentar capturar de novo
          </Button>
        )}
        <Button variant="ghost" className="w-full" onClick={onClose}>
          Fechar
        </Button>
      </div>
    </div>
  );
}

// Ícones específicos da sidebar (legenda e cópia) — o resto vem do kit.

function CaptionsIcon({ crossed = false }: { crossed?: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="14" rx="4.5" />
      <path d="M10.5 10.6c-.4-.5-1-.8-1.7-.8-1.2 0-2.1 1-2.1 2.2s.9 2.2 2.1 2.2c.7 0 1.3-.3 1.7-.8M17.3 10.6c-.4-.5-1-.8-1.7-.8-1.2 0-2.1 1-2.1 2.2s.9 2.2 2.1 2.2c.7 0 1.3-.3 1.7-.8" />
      {crossed && <path d="M4 21 20 3" />}
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="11" height="11" rx="2.8" />
      <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
    </svg>
  );
}
