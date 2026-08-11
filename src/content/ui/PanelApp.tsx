/**
 * O painel TaqCITi — uma janela flutuante, com os MESMOS componentes e tokens
 * das outras superfícies.
 *
 * ── Os estados, e por que são dois eixos e não uma lista ───────────────────
 *
 * A tentação é enumerar "minimizado, expandido, histórico, reunião, comprimido,
 * fechado" como um estado só. Não são: presença, tamanho e conteúdo variam
 * independentemente. Um painel pode estar aberto-comprimido-no-histórico ou
 * aberto-alto-numa-reunião, e tratar isso como uma enumeração daria doze casos
 * para manter em sincronia. Aqui são três eixos:
 *
 *   PRESENÇA   closed → minimized → open   (some / cápsula / janela)
 *   TAMANHO    compact / regular / tall    (só a altura muda)
 *   ROTA       auto / history / record     (o que o corpo mostra)
 *
 * `closed` e `minimized` são coisas DIFERENTES e essa distinção é o ponto:
 * minimizar deixa a cápsula à mão, fechar tira o TaqCITi da tela e exige um
 * gesto explícito para voltar. Por isso `closed` mora nas preferências
 * (persistido) e `minimized` mora no estado local — fechar tem que durar mais
 * que a aba, recolher não.
 *
 * ── Por que a rota tem um estado `auto` ────────────────────────────────────
 *
 * Quase sempre o corpo é uma função da fase da reunião: ociosa mostra o
 * histórico, gravando mostra a transcrição, terminada mostra o resumo. `auto` é
 * esse acompanhamento. As outras duas rotas são a navegação DELIBERADA do
 * usuário, que precisa sobreviver a uma mudança de fase — ler uma reunião
 * antiga enquanto outra grava tem que ser possível. Qualquer fase nova devolve
 * a rota para `auto`, porque uma reunião começando é mais urgente do que a tela
 * em que a pessoa estava.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type {
  CaptionLanguage,
  MeetingRecord,
  MeetingSessionState,
  MeetingState,
  PanelPrefs,
  PanelSize,
} from '@/shared/types/domain';
import { EXPECTED_CAPTION_LANGUAGE } from '@/shared/config/constants';
import { useHistory } from '@/features/history/useHistory';
import { HistoryCard } from '@/sidepanel/components/HistoryCard';
import { buildMeetingRecord } from '@/features/meeting/payload';
import { downloadTranscript, transcriptToText } from '@/features/history/export';
import { GenerateDocumentMenu } from '@/document/GenerateDocumentMenu';
import { GeneratedDocumentResult } from '@/document/GeneratedDocumentResult';
import type { GenerationResult } from '@/document/generateDocument';
import { Button } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Sheen, SHEEN_HOST, trackSheen } from '@/shared/ui/Sheen';
import { TranscriptView } from '@/shared/ui/TranscriptView';
import { Wave } from '@/shared/ui/Wave';
import { Wordmark } from '@/shared/ui/Wordmark';
import { AccountBoundaryNotice } from '@/shared/ui/AccountBoundaryNotice';
import { SearchField } from '@/shared/ui/Field';
import {
  countWords,
  formatCount,
  formatElapsedClock,
  hostName,
} from '@/shared/ui/format';
import { detectNextMeeting, type NextMeetingHypothesis } from '@/features/meeting/nextMeeting';
import { useFloating } from './useFloating';
import { PANEL_OPEN_EVENT } from './mount';

export interface PanelCallbacks {
  onPause(): void;
  onResume(): void;
  onFinish(): void;
  onRename(title: string): void;
  /** Abre o painel lateral do Chrome — o modo legado, preservado. */
  onOpenSidePanel(): void;
  onResumeCapture(): void;
  onCloseEnded(): void;
  onEnableCaptions(): void;
  onDismissLanguageWarning(): void;
  onToggleNativeCaptions(hidden: boolean): void;
  /** Grava preferências (posição, tamanho, fechado). Sempre um patch. */
  onPrefsChange(patch: Partial<PanelPrefs>): void;
}

