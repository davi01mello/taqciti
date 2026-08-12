import { describe, expect, it } from 'vitest';
import { BENCH_SCHEMA, BENCH_SYSTEM, checkAnchors, countKinds } from './bench';
import type { BenchStatement } from './bench';

const transcript = [
  '**Carlos:** Vamos revisar a modelagem do banco de dados do sistema de gestão de clientes?',
  '**Ana:** Podemos avaliar desnormalizações específicas após os testes de desempenho.',
].join('\n');

const statement = (quote: string, kind = 'context'): BenchStatement => ({
  text: 'irrelevante para a âncora',
  quote,
  kind,
});

describe('checkAnchors', () => {
  it('conta como exata a citação copiada caractere por caractere', () => {
    const report = checkAnchors([statement('modelagem do banco de dados')], transcript);
    expect(report.exatos).toBe(1);
    expect(report.taxa).toBe(1);
  });

  it('aceita diferença só de espaço, aspas curvas e caixa', () => {
    const report = checkAnchors([statement('MODELAGEM   DO  BANCO de dados')], transcript);
    expect(report.exatos).toBe(0);
    expect(report.normalizados).toBe(1);
    expect(report.taxa).toBe(1);
  });

  it('NÃO tolera acento faltando — é assim que a falha real aparece', () => {
    // Caso observado em gemini-3.5-flash: "gestão" saiu como "gesto", com o
    // caractere multibyte apagado em vez de transliterado. JSON válido,
    // schema satisfeito, âncora inútil. Só esta checagem pega.
    const report = checkAnchors([statement('sistema de gesto de clientes')], transcript);
    expect(report.perdidos).toBe(1);
    expect(report.taxa).toBe(0);
  });

  it('reporta exemplos das perdidas, para o diagnóstico não virar adivinhação', () => {
    const report = checkAnchors([statement('frase que nunca foi dita')], transcript);
    expect(report.exemplosPerdidos[0]).toContain('nunca foi dita');
  });

  it('citação vazia conta como perdida, não como acerto', () => {
    // `''` está contido em qualquer string; sem guarda, uma citação vazia
    // passaria como âncora válida e a taxa mentiria.
    const report = checkAnchors([statement('')], transcript);
    expect(report.perdidos).toBe(1);
  });

  it('taxa é zero, e não NaN, quando não há statements', () => {
    expect(checkAnchors([], transcript).taxa).toBe(0);
  });

  it('mistura exatas, normalizadas e perdidas na mesma conta', () => {
    const report = checkAnchors(
      [
        statement('modelagem do banco de dados'),
        statement('TESTES   DE DESEMPENHO'),
        statement('isso não está na transcrição'),
      ],
      transcript,
    );
    expect(report).toMatchObject({ total: 3, exatos: 1, normalizados: 1, perdidos: 1 });
    expect(report.taxa).toBeCloseTo(2 / 3, 5);
  });
});

describe('countKinds', () => {
  it('agrupa por kind', () => {
    const counts = countKinds([
      statement('a', 'decision'),
      statement('b', 'decision'),
      statement('c', 'argument'),
    ]);
    expect(counts).toEqual({ decision: 2, argument: 1 });
  });

  it('devolve objeto vazio sem statements', () => {
    expect(countKinds([])).toEqual({});
  });
});

describe('prompt do bench', () => {
  it('é neutro quanto ao provedor', () => {
    // Prompt que cita um fornecedor faz a comparação medir adequação ao
    // prompt em vez de capacidade do modelo.
    const texto = BENCH_SYSTEM.toLowerCase();
    for (const marca of ['claude', 'anthropic', 'gemini', 'google', 'grok', 'gpt', 'openai']) {
      expect(texto).not.toContain(marca);
    }
  });

  it('ensina a distinção entre proposta e decisão, que é o discriminador', () => {
    expect(BENCH_SYSTEM).toContain('NÃO são decisão');
    expect(BENCH_SYSTEM).toMatch(/concord/i);
  });

  it('exige quote literal', () => {
    expect(BENCH_SYSTEM).toMatch(/literal/i);
  });

  it('o schema cobre os kinds que CompactedStatement define', () => {
    const kinds = BENCH_SCHEMA.properties!.statements!.items!.properties!.kind!.enum;
    expect(kinds).toEqual([
      'context',
      'argument',
      'decision',
      'commitment',
      'deadline',
      'risk',
      'question',
      'other',
    ]);
  });
});
