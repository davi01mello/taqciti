/**
 * Tabela de preço por milhão de tokens. É o que transforma `usage` em
 * número comparável entre provedores — sem ela, "testar os três" vira
 * impressão pessoal.
 *
 * PREÇO MUDA. Cada bloco carrega a data em que foi consultado e a URL.
 * Atualizar é editar número e data, nada mais.
 *
 * Convenção de `usage` normalizado (ver providers/*.ts):
 *   inputTokens        = TODOS os tokens de entrada, cache incluído
 *   cachedInputTokens  = a parte de inputTokens que veio de cache
 * Portanto o custo de entrada é
 *   (inputTokens - cachedInputTokens) × inputPerMTok
 *   + cachedInputTokens × cachedInputPerMTok
 * Os três provedores reportam de jeitos diferentes; a normalização mora no
 * adaptador, justamente pra esta fórmula valer igual pros três.
 */
import type { ProviderId } from './types';

export interface Rates {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Leitura de cache. Ausente = provedor não desconta leitura de cache. */
  cachedInputPerMTok?: number;
}

export interface ModelPrice extends Rates {
  /**
   * Faixa de contexto longo. Quando o prompt atinge `thresholdTokens`, a
   * requisição INTEIRA passa a ser cobrada nesta faixa — não é cobrança
   * progressiva. Ausente = preço único.
   */
  longContext?: Rates & { thresholdTokens: number };
  /**
   * Multiplicador sobre `inputPerMTok` para ESCRITA de cache, quando o
   * provedor cobra por isso. Anthropic cobra (1.25× no TTL de 5 min);
   * Google e xAI não cobram escrita no cache implícito.
   */
  cacheWriteMultiplier?: number;
}

/**
 * Anthropic — consultado em 2026-08-12.
 * https://platform.claude.com/docs/en/about-claude/pricing
 *
 * Leitura de cache é 0.1× a entrada base; escrita de 5 min é 1.25×.
 * Nenhum modelo aqui tem faixa de contexto longo: a partir da geração 4.6 a
 * janela de 1M é cobrada no preço padrão (uma requisição de 900k tokens sai
 * pela mesma taxa por token que uma de 9k). Isso NÃO vale para Google e xAI,
 * que têm faixa alta acima de 200k — ver as tabelas abaixo.
 */
const ANTHROPIC_PRICING: Record<string, ModelPrice> = {
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25, cachedInputPerMTok: 0.5, cacheWriteMultiplier: 1.25 },
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25, cachedInputPerMTok: 0.5, cacheWriteMultiplier: 1.25 },
  // $2/$10 anunciado como preço introdutório até 2026-08-31 VIROU o preço
  // padrão: a documentação registra que o aumento previsto para 2026-09-01
  // (que levaria a $3/$15) não vai acontecer. Não é preço promocional a
  // expirar — não "corrija" isto para $3/$15.
  'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10, cachedInputPerMTok: 0.2, cacheWriteMultiplier: 1.25 },
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15, cachedInputPerMTok: 0.3, cacheWriteMultiplier: 1.25 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5, cachedInputPerMTok: 0.1, cacheWriteMultiplier: 1.25 },
};

/**
 * Google Gemini — consultado em 2026-08-12.
 * https://ai.google.dev/gemini-api/docs/pricing
 * Cache implícito não cobra escrita; a coluna "context caching" da tabela
 * é o preço de LEITURA. O preço de armazenamento por hora só se aplica ao
 * cache EXPLÍCITO, que não usamos.
 */
