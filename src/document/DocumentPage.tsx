/**
 * Página de continuação do fluxo: aba própria aberta pelo botão "Continuar
 * fluxo" (histórico ou tela de fim de reunião). Lê `meetingId` da query
 * string e mostra a transcrição completa — mesma leitura direta de
 * `chrome.storage.local` que o resto do histórico usa, nenhum jeito novo.
 *
 * "Gerar com IA" chama o servidor em `server/` (fase 2, ver README de lá).
 * A geração de lá é um stub por enquanto — nenhuma IA de verdade, nenhuma
 * chave de API aqui. Quando a IA real entrar, só o servidor muda; o fetch
 * abaixo já fala o contrato definitivo (`{ transcript, title, date }` →
 * `{ title, content }`).
 */
import { useEffect, useState } from 'react';
import type { MeetingRecord } from '@/shared/types/domain';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { SERVER_BASE_URL } from '@/shared/config/serverConfig';
import { readLocal } from '@/shared/services/storage';
import { transcriptToText } from '@/features/history/export';
import { Button } from '@/shared/ui/Button';
import { TranscriptView } from '@/shared/ui/TranscriptView';
import { formatDate, formatDurationHuman, formatTime, hostName } from '@/shared/ui/format';

type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'ready'; record: MeetingRecord };

type GenerationState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; title: string; content: string }
  | { status: 'error'; message: string };

function readMeetingIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('meetingId');
}

async function requestGeneration(record: MeetingRecord): Promise<GenerationState> {
  try {
    const response = await fetch(`${SERVER_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: transcriptToText(record.segments),
        title: record.title,
        date: new Date(record.startedAt).toISOString(),
      }),
    });

    if (!response.ok) {
      return { status: 'error', message: `O servidor respondeu com erro (${response.status}).` };
    }

    const data = (await response.json()) as { title: string; content: string };
    return { status: 'success', title: data.title, content: data.content };
  } catch {
    return {
      status: 'error',
      message: 'Não foi possível falar com o servidor. Ele está rodando em localhost:3000?',
    };
  }
}

export function DocumentPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [generation, setGeneration] = useState<GenerationState>({ status: 'idle' });

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
          <Button
            variant="primary"
            disabled={generation.status === 'loading'}
            onClick={() => {
              setGeneration({ status: 'loading' });
              void requestGeneration(record).then(setGeneration);
            }}
          >
            {generation.status === 'loading' ? 'Gerando...' : 'Gerar com IA'}
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

        {generation.status === 'success' && (
          <div className="mt-6 border-t border-borderc pt-6">
            <p className="mb-3 text-caption font-semibold uppercase tracking-wide text-muted">
              Documento gerado
            </p>
            <h2 className="mb-2 text-title font-bold">{generation.title}</h2>
            <p className="whitespace-pre-wrap text-read text-foreground/90">
              {generation.content}
            </p>
          </div>
        )}

        {generation.status === 'error' && (
          <div className="mt-6 border-t border-borderc pt-6">
            <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-muted">
              Documento gerado
            </p>
            <p className="text-body text-red-300">{generation.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}
