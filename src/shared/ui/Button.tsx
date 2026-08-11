/**
 * O botão do design system — um objeto de vidro sobre a interface.
 *
 * ── O que mudou, e por quê ─────────────────────────────────────────────────
 *
 * O primário era um retângulo de verde CHAPADO (`from-#2fd267 to-#17a94a`), e
 * era ele, sozinho, que carregava a maior parte da sensação de saturação do
 * produto: um bloco sólido do verde mais forte da paleta, presente na base de
 * praticamente toda tela, a reunião inteira.
 *
 * A correção não foi trocar o verde por outro — a identidade é o verde. Foi
 * parar de aplicá-lo como tinta e passar a aplicá-lo como VIDRO: o `.glass-tint`
 * tem alpha abaixo de 1, desfoca o que está atrás e recolhe um brilho na quina
 * de cima. A cor continua sendo a mesma família, o botão continua sendo a
 * única coisa colorida da tela — mas ele deixa o fundo atravessar, e é isso
 * que tira o peso sem tirar a hierarquia.
 *
 * ── Estados ────────────────────────────────────────────────────────────────
 *
 * hover     sobe 1px e clareia de leve — o vidro "se aproxima da luz"
 * active    volta ao lugar e afunda 1% — devolve a sensação de toque físico
 * disabled  dessatura ALÉM de baixar a opacidade: só a opacidade deixava o
 *           verde da marca ainda parecendo um botão pronto para clicar
 * focus     anel visível sempre, inclusive por cima do vidro
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'default' | 'compact';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /**
   * `compact` para ações auxiliares — é o que dá hierarquia dentro de uma
   * fileira de botões. Antes cada chamada resolvia isso com
   * `className="!min-h-[38px] text-xs"`, e o "auxiliar" tinha meia dúzia de
   * alturas diferentes pelo produto.
   */
  size?: Size;
  children?: ReactNode;
}

const BASE =
  'inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold ' +
  'transition-[transform,filter,background-color,box-shadow] duration-200 ease-flow ' +
  'disabled:opacity-45 disabled:grayscale disabled:pointer-events-none ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/70';

const SIZES: Record<Size, string> = {
  /* 44px é o alvo de toque mínimo; vale para a ação principal de cada tela. */
  default: 'min-h-[44px] px-4 py-2 text-sm',
  compact: 'min-h-[34px] px-3 py-1.5 text-xs',
};

const VARIANTS: Record<Variant, string> = {
  primary:
    'glass-tint text-primary-deep ' +
    'hover:-translate-y-px hover:brightness-[1.06] ' +
    'active:translate-y-0 active:scale-[0.99] active:brightness-95',
  secondary:
    'glass-subtle text-foreground ' +
    'hover:-translate-y-px hover:bg-white/[0.085] ' +
    'active:translate-y-0 active:scale-[0.99]',
  ghost:
    'text-muted hover:bg-white/[0.06] hover:text-foreground active:scale-[0.99]',
  danger:
    'text-danger [background:var(--tint-danger)] ' +
    'shadow-[inset_0_0_0_1px_rgba(248,141,141,0.18)] ' +
    'hover:brightness-125 active:scale-[0.99]',
};

export function Button({
  variant = 'secondary',
  size = 'default',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${rest.className ?? ''}`}
    >
      {children}
    </button>
  );
}