export interface PanelContext {
  inMeeting: boolean;
  captionsAutoFailed: boolean;
  nativeCaptionsHidden: boolean;
  /** false = há legenda na tela que a captura não está lendo (religando). */
  captureHealthy: boolean;
}

interface PanelAppProps {
  state: MeetingState;
  ctx: PanelContext;
  prefs: PanelPrefs;
  callbacks: PanelCallbacks;
  /**
   * Nasce aberto em vez de recolhido. No Meet o painel aparece sozinho junto
   * com a página e começar aberto seria invasivo; fora do Meet ele só existe
   * porque alguém clicou no ícone pedindo por ele.
   */
  defaultOpen?: boolean;
}

type Route = { kind: 'auto' } | { kind: 'history' } | { kind: 'record'; id: string };

const TOAST_MS = 2200;

/**
 * Os degraus de altura. Só a ALTURA muda: variar a largura junto faria os
 * cartões do histórico refluírem a cada clique, e o que se pede é espaço
 * vertical para mais reuniões, não uma janela de proporção instável.
 */
const PANEL_WIDTH = 396;
const PANEL_HEIGHTS: Record<PanelSize, number> = {
  compact: 320,
  regular: 564,
  tall: 780,
};
const SIZE_ORDER: PanelSize[] = ['compact', 'regular', 'tall'];

