import { describe, expect, it } from 'vitest';
import { ehRotuloDeSelf, limparRotuloDeSelf } from './rotuloDeSelf';

describe('ehRotuloDeSelf', () => {
  it.each(['Você', 'voce', 'VOCÊ', ' você ', 'You', 'you', 'Eu', 'EU', 'vc', 'Tu'])(
    'reconhece %s como rótulo, não como nome',
    (rotulo) => {
      expect(ehRotuloDeSelf(rotulo)).toBe(true);
    },
  );

  it.each(['Ana Souza', 'Bernardo Belfort', 'Eugênio', 'Eumir', 'Vocelia', 'Tulio'])(
    'não confunde %s com rótulo',
    (nome) => {
      // A comparação e por igualdade da string INTEIRA normalizada, nunca por
      // prefixo: "Eugênio" começa com "eu" e "Tulio" com "tu". Um `startsWith`
      // aqui apagaria o nome de gente de verdade.
      expect(ehRotuloDeSelf(nome)).toBe(false);
    },
  );
});

describe('limparRotuloDeSelf', () => {
  it.each([
    ['Bernardo Belfort (Você)', 'Bernardo Belfort'],
    ['Ana Souza (você)', 'Ana Souza'],
    ['Carlos (You)', 'Carlos'],
    ['Ana Souza  (Você)  ', 'Ana Souza'],
  ])('%s vira %s', (entrada, esperado) => {
    expect(limparRotuloDeSelf(entrada)).toBe(esperado);
  });

  it('não toca em parêntese que não é rótulo de self', () => {
    // "Maria (RH)" carrega informação. Descartar todo parêntese final por
    // atacado perderia isso.
    expect(limparRotuloDeSelf('Maria (RH)')).toBe('Maria (RH)');
    expect(limparRotuloDeSelf('João (convidado)')).toBe('João (convidado)');
  });

  it('devolve o rótulo puro intacto, para virar lacuna depois', () => {
    // Quem transforma isto em `[A preencher: ...]` é `detectGaps`. Se aqui
    // devolvesse string vazia, o participante sumiria da ata em silêncio.
    expect(limparRotuloDeSelf('Você')).toBe('Você');
    expect(limparRotuloDeSelf('(Você)')).toBe('(Você)');
  });

  it('não deixa nome virar string vazia', () => {
    for (const entrada of ['Você', '(Você)', '(you)']) {
      expect(limparRotuloDeSelf(entrada).length).toBeGreaterThan(0);
    }
  });
});
