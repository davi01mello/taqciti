/**
 * Tokens do sistema de design "Liquid Glass" mapeados para o Tailwind.
 * As cores reais vivem em src/shared/config/tokens.css como CSS custom properties.
 */
import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      // Canais crus + <alpha-value>: é o que faz `text-muted/70` e
      // `bg-primary/15` funcionarem (ver comentário em tokens.css).
      colors: {
        background: 'rgb(var(--c-background) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        elevated: 'rgb(var(--c-elevated) / <alpha-value>)',
        primary: 'rgb(var(--c-primary) / <alpha-value>)',
        glow: 'rgb(var(--c-glow) / <alpha-value>)',
        /** O verde escuro que fica SOBRE o verde — texto do botão primário. */
        'primary-deep': 'rgb(var(--c-primary-deep) / <alpha-value>)',
        foreground: 'rgb(var(--c-text) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        danger: 'rgb(var(--c-danger) / <alpha-value>)',
        borderc: 'var(--color-border)',
      },
      /**
       * A escala tipográfica — cinco degraus, e só.
       *
       * Antes havia `[10px]`, `[10.5px]`, `[11px]`, `[11.5px]`, `[12px]`,
       * `[12.5px]`, `[13px]`, `[13.5px]`, `[14.5px]`, `[15px]` e `[15.5px]`
       * espalhados como literais pelas telas. Meia dúzia de tamanhos quase
       * iguais não é hierarquia: é o que faz uma interface parecer montada aos
       * pedaços, porque o olho percebe a diferença sem conseguir atribuir
       * significado a ela.
       *
       * Cada degrau já vem com a entrelinha certa para o seu papel: texto de
       * leitura corrida solto, rótulo e número apertados.
       */
      fontSize: {
        micro: ['10.5px', { lineHeight: '1.4', letterSpacing: '0.02em' }],
        caption: ['11.5px', { lineHeight: '1.45' }],
        body: ['12.5px', { lineHeight: '1.55' }],
        read: ['13.5px', { lineHeight: '1.6' }],
        title: ['15px', { lineHeight: '1.35', letterSpacing: '-0.01em' }],
      },
      /**
       * Uma escala só de raio, vinda dos tokens — nada no produto tem canto
       * vivo, e curvas aninhadas ficam concêntricas em vez de acidentais.
       * Os nomes dizem o PAPEL, para que um card nunca receba por engano o
       * raio de um chip.
       */
      borderRadius: {
        chip: 'var(--radius-xs)',
        control: 'var(--radius-sm)',
        panel: 'var(--radius-md)',
        card: 'var(--radius-lg)',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Text',
          'Inter',
          'Segoe UI',
          'sans-serif',
        ],
      },
      transitionTimingFunction: {
        flow: 'cubic-bezier(0.32, 0.72, 0, 1)',
        pop: 'cubic-bezier(0.34, 1.45, 0.64, 1)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        soft: 'var(--shadow-md)',
        float: 'var(--shadow-lg)',
        /* Halo quase inexistente: serve para dizer "isto está ativo", não
           para iluminar a tela. O valor antigo (0.35 do verde saturado) era
           metade da sensação de brilho excessivo. */
        glow: '0 0 20px rgba(92, 203, 133, 0.18)',
      },
      keyframes: {
        'fade-slide-in': {
          from: { opacity: '0', transform: 'translateY(7px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.4', transform: 'scale(0.75)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.5)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        // Passos do wizard: entra da direita ao avançar, da esquerda ao voltar.
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-in-left': {
          from: { opacity: '0', transform: 'translateX(-16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        eq: {
          '0%, 100%': { transform: 'scaleY(0.55)' },
          '50%': { transform: 'scaleY(1.25)' },
        },
        // O painel dentro do Meet: a cápsula chega, o painel abre a partir dela.
        'dock-in': {
          from: { opacity: '0', transform: 'translateY(10px) scale(0.9)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        ripple: {
          '0%': { opacity: '0.5', transform: 'scale(0.6)' },
          '100%': { opacity: '0', transform: 'scale(1.9)' },
        },
        typing: {
          '0%, 100%': { opacity: '0.25' },
          '50%': { opacity: '1' },
        },
        spin: {
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        entry: 'fade-slide-in 260ms cubic-bezier(0.32, 0.72, 0, 1)',
        'pulse-dot': 'pulse-dot 1.7s cubic-bezier(0.32, 0.72, 0, 1) infinite',
        'fade-in': 'fade-in 200ms cubic-bezier(0.32, 0.72, 0, 1)',
        'pop-in': 'pop-in 460ms cubic-bezier(0.34, 1.45, 0.64, 1)',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.32, 0.72, 0, 1)',
        'slide-in-left': 'slide-in-left 220ms cubic-bezier(0.32, 0.72, 0, 1)',
        eq: 'eq 1.15s ease-in-out infinite',
        'dock-in': 'dock-in 420ms cubic-bezier(0.34, 1.45, 0.64, 1)',
        ripple: 'ripple 2.6s cubic-bezier(0.32, 0.72, 0, 1) infinite',
        typing: 'typing 1.3s ease-in-out infinite',
        'spin-slow': 'spin 900ms linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
