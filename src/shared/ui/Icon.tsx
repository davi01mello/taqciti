/**
 * Ícones SVG do design system. Traço fino e uniforme, herdam currentColor.
 * Ícone é vetor: escala sem serrilhar e segue a cor do texto ao redor.
 */
import type { ReactNode } from 'react';

export type IconName =
  | 'search'
  | 'play'
  | 'pause'
  | 'stop'
  | 'trash'
  | 'chevron'
  | 'arrowDown'
  | 'panel'
  | 'check'
  | 'plus'
  | 'close'
  | 'minimize'
  | 'expand'
  | 'compress'
  // Acrescentados para a HOME em aba inteira (src/home). Ficam aqui, e não
  // num conjunto próprio, porque ícone é vocabulário do design system: um
  // segundo conjunto divergiria em traço e tamanho no primeiro ajuste.
  | 'sparkles'
  | 'history'
  | 'doc'
  | 'link'
  | 'image'
  | 'arrowUp'
  | 'arrowUpRight';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

// Controles de mídia leem melhor sólidos em tamanho pequeno; o resto é traço.
const FILLED = new Set<IconName>(['play', 'pause', 'stop']);

const PATHS: Record<IconName, ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.6-3.6" />
    </>
  ),
  play: <path d="M8 5v14l11-7z" />,
  pause: (
    <>
      <rect x="6.5" y="5" width="3.4" height="14" rx="1.3" />
      <rect x="14.1" y="5" width="3.4" height="14" rx="1.3" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2.6" />,
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5.2A1.2 1.2 0 0 1 10.2 4h3.6A1.2 1.2 0 0 1 15 5.2V7" />
      <path d="M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12" />
    </>
  ),
  chevron: <path d="M6 9.5l6 6 6-6" />,
  arrowDown: (
    <>
      <path d="M12 5v13" />
      <path d="M6.5 12.5L12 18l5.5-5.5" />
    </>
  ),
  panel: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.6" />
      <path d="M14 5v14" />
    </>
  ),
  check: <path d="M20 6.5L9.2 17.3 4.5 12.6" />,
  plus: (
    <>
      <path d="M12 5.5v13" />
      <path d="M5.5 12h13" />
    </>
  ),
  close: (
    <>
      <path d="M6.5 6.5l11 11" />
      <path d="M17.5 6.5l-11 11" />
    </>
  ),
  /* Um traço só: "vira uma faixa", que é o que minimizar faz — diferente do
     `close`, que remove. A distinção entre os dois é o ponto do produto. */
  minimize: <path d="M6 12h12" />,
  /* Setas divergindo na vertical: só a ALTURA muda nos degraus de tamanho. */
  expand: (
    <>
      <path d="M8.5 9.5L12 6l3.5 3.5" />
      <path d="M8.5 14.5L12 18l3.5-3.5" />
    </>
  ),
  compress: (
    <>
      <path d="M8.5 6.5L12 10l3.5-3.5" />
      <path d="M8.5 17.5L12 14l3.5 3.5" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 4.2l1.5 4.1 4.1 1.5-4.1 1.5L12 15.4l-1.5-4.1-4.1-1.5 4.1-1.5z" />
      <path d="M18.2 15.4l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" />
    </>
  ),
  history: (
    <>
      <path d="M3.6 12a8.4 8.4 0 1 0 2.5-6" />
      <path d="M3.4 4.4V9h4.6" />
      <path d="M12 7.8V12l3 1.8" />
    </>
  ),
  doc: (
    <>
      <path d="M14 3.4H7.4A1.6 1.6 0 0 0 5.8 5v14a1.6 1.6 0 0 0 1.6 1.6h9.2a1.6 1.6 0 0 0 1.6-1.6V7.4z" />
      <path d="M14 3.4V7.4h4.2" />
      <path d="M8.9 12.6h6.2M8.9 16h4.4" />
    </>
  ),
  link: (
    <>
      <path d="M10.3 13.7a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-1.2 1.2" />
      <path d="M13.7 10.3a3.6 3.6 0 0 0-5.1 0L6 12.9a3.6 3.6 0 0 0 5.1 5.1l1.2-1.2" />
    </>
  ),
  image: (
    <>
      <rect x="3.6" y="5" width="16.8" height="14" rx="2.2" />
      <circle cx="9" cy="10.2" r="1.5" />
      <path d="M4.4 17.2l4.4-4.1a1.7 1.7 0 0 1 2.3 0l5.1 4.8" />
    </>
  ),
  arrowUp: (
    <>
      <path d="M12 19V5.6" />
      <path d="M6.6 11L12 5.6 17.4 11" />
    </>
  ),
  arrowUpRight: (
    <>
      <path d="M8 16.2L16.2 8" />
      <path d="M9.4 8h6.8v6.8" />
    </>
  ),
};

export function Icon({ name, size = 18, className = '' }: IconProps) {
  const filled = FILLED.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
