/**
 * A marca TaqCiti: o sinal de waveform mais o nome.
 *
 * ── O lockup ─────────────────────────────────────────────────────────────
 *
 * O sinal é vetor (`SinalTaqciti`, recortado na caixa exata da onda) e o nome
 * é texto na Barlow — a mesma fonte da ata que o produto gera. Antes o sinal
 * era o PNG quadrado da marca, em que 60% da altura é margem, e o nome saía na
 * fonte do sistema: no cabeçalho da sidebar a onda tinha uns 8px e o nome não
 * tinha nada a ver com o documento.
 *
 * "Taq" no branco do texto, "Citi" no verde da marca e em itálico: é o desenho
 * que o produto já tinha, só que agora com a fonte certa. O itálico da Barlow
 * não é embarcado, então ele é o oblíquo sintetizado — a Barlow é geométrica o
 * bastante para isso ler como intenção e não como fallback.
 *
 * `height` manda: o corpo da fonte e o sinal saem dele. O sinal desliga sozinho
 * abaixo de 14px, onde as barras viram um borrão.
 */
import { SinalTaqciti } from './SinalTaqciti';

interface Props {
  height?: number;
  className?: string;
  /** Desliga o sinal e deixa só o nome. Útil onde a altura é apertada. */
  comSinal?: boolean;
}

export function Wordmark({ height = 26, className = '', comSinal = true }: Props) {
  const mostrarSinal = comSinal && height >= 14;
  const corpo = Math.round(height * 0.92);

  return (
    <span
      className={`inline-flex select-none items-center ${className}`}
      style={{ height, gap: Math.round(height * 0.34) }}
      aria-label="TaqCiti"
      role="img"
    >
      {mostrarSinal && <SinalTaqciti altura={Math.round(height * 0.78)} />}
      <span
        aria-hidden="true"
        style={{
          fontFamily: 'var(--font-titulo)',
          fontSize: corpo,
          fontWeight: 700,
          letterSpacing: `${-corpo * 0.02}px`,
          lineHeight: 1,
        }}
        className="text-foreground"
      >
        Taq<em className="text-primary">Citi</em>
      </span>
    </span>
  );
}
