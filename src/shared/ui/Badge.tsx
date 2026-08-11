/** Badge de status: cores por tom semântico. Componente puro. */
import type { ReactNode } from 'react';

type Tone = 'primary' | 'neutral' | 'warning' | 'danger';

/*
 * Todo tom é o mesmo desenho: um véu translúcido da cor + um fio de 1px da
 * mesma cor por dentro. Nenhum fundo sólido — um badge é uma etiqueta, e uma
 * etiqueta que grita compete com o conteúdo que ela deveria classificar.
 */
const TONES: Record<Tone, string> = {
  primary: 'bg-primary/14 text-glow shadow-[inset_0_0_0_1px_rgba(92,203,133,0.22)]',
  neutral: 'bg-white/[0.05] text-muted shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]',
  warning: 'bg-amber-400/12 text-amber-200/90 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.2)]',
  danger: 'bg-danger/12 text-danger shadow-[inset_0_0_0_1px_rgba(248,141,141,0.2)]',
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
