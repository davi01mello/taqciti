/**
 * Botão do design system: primário (verde com glow), secundário (glass),
 * ghost e danger. Sempre arredondado. Componente puro — zero lógica de negócio.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

// Desabilitado precisa PARECER desabilitado: só baixar a opacidade deixava o
// verde da marca ainda parecendo um botão pronto para clicar. Dessaturar
// resolve de vez a ambiguidade.
const BASE =
  'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ' +
  'transition-all duration-200 ease-flow ' +
  'disabled:opacity-45 disabled:grayscale disabled:pointer-events-none ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/60';

const VARIANTS: Record<Variant, string> = {
  // Sem halo colorido: o botão é uma superfície, não uma lâmpada.
  primary:
    'bg-gradient-to-b from-[#2fd267] to-[#17a94a] text-[#032b10] ' +
    'shadow-[0_4px_12px_-4px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.3)] ' +
    'hover:-translate-y-px hover:brightness-[1.08] ' +
    'active:translate-y-0 active:brightness-95',
  secondary: 'glass-lite text-foreground hover:bg-white/10 hover:-translate-y-px',
  ghost: 'text-muted hover:text-foreground hover:bg-white/5',
  danger: 'bg-red-500/15 text-red-300 border border-red-400/20 hover:bg-red-500/25',
};

export function Button({ variant = 'secondary', children, ...rest }: ButtonProps) {
  return (
    <button {...rest} className={`${BASE} ${VARIANTS[variant]} ${rest.className ?? ''}`}>
      {children}
    </button>
  );
}
