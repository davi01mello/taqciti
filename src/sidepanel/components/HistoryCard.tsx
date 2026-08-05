/**
 * Card de reunião no histórico: título, pilha de avatares, metadados e status.
 * Clique abre o detalhe.
 */
import type { MeetingRecord } from '@/shared/types/domain';
import { getSegmentDisplayText } from '@/shared/types/domain';
import { Avatar } from '@/shared/ui/Avatar';
import {
  countWords,
  formatCount,
  formatDate,
  formatDurationHuman,
  formatTime,
} from '@/shared/ui/format';
import { StatusBadge } from './StatusBadge';

interface HistoryCardProps {
  record: MeetingRecord;
  onOpen: () => void;
}

export function HistoryCard({ record, onOpen }: HistoryCardProps) {
  // Linhas apagadas (soft-delete) não contam como fala, e a contagem reflete
  // o texto corrigido — mesmo critério de transcriptToText.
  const words = countWords(
    record.segments.filter((s) => s.status !== 'deleted').map((s) => getSegmentDisplayText(s)),
  );

  return (
    <li className="animate-entry">
      <button
        onClick={onOpen}
        className="glass w-full rounded-panel p-4 text-left transition-all duration-200 ease-flow hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/60"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold leading-snug">
            {record.title}
          </p>
          <StatusBadge status={record.status} />
        </div>

        <p className="mt-2 truncate text-xs text-muted">
          {formatDate(record.startedAt)} · {formatTime(record.startedAt)} ·{' '}
          {formatDurationHuman(record.durationSeconds)}
          {words > 0 && ` · ${formatCount(words)} palavras`}
        </p>

        {record.participants.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            {/* Sem sobreposição: empilhar cortava as iniciais e virava borrão. */}
            <span className="flex gap-1">
              {record.participants.slice(0, 4).map((p) => (
                <Avatar key={p.name} name={p.name} size={22} />
              ))}
            </span>
            <span className="truncate text-xs text-muted/80">
              {record.participants
                .slice(0, 2)
                .map((p) => p.name.split(' ')[0])
                .join(', ')}
              {record.participants.length > 2 &&
                ` +${record.participants.length - 2}`}
            </span>
          </div>
        )}
      </button>
    </li>
  );
}
