/**
 * A opção clicável do fluxo — o componente que a pessoa mais vê.
 *
 * Três papéis, um só desenho:
 * - `single`  escolha única: clicar seleciona e a tela avança sozinha;
 * - `multi`   múltipla escolha: caixa que marca, sem avançar;
 * - `nav`     leva a outro lugar (escolher uma organização): seta à direita.
 */
import type { ReactNode } from 'react';
import { Icon } from './Icon';

type Role = 'single' | 'multi' | 'nav';

interface OptionCardProps {
  label: string;
  hint?: string;
  /** Detalhe à direita do rótulo (etapa da oportunidade, por exemplo). */
  meta?: string;
  selected?: boolean;
  role?: Role;
  leading?: ReactNode;
  /** Deixa o rótulo quebrar em duas linhas em vez de cortar com reticências. */
  wrap?: boolean;
  onClick: () => void;
}

export function OptionCard({
  label,
  hint,
  meta,
  selected = false,
  role = 'single',
  leading,
  wrap = false,
  onClick,
}: OptionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={role === 'nav' ? undefined : selected}
      className={`group flex w-full items-center gap-3 rounded-panel px-4 py-3.5 text-left text-foreground transition-all duration-200 ease-flow active:scale-[0.985] ${
        selected
          ? 'bg-primary/12 shadow-[inset_0_0_0_1px_rgb(var(--c-primary)/0.38)]'
          : 'glass-subtle hover:-translate-y-px hover:bg-white/[0.075]'
      }`}
    >
      {role === 'multi' && (
        <span
          className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[7px] border transition-colors duration-200 ease-flow ${
            selected
              ? 'border-primary/80 bg-primary/85 text-primary-deep'
              : 'border-white/25'
          }`}
        >
          {selected && <Icon name="check" size={12} />}
        </span>
      )}
      {leading}

      <span className="min-w-0 flex-1">
        <span
          className={`block text-read font-semibold leading-snug ${
            wrap ? '' : 'truncate'
          }`}
        >
          {label}
        </span>
        {hint && (
          <span className="mt-0.5 block truncate text-caption font-normal text-muted">
            {hint}
          </span>
        )}
      </span>

      {meta && (
        <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-muted">
          {meta}
        </span>
      )}
      {role === 'nav' && (
        <Icon
          name="chevron"
          size={16}
          className="shrink-0 -rotate-90 text-muted transition-transform duration-200 ease-flow group-hover:translate-x-0.5"
        />
      )}
      {role === 'single' && selected && (
        <Icon name="check" size={16} className="shrink-0 text-primary" />
      )}
    </button>
  );
}
