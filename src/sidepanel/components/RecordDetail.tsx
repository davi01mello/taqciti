/**
 * Detalhe de uma reunião do histórico: título editável, metadados, ações
 * (copiar, baixar, apagar) e a transcrição completa.
 */
import { useState } from 'react';
import type { MeetingRecord } from '@/shared/types/domain';
import { sendMessage } from '@/shared/services/messaging';
import { downloadTranscript, transcriptToText } from '@/features/history/export';
import { GenerateDocumentMenu } from '@/document/GenerateDocumentMenu';
import { GeneratedDocumentResult } from '@/document/GeneratedDocumentResult';
import type { GenerationResult } from '@/document/generateDocument';
import { Button } from '@/shared/ui/Button';
import { ConfirmModal } from '@/shared/ui/ConfirmModal';
import { EditableTitle } from '@/shared/ui/EditableTitle';
import { TranscriptView } from '@/shared/ui/TranscriptView';
import { formatDate, formatDurationHuman, formatTime, hostName } from '@/shared/ui/format';
import { StatusBadge } from './StatusBadge';

interface RecordDetailProps {
  record: MeetingRecord;
  onBack: () => void;
}

export function RecordDetail({ record, onBack }: RecordDetailProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [generated, setGenerated] = useState<Extract<GenerationResult, { status: 'success' }> | null>(
    null,
  );

  const copy = async () => {
    await navigator.clipboard.writeText(transcriptToText(record.segments));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden animate-fade-in">
      <header className="glass sticky top-0 z-10 rounded-b-panel px-4 pb-3 pt-3.5">
        <div className="mb-1 flex items-center justify-between gap-2">
          <button
            onClick={onBack}
            className="rounded-full px-2.5 py-1 text-body font-semibold text-muted transition-colors duration-200 ease-flow hover:bg-white/5 hover:text-foreground"
          >
            ← Histórico
          </button>
          <StatusBadge status={record.status} />
        </div>
        <EditableTitle
          value={record.title}
          onRename={(title) =>
            void sendMessage({ type: 'ui/history/rename', id: record.id, title })
          }
          className="-ml-2 text-title font-semibold"
        />
        <p className="mt-1 truncate px-0.5 text-caption text-muted/85">
          {formatDate(record.startedAt)} · {formatTime(record.startedAt)} ·{' '}
          {formatDurationHuman(record.durationSeconds)}
          {record.participants.length > 0 &&
            ` · ${record.participants.map((p) => p.name).join(', ')}`}
        </p>
      </header>

      <div className="space-y-2 px-4 py-3">
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1 !px-2 !py-1.5 text-xs"
            onClick={() => void copy()}
          >
            {copied ? 'Copiado ✓' : 'Copiar'}
          </Button>
          <Button
            variant="secondary"
            className="flex-1 !px-2 !py-1.5 text-xs"
            onClick={() => downloadTranscript(record)}
          >
            Baixar .txt
          </Button>
          <Button
            variant="ghost"
            className="flex-1 !px-2 !py-1.5 text-xs !text-red-300/80 hover:!text-red-300"
            onClick={() => setConfirmDelete(true)}
          >
            Apagar
          </Button>
        </div>
        <GenerateDocumentMenu
          meetingId={record.id}
          source={record}
          onGenerated={setGenerated}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-1">
        <TranscriptView
          segments={record.segments}
          selfName={hostName(record.participants)}
          emptyMessage="Nenhuma fala foi capturada nesta reunião."
          className="!flex-none"
        />

        {generated && <GeneratedDocumentResult result={generated} />}
      </div>

      <ConfirmModal
        open={confirmDelete}
        title="Apagar do histórico?"
        description={`"${record.title}" será removida para sempre, incluindo a transcrição.`}
        confirmLabel="Apagar"
        danger
        onConfirm={() => {
          setConfirmDelete(false);
          void sendMessage({ type: 'ui/history/delete', id: record.id });
          onBack();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
