/**
 * Exportação de transcrições: texto para a área de transferência e download
 * como arquivo .txt. Helpers puros de apresentação + um efeito de download.
 */
import type { LiveSegment, MeetingRecord } from '@/shared/types/domain';
import { getSegmentDisplayText } from '@/shared/types/domain';
import { formatDate, formatElapsedClock, formatTime } from '@/shared/ui/format';

/** Linhas apagadas (soft-delete) ficam de fora — "removida da view" vale para
 *  a exportação também. O texto exportado é o corrigido, quando houver. */
export function transcriptToText(segments: readonly LiveSegment[]): string {
  return segments
    .filter((s) => s.status !== 'deleted')
    .map(
      (s) =>
        `[${formatElapsedClock(s.startOffsetMs)}] ${s.speaker ?? 'Falante'}: ${getSegmentDisplayText(s)}`,
    )
    .join('\n');
}

export function recordToText(record: MeetingRecord): string {
  const header = [
    record.title,
    `${formatDate(record.startedAt)} · ${formatTime(record.startedAt)}`,
    record.participants.length > 0
      ? `Participantes: ${record.participants.map((p) => p.name).join(', ')}`
      : null,
    '',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
  return `${header}\n${transcriptToText(record.segments)}\n`;
}

function safeFilename(title: string): string {
  const clean = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return clean.length > 0 ? clean : 'transcricao';
}

export function downloadTranscript(record: MeetingRecord): void {
  const blob = new Blob([recordToText(record)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeFilename(record.title)}.txt`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