export function PanelApp({
  state,
  ctx,
  prefs,
  callbacks,
  defaultOpen = false,
}: PanelAppProps) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const [route, setRoute] = useState<Route>({ kind: 'auto' });
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const session = state.session;
  const phase = state.phase;
  const live = phase === 'recording' || phase === 'paused';
  const idle = !session || phase === 'idle';

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const panelBox = useMemo(
    () => ({ width: PANEL_WIDTH, height: PANEL_HEIGHTS[prefs.size] }),
    [prefs.size],
  );

  const floating = useFloating({
    x: prefs.x,
    y: prefs.y,
    panel: panelBox,
    onMove: (x, y) => callbacks.onPrefsChange({ x, y }),
  });

  /**
   * Abrir é mais do que expandir: também desfaz o "fechado". Todo caminho que
   * traz o TaqCITi de volta — clique na cápsula, atalho, clique no ícone da
   * extensão — passa por aqui, senão um deles esqueceria de limpar `dismissed`
   * e o painel abriria invisível.
   */
  const open = useCallback(() => {
    setExpanded(true);
    if (prefs.dismissed) callbacks.onPrefsChange({ dismissed: false });
  }, [prefs.dismissed, callbacks]);

  // Relógio: só corre enquanto a reunião está viva.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);

  /*
   * A fase muda: a rota volta a acompanhar a reunião, e o fim dela abre o
   * painel sozinho.
   *
   * Abrir sozinho no fim é o requisito da tela pós-reunião — ela precisa
   * aparecer, não esperar um clique, senão a transcrição recém-salva fica
   * escondida atrás de uma cápsula. E uma reunião COMEÇANDO desfaz o "fechado",
   * que é a única coisa capaz de trazer o TaqCITi de volta sem o usuário pedir:
   * é o comportamento que ele já tinha, e o único momento em que reabrir sozinho
   * não contraria quem fechou de propósito.
   */
  useEffect(() => {
    /*
     * Voltar ao ocioso NÃO rouba a tela. É o que permite "Ver no histórico" na
     * tela pós-reunião encerrar o estado `ended` e navegar até o registro no
     * mesmo gesto: o `ui/reset` traz a fase para `idle`, e se este efeito
     * reagisse a isso ele devolveria a rota para `auto` e a pessoa cairia na
     * lista em vez da reunião que acabou de gravar.
     */
    if (phase === 'idle') return;

    setRoute({ kind: 'auto' });
    if (phase === 'ended') setExpanded(true);
    if (prefs.dismissed) callbacks.onPrefsChange({ dismissed: false });
    // `prefs.dismissed` fora das dependências de propósito: o efeito reage à
    // MUDANÇA DE FASE, e reexecutá-lo quando as preferências chegam do storage
    // jogaria a rota de volta para `auto` no meio da navegação do usuário.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Esc recolhe; Alt+Shift+T abre e fecha sem tirar a mão do teclado.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && expanded) {
        setExpanded(false);
        return;
      }
      if (event.altKey && event.shiftKey && event.code === 'KeyT') {
        event.preventDefault();
        if (expanded) setExpanded(false);
        else open();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded, open]);

  // Clicar no ícone numa aba que já tem o painel montado: ver PANEL_OPEN_EVENT.
  // Também é o caminho que desfaz o "fechado" — daí não bastar `setExpanded`.
  useEffect(() => {
    const onOpenRequest = () => open();
    document.addEventListener(PANEL_OPEN_EVENT, onOpenRequest);
    return () => document.removeEventListener(PANEL_OPEN_EVENT, onOpenRequest);
  }, [open]);

  const elapsed = useMemo(() => {
    if (!session) return '00:00';
    return formatElapsedClock((session.endedAt ?? now) - session.startedAt);
  }, [session, now]);

  /*
   * A hipótese da próxima reunião, lida da transcrição a cada atualização.
   * Sendo pura e local, custa nada rodar durante a reunião — é o que permite
   * mostrar o indicador ao vivo.
   */
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

  const download = (record: MeetingRecord) => {
    downloadTranscript(record);
    showToast('Baixando .txt');
  };

  /** Sem reunião não há nada acontecendo: a cápsula fica apagada, não verde. */
  const tone = idle
    ? 'dim'
    : phase === 'paused' || phase === 'captionsRequired'
      ? 'amber'
      : 'green';

  // ---------- fechado: nada na tela ----------

  /*
   * O retorno antecipado é o estado "fechado" inteiro. Não há cápsula, não há
   * resíduo — que é a diferença entre fechar e minimizar. Voltar exige o ícone
   * da extensão ou uma reunião nova.
   */
  if (prefs.dismissed) return null;

  const sizeIndex = SIZE_ORDER.indexOf(prefs.size);
  const resize = (delta: number) => {
    const next = SIZE_ORDER[sizeIndex + delta];
    if (next) callbacks.onPrefsChange({ size: next });
  };

  const showingHistory =
    route.kind === 'history' || (route.kind === 'auto' && idle);
  const searchable = showingHistory || live;

  return (
    <>
      {/* ---------- cápsula recolhida ---------- */}
      <button
        ref={floating.capsuleRef as RefObject<HTMLButtonElement>}
        type="button"
        title="TaqCITi — clique para abrir, arraste para mover"
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
        className={`glass ${SHEEN_HOST} fixed z-[2147483000] flex items-center gap-2.5 rounded-full py-2.5 pl-3.5 pr-4 text-body font-semibold tabular-nums text-foreground transition-[opacity,transform] duration-300 ease-flow animate-dock-in ${
          floating.dragging ? 'cursor-grabbing' : 'cursor-grab'
        } ${expanded ? 'pointer-events-none scale-90 opacity-0' : 'opacity-100'}`}
      >
        <Sheen />
        <Wave size={16} animated={phase === 'recording'} tone={tone} />
        {live ? (
          <span>{elapsed}</span>
        ) : (
          <span className="text-muted">
            {idle
              ? 'TaqCITi'
              : phase === 'captionsRequired'
                ? 'preparando…'
                : 'salva'}
          </span>
        )}
        {/* Sem ponto de status quando ocioso: um ponto colorido comunica "algo
            está acontecendo", e em repouso nada está. */}
        {!idle && (
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              tone === 'amber' ? 'bg-[#f2c94c]' : 'bg-primary'
            } ${phase === 'recording' ? 'animate-pulse-dot' : ''}`}
          />
        )}
      </button>

      {/* ---------- janela ---------- */}
      <section
        style={{
          left: floating.geometry.panel.left,
          top: floating.geometry.panel.top,
          width: floating.geometry.panel.width,
          height: floating.geometry.panel.height,
          transformOrigin: floating.geometry.panel.origin,
        }}
        className={`glass fixed z-[2147483001] grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-card transition-all duration-300 ease-flow ${
          expanded
            ? 'pointer-events-auto scale-100 opacity-100'
            : 'pointer-events-none scale-90 opacity-0'
        }`}
      >
        <PanelHeader
          title={idle || route.kind !== 'auto' ? null : (session?.title ?? '')}
          status={
            route.kind === 'record'
              ? 'Reunião'
              : showingHistory
                ? 'Histórico'
                : phase === 'recording'
                  ? elapsed
                  : phase === 'paused'
                    ? `Pausado · ${elapsed}`
                    : phase === 'captionsRequired'
                      ? 'Preparando'
                      : `Salva · ${elapsed}`
          }
          searching={searching}
          showSearch={searchable}
          showHistory={!showingHistory}
          canGrow={sizeIndex < SIZE_ORDER.length - 1}
          canShrink={sizeIndex > 0}
          dragging={floating.dragging}
          dragHandlers={floating.dragHandlers}
          onToggleSearch={() => {
            setSearching((current) => !current);
            setQuery('');
          }}
          onHistory={() => {
            setRoute({ kind: 'history' });
            setQuery('');
          }}
          onGrow={() => resize(1)}
          onShrink={() => resize(-1)}
          onMinimize={() => setExpanded(false)}
          onClose={() => {
            setExpanded(false);
            callbacks.onPrefsChange({ dismissed: true });
          }}
          onRename={(title) => {
            callbacks.onRename(title);
            showToast('Renomeada');
          }}
        >
          {searching && (
            <div className="px-3.5 pb-2">
              <SearchField
                autoFocus
                value={query}
                placeholder={
                  showingHistory
                    ? 'Buscar por título, pessoa ou fala…'
                    : 'Buscar uma fala nesta reunião…'
                }
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setSearching(false);
                    setQuery('');
                  }
                }}
              />
            </div>
          )}
        </PanelHeader>

        <div className="flex min-h-0 flex-col px-3.5 pb-3.5">
          <PanelBody
            route={route}
            state={state}
            ctx={ctx}
            query={query}
            toast={toast}
            hypothesis={hypothesis}
            callbacks={callbacks}
            onRoute={setRoute}
            onCopy={copySegments}
            onDownload={download}
            onToast={showToast}
          />
        </div>
      </section>
    </>
  );
}

// ---------- o corpo, por rota ----------

function PanelBody({
  route,
  state,
  ctx,
  query,
  toast,
  hypothesis,
  callbacks,
  onRoute,
  onCopy,
  onDownload,
  onToast,
}: {
  route: Route;
  state: MeetingState;
  ctx: PanelContext;
  query: string;
  toast: string | null;
  hypothesis: NextMeetingHypothesis;
  callbacks: PanelCallbacks;
  onRoute: (route: Route) => void;
  onCopy: (segments: MeetingRecord['segments']) => void;
  onDownload: (record: MeetingRecord) => void;
  onToast: (message: string) => void;
}) {
  const records = useHistory();
  const session = state.session;
  const phase = state.phase;
  const idle = !session || phase === 'idle';

  // Uma reunião aberta pelo histórico. Se ela some do histórico (apagada de
  // outra superfície), a rota deixa de ter destino e a lista volta.
  if (route.kind === 'record') {
    const record = records.find((item) => item.id === route.id);
    if (!record) return <HistoryList records={records} query={query} onOpen={onRoute} />;
    return (
      <MeetingScreen
        record={record}
        heading={record.title}
        onCopy={() => onCopy(record.segments)}
        onDownload={() => onDownload(record)}
        onHistory={() => onRoute({ kind: 'history' })}
        historyLabel="Voltar ao histórico"
      />
    );
  }

  if (route.kind === 'history' || idle) {
    return (
      <HistoryList
        records={records}
        query={query}
        onOpen={onRoute}
        onOpenSidePanel={callbacks.onOpenSidePanel}
      />
    );
  }

  if (phase === 'captionsRequired') {
    return (
      <PreparingScreen
        failed={ctx.captionsAutoFailed}
        onEnable={callbacks.onEnableCaptions}
      />
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
      <MeetingScreen
        record={record}
        heading="Transcrição salva"
        subtitle={`${session.segments.length} ${
          session.segments.length === 1 ? 'fala guardada' : 'falas guardadas'
        } no histórico local, nada se perde.`}
        onCopy={() => onCopy(record.segments)}
        onDownload={() => onDownload(record)}
        /*
         * Leva à reunião correspondente, não só à lista: é dela que se acabou
         * de sair, e cair na lista obrigaria a procurá-la de novo.
         *
         * E encerra o estado pós-reunião no caminho. Sem isso a fase ficaria em
         * `ended` para sempre — a cápsula presa em "salva", a próxima reunião
         * chegando por cima de uma tela que ninguém dispensou. Era o que o
         * botão "Fechar" fazia, e é a única parte dele que valia a pena.
         */
        onHistory={() => {
          callbacks.onCloseEnded();
          onRoute({ kind: 'record', id: record.id });
        }}
        historyLabel="Ver no histórico"
      />
    );
  }

  if (session) {
    return (
      <LiveBody
        session={session}
        phase={phase}
        ctx={ctx}
        query={query}
        toast={toast}
        hypothesis={hypothesis}
        callbacks={callbacks}
        onCopy={() => onCopy(session.segments)}
        onToast={onToast}
      />
    );
  }

  return <HistoryList records={records} query={query} onOpen={onRoute} />;
}

/**
 * A tela de uma reunião — a MESMA para a que acabou de terminar e para a que
 * foi aberta pelo histórico.
 *
 * Um componente só, e não dois parecidos, porque a exigência é literalmente
 * que as duas ofereçam as mesmas ações. Duas telas irmãs divergem: alguém
 * acrescenta um botão na tela pós-reunião, ninguém lembra da outra, e reabrir
 * uma reunião passa a ser uma versão pobre de tê-la acabado de gravar.
 *
 * Recebe `MeetingRecord` — o formato do histórico — e não a sessão viva. É o
 * denominador comum: a sessão vira registro com `buildMeetingRecord`, o
 * contrário não existe.
 */
function MeetingScreen({
  record,
  heading,
  subtitle,
  onCopy,
  onDownload,
  onHistory,
  historyLabel,
}: {
  record: MeetingRecord;
  heading: string;
  subtitle?: string;
  onCopy: () => void;
  onDownload: () => void;
  onHistory: () => void;
  historyLabel: string;
}) {
  const [generated, setGenerated] = useState<
    Extract<GenerationResult, { status: 'success' }> | null
  >(null);

  return (
    <div className="scroll-region flex min-h-0 flex-1 flex-col gap-3 py-1 animate-fade-in motion-reduce:animate-none">
      <div className="shrink-0 text-center">
        <h2 className="truncate text-title font-semibold">{heading}</h2>
        {subtitle && (
          <p className="mt-1 text-body leading-relaxed text-muted">{subtitle}</p>
        )}
      </div>

      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" size="compact" className="flex-1" onClick={onCopy}>
          Copiar
        </Button>
        <Button variant="secondary" size="compact" className="flex-1" onClick={onDownload}>
          Baixar .txt
        </Button>
      </div>

      {/* Agrupado logo abaixo de "Baixar .txt": as duas ações que fazem algo
       * com o CONTEÚDO da reunião, separadas de navegação (histórico/fechar). */}
      <div className="shrink-0">
        <GenerateDocumentMenu source={record} onGenerated={setGenerated} />
      </div>
      {generated && <GeneratedDocumentResult result={generated} />}

      {/*
       * Um botão de navegação só. Antes havia "Ver no histórico" e "Fechar"
       * lado a lado, e os dois tiravam a pessoa desta tela — dois caminhos para
       * o mesmo lugar, um deles com nome que sugeria fechar o TaqCITi inteiro.
       * Fechar de verdade é o X do cabeçalho, que é global e sempre está lá.
       */}
      <Button variant="secondary" className="w-full shrink-0" onClick={onHistory}>
        {historyLabel}
      </Button>
    </div>
  );
}

/**
 * O histórico local — o corpo em repouso, e a casa do painel.
 *
 * É o que faz a cápsula valer a pena existir fora de uma reunião: sem isto,
 * abrir o painel sem reunião mostraria uma caixa vazia. A lista ocupa toda a
 * altura que a janela tiver, e é por isso que o tamanho da janela virou um
 * controle do usuário — o histórico é o conteúdo que mais precisa de espaço.
 */
function HistoryList({
  records,
  query,
  onOpen,
  onOpenSidePanel,
}: {
  records: MeetingRecord[];
  query: string;
  onOpen: (route: Route) => void;
  onOpenSidePanel?: () => void;
}) {
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return records;
    return records.filter(
      (record) =>
        record.title.toLowerCase().includes(needle) ||
        record.participants.some((p) => p.name.toLowerCase().includes(needle)) ||
        record.segments.some((s) => s.text.toLowerCase().includes(needle)),
    );
  }, [records, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="mb-2 shrink-0 px-1 text-caption font-semibold uppercase tracking-wide text-muted">
        {query
          ? `Resultados · ${filtered.length}`
          : records.length === 1
            ? '1 reunião'
            : `${records.length} reuniões`}
      </p>

      {records.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-3 text-center">
          <div className="glass-subtle mb-3 grid h-12 w-12 place-items-center rounded-full">
            <Wave size={18} tone="dim" />
          </div>
          <p className="max-w-[240px] text-body leading-relaxed text-muted">
            Nenhuma reunião ainda. Entre num Meet e a captura cuida do resto.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="flex-1 px-1 py-6 text-center text-body text-muted">
          Nada encontrado com essa busca.
        </p>
      ) : (
        <ul tabIndex={0} className="scroll-region flex-1 space-y-2 pb-1 outline-none">
          {filtered.map((record) => (
            <HistoryCard
              key={record.id}
              record={record}
              onOpen={() => onOpen({ kind: 'record', id: record.id })}
            />
          ))}
        </ul>
      )}

      {/*
       * O modo legado. Continua existindo, e num lugar estável: o histórico é a
       * tela de repouso do painel, então este é o ponto que está sempre a um
       * clique. Some das outras rotas de propósito — durante uma gravação não é
       * a saída que se procura.
       */}
      {onOpenSidePanel && (
        <div className="mt-2 shrink-0 border-t border-white/[0.06] pt-2">
          <Button
            variant="ghost"
            size="compact"
            className="w-full justify-start"
            onClick={onOpenSidePanel}
          >
            <Icon name="panel" size={14} />
            Abrir no painel lateral
          </Button>
        </div>
      )}
    </div>
  );
}

function LiveBody({
  session,
  phase,
  ctx,
  query,
  toast,
  hypothesis,
  callbacks,
  onCopy,
  onToast,
}: {
  session: MeetingSessionState;
  phase: MeetingState['phase'];
  ctx: PanelContext;
  query: string;
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
        query={query}
        emptyMessage="Ouvindo a reunião. As falas aparecem aqui automaticamente."
      />
      <LiveStats session={session} toast={toast} hypothesis={hypothesis} />
      <LiveControls
        paused={phase === 'paused'}
        captionsHidden={ctx.nativeCaptionsHidden}
        /* Só a aba do Meet tem legenda nativa para esconder. Numa aba
           qualquer o botão existiria sem fazer nada. */
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

// ---------- cabeçalho e controles de janela ----------

/**
 * O cabeçalho é a BARRA DE TÍTULO: é por ele que a janela se move, e é nele que
 * moram os controles de janela — comprimir, expandir, minimizar, fechar.
 *
 * Os controles precisam parar o `pointerdown` antes que ele chegue à alça de
 * arraste. Sem isso, cada clique num botão começaria um arraste de zero pixels:
 * inofensivo por acidente (o limiar de 5px o descarta), mas basta a mão tremer
 * para o clique virar movimento e o botão não disparar.
 */
function PanelHeader({
  title,
  status,
  searching,
  showSearch,
  showHistory,
  canGrow,
  canShrink,
  dragging,
  dragHandlers,
  onToggleSearch,
  onHistory,
  onGrow,
  onShrink,
  onMinimize,
  onClose,
  onRename,
  children,
}: {
  /** `null` = não há reunião para renomear nesta rota. */
  title: string | null;
  status: string;
  searching: boolean;
  showSearch: boolean;
  showHistory: boolean;
  canGrow: boolean;
  canShrink: boolean;
  dragging: boolean;
  dragHandlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  };
  onToggleSearch: () => void;
  onHistory: () => void;
  onGrow: () => void;
  onShrink: () => void;
  onMinimize: () => void;
  onClose: () => void;
  onRename: (title: string) => void;
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState(title ?? '');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(title ?? '');
  }, [title, editing]);

  const stopDrag = (event: ReactPointerEvent) => event.stopPropagation();

  return (
    <div className="min-h-0">
      <header
        {...dragHandlers}
        className={`select-none px-3.5 pb-2.5 pt-3.5 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        <div className="flex items-center justify-between gap-2">
          <Wordmark height={24} />

          <div className="flex items-center gap-0.5" onPointerDown={stopDrag}>
            <span className="mr-1 truncate rounded-full bg-white/[0.06] px-2.5 py-1 text-micro font-semibold tabular-nums text-muted">
              {status}
            </span>

            {showHistory && (
              <HeaderButton label="Ver o histórico" onClick={onHistory}>
                <Icon name="panel" size={14} />
              </HeaderButton>
            )}
            {showSearch && (
              <HeaderButton
                label="Buscar"
                active={searching}
                onClick={onToggleSearch}
              >
                <Icon name="search" size={14} />
              </HeaderButton>
            )}
            <HeaderButton label="Comprimir" disabled={!canShrink} onClick={onShrink}>
              <Icon name="compress" size={14} />
            </HeaderButton>
            <HeaderButton label="Expandir" disabled={!canGrow} onClick={onGrow}>
              <Icon name="expand" size={14} />
            </HeaderButton>
            <HeaderButton label="Minimizar" onClick={onMinimize}>
              <Icon name="minimize" size={14} />
            </HeaderButton>
            <HeaderButton label="Fechar o TaqCITi" onClick={onClose}>
              <Icon name="close" size={14} />
            </HeaderButton>
          </div>
        </div>

        {title !== null && (
          <input
            value={draft}
            maxLength={200}
            spellCheck={false}
            aria-label="Nome da reunião"
            onPointerDown={stopDrag}
            onFocus={() => setEditing(true)}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                setDraft(title);
                event.currentTarget.blur();
              }
            }}
            onBlur={() => {
              setEditing(false);
              const next = draft.trim();
              if (next.length > 0 && next !== title) onRename(next);
              else setDraft(title);
            }}
            className="mt-2.5 w-full cursor-text rounded-control bg-transparent px-2 py-1.5 text-center text-title font-semibold text-foreground outline-none transition-colors duration-200 ease-flow hover:bg-white/[0.04] focus:bg-white/[0.06]"
          />
        )}
      </header>
      {children}
    </div>
  );
}

