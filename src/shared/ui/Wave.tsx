/** Marca da TaqCITi: três barras de waveform. Anima quando gravando. */

interface WaveProps {
  size?: number;
  animated?: boolean;
  tone?: 'green' | 'amber' | 'dim';
}

const TONES = {
  green: ['#2ddb60', '#7af2a5', '#2ddb60'],
  amber: ['#f2c94c', '#f2c94c', '#f2c94c'],
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
