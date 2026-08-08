/**
 * Página de continuação do fluxo: aba própria aberta pelo botão "Continuar
 * fluxo" (histórico ou tela de fim de reunião). Lê `meetingId` da query
 * string e mostra a transcrição completa — mesma leitura direta de
 * `chrome.storage.local` que o resto do histórico usa, nenhum jeito novo.
 *
 * Fase 1: só leitura/exibição. A geração por IA (fase futura) vai chamar um
 * servidor externo via fetch a partir DESTA MESMA página — por isso o botão
 * abaixo já existe, desabilitado: é o lugar certo pra pendurar aquele
 * `onClick` depois, sem precisar mexer no resto do componente.
 */
import { useEffect, useState } from 'react';
import type { MeetingRecord } from '@/shared/types/domain';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { readLocal } from '@/shared/services/storage';
import { Button } from '@/shared/ui/Button';
import { TranscriptView } from '@/shared/ui/TranscriptView';
import { formatDate, formatDurationHuman, formatTime, hostName } from '@/shared/ui/format';

type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'ready'; record: MeetingRecord };

function readMeetingIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('meetingId');
}

export function DocumentPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const meetingId = readMeetingIdFromUrl();
    if (!meetingId) {
      setState({ status: 'not-found' });
      return;
    }
    let mounted = true;
    void readLocal<MeetingRecord[]>(STORAGE_KEYS.history).then((records) => {
      if (!mounted) return;
      const record = (records ?? []).find((r) => r.id === meetingId);
      setState(record ? { status: 'ready', record } : { status: 'not-found' });
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <main className="grid h-[100dvh] place-items-center">
        <p className="text-body text-muted">Carregando...</p>
      </main>
    );
  }

  if (state.status === 'not-found') {
    return (
      <main className="grid h-[100dvh] place-items-center px-6 text-center">
        <div>
          <h1 className="mb-1 text-title font-bold">Reunião não encontrada</h1>
          <p className="max-w-sm text-body text-muted">
            Essa reunião não existe mais no histórico local, ou o link está incompleto.
          </p>
        </div>
      </main>
    );
  }

  const { record } = state;

  return (
    <div className="mx-auto flex h-[100dvh] min-h-0 max-w-[760px] flex-col overflow-hidden">
      <header className="glass shrink-0 rounded-b-panel px-6 py-5">
        <h1 className="text-title font-bold">{record.title}</h1>
        <p className="mt-1 text-caption text-muted/85">
          {formatDate(record.startedAt)} · {formatTime(record.startedAt)} ·{' '}
          {formatDurationHuman(record.durationSeconds)}
          {record.participants.length > 0 &&
            ` · ${record.participants.map((p) => p.name).join(', ')}`}
        </p>
        <div className="mt-3 flex justify-end">
          <Button variant="primary" disabled title="Em breve">
            Gerar com IA
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-4">
        <TranscriptView
          segments={record.segments}
          selfName={hostName(record.participants)}
          emptyMessage="Nenhuma fala foi capturada nesta reunião."
          className="!flex-none"
        />
      </div>
    </div>
  );
}
