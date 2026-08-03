import { describe, expect, it } from 'vitest';
import {
  firstNameOf,
  formatSpeakerName,
  isSelfCaptionLabel,
  sanitizeSpeakerName,
} from './sanitize';

describe('formatSpeakerName', () => {
  it('normaliza CAIXA ALTA para nome próprio', () => {
    expect(formatSpeakerName('BERNARDO BELFORT')).toBe('Bernardo Belfort');
  });

  it('normaliza minúsculas bagunçadas', () => {
    expect(formatSpeakerName('joão   pedro')).toBe('João Pedro');
  });

  it('corta para os 3 primeiros nomes, preservando conectores no meio', () => {
    expect(formatSpeakerName('MARIA EDUARDA DA SILVA SANTOS')).toBe(
      'Maria Eduarda da Silva',
    );
  });

  it('mantém conectores minúsculos (de/da/do)', () => {
    expect(formatSpeakerName('ana DE souza')).toBe('Ana de Souza');
  });

  it('nunca termina num conector solto', () => {
    expect(formatSpeakerName('Ana de')).toBe('Ana');
  });

  it('lida com hífen e apóstrofo', () => {
    expect(formatSpeakerName('ana-maria d’angelo costa lima')).toBe(
      'Ana-Maria D’Angelo Costa',
    );
  });

  it('devolve null para vazio e para só espaços', () => {
    expect(formatSpeakerName('   ')).toBeNull();
    expect(formatSpeakerName(null)).toBeNull();
  });

  it('é idempotente', () => {
    const once = formatSpeakerName('MARIA EDUARDA DA SILVA SANTOS');
    expect(formatSpeakerName(once)).toBe(once);
  });
});

describe('firstNameOf', () => {
  it('devolve só o primeiro nome, em nome próprio', () => {
    expect(firstNameOf('maria eduarda')).toBe('Maria');
    expect(firstNameOf('BERNARDO BELFORT')).toBe('Bernardo');
  });
});

describe('isSelfCaptionLabel', () => {
  it('reconhece os rótulos da própria pessoa em vários idiomas', () => {
    for (const label of ['Você', 'voce', 'You', 'eu', 'EU', 'Tu']) {
      expect(isSelfCaptionLabel(label)).toBe(true);
    }
  });

  it('não confunde um nome real com self', () => {
    expect(isSelfCaptionLabel('Bernardo')).toBe(false);
    expect(isSelfCaptionLabel(null)).toBe(false);
  });
});

describe('sanitizeSpeakerName (contrato preservado)', () => {
  it('colapsa espaços e apara', () => {
    expect(sanitizeSpeakerName('  Ana   Costa ')).toBe('Ana Costa');
  });
});
