/**
 * Uma tela do fluxo: título, subtítulo e corpo, com uma decisão principal.
 *
 * Toda tela do produto passa por aqui, e é isso que faz uma parecer a outra: a
 * mesma escala tipográfica, o mesmo respiro, a mesma animação de entrada.
 */
import type { ReactNode } from 'react';

interface ScreenProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Rodapé discreto: a saída secundária, longe da decisão principal. */
  footer?: ReactNode;
  /** Direção da transição — 'back' entra pela esquerda. */
  direction?: 'forward' | 'back';
}

export function Screen({
  title,
  subtitle,
  children,
  footer,
  direction = 'forward',
}: ScreenProps) {
  const animation =
    direction === 'back' ? 'animate-slide-in-left' : 'animate-slide-in-right';

  return (
    <div className={`${animation} motion-reduce:animate-none flex min-h-0 flex-col`}>
      <h2 className="text-title font-semibold leading-tight tracking-[-0.01em] text-foreground">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-1.5 text-body leading-relaxed text-muted">{subtitle}</p>
      )}
      <div className="mt-4 min-h-0">{children}</div>
      {footer && <div className="mt-4">{footer}</div>}
    </div>
  );
}
