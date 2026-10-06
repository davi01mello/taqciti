import { describe, expect, it } from 'vitest';
import { formatSpeechDuration } from './format';

describe('formatSpeechDuration', () => {
  it('segundos, e minutos com segundos de dois dígitos', () => {
    expect(formatSpeechDuration(1_000, 13_000)).toBe('12 s');
    expect(formatSpeechDuration(0, 400)).toBe('1 s');
    expect(formatSpeechDuration(0, 65_000)).toBe('1 min 05 s');
    expect(formatSpeechDuration(0, 600_000)).toBe('10 min 00 s');
  });

  it('sem duração conhecida, não inventa número', () => {
    expect(formatSpeechDuration(5_000, 5_000)).toBe('');
    expect(formatSpeechDuration(9_000, 3_000)).toBe('');
    expect(formatSpeechDuration(0, Number.NaN)).toBe('');
  });
});
