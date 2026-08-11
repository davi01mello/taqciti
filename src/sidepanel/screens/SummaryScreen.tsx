/**
 * Pós-reunião no painel lateral: a transcrição já está salva no histórico,
 * então nada aqui bloqueia — sair é de graça, e uma reunião nova substitui
 * esta tela.
 *
 * Hierarquia da tela, de cima para baixo: o que aconteceu (moldura), a ação
 * principal (gerar documento), as ações auxiliares (copiar/baixar/fechar) e
 * só então o conteúdo bruto. Antes as três ações auxiliares ficavam lado a
 * lado com o mesmo peso da principal, e não havia como saber qual era a
 * decisão da tela.
 */
import { useState } from 'react';
import type { MeetingSessionState } from '@/shared/types/domain';
import { buildMeetingRecord } from '@/features/meeting/payload';
import { downloadTranscript, transcriptToText } from '@/features/history/export';
import { GenerateDocumentMenu } from '@/document/GenerateDocumentMenu';
import { GeneratedDocumentResult } from '@/document/GeneratedDocumentResult';
import type { GenerationResult } from '@/document/generateDocument';
import { usePlatform } from '@/shared/platform/context';
import { AppShell } from '@/shared/ui/AppShell';
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
  const platform = usePlatform();
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
    <AppShell
      className="animate-fade-in"
      header={
        <header className="glass rounded-b-card px-5 pb-4 pt-5 text-center">
          <div className="glass-subtle mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full animate-pop-in">
            <Wave size={22} tone={empty ? 'dim' : 'green'} />
          </div>

          <h1 className="mb-1 text-title font-bold">
            {empty ? 'Nada foi capturado' : 'Transcrição salva'}
          </h1>
          <p className="text-caption leading-relaxed text-muted">
            {empty
              ? 'As legendas do Meet não produziram fala nenhuma nesta reunião.'
              : 'Já está no histórico, nada se perde.'}
          </p>

          {!empty && (
            <>
              <div className="mt-3">
                <EditableTitle
                  value={session.title}
                  onRename={(title) => void platform.send({ type: 'ui/rename', title })}
                  className="text-center text-sm font-semibold"
                />
              </div>
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
      }
    >
      {empty ? (
        <div className="px-4 pt-4">
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => void platform.send({ type: 'ui/reset' })}
          >
            Fechar
          </Button>
        </div>
      ) : (
        <div className="scroll-region flex-1 px-4 pb-6 pt-4">
          <GenerateDocumentMenu source={session} onGenerated={setGenerated} className="mb-3" />

          {/* Ações auxiliares: peso deliberadamente menor que o do menu acima
              — corpo reduzido, altura reduzida, nenhuma cor. */}
          <div className="mb-4 flex items-center justify-center gap-1.5">
            <Button variant="secondary" size="compact" onClick={() => void copy()}>
              {copied ? 'Copiado ✓' : 'Copiar'}
            </Button>
            <Button
              variant="secondary"
              size="compact"
              onClick={() => downloadTranscript(buildMeetingRecord(session, 'ready'))}
            >
              Baixar .txt
            </Button>
            <Button
              variant="ghost"
              size="compact"
              onClick={() => void platform.send({ type: 'ui/reset' })}
            >
              Fechar
            </Button>
          </div>

          {/* `scroll={false}`: quem rola é a página, não a transcrição. */}
          <TranscriptView
            segments={session.segments}
            selfName={hostName(session.participants)}
            scroll={false}
          />

          {generated && <GeneratedDocumentResult result={generated} />}
        </div>
      )}
    </AppShell>
  );
}
