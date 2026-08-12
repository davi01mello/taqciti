import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_KEY_ENV_VAR, describeSkips, hasApiKey, planMatrixRun } from './availability';
import { COMPARISON_MATRIX } from './config';
import type { MatrixEntry } from './config';

const ORIGINAL = { ...process.env };

function setKeys(present: Array<'anthropic' | 'google' | 'xai'>) {
  for (const [provider, envVar] of Object.entries(API_KEY_ENV_VAR)) {
    if (present.includes(provider as 'anthropic')) process.env[envVar] = 'chave-de-teste';
    else delete process.env[envVar];
  }
}

beforeEach(() => setKeys([]));
afterEach(() => {
  process.env = { ...ORIGINAL };
});

const entry = (id: string, provider: MatrixEntry['provider']): MatrixEntry => ({
  id,
  provider,
  tier: 'barato',
  model: `modelo-${id}`,
});

describe('hasApiKey', () => {
  it('reconhece chave presente e ausente', () => {
    setKeys(['google']);
    expect(hasApiKey('google')).toBe(true);
    expect(hasApiKey('anthropic')).toBe(false);
  });

  it('trata chave só com espaços como ausente', () => {
    process.env.XAI_API_KEY = '   ';
    expect(hasApiKey('xai')).toBe(false);
  });
});

describe('planMatrixRun', () => {
  it('separa executáveis de puladas', () => {
    setKeys(['google']);
    const plan = planMatrixRun([entry('a', 'google'), entry('b', 'anthropic')]);

    expect(plan.runnable.map((e) => e.id)).toEqual(['a']);
    expect(plan.skipped.map((s) => s.entry.id)).toEqual(['b']);
  });

  it('toda entrada pulada carrega motivo nomeando a variável de ambiente', () => {
    // "pulou" sem motivo obriga quem lê o relatório a adivinhar se foi falta
    // de chave, erro de rede ou decisão.
    setKeys(['google']);
    const plan = planMatrixRun([entry('b', 'anthropic')]);
    expect(plan.skipped[0]!.reason).toContain('ANTHROPIC_API_KEY');
  });

  it('nenhuma entrada some: executáveis + puladas = total', () => {
    setKeys(['google']);
    const plan = planMatrixRun();
    expect(plan.runnable.length + plan.skipped.length).toBe(COMPARISON_MATRIX.length);
  });

  it('fornecedor com todas as entradas puladas vira linha própria', () => {
    setKeys(['google']);
    const plan = planMatrixRun([
      entry('g1', 'google'),
      entry('a1', 'anthropic'),
      entry('a2', 'anthropic'),
    ]);

    expect(plan.skippedProviders).toHaveLength(1);
    expect(plan.skippedProviders[0]!.provider).toBe('anthropic');
    expect(plan.skippedProviders[0]!.entryIds).toEqual(['a1', 'a2']);
  });

  it('fornecedor parcialmente executado NÃO vira linha de fornecedor', () => {
    setKeys(['google', 'anthropic']);
    const plan = planMatrixRun([entry('a1', 'anthropic'), entry('g1', 'google')]);
    expect(plan.skippedProviders).toHaveLength(0);
  });

  it('com todas as chaves, nada é pulado', () => {
    setKeys(['anthropic', 'google', 'xai']);
    const plan = planMatrixRun();
    expect(plan.skipped).toHaveLength(0);
    expect(plan.skippedProviders).toHaveLength(0);
    expect(plan.runnable).toHaveLength(COMPARISON_MATRIX.length);
  });

  it('sem chave nenhuma, os três fornecedores aparecem como fora', () => {
    const plan = planMatrixRun();
    expect(plan.runnable).toHaveLength(0);
    expect(plan.skippedProviders.map((p) => p.provider).sort()).toEqual([
      'anthropic',
      'google',
      'xai',
    ]);
  });

  it('o cenário real de hoje: só Google roda, Anthropic e xAI fora', () => {
    setKeys(['google']);
    const plan = planMatrixRun();

    expect(plan.runnable.every((e) => e.provider === 'google')).toBe(true);
    expect(plan.skippedProviders.map((p) => p.provider).sort()).toEqual(['anthropic', 'xai']);
  });
});

describe('describeSkips', () => {
  it('devolve null quando nada foi pulado', () => {
    setKeys(['anthropic', 'google', 'xai']);
    expect(describeSkips(planMatrixRun())).toBeNull();
  });

  it('destaca o fornecedor inteiro e não repete as entradas dele', () => {
    setKeys(['google']);
    const texto = describeSkips(
      planMatrixRun([entry('g1', 'google'), entry('a1', 'anthropic'), entry('a2', 'anthropic')]),
    )!;

    expect(texto).toContain('FORNECEDOR ANTHROPIC INTEIRO');
    expect(texto).toContain('a1, a2');
    // As entradas já estão contadas na linha do fornecedor; repeti-las
    // linha a linha faria o relatório parecer ter mais buracos do que tem.
    expect(texto).not.toMatch(/^configuração a1 fora/m);
  });

  it('lista entrada avulsa quando o fornecedor não caiu inteiro', () => {
    setKeys(['google']);
    const texto = describeSkips(
      planMatrixRun([entry('g1', 'google'), entry('x1', 'xai')]),
    )!;
    expect(texto).toContain('FORNECEDOR XAI INTEIRO');
  });
});