/** Controle de ícone do cabeçalho — pequeno, e com o mesmo reflexo verde. */
function HeaderButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      onPointerMove={trackSheen}
      className={`${SHEEN_HOST} grid h-7 w-7 place-items-center rounded-full transition-colors duration-200 ease-flow hover:bg-white/[0.07] disabled:pointer-events-none disabled:opacity-30 ${
        active ? 'text-glow' : 'text-muted hover:text-foreground'
      }`}
    >
      {!disabled && <Sheen />}
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
      {/* Transparente como o resto: o único botão preenchido do produto é
          "Gerar Documento". A hierarquia aqui vem do rótulo e da posição. */}
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
 * Meet sozinha (seletores ofuscados, risco alto demais para automatizar). O
 * "x" só esconde por agora; "não avisar de novo" grava a decisão na sessão.
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

function PreparingScreen({
  failed,
  onEnable,
}: {
  failed: boolean;
  onEnable: () => void;
}) {
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
          : 'Ligando as legendas do Meet automaticamente e escondendo-as da tela. A captura começa sozinha.'}
      </p>
      {failed && (
        <Button variant="secondary" className="mt-4" onClick={onEnable}>
          Ativar legendas
        </Button>
      )}
    </div>
  );
}

/**
 * A reunião terminou sem uma palavra capturada. Antes o painel simplesmente
 * sumia, o que parecia defeito. Agora diz o que aconteceu.
 */
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

// Ícones específicos do painel (legenda e cópia) — o resto vem do kit.

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
