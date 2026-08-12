import { describe, expect, it } from 'vitest';
import { PRICING, estimateCost, priceFor } from './pricing';
import { PROVIDER_IDS } from './types';

describe('estimateCost', () => {
  it('cobra entrada, saída e leitura de cache com taxas distintas', () => {
    // 1M de entrada dos quais 400k de cache, 100k de saída, em Sonnet 5:
    // (600k × $2 + 400k × $0,20 + 100k × $10) / 1M
    const cost = estimateCost('anthropic', 'claude-sonnet-5', {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cachedInputTokens: 400_000,
    })!;

    expect(cost.inputUsd).toBeCloseTo(1.2, 6);
    expect(cost.cachedInputUsd).toBeCloseTo(0.08, 6);
    expect(cost.outputUsd).toBeCloseTo(1.0, 6);
    expect(cost.totalUsd).toBeCloseTo(2.28, 6);
  });

  it('trata inputTokens como já incluindo o cache', () => {
    // A convenção normalizada: `inputTokens` é o total, `cachedInputTokens`
    // é um recorte dele. Somar os dois cobraria o cache duas vezes.
    const cost = estimateCost('anthropic', 'claude-haiku-4-5', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 1_000_000,
    })!;

    expect(cost.inputUsd).toBe(0);
    expect(cost.cachedInputUsd).toBeCloseTo(0.1, 6);
  });

  it('usa a faixa alta quando o prompt atinge o limiar', () => {
    const abaixo = estimateCost('xai', 'grok-4.3', { inputTokens: 199_999, outputTokens: 1_000 })!;
    const noLimiar = estimateCost('xai', 'grok-4.3', { inputTokens: 200_000, outputTokens: 1_000 })!;

    expect(abaixo.longContextTier).toBe(false);
    expect(noLimiar.longContextTier).toBe(true);
    // A faixa alta vale para a requisição INTEIRA, não só para o excedente:
    // um token a mais praticamente dobra a conta.
    expect(noLimiar.totalUsd).toBeGreaterThan(abaixo.totalUsd * 1.9);
  });

  it('nenhum modelo da Anthropic tem faixa de contexto longo', () => {
    // A partir da geração 4.6 a janela de 1M sai no preço padrão. Se alguém
    // acrescentar uma faixa aqui copiando de outro provedor, este teste cai.
    for (const price of Object.values(PRICING.anthropic)) {
      expect(price.longContext).toBeUndefined();
    }
  });

  it('devolve undefined para modelo fora da tabela, não zero', () => {
    // Zero silencioso viraria um relatório de custo mentiroso, que é pior
    // que um relatório incompleto.
    expect(estimateCost('anthropic', 'modelo-inexistente', { inputTokens: 1000, outputTokens: 10 })).toBeUndefined();
  });

  it('trata cachedInputTokens ausente como zero', () => {
    const cost = estimateCost('google', 'gemini-3.6-flash', { inputTokens: 1_000_000, outputTokens: 0 })!;
    expect(cost.cachedInputUsd).toBe(0);
    expect(cost.inputUsd).toBeCloseTo(1.5, 6);
  });
});

describe('coerência da tabela', () => {
  it('todo preço é positivo e a saída não é mais barata que a entrada', () => {
    for (const provider of PROVIDER_IDS) {
      for (const [model, price] of Object.entries(PRICING[provider])) {
        expect(price.inputPerMTok, `${provider}/${model}`).toBeGreaterThan(0);
        expect(price.outputPerMTok, `${provider}/${model}`).toBeGreaterThan(0);
        expect(price.outputPerMTok, `${provider}/${model}`).toBeGreaterThanOrEqual(price.inputPerMTok);
      }
    }
  });

  it('leitura de cache é mais barata que entrada fresca', () => {
    for (const provider of PROVIDER_IDS) {
      for (const [model, price] of Object.entries(PRICING[provider])) {
        if (price.cachedInputPerMTok === undefined) continue;
        expect(price.cachedInputPerMTok, `${provider}/${model}`).toBeLessThan(price.inputPerMTok);
      }
    }
  });

  it('a faixa longa é mais cara que a padrão', () => {
    for (const provider of PROVIDER_IDS) {
      for (const [model, price] of Object.entries(PRICING[provider])) {
        if (!price.longContext) continue;
        expect(price.longContext.inputPerMTok, `${provider}/${model}`).toBeGreaterThan(price.inputPerMTok);
        expect(price.longContext.thresholdTokens, `${provider}/${model}`).toBeGreaterThan(0);
      }
    }
  });

  it('Sonnet 5 está a $2/$10 — o aumento previsto foi cancelado', () => {
    // Regressão específica: a tabela já esteve a $3/$15, copiada de uma
    // fonte desatualizada. A documentação registra que o aumento de
    // 2026-09-01 não vai acontecer.
    const price = priceFor('anthropic', 'claude-sonnet-5')!;
    expect(price.inputPerMTok).toBe(2);
    expect(price.outputPerMTok).toBe(10);
  });
});
