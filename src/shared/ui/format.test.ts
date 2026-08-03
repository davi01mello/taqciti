import { describe, expect, it } from 'vitest';
import { assignSpeakerColors, contrastRatio } from './format';

describe('paleta de falantes por sessão', () => {
  it('resolve colisões de hash dentro da mesma reunião', () => {
    // "Aa" e "BB" colidem no hash Java/31 usado pelo helper.
    const colors = assignSpeakerColors(['Aa', 'BB', 'Carla'], 'dark');
    expect(colors.get('Aa')).not.toBe(colors.get('BB'));
    expect(new Set(colors.values())).toHaveLength(3);
  });

  it('mantém cores anteriores quando um novo falante aparece no fim', () => {
    const before = assignSpeakerColors(['Ana', 'Bruno'], 'dark');
    const after = assignSpeakerColors(['Ana', 'Bruno', 'Carla'], 'dark');
    expect(after.get('Ana')).toBe(before.get('Ana'));
    expect(after.get('Bruno')).toBe(before.get('Bruno'));
  });

  it('garante contraste WCAG AA no fundo claro e escuro do produto', () => {
    const names = Array.from({ length: 12 }, (_, index) => `Pessoa ${index}`);
    const dark = assignSpeakerColors(names, 'dark');
    const light = assignSpeakerColors(names, 'light');

    for (const color of dark.values()) {
      expect(contrastRatio(color, '#0b1210')).toBeGreaterThanOrEqual(4.5);
    }
    for (const color of light.values()) {
      expect(contrastRatio(color, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
    expect(new Set(dark.values())).toHaveLength(names.length);
    expect(new Set(light.values())).toHaveLength(names.length);
  });
});
