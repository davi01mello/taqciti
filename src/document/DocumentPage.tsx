/**
 * A janela larga do documento: a transcrição inteira de um lado do olho, e o
 * documento gerado embaixo, com espaço para ler.
 *
 * É a mesma geração do painel lateral e do painel flutuante — o mesmo
 * `GenerateDocumentMenu`, o mesmo `GeneratedDocumentResult`. O que muda aqui é
 * só a largura: uma ata de reunião longa não cabe confortavelmente numa
 * coluna de painel, e esta tela existe para quando alguém quer de fato LER o
 * que saiu antes de mandar para o cliente.
 *
 * Ela já teve fileira de botões e modal próprios, que faziam a geração por
 * fora do menu. Isso era uma segunda implementação do mesmo fluxo, e ela
 * ficou para trás quando o menu ganhou entrega e perguntas — sumiu daqui, e a
 * tela passou a usar o caminho de verdade.
 *
 * Lê `meetingId` da query string; o histórico vem do mesmo hook que o resto do
 * produto usa.
 */
import { useState } from 'react';
import { useHistoryState } from '@/features/history/useHistory';
import { AppShell } from '@/shared/ui/AppShell';
import { TranscriptView } from '@/shared/ui/TranscriptView';
import { Wordmark } from '@/shared/ui/Wordmark';
import { formatDate, formatDurationHuman, formatTime, hostName } from '@/shared/ui/format';
import { GenerateDocumentMenu } from './GenerateDocumentMenu';
import { GeneratedDocumentResult } from './GeneratedDocumentResult';
import type { DocumentoPronto } from './generateDocument';

function readMeetingIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('meetingId');
}

function NotFound() {
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

export function DocumentPage() {
  const [generated, setGenerated] = useState<DocumentoPronto | null>(null);

  const { records, loaded } = useHistoryState();
  const meetingId = readMeetingIdFromUrl();
  const record = meetingId === null ? undefined : records.find((r) => r.id === meetingId);

  if (meetingId !== null && !loaded) {
    return (
      <main className="grid h-full place-items-center">
        <p className="text-body text-muted">Carregando...</p>
      </main>
    );
  }
  if (record === undefined) {
    return <NotFound />;
  }

  return (
    <AppShell
      className="mx-auto max-w-[760px]"
      header={
        <header className="glass rounded-b-card px-6 py-5">
          <Wordmark height={40} className="mb-4" />

          <h1 className="text-title font-bold">{record.title}</h1>
          <p className="mt-1 text-caption text-muted/85">
            {formatDate(record.startedAt)} · {formatTime(record.startedAt)} ·{' '}
            {formatDurationHuman(record.durationSeconds)}
            {record.participants.length > 0 &&
              ` · ${record.participants.map((p) => p.name).join(', ')}`}
          </p>

          {/* O menu ocupa uma coluna estreita mesmo numa janela larga: ele
              abre uma lista, e uma lista esticada por 760px fica ilegível. */}
          <div className="mt-3 max-w-[280px]">
            <GenerateDocumentMenu source={record} onGenerated={setGenerated} ampla />
          </div>
        </header>
      }
    >
      {/* `scroll={false}` na transcrição: quem rola é esta região, e só ela. */}
      <div className="scroll-region flex-1 px-6 pb-8 pt-4">
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
            ampla
          />
        )}
      </div>
    </AppShell>
  );
}
