import { describe, expect, it } from 'vitest';
import type { LiveSegment } from '@/shared/types/domain';
import { detectCaptionLanguage, recentSegmentsText } from './languageHeuristic';

describe('detectCaptionLanguage', () => {
  it('reconhece português com confiança alta', () => {
    const result = detectCaptionLanguage(
      'Então, mas eu acho que não é bem assim, porque a gente já viu isso antes e também não tem como.',
    );
    expect(result.language).toBe('pt');
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  it('reconhece inglês com confiança alta', () => {
    const result = detectCaptionLanguage(
      "So I think that we are going to do this because you know what, that is not what we have with the plan for this.",
    );
    expect(result.language).toBe('en');
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  it('texto curto demais fica unknown', () => {
    const result = detectCaptionLanguage('ok');
    expect(result.language).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('texto sem stopwords reconhecíveis fica unknown', () => {
    const result = detectCaptionLanguage('Bernardo João Maria Pedro Ana Carlos Souza Ltda');
    expect(result.language).toBe('unknown');
  });

  it('só considera a janela recente, ignorando o começo do texto', () => {
    const oldEnglish = 'the and is of that this are was were have has with for not but so we they '.repeat(10);
    const recentPortuguese =
      'mas agora eu acho que não é bem assim porque a gente já viu isso antes e também não tem como';
    const result = detectCaptionLanguage(oldEnglish + recentPortuguese, recentPortuguese.length);
    expect(result.language).toBe('pt');
  });

  it('idioma misto sem dominância clara fica unknown', () => {
    const result = detectCaptionLanguage('the que and não is para that com this uma');
    expect(result.language).toBe('unknown');
  });
});

describe('recentSegmentsText', () => {
  function segment(text: string): LiveSegment {
    return {
      id: 'seg-0',
      captionId: 'c',
      speaker: null,
      text,
      startOffsetMs: 0,
      endOffsetMs: 0,
      source: 'caption',
      status: 'active',
    };
  }

  it('concatena do mais antigo para o mais recente, limitado a maxChars', () => {
    const segments = [segment('primeira fala'), segment('segunda fala'), segment('terceira fala')];
    const text = recentSegmentsText(segments, 200);
    expect(text).toBe('primeira fala segunda fala terceira fala');
  });

  it('corta o início quando ultrapassa maxChars', () => {
    const segments = [segment('bloco antigo bem comprido aqui'), segment('fala recente')];
    const text = recentSegmentsText(segments, 12);
    expect(text.length).toBeLessThanOrEqual(12);
    expect(text.endsWith('fala recente'.slice(-12))).toBe(true);
  });

  it('lista vazia devolve string vazia', () => {
    expect(recentSegmentsText([], 500)).toBe('');
  });
});
