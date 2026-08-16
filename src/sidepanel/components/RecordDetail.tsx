/**
 * Detalhe de uma reunião do histórico: título editável, metadados, ações
 * (copiar, baixar, apagar) e a transcrição completa.
 *
 * Geometria pelo `AppShell`: moldura de vidro que não rola no topo, uma única
 * região de rolagem embaixo.
 */
import { useState } from 'react';
import type { MeetingRecord } from '@/shared/types/domain';
import { usePlatform } from '@/shared/platform/context';
import { downloadTranscript, transcriptToText } from '@/features/history/export';
import { GenerateDocumentMenu } from '@/document/GenerateDocumentMenu';
import { GeneratedDocumentResult } from '@/document/GeneratedDocumentResult';
import type { DocumentoPronto } from '@/document/generateDocument';
import { AppShell } from '@/shared/ui/AppShell';
import { Button } from '@/shared/ui/Button';
import { ConfirmModal } from '@/shared/ui/ConfirmModal';
import { EditableTitle } from '@/shared/ui/EditableTitle';
import { Icon } from '@/shared/ui/Icon';
import { TranscriptView } from '@/shared/ui/TranscriptView';
import { formatDate, formatDurationHuman, formatTime, hostName } from '@/shared/ui/format';
import { StatusBadge } from './StatusBadge';

interface RecordDetailProps {
  record: MeetingRecord;
  onBack: () => void;
}

export function RecordDetail({ record, onBack }: RecordDetailProps) {
  const platform = usePlatform();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [generated, setGenerated] = useState<DocumentoPronto | null>(null);

  const copy = async () => {
    await navigator.clipboard.writeText(transcriptToText(record.segments));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <AppShell
      className="animate-fade-in"
      header={
        <header className="glass rounded-b-card px-4 pb-3.5 pt-3.5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <Button variant="ghost" size="compact" onClick={onBack} className="-ml-1.5">
              <Icon name="chevron" size={14} className="rotate-90" />
              Histórico
            </Button>
            <StatusBadge status={record.status} />
          </div>

          <EditableTitle
            value={record.title}
            onRename={(title) =>
              void platform.send({ type: 'ui/history/rename', id: record.id, title })
            }
            className="-ml-2 text-title font-semibold"
          />
          <p className="mt-1 truncate px-0.5 text-caption text-muted/85">
            {formatDate(record.startedAt)} · {formatTime(record.startedAt)} ·{' '}
            {formatDurationHuman(record.durationSeconds)}
            {record.participants.length > 0 &&
              ` · ${record.participants.map((p) => p.name).join(', ')}`}
          </p>

          <div className="mt-3 space-y-2">
            <GenerateDocumentMenu source={record} onGenerated={setGenerated} />
            <div className="flex gap-1.5">
              <Button
                variant="secondary"
                size="compact"
                className="flex-1"
                onClick={() => void copy()}
              >
                {copied ? 'Copiado ✓' : 'Copiar'}
              </Button>
              <Button
                variant="secondary"
                size="compact"
                className="flex-1"
                onClick={() => downloadTranscript(record)}
              >
                Baixar .txt
              </Button>
              <Button
                variant="ghost"
                size="compact"
                className="flex-1 text-danger/80 hover:text-danger"
                onClick={() => setConfirmDelete(true)}
              >
                Apagar
              </Button>
            </div>
          </div>
        </header>
      }
    >
      {/* `scroll={false}` na transcrição: quem rola é esta região. */}
      <div className="scroll-region flex-1 px-4 pb-6 pt-3">
        <TranscriptView
          segments={record.segments}
          selfName={hostName(record.participants)}
          emptyMessage="Nenhuma fala foi capturada nesta reunião."
          scroll={false}
        />

        {generated && (
          <GeneratedDocumentResult
            documento={generated}
            source={record}
            onAtualizado={setGenerated}
          />
        )}
      </div>

      <ConfirmModal
        open={confirmDelete}
        title="Apagar do histórico?"
        description={`"${record.title}" será removida para sempre, incluindo a transcrição.`}
        confirmLabel="Apagar"
        danger
        onConfirm={() => {
          setConfirmDelete(false);
          void platform.send({ type: 'ui/history/delete', id: record.id });
          onBack();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </AppShell>
  );
}
