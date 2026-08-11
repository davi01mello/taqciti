/**
 * Página de continuação do fluxo — órfã desde que "Gerar Documento" passou a
 * ser um menu inline (GenerateDocumentMenu) que já faz a geração no lugar,
 * sem navegar pra cá. Fica no repo como a origem de `generateDocument.ts` e
 * `GeneratedDocumentResult.tsx`, que o menu reusa.
 *
 * Lê `meetingId` da query string e mostra a transcrição completa — mesma
 * leitura direta de `chrome.storage.local` que o resto do histórico usa,
 * nenhum jeito novo.
 *
 * Os botões de geração chamam o servidor em `server/` (fase 2, ver README de
 * lá). A geração de lá é um stub por enquanto — nenhuma IA de verdade,
 * nenhuma chave de API aqui. Quando a IA real entrar, só o servidor muda; o
 * fetch abaixo já fala o contrato definitivo (`{ transcript, title, date,
 * documentType }` → `{ title, content }`).
 */
import { useEffect, useState } from 'react';
import type { MeetingRecord } from '@/shared/types/domain';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { readLocal } from '@/shared/services/storage';
import { AppShell } from '@/shared/ui/AppShell';
import { Button } from '@/shared/ui/Button';
import { TranscriptView } from '@/shared/ui/TranscriptView';
import { Wordmark } from '@/shared/ui/Wordmark';
import { formatDate, formatDurationHuman, formatTime, hostName } from '@/shared/ui/format';
import {
  DOCUMENT_TYPE_LABELS,
  requestGeneration,
  type DocumentType,
  type GenerationResult,
} from './generateDocument';
import { GeneratedDocumentResult } from './GeneratedDocumentResult';

type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'ready'; record: MeetingRecord };

type GenerationState = { status: 'idle' } | { status: 'loading'; documentType: DocumentType } | GenerationResult;

function readMeetingIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('meetingId');
}

/** Menu "Outros" — mesmo padrão visual do ConfirmModal (overlay + glass
 *  card), mas com uma lista de opções em vez de confirmar/cancelar. Não
 *  existia nenhum componente de menu genérico reaproveitável, então este
 *  fica local a esta página até um segundo consumidor justificar extrair. */
function OtherDocumentTypesModal({
  open,
  busy,
  onClose,
  onSelect,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSelect: (type: DocumentType) => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-[6px] animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Outros tipos de documento"
    >
      <div
        className="glass w-full max-w-sm rounded-card p-5 shadow-float animate-entry"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold">Outros tipos de documento</h2>
        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            className="w-full justify-start"
            disabled={busy}
            onClick={() => onSelect('daily')}
          >
            Daily
          </Button>
          <Button
            variant="secondary"
            className="w-full justify-start"
            disabled={busy}
            onClick={() => onSelect('planning')}
          >
            Planning
          </Button>
          <Button
            variant="secondary"
            className="w-full justify-start"
            disabled={busy}
            onClick={() => onSelect('review')}
          >
            Review
          </Button>
          <Button variant="secondary" className="w-full justify-start" disabled title="Em breve">
            Personal <span className="ml-2 text-micro text-muted">em breve</span>
          </Button>
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DocumentPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [generation, setGeneration] = useState<GenerationState>({ status: 'idle' });
  const [othersOpen, setOthersOpen] = useState(false);

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
      <main className="grid h-full place-items-center">
        <p className="text-body text-muted">Carregando...</p>
      </main>
    );
  }

  if (state.status === 'not-found') {
    return (
      <main className="grid h-full place-items-center px-6 text-center">
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
  const busy = generation.status === 'loading';

  // Handler único, parametrizado por tipo — os 5 botões funcionais (linha
  // principal + os 3 de dentro do "Outros") chamam este mesmo caminho.
  const generate = (documentType: DocumentType) => {
    setOthersOpen(false);
    setGeneration({ status: 'loading', documentType });
    void requestGeneration(record, documentType).then(setGeneration);
  };

  const buttonLabel = (documentType: DocumentType, idleLabel: string) =>
    busy && generation.status === 'loading' && generation.documentType === documentType
      ? `Gerando ${DOCUMENT_TYPE_LABELS[documentType]}...`
      : idleLabel;

  const othersBusyLabel =
    busy &&
    generation.status === 'loading' &&
    (generation.documentType === 'daily' ||
      generation.documentType === 'planning' ||
      generation.documentType === 'review')
      ? `Gerando ${DOCUMENT_TYPE_LABELS[generation.documentType]}...`
      : 'Outros';

  return (
    <AppShell className="mx-auto max-w-[760px]" header={
      <header className="glass rounded-b-card px-6 py-5">
        <Wordmark height={40} className="mb-4" />

        <h1 className="text-title font-bold">{record.title}</h1>
        <p className="mt-1 text-caption text-muted/85">
          {formatDate(record.startedAt)} · {formatTime(record.startedAt)} ·{' '}
          {formatDurationHuman(record.durationSeconds)}
          {record.participants.length > 0 &&
            ` · ${record.participants.map((p) => p.name).join(', ')}`}
        </p>

        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <Button variant="primary" disabled={busy} onClick={() => generate('ata')}>
            {buttonLabel('ata', 'Gerar Ata de Reunião')}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => generate('x1')}>
            {buttonLabel('x1', 'Gerar Doc Conversa (X1)')}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setOthersOpen(true)}>
            {othersBusyLabel}
          </Button>
        </div>
      </header>
    }>
      {/* `scroll={false}` na transcrição: quem rola é esta região, e só ela. */}
      <div className="scroll-region flex-1 px-6 pb-8 pt-4">
        <TranscriptView
          segments={record.segments}
          selfName={hostName(record.participants)}
          emptyMessage="Nenhuma fala foi capturada nesta reunião."
          scroll={false}
        />

        {generation.status === 'success' && <GeneratedDocumentResult result={generation} />}

        {generation.status === 'error' && (
          <div className="mt-6 border-t border-borderc pt-6">
            <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-muted">
              Documento gerado — {DOCUMENT_TYPE_LABELS[generation.documentType]}
            </p>
            <p className="text-body text-danger">{generation.message}</p>
          </div>
        )}
      </div>

      <OtherDocumentTypesModal
        open={othersOpen}
        busy={busy}
        onClose={() => setOthersOpen(false)}
        onSelect={generate}
      />
    </AppShell>
  );
}
