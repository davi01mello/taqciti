/** Marca da TaqCITi: três barras de waveform. Anima quando gravando. */

interface WaveProps {
  size?: number;
  animated?: boolean;
  tone?: 'green' | 'amber' | 'dim';
}

/*
 * Os mesmos valores de `--c-primary` / `--c-glow`, em hex: a marca é
 * desenhada como SVG inline e cada barra recebe a sua cor por style, então
 * aqui não dá para passar pelo token CSS. Quando o verde mudar em
 * tokens.css, estes dois mudam junto — é o único lugar do produto onde a cor
 * da marca aparece duplicada, e é por essa razão.
 */
const TONES = {
  green: ['#5ccb85', '#90dfad', '#5ccb85'],
  amber: ['#e8c164', '#e8c164', '#e8c164'],
  dim: ['#3a4753', '#4b5a68', '#3a4753'],
} as const;

const HEIGHTS = [0.44, 0.85, 0.33];

export function Wave({ size = 18, animated = false, tone = 'green' }: WaveProps) {
  const colors = TONES[tone];
  return (
    <span
      className="inline-flex items-center"
      style={{ height: size, gap: size * 0.14 }}
      aria-hidden
    >
      {HEIGHTS.map((h, i) => (
        <span
          key={i}
          className={animated ? 'animate-eq' : ''}
          style={{
            width: size * 0.19,
            height: size * h,
            borderRadius: 999,
            backgroundColor: colors[i],
            animationDelay: `${i * 0.18}s`,
          }}
        />
      ))}
    </span>
  );
}