const GOOGLE_PRICING: Record<string, ModelPrice> = {
  'gemini-3.6-flash': { inputPerMTok: 1.5, outputPerMTok: 7.5, cachedInputPerMTok: 0.15 },
  'gemini-3.5-flash': { inputPerMTok: 1.5, outputPerMTok: 9, cachedInputPerMTok: 0.15 },
  'gemini-3.5-flash-lite': { inputPerMTok: 0.3, outputPerMTok: 2.5, cachedInputPerMTok: 0.03 },
  'gemini-3.1-pro-preview': {
    inputPerMTok: 2,
    outputPerMTok: 12,
    cachedInputPerMTok: 0.2,
    longContext: { thresholdTokens: 200_000, inputPerMTok: 4, outputPerMTok: 18, cachedInputPerMTok: 0.4 },
  },
  'gemini-2.5-pro': {
    inputPerMTok: 1.25,
    outputPerMTok: 10,
    cachedInputPerMTok: 0.125,
    longContext: { thresholdTokens: 200_000, inputPerMTok: 2.5, outputPerMTok: 15, cachedInputPerMTok: 0.25 },
  },
  // Preço PAGO. A entrada `google-dev-free` da matriz usa este mesmo modelo
  // no free tier, onde não se paga nada — mas o zero mora lá, em
  // `billing: 'free-tier'`, e não aqui. Registrar 0 nesta tabela poria um
  // número falso no lugar onde alguém vai olhar pra decidir migrar para
  // pago; o custo de rodar em free tier é uma propriedade da configuração,
  // não do modelo.
  'gemini-2.5-flash': { inputPerMTok: 0.3, outputPerMTok: 2.5, cachedInputPerMTok: 0.03 },
  'gemini-2.5-flash-lite': { inputPerMTok: 0.1, outputPerMTok: 0.4, cachedInputPerMTok: 0.01 },
};

/**
 * xAI Grok — consultado em 2026-08-12.
 * https://docs.x.ai/docs/models
 * "Requests whose prompt reaches 200k tokens are billed at the higher rate
 * for all tokens in the request" — daí `thresholdTokens` valer para a
 * requisição inteira, não só para o excedente.
 */
const XAI_PRICING: Record<string, ModelPrice> = {
  'grok-4.5': {
    inputPerMTok: 2,
    outputPerMTok: 6,
    cachedInputPerMTok: 0.3,
    longContext: { thresholdTokens: 200_000, inputPerMTok: 4, outputPerMTok: 12, cachedInputPerMTok: 0.6 },
  },
  'grok-4.3': {
    inputPerMTok: 1.25,
    outputPerMTok: 2.5,
    cachedInputPerMTok: 0.2,
    longContext: { thresholdTokens: 200_000, inputPerMTok: 2.5, outputPerMTok: 5, cachedInputPerMTok: 0.4 },
  },
  'grok-build-0.1': {
    inputPerMTok: 1,
    outputPerMTok: 2,
    cachedInputPerMTok: 0.2,
    longContext: { thresholdTokens: 200_000, inputPerMTok: 2, outputPerMTok: 4, cachedInputPerMTok: 0.4 },
  },
};

export const PRICING: Record<ProviderId, Record<string, ModelPrice>> = {
  anthropic: ANTHROPIC_PRICING,
  google: GOOGLE_PRICING,
  xai: XAI_PRICING,
};

export function priceFor(provider: ProviderId, model: string): ModelPrice | undefined {
  return PRICING[provider][model];
}

export interface CostBreakdown {
  inputUsd: number;
  cachedInputUsd: number;
  outputUsd: number;
  totalUsd: number;
  /** true = a requisição caiu na faixa de contexto longo do modelo. */
  longContextTier: boolean;
}

/**
 * Custo em dólares de uma chamada. Devolve `undefined` — em vez de zero —
 * quando o modelo não está na tabela: zero silencioso viraria um relatório
 * de custo mentiroso, que é pior que um relatório incompleto.
 */
export function estimateCost(
  provider: ProviderId,
  model: string,
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number },
): CostBreakdown | undefined {
  const price = priceFor(provider, model);
  if (!price) return undefined;

  const longContextTier =
    price.longContext !== undefined && usage.inputTokens >= price.longContext.thresholdTokens;
  const rates: Rates = longContextTier ? price.longContext! : price;

  const cached = usage.cachedInputTokens ?? 0;
  const fresh = Math.max(0, usage.inputTokens - cached);

  const inputUsd = (fresh / 1_000_000) * rates.inputPerMTok;
  const cachedInputUsd = (cached / 1_000_000) * (rates.cachedInputPerMTok ?? rates.inputPerMTok);
  const outputUsd = (usage.outputTokens / 1_000_000) * rates.outputPerMTok;

  return {
    inputUsd,
    cachedInputUsd,
    outputUsd,
    totalUsd: inputUsd + cachedInputUsd + outputUsd,
    longContextTier,
  };
}
