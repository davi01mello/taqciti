import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OVERLAP_CHARS,
  DEFAULT_WINDOW_CHARS,
  dedupeKey,
  windowCharsForModel,
  windowTranscript,
} from './windowing';

describe('windowTranscript', () => {
  it('passada única quando cabe no limite', () => {
    const windows = windowTranscript('abc', { windowChars: 10, overlapChars: 2 });
    expect(windows).toHaveLength(1);
    expect(windows[0]).toEqual({ index: 0, start: 0, end: 3, text: 'abc' });
  });

  it('passada única para transcrição de tamanho exatamente igual ao limite', () => {
    expect(windowTranscript('a'.repeat(10), { windowChars: 10, overlapChars: 2 })).toHaveLength(1);
  });

  it('as janelas cobrem a transcrição inteira, sem buraco', () => {
    const transcript = 'a'.repeat(250);
    const windows = windowTranscript(transcript, { windowChars: 100, overlapChars: 20 });

    expect(windows[0]!.start).toBe(0);
    expect(windows.at(-1)!.end).toBe(transcript.length);
    for (let i = 1; i < windows.length; i += 1) {
      // Buraco entre janelas perderia fala; por isso o início da seguinte
      // nunca pode passar do fim da anterior.
      expect(windows[i]!.start).toBeLessThanOrEqual(windows[i - 1]!.end);
    }
  });

  it('a sobreposição é do tamanho pedido', () => {
    const windows = windowTranscript('a'.repeat(250), { windowChars: 100, overlapChars: 20 });
    expect(windows[0]!.end - windows[1]!.start).toBe(20);
  });

  it('cada janela carrega o texto que os offsets prometem', () => {
    const transcript = Array.from({ length: 250 }, (_, i) => String(i % 10)).join('');
    for (const window of windowTranscript(transcript, { windowChars: 100, overlapChars: 20 })) {
      expect(window.text).toBe(transcript.slice(window.start, window.end));
    }
  });

  it('recusa sobreposição maior ou igual à janela em vez de laçar para sempre', () => {
    // Com overlap >= window o avanço seria zero e o laço nunca terminaria —
    // travamento em produção, não erro visível.
    expect(() => windowTranscript('a'.repeat(50), { windowChars: 10, overlapChars: 10 })).toThrow(
      /precisa ser menor/,
    );
  });

  it('recusa parâmetros absurdos', () => {
    expect(() => windowTranscript('abc', { windowChars: 0 })).toThrow(/positivo/);
    expect(() => windowTranscript('abc', { windowChars: 10, overlapChars: -1 })).toThrow(/negativo/);
  });

  it('os padrões da especificação são passada única até 200 mil caracteres', () => {
    expect(DEFAULT_WINDOW_CHARS).toBe(200_000);
    expect(DEFAULT_OVERLAP_CHARS).toBe(4_000);
    expect(windowTranscript('a'.repeat(199_999))).toHaveLength(1);
    expect(windowTranscript('a'.repeat(200_001)).length).toBeGreaterThan(1);
  });
});

describe('windowCharsForModel', () => {
  it('reserva espaço para a saída em vez de encher a janela com entrada', () => {
    // A saída do Analista é grande; encher o contexto de entrada deixaria o
    // modelo sem espaço para responder.
    const chars = windowCharsForModel(1_000_000);
    expect(chars).toBeLessThan(1_000_000 * 3);
  });

  it('é monotônico: janela maior comporta mais caracteres', () => {
    expect(windowCharsForModel(1_000_000)).toBeGreaterThan(windowCharsForModel(200_000));
  });

  it('nunca devolve zero, nem para janela minúscula', () => {
    expect(windowCharsForModel(1)).toBeGreaterThanOrEqual(1);
  });
});

describe('dedupeKey', () => {
  it('iguala afirmações que só diferem em espaço e caixa', () => {
    const a = { text: 'A equipe decidiu', quote: 'vamos fazer' };
    const b = { text: 'a  equipe   DECIDIU', quote: 'VAMOS fazer' };
    expect(dedupeKey(a)).toBe(dedupeKey(b));
  });

  it('separa afirmações com o mesmo texto mas citações diferentes', () => {
    // Mesma conclusão sustentada por trechos diferentes são duas evidências,
    // não uma repetida.
    const a = { text: 'A equipe decidiu', quote: 'vamos fazer' };
    const b = { text: 'A equipe decidiu', quote: 'está aprovado' };
    expect(dedupeKey(a)).not.toBe(dedupeKey(b));
  });

  it('separa citações iguais com textos diferentes', () => {
    const a = { text: 'primeira leitura', quote: 'Concordo.' };
    const b = { text: 'segunda leitura', quote: 'Concordo.' };
    expect(dedupeKey(a)).not.toBe(dedupeKey(b));
  });
});
