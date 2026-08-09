/**
 * O painel TaqCITi dentro do Meet — em React, com os MESMOS componentes e
 * tokens do side panel.
 *
 * Dois corpos, um componente:
 * - a cápsula recolhida, arrastável para qualquer borda;
 * - o painel, que abre a partir dela: transcrição ao vivo, busca, controles e,
 *   ao fim da reunião, o resumo da captura (guardada no histórico local).
 *
 * Componente 100% de apresentação: recebe o estado e devolve intenções pelos
 * callbacks. Nenhuma decisão de negócio acontece aqui.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CaptionLanguage,
  DockEdge,
  MeetingSessionState,
  MeetingState,
  PanelPrefs,
} from '@/shared/types/domain';
import { EXPECTED_CAPTION_LANGUAGE } from '@/shared/config/constants';
import { buildMeetingRecord } from '@/features/meeting/payload';
import { downloadTranscript, transcriptToText } from '@/features/history/export';
import { Button } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
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
import { useDock } from './useDock';

export interface PanelCallbacks {
  onPause(): void;
  onResume(): void;
  onFinish(): void;
  onRename(title: string): void;
  onOpenHistory(): void;
  onOpenDocument(meetingId: string): void;
  onResumeCapture(): void;
  onCloseEnded(): void;
  onEnableCaptions(): void;
  onDismissLanguageWarning(): void;
  onToggleNativeCaptions(hidden: boolean): void;
  onDockChange(edge: DockEdge, offset: number): void;
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
}

const TOAST_MS = 2200;

export function PanelApp({ state, ctx, prefs, callbacks }: PanelAppProps) {
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<string | null>(null);

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

  const dock = useDock({ prefs, onDockChange: callbacks.onDockChange });
  const dockRef = dock.dockRef;

  const session = state.session;
  const phase = state.phase;
  const live = phase === 'recording' || phase === 'paused';

  // Relógio: só corre enquanto a reunião está viva.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);

  // Esc recolhe; Alt+Shift+T abre e fecha sem tirar a mão do teclado.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        setOpen(false);
        return;
      }
      if (event.altKey && event.shiftKey && event.code === 'KeyT') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Clique em qualquer lugar da reunião recolhe o painel, sem roubar o clique
  // do Meet. `composedPath` é o que enxerga através do shadow DOM.
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const path = event.composedPath();
      if (panelRef.current && path.includes(panelRef.current)) return;
      if (dockRef.current && path.includes(dockRef.current)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, [open, dockRef]);

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

  const bodyRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      setHeaderHeight(entry?.contentRect.height ?? 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // O GUARD FICA DEPOIS DE TODOS OS HOOKS — ver histórico do componente.
  if (!session || phase === 'idle') return null;

  const copy = () => {
    if (session.segments.length === 0) {
      showToast('Nada capturado ainda');
      return;
    }
    void navigator.clipboard
      .writeText(transcriptToText(session.segments))
      .then(() => showToast('Transcrição copiada'))
      .catch(() => showToast('Não foi possível copiar'));
  };

  const download = () => {
    downloadTranscript(buildMeetingRecord(session, 'ready'));
    showToast('Baixando .txt');
  };

  const tone = phase === 'paused' || phase === 'captionsRequired' ? 'amber' : 'green';

  /** O que sobra do painel para o corpo, depois do cabeçalho. */
  const bodyBudget = Math.max(160, dock.geometry.panel.maxHeight - headerHeight);

  return (
    <>
      {/* ---------- cápsula recolhida ---------- */}
      <button
        ref={dock.dockRef}
        type="button"
        title="TaqCITi — clique para abrir, arraste para mover"
        onPointerDown={dock.onPointerDown}
        onPointerMove={dock.onPointerMove}
        onPointerUp={(event) => {
          dock.onPointerUp(event);
          if (dock.wasClick()) setOpen((current) => !current);
        }}
        style={{ left: dock.geometry.dock.left, top: dock.geometry.dock.top }}
        className={`glass fixed z-[2147483000] flex items-center gap-2.5 rounded-full py-2.5 pl-3.5 pr-4 text-body font-semibold tabular-nums text-foreground transition-[opacity,transform] duration-300 ease-flow animate-dock-in ${
          dock.dragging ? 'cursor-grabbing' : 'cursor-grab'
        } ${open ? 'pointer-events-none scale-90 opacity-0' : 'opacity-100'}`}
      >
        <Wave size={16} animated={phase === 'recording'} tone={tone} />
        {live ? (
          <span>{elapsed}</span>
        ) : (
          <span className="text-muted">
            {phase === 'captionsRequired' ? 'preparando…' : 'salva'}
          </span>
        )}
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            tone === 'amber' ? 'bg-[#f2c94c]' : 'bg-primary'
          } ${phase === 'recording' ? 'animate-pulse-dot' : ''}`}
        />
      </button>

      {/* ---------- painel ---------- */}
      <section
        ref={panelRef}
        style={{
          left: dock.geometry.panel.left,
          top: dock.geometry.panel.top,
          width: dock.geometry.panel.width,
          ...(live
            ? { height: dock.geometry.panel.height }
            : { maxHeight: dock.geometry.panel.maxHeight }),
          transformOrigin: dock.geometry.panel.origin,
        }}
        className={`glass fixed z-[2147483001] grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-panel transition-all duration-300 ease-flow ${
          open
            ? 'pointer-events-auto scale-100 opacity-100'
            : 'pointer-events-none scale-90 opacity-0'
        }`}
      >
        <div ref={headerRef} className="min-h-0">
          <PanelHeader
            title={session.title}
            phase={phase}
            elapsed={elapsed}
            searching={searching}
            onToggleSearch={() => {
              setSearching((current) => !current);
              setQuery('');
            }}
            onCollapse={() => setOpen(false)}
            onRename={(title) => {
              callbacks.onRename(title);
              showToast('Renomeada');
            }}
            showSearch={phase === 'recording' || phase === 'paused'}
          />

          {searching && (
            <div className="px-3.5 pb-2">
              <SearchField
                autoFocus
                value={query}
                placeholder="Buscar uma fala nesta reunião…"
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
        </div>

        <div ref={bodyRef} className="flex min-h-0 flex-col px-3.5 pb-3.5">
          {phase === 'captionsRequired' && (
            <PreparingScreen
              failed={ctx.captionsAutoFailed}
              onEnable={callbacks.onEnableCaptions}
            />
          )}

          {live && (
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
                onPauseToggle={() => {
                  if (phase === 'paused') {
                    callbacks.onResume();
                    showToast('Captura retomada');
                  } else {
                    callbacks.onPause();
                    showToast('Captura pausada');
                  }
                }}
                onToggleCaptions={() => {
                  const next = !ctx.nativeCaptionsHidden;
                  callbacks.onToggleNativeCaptions(next);
                  showToast(
                    next ? 'Legendas ocultas na tela' : 'Legendas visíveis na tela',
                  );
                }}
                onCopy={copy}
                onFinish={callbacks.onFinish}
              />
            </>
          )}

          {phase === 'ended' && (
            <div
              style={{ maxHeight: bodyBudget }}
              className="min-h-0 overflow-y-auto overscroll-contain pt-1"
            >
              {session.segments.length === 0 ? (
                <EmptyCaptureScreen
                  inMeeting={ctx.inMeeting}
                  onResumeCapture={callbacks.onResumeCapture}
                  onClose={callbacks.onCloseEnded}
                />
              ) : (
                <EndedSummary
                  session={session}
                  onCopy={copy}
                  onDownload={download}
                  onOpenHistory={callbacks.onOpenHistory}
                  onOpenDocument={callbacks.onOpenDocument}
                  onClose={callbacks.onCloseEnded}
                />
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

// ---------- pedaços do painel ----------

function EndedSummary({
  session,
  onCopy,
  onDownload,
  onOpenHistory,
  onOpenDocument,
  onClose,
}: {
  session: MeetingSessionState;
  onCopy: () => void;
  onDownload: () => void;
  onOpenHistory: () => void;
  onOpenDocument: (meetingId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 py-1 animate-fade-in motion-reduce:animate-none">
      <div className="text-center">
        <h2 className="text-title font-semibold">Transcrição salva</h2>
        <p className="mt-1 text-body leading-relaxed text-muted">
          {session.segments.length} {session.segments.length === 1 ? 'fala' : 'falas'} guardadas
          no histórico local, nada se perde.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1 !py-2 text-xs" onClick={onCopy}>
          Copiar
        </Button>
        <Button variant="secondary" className="flex-1 !py-2 text-xs" onClick={onDownload}>
          Baixar .txt
        </Button>
      </div>
      {/* Agrupado logo abaixo de "Baixar .txt": as duas ações que fazem algo
       * com o CONTEÚDO da reunião, separadas de navegação (histórico/fechar). */}
      <Button
        variant="primary"
        className="w-full"
        onClick={() => onOpenDocument(session.meetingId)}
      >
        Gerar Documento
      </Button>
      <Button variant="primary" className="w-full" onClick={onOpenHistory}>
        Ver no histórico
      </Button>
      <Button variant="ghost" className="w-full" onClick={onClose}>
        Fechar
      </Button>
    </div>
  );
}

function PanelHeader({
  title,
  phase,
  elapsed,
  searching,
  showSearch,
  onToggleSearch,
  onCollapse,
  onRename,
}: {
  title: string;
  phase: MeetingState['phase'];
  elapsed: string;
  searching: boolean;
  showSearch: boolean;
  onToggleSearch: () => void;
  onCollapse: () => void;
  onRename: (title: string) => void;
}) {
  const [draft, setDraft] = useState(title);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  const status =
    phase === 'recording'
      ? elapsed
      : phase === 'paused'
        ? `Pausado · ${elapsed}`
        : phase === 'captionsRequired'
          ? 'Preparando'
          : `Salva · ${elapsed}`;

  return (
    <header className="shrink-0 px-3.5 pb-2.5 pt-3.5">
      <div className="flex items-center justify-between gap-2">
        <Wordmark height={26} />

        <div className="flex items-center gap-1.5">
          <span className="truncate rounded-full bg-white/[0.06] px-2.5 py-1 text-micro font-semibold tabular-nums text-muted">
            {status}
          </span>

          {showSearch && (
            <button
              type="button"
              onClick={onToggleSearch}
              title="Buscar na transcrição"
              aria-label="Buscar na transcrição"
              className={`rounded-full p-1.5 transition-colors duration-200 ease-flow hover:bg-white/8 ${
                searching ? 'text-glow' : 'text-muted hover:text-foreground'
              }`}
            >
              <Icon name="search" size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={onCollapse}
            title="Recolher"
            aria-label="Recolher painel"
            className="rounded-full p-1.5 text-muted transition-colors duration-200 ease-flow hover:bg-white/8 hover:text-foreground"
          >
            <Icon name="chevron" size={15} />
          </button>
        </div>
      </div>

      <input
        value={draft}
        maxLength={200}
        spellCheck={false}
        aria-label="Nome da reunião"
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
        className="mt-2.5 w-full rounded-control bg-transparent px-2 py-1.5 text-center text-title font-semibold text-foreground outline-none transition-colors duration-200 ease-flow hover:bg-white/[0.04] focus:bg-white/[0.06]"
      />
    </header>
  );
}

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
  onPauseToggle,
  onToggleCaptions,
  onCopy,
  onFinish,
}: {
  paused: boolean;
  captionsHidden: boolean;
  onPauseToggle: () => void;
  onToggleCaptions: () => void;
  onCopy: () => void;
  onFinish: () => void;
}) {
  const ghost =
    'grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted transition-all duration-200 ease-flow hover:bg-white/8 hover:text-foreground active:scale-95';

  return (
    <div className="mt-2.5 flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={onPauseToggle}
        title={paused ? 'Retomar captura' : 'Pausar captura'}
        className={ghost}
      >
        <Icon name={paused ? 'play' : 'pause'} size={15} />
      </button>
      <button
        type="button"
        onClick={onToggleCaptions}
        title={
          captionsHidden
            ? 'Mostrar as legendas do Meet na tela'
            : 'Ocultar as legendas do Meet da tela'
        }
        className={`${ghost} ${captionsHidden ? '' : 'text-glow'}`}
      >
        <CaptionsIcon crossed={captionsHidden} />
      </button>
      <button type="button" onClick={onCopy} title="Copiar transcrição" className={ghost}>
        <CopyIcon />
      </button>
      <Button
        variant="primary"
        className="ml-auto !min-h-[40px] !px-5"
        onClick={onFinish}
      >
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
        <Button variant="primary" className="mt-4" onClick={onEnable}>
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
    <div className="flex flex-col items-center px-3 py-6 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-full border border-white/10 bg-white/[0.04]">
        <Wave size={22} tone="dim" />
      </div>
      <h2 className="text-title font-semibold">Nada foi capturado</h2>
      <p className="mt-1.5 max-w-[260px] text-body leading-relaxed text-muted">
        As legendas do Meet não chegaram a produzir fala nenhuma nesta reunião.
      </p>
      <div className="mt-5 flex w-full flex-col gap-2">
        {inMeeting && (
          <Button variant="primary" className="w-full" onClick={onResumeCapture}>
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
