/**
 * Tela ao vivo: cabeçalho, participantes, transcrição e controles.
 *
 * A geometria vem do `AppShell`: altura definida, uma região que rola, faixas
 * fixas que não encolhem. A disciplina que esta tela mantinha à mão agora vale
 * para as três superfícies — é o que faltava no painel dentro do Meet, e é por
 * isso que lá a transcrição não rolava.
 */
import type { MeetingSessionState } from '@/shared/types/domain';
import { hostName } from '@/shared/ui/format';
import { AppShell } from '@/shared/ui/AppShell';
import { TranscriptView } from '@/shared/ui/TranscriptView';
import { Wave } from '@/shared/ui/Wave';
import { AccountBoundaryNotice } from '@/shared/ui/AccountBoundaryNotice';
import { PanelHeader } from '../components/PanelHeader';
import { ParticipantsSection } from '../components/ParticipantsSection';
import { ControlsBar } from '../components/ControlsBar';

interface LiveScreenProps {
  session: MeetingSessionState;
  phase: 'preparing' | 'recording' | 'paused';
}

export function LiveScreen({ session, phase }: LiveScreenProps) {
  if (phase === 'preparing') {
    return (
      <AppShell
        header={
          <div className="glass rounded-b-card pb-1">
            <PanelHeader session={session} phase={phase} />
          </div>
        }
      >
        <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center animate-fade-in">
          <Wave size={26} tone="amber" animated />
          <div className="space-y-1.5">
            <h2 className="text-title font-semibold">Preparando a transcrição</h2>
            <p className="mx-auto max-w-[250px] text-body text-muted">
              Ativando as legendas do Meet automaticamente. A captura começa
              sozinha em instantes.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      header={
        /* UMA placa de vidro para a moldura inteira — marca, status, título e
           presentes pertencem à mesma superfície fixa. */
        <div className="glass rounded-b-card pb-2">
          <PanelHeader session={session} phase={phase} />
          <ParticipantsSection
            attendedMeeting={session.participants}
            presentNow={session.presentNow}
          />
          <div className="px-4 pt-2 empty:hidden">
            <AccountBoundaryNotice boundary={session.accountBoundary} />
          </div>
        </div>
      }
      footer={<ControlsBar paused={phase === 'paused'} />}
    >
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-1 pt-2">
        <TranscriptView
          segments={session.segments}
          selfName={hostName(session.participants)}
          live={phase === 'recording'}
          dimmed={phase === 'paused'}
        />
      </div>
    </AppShell>
  );
}
