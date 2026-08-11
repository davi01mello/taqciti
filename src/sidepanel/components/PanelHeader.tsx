/**
 * Cabeçalho do painel ao vivo: marca TaqCITi, chip de status com timer e
 * título editável inline.
 */
import type { MeetingSessionState } from '@/shared/types/domain';
import { sendMessage } from '@/shared/services/messaging';
import { useElapsedTime } from '@/shared/hooks/useElapsedTime';
import { EditableTitle } from '@/shared/ui/EditableTitle';
import { Wordmark } from '@/shared/ui/Wordmark';
import { formatElapsedClock } from '@/shared/ui/format';

interface PanelHeaderProps {
  session: MeetingSessionState;
  phase: 'preparing' | 'recording' | 'paused';
}

export function PanelHeader({ session, phase }: PanelHeaderProps) {
  const elapsedMs = useElapsedTime(session.startedAt);
  const capturing = session.captionsEnabled;

  const status =
    phase === 'preparing'
      ? { label: 'Preparando…', dot: 'bg-amber-400', pulse: true }
      : phase === 'paused'
        ? { label: 'Pausado', dot: 'bg-amber-400', pulse: false }
        : capturing
          ? { label: 'Gravando', dot: 'bg-primary', pulse: true }
          : { label: 'Reconectando', dot: 'bg-amber-400', pulse: true };

  return (
    /*
     * Sem `glass` e sem `sticky`.
     *
     * O vidro agora é da MOLDURA inteira (ver LiveScreen): antes o cabeçalho
     * tinha o seu, e a seção de participantes logo abaixo não — a placa de
     * vidro terminava no meio da faixa fixa, com a lista de presentes apoiada
     * direto no fundo. Duas superfícies onde o olho lê uma só.
     *
     * O `sticky` era inerte: esta faixa vive na linha fixa do AppShell, que já
     * não rola. Só criava um contexto de empilhamento a mais.
     */
    <header className="px-4 pb-3 pt-4">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <Wordmark height={23} />
        <span className="glass-subtle inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-caption font-semibold tabular-nums text-foreground/90">
          <span
            className={`h-1.5 w-1.5 rounded-full ${status.dot} ${status.pulse ? 'animate-pulse-dot' : ''}`}
          />
          {status.label}
          {phase !== 'preparing' && (
            <span className="text-muted"> · {formatElapsedClock(elapsedMs)}</span>
          )}
        </span>
      </div>
      <EditableTitle
        value={session.title}
        onRename={(title) => void sendMessage({ type: 'ui/rename', title })}
        className="-ml-2 text-title font-semibold"
      />
    </header>
  );
}
