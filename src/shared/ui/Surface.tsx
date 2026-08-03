/**
 * Superfície de vidro do design system. Antes cada tela desenhava a sua (o
 * painel no Meet em CSS solto, o side panel em Tailwind), e por isso "tinha
 * página diferente de página". Agora existe uma só, em três pesos.
 */
import type { HTMLAttributes, ReactNode } from 'react';

type Level = 'panel' | 'card' | 'inset';

interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  level?: Level;
  children: ReactNode;
}

const LEVELS: Record<Level, string> = {
  /** O corpo do painel: vidro cheio, borda de luz. */
  panel: 'glass rounded-panel',
  /** Um bloco dentro do painel. */
  card: 'glass-lite rounded-panel',
  /** Um campo ou trecho rebaixado, para o conteúdo respirar. */
  inset: 'rounded-control border border-white/10 bg-black/25',
};

export function Surface({ level = 'card', children, className = '', ...rest }: SurfaceProps) {
  return (
    <div {...rest} className={`${LEVELS[level]} ${className}`}>
      {children}
    </div>
  );
}
