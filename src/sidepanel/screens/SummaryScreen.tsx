/**
 * Pós-reunião no side panel: a transcrição já está salva no histórico, então
 * nada aqui bloqueia — sair é de graça, e uma reunião nova substitui esta tela.
 */
import { useState } from 'react';
import type { MeetingSessionState } from '@/shared/types/domain';
import { buildMeetingRecord } from '@/features/meeting/payload';
import { downloadTranscript, transcriptToText } from '@/features/history/export';
import { GenerateDocumentMenu } from '@/document/GenerateDocumentMenu';
import { GeneratedDocumentResult } from '@/document/GeneratedDocumentResult';
import type { GenerationResult } from '@/document/generateDocument';
import { sendMessage } from '@/shared/services/messaging';
import { Button } from '@/shared/ui/Button';
import { EditableTitle } from '@/shared/ui/EditableTitle';
import { StatTile } from '@/shared/ui/StatTile';
import { TranscriptView } from '@/shared/ui/TranscriptView';
import { Wave } from '@/shared/ui/Wave';
import { countWords, formatCount, formatDurationHuman, hostName } from '@/shared/ui/format';

interface SummaryScreenProps {
  session: MeetingSessionState;
}

export function SummaryScreen({ session }: SummaryScreenProps) {
  const [copied, setCopied] = useState(false);
  const [generated, setGenerated] = useState<Extract<GenerationResult, { status: 'success' }> | null>(
    null,
  );

  const durationSeconds = Math.round(
    ((session.endedAt ?? session.startedAt) - session.startedAt) / 1000,
  );
  const empty = session.segments.length === 0;

  const copy = async () => {
    await navigator.clipboard.writeText(transcriptToText(session.segments));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden animate-fade-in">
      <header className="shrink-0 glass rounded-b-panel px-5 pb-4 pt-5 text-center">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-white/[0.04] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] animate-pop-in">
          <Wave size={22} tone={empty ? 'dim' : 'green'} />
        </div>

        <h1 className="mb-1 text-title font-bold">
          {empty ? 'Nada foi capturado' : 'Transcrição salva'}
        </h1>
        <p className="mb-3 text-caption leading-relaxed text-muted">
          {empty
            ? 'As legendas do Meet não produziram fala nenhuma nesta reunião.'
            : 'Já está no histórico, nada se perde.'}
        </p>

        {!empty && (
          <>
            <EditableTitle
              value={session.title}
              onRename={(title) => void sendMessage({ type: 'ui/rename', title })}
              className="text-center text-sm font-semibold"
            />
            <div className="mx-auto mt-3 grid max-w-[280px] grid-cols-3 gap-2">
              <StatTile
                value={formatDurationHuman(durationSeconds).replace(' ', '')}
                label="duração"
              />
              <StatTile value={String(session.segments.length)} label="falas" />
              <StatTile
                value={formatCount(countWords(session.segments.map((s) => s.text)))}
                label="palavras"
              />
            </div>
          </>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
        {empty ? (
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => void sendMessage({ type: 'ui/reset' })}
          >
            Fechar
          </Button>
        ) : (
          <>
            <GenerateDocumentMenu
              meetingId={session.meetingId}
              source={session}
              onGenerated={setGenerated}
              className="mb-3"
            />

            <div className="mb-3 flex items-center justify-center gap-2">
              <Button variant="secondary" className="!min-h-[38px] text-xs" onClick={() => void copy()}>
                {copied ? 'Copiado ✓' : 'Copiar'}
              </Button>
              <Button
                variant="secondary"
                className="!min-h-[38px] text-xs"
                onClick={() => downloadTranscript(buildMeetingRecord(session, 'ready'))}
              >
                Baixar .txt
              </Button>
              <Button variant="ghost" className="!min-h-[38px] text-xs" onClick={() => void sendMessage({ type: 'ui/reset' })}>
                Fechar
              </Button>
            </div>

            <TranscriptView
              segments={session.segments}
              selfName={hostName(session.participants)}
              className="!flex-none"
            />

            {generated && <GeneratedDocumentResult result={generated} />}
          </>
        )}
      </div>
    </div>
  );
}
