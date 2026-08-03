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

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * Paleta das pessoas — matizes escolhidos a dedo, TODOS fora da faixa do verde
 * (~110–165). O verde é a voz da marca: se uma pessoa também for verde, o olho
 * confunde falante com interface.
 */
const SPEAKER_HUES = [8, 26, 44, 178, 196, 212, 236, 262, 288, 318, 338] as const;

const SESSION_COLORS = {
  dark: [
    '#ff8a80', '#ffb74d', '#ffe082', '#4dd0e1', '#64b5f6', '#90caf9',
    '#9fa8da', '#b39ddb', '#ce93d8', '#f48fb1', '#80cbc4', '#bcaaa4',
  ],
  light: [
    '#a52714', '#8a4b00', '#735c00', '#006064', '#0d47a1', '#12538a',
    '#283593', '#4527a0', '#6a1b9a', '#880e4f', '#005b4f', '#5d4037',
  ],
} as const;

export type SpeakerColorTheme = keyof typeof SESSION_COLORS;

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function hueForName(name: string): number {
  const index = hashName(name) % SPEAKER_HUES.length;
  return SPEAKER_HUES[index] ?? SPEAKER_HUES[0];
}

/** Cor determinística por nome: mesma pessoa, mesma cor, em qualquer tela. */
export function colorForName(name: string): string {
  const palette = SESSION_COLORS.dark;
  return palette[hashName(name) % palette.length] ?? palette[0];
}

/**
 * Paleta da SESSÃO: o hash só escolhe a preferência inicial; colisões fazem
 * probing nos tons ainda livres. Assim nomes com o mesmo hash não recebem a
 * mesma cor quando aparecem juntos. A ordem é a primeira aparição e permanece
 * estável enquanto novas falas são anexadas.
 */
export function assignSpeakerColors(
  names: readonly string[],
  theme: SpeakerColorTheme = 'dark',
): ReadonlyMap<string, string> {
  const palette = SESSION_COLORS[theme];
  const result = new Map<string, string>();
  const used = new Set<number>();
  for (const raw of names) {
    const name = raw.trim() || 'Falante';
    if (result.has(name)) continue;
    const preferred = hashName(name) % palette.length;
    let index = preferred;
    if (used.size < palette.length) {
      for (let offset = 0; offset < palette.length; offset += 1) {
        const candidate = (preferred + offset) % palette.length;
        if (!used.has(candidate)) {
          index = candidate;
          break;
        }
      }
    }
    used.add(index);
    result.set(name, palette[index] ?? palette[0]);
  }
  return result;
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

/** Exportado para a verificação WCAG automatizada da paleta. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Gradiente determinístico do avatar — mesma pessoa, mesmo par de tons. */
export function gradientForName(name: string): string {
  const hue = hueForName(name);
  return `linear-gradient(140deg, hsl(${hue} 68% 64%), hsl(${(hue + 34) % 360} 64% 48%))`;
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
