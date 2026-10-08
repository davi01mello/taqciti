/**
 * Formatação de apresentação (datas, durações, iniciais) — helpers puros de UI.
 */
import type { Participant } from '@/shared/types/domain';

/** Quem está tocando a reunião (o "Eu"): o participante marcado como anfitrião. */
export function hostName(participants: readonly Participant[]): string | null {
  return participants.find((p) => p.isHost === true)?.name ?? null;
}

/**
 * Rótulo de exibição ao vivo: "Bernardo Belfort (Eu)" para a própria pessoa,
 * nome puro para os demais. O "(Eu)" é só de tela — o que vai para a plataforma
 * e para a exportação é sempre o nome puro (o `speaker` do segmento).
 */
export function speakerLabel(realName: string, selfName: string | null): string {
  return selfName !== null && realName.toLowerCase() === selfName.toLowerCase()
    ? `${realName} (Eu)`
    : realName;
}

export function formatElapsedClock(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDurationHuman(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 1) return 'menos de 1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest > 0 ? `${h}h ${rest}min` : `${h}h`;
}

export function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatOffset(offsetMs: number): string {
  return formatElapsedClock(offsetMs);
}

/**
 * Quanto durou a fala, ao lado do horário: "12 s", "1 min 05 s". Fala sem
 * duração conhecida (fim antes do início, ou ainda sem fim) não mostra nada —
 * melhor que "0 s", que seria um número inventado.
 */
export function formatSpeechDuration(startOffsetMs: number, endOffsetMs: number): string {
  const ms = endOffsetMs - startOffsetMs;
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const total = Math.max(1, Math.round(ms / 1000));
  if (total < 60) return `${total} s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m} min ${String(s).padStart(2, '0')} s`;
}

/** Palavras de um conjunto de falas — usado nas estatísticas da reunião. */
export function countWords(texts: readonly string[]): number {
  return texts.reduce(
    (total, text) => total + text.split(/\s+/).filter(Boolean).length,
    0,
  );
}

/** 1240 → "1,2 mil" (números grandes sem virar ruído visual). */
export function formatCount(value: number): string {
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(1).replace('.', ',')} mil`;
}
