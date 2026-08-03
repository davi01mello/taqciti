/**
 * Ícones SVG do design system. Traço fino e uniforme, herdam currentColor.
 * Ícone é vetor: escala sem serrilhar e segue a cor do texto ao redor.
 */
import type { ReactNode } from 'react';

type IconName =
  | 'search'
  | 'play'
  | 'pause'
  | 'stop'
  | 'trash'
  | 'chevron'
  | 'arrowDown'
  | 'panel'
  | 'check'
  | 'plus';

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
