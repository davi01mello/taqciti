/** Badge de status: cores por tom semântico. Componente puro. */
import type { ReactNode } from 'react';

type Tone = 'primary' | 'neutral' | 'warning' | 'danger';

const TONES: Record<Tone, string> = {
  primary: 'bg-primary/15 text-glow shadow-[inset_0_0_0_1px_rgba(45,219,96,0.25)]',
  neutral: 'bg-white/5 text-muted shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]',
  warning: 'bg-amber-400/15 text-amber-300 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.25)]',
  danger: 'bg-red-500/15 text-red-300 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.25)]',
};

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-micro font-semibold ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
