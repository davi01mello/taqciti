/**
 * Popup: estado atual num relance, controles rápidos da captura e as
 * reuniões recentes — o histórico completo vive na janela principal.
 */
import { useMeetingState } from '@/shared/hooks/useMeetingState';
import { useHistory } from '@/features/history/useHistory';
import { useElapsedTime } from '@/shared/hooks/useElapsedTime';
import { usePlatform } from '@/shared/platform/context';
import { AppShell } from '@/shared/ui/AppShell';
import { Button } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Wordmark } from '@/shared/ui/Wordmark';
import { formatDate, formatDurationHuman, formatElapsedClock } from '@/shared/ui/format';
import { StatusBadge } from '@/sidepanel/components/StatusBadge';

function subtitleFor(phase: string): string {
  switch (phase) {
    case 'recording':
      return 'Capturando a reunião agora';
    case 'paused':
      return 'Captura pausada';
    case 'captionsRequired':
      return 'Preparando a transcrição…';
    case 'ended':
      return 'Transcrição salva no histórico';
    default:
      return 'Aguardando reunião no Meet';
  }
}

export function App() {
  const platform = usePlatform();
  const state = useMeetingState();
  const records = useHistory();
  const live = state.phase === 'recording' || state.phase === 'paused';
  const elapsedMs = useElapsedTime(live ? (state.session?.startedAt ?? null) : null);

  const openPanel = () => {
    void platform.send({ type: 'panel/openRequest' }).then(() => window.close());
  };

  return (
    /*
     * Mesma geometria das outras superfícies, no modo `auto`: o popup é
     * dimensionado pelo Chrome a partir da altura do documento, então aqui o
     * shell cresce com o conteúdo e o TETO vem da classe — é contra ele que a
     * lista de recentes consegue encolher e rolar.
     */
    <AppShell
      height="auto"
      className="max-h-[560px] min-h-[300px]"
      header={
        <>
          <header className="flex items-center gap-3 px-4 pb-3 pt-4">
            <Wordmark height={23} />
            <div className="min-w-0">
              <p className="truncate text-caption text-muted">{subtitleFor(state.phase)}</p>
            </div>
          </header>

          {state.session && state.phase !== 'idle' && (
            <div className="px-4 pb-3">
              <div className="glass-raised rounded-panel p-3.5 animate-entry">
                <p className="mb-1 truncate text-read font-semibold">
                  {state.session.title}
                </p>
                <p className="mb-3 text-caption tabular-nums text-muted">
                  {live
                    ? `${formatElapsedClock(elapsedMs)}${state.phase === 'paused' ? ' · pausado' : ''}`
                    : state.phase === 'captionsRequired'
                      ? 'Ativando legendas automaticamente'
                      : `${state.session.segments.length} falas guardadas`}
                </p>
                <div className="flex gap-2">
                  {live && (
                    <Button
                      variant="secondary"
                      size="compact"
                      className="flex-1"
                      onClick={() =>
                        void platform.send({
                          type: state.phase === 'paused' ? 'ui/resume' : 'ui/pause',
                        })
                      }
                    >
                      <Icon name={state.phase === 'paused' ? 'play' : 'pause'} size={14} />
                      {state.phase === 'paused' ? 'Retomar' : 'Pausar'}
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    size="compact"
                    className="flex-1"
                    onClick={openPanel}
                  >
                    Abrir painel
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      }
      footer={
        <footer className="px-4 pb-4 pt-2">
          <Button variant="secondary" size="compact" className="w-full" onClick={openPanel}>
            <Icon name="panel" size={15} />
            Abrir histórico completo
          </Button>
        </footer>
      }
    >
      <section className="flex min-h-0 flex-1 flex-col px-4 pb-2">
        <h2 className="mb-2 px-1 text-caption font-semibold uppercase tracking-wide text-muted">
          Recentes
        </h2>
        {records.length === 0 ? (
          <p className="mt-6 px-1 text-center text-body leading-relaxed text-muted">
            Nenhuma reunião capturada ainda.
          </p>
        ) : (
          <ul tabIndex={0} className="scroll-region flex-1 space-y-2 pb-1 outline-none">
            {records.slice(0, 5).map((record) => (
              <li key={record.id} className="animate-entry">
                <button
                  onClick={openPanel}
                  className="glass-subtle flex min-h-[52px] w-full flex-col justify-center gap-1 rounded-panel px-3 py-2.5 text-left transition-all duration-200 ease-flow hover:-translate-y-px hover:bg-white/[0.085] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-body font-medium">{record.title}</p>
                    <StatusBadge status={record.status} />
                  </div>
                  <p className="text-micro text-muted">
                    {formatDate(record.startedAt)} ·{' '}
                    {formatDurationHuman(record.durationSeconds)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
