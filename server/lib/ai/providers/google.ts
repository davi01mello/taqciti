/**
 * Adaptador Google Gemini.
 *
 * Nativas usadas: saída estruturada e raciocínio. As DUAS mudaram de forma
 * entre a família 2.5 e a 3.x, e o adaptador escolhe pela família do modelo
 * — mesmo padrão da lista de modelos-com-adaptativo no adaptador da
 * Anthropic. Mandar a forma errada é 400, não degradação silenciosa.
 *
 *   saída estruturada  3.x → `responseJsonSchema` (JSON Schema de verdade)
 *                      2.5 → `responseSchema` (subconjunto do OpenAPI; ver
 *                            geminiSchema.ts para o que se perde na conversão)
 *   raciocínio         3.x → `thinkingConfig.thinkingLevel` (enum)
 *                      2.5 → `thinkingConfig.thinkingBudget` (tokens;
 *                            0 desliga, -1 é automático)
 *
 * Cache de contexto: o Gemini tem duas formas. A implícita é automática a
 * partir da família 2.5, casa por prefixo e não cobra escrita — mas foi
 * medida entregando 4% da entrada, então não se conta com ela. A explícita
 * cria um recurso `cachedContents` com TTL e cobra armazenamento por hora;
 * é a que usamos para `cacheablePrefix` grande (a transcrição do Pensante),
 * com TTL curto e queda para a chamada normal em qualquer falha. Ver
 * "Cache EXPLÍCITO do prefixo" abaixo.
 *
 * O mínimo para o cache implícito bater é de 2.048 tokens (família 2.5) a
 * 4.096 (3.x). Abaixo disso ele silenciosamente não acontece: sem erro,
 * `cachedContentTokenCount` volta zero.
 */
import { GoogleGenAI, ThinkingLevel, type GenerateContentConfig, type Content } from '@google/genai';
import {
  OverloadedError,
  ProviderError,
  RateLimitError,
  type Capability,
  type CompletionMessage,
  type CompletionRequest,
  type JsonSchema,
  type Provider,
  type ReasoningEffort,
} from '../types';
import { toGeminiSchema } from './geminiSchema';
import { requireApiKey, runCompletion, type RawInvocation } from './shared';

type Family = '2.5' | '3.x';

function familyOf(model: string): Family {
  return model.startsWith('gemini-2.5') ? '2.5' : '3.x';
}

const CONTEXT_WINDOWS: Record<string, number> = {
  'gemini-3.6-flash': 1_000_000,
  'gemini-3.5-flash': 1_000_000,
  'gemini-3.5-flash-lite': 1_000_000,
  'gemini-3.1-pro-preview': 1_000_000,
  'gemini-2.5-pro': 1_048_576,
  'gemini-2.5-flash': 1_048_576,
  'gemini-2.5-flash-lite': 1_048_576,
};

const FALLBACK_CONTEXT_TOKENS = 1_000_000;

let cached: GoogleGenAI | undefined;

function client(): GoogleGenAI {
  if (!cached) {
    cached = new GoogleGenAI({ apiKey: requireApiKey('google', 'GOOGLE_API_KEY') });
  }
  return cached;
}

/** Monta a parte de saída estruturada conforme a família do modelo. */
function structuredOutputConfig(model: string, schema: JsonSchema): Partial<GenerateContentConfig> {
  if (familyOf(model) === '3.x') {
    return { responseMimeType: 'application/json', responseJsonSchema: schema };
  }
  const { schema: converted, dropped } = toGeminiSchema(schema);
  if (dropped.length > 0) {
    // Não é erro: a forma OpenAPI simplesmente não tem esses campos. Mas
    // silêncio aqui vira confusão depois, quando o 2.5 aceitar uma
    // propriedade extra que o 3.x recusaria.
    console.warn(
      `[google/${model}] responseSchema (OpenAPI) não suporta: ${dropped.join(', ')}. ` +
        'A restrição continua valendo — quem passa a garanti-la é o validador local.',
    );
  }
  return { responseMimeType: 'application/json', responseSchema: converted };
}

/**
 * Nível de raciocínio por modelo, para a família 3.x.
 *
 * Não é uniforme de propósito. Raciocínio custa token de saída e latência, e
 * as tarefas do pipeline não pedem a mesma coisa: extrair afirmação e copiar
 * citação é trabalho mecânico, enquanto decidir o que entra numa seção da
 * Ata é julgamento. Ligar alto em tudo pagaria caro pelo que não precisa.
 *
 * Medido no bench: `gemini-2.5-flash` com raciocínio automático gastou 6.606
 * tokens de saída para 27 afirmações e expandiu o texto em vez de compactar.
 * O nível é a alavanca contra isso.
 */
const THINKING_LEVEL: Record<string, ThinkingLevel> = {
  // Raciocínio: julgamento sobre o contexto compactado e redação final.
  'gemini-3.5-flash': ThinkingLevel.HIGH,
  'gemini-3.6-flash': ThinkingLevel.HIGH,
  // Extração: mecânico e de alto volume. LOW é o que o bench mediu, com
  // 100% de âncoras nas duas execuções — não mexer no que está provado.
  'gemini-3.5-flash-lite': ThinkingLevel.LOW,
};

const DEFAULT_THINKING_LEVEL = ThinkingLevel.LOW;

/** O pedido explícito do chamador (`CompletionRequest.reasoning`) na forma 3.x. */
const LEVEL_BY_EFFORT: Record<ReasoningEffort, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

/** E na forma 2.5, que é orçamento em tokens. `high` fica no automático. */
const BUDGET_BY_EFFORT: Record<ReasoningEffort, number> = {
  low: 1_024,
  medium: 4_096,
  high: -1,
};

/**
 * Monta a parte de raciocínio conforme a família do modelo. O pedido do
 * chamador vence a tabela por modelo: a tabela é o padrão de quem não sabe o
 * que a tarefa pede, e o Pensante sabe — ver `SectionSpec.reasoning`.
 */
export function thinkingConfigFor(
  model: string,
  effort?: ReasoningEffort,
): Partial<GenerateContentConfig> {
  if (familyOf(model) === '3.x') {
    return {
      thinkingConfig: {
        thinkingLevel: effort
          ? LEVEL_BY_EFFORT[effort]
          : (THINKING_LEVEL[model] ?? DEFAULT_THINKING_LEVEL),
      },
    };
  }
  // -1 é "automático": deixa o modelo decidir quanto pensar, que é o
  // equivalente mais próximo do adaptativo dos outros provedores. 0
  // desligaria, e nós não queremos essa decisão implícita aqui.
  return { thinkingConfig: { thinkingBudget: effort ? BUDGET_BY_EFFORT[effort] : -1 } };
}

// ---------------------------------------------------------------------------
// Cache EXPLÍCITO do prefixo
// ---------------------------------------------------------------------------

/**
 * Por que explícito, contrariando o comentário do topo.
 *
 * O implícito foi medido e não entrega: na execução de 16/08 a transcrição foi
 * como prefixo idêntico em cinco chamadas, e só 4% da entrada saiu de cache
 * (ver docs/medicao-2026-08-16-longa). O Pensante lê a transcrição inteira em
 * cada seção, então é a entrada dele que mais pesa depois do raciocínio — e
 * com o cache explícito a leitura custa 10% do preço, garantido, em vez de
 * "quando o provedor quiser".
 *
 * O custo do explícito é armazenamento por hora, e ele é desprezível aqui: a
 * transcrição de uma reunião de uma hora são ~15 mil tokens, vivendo alguns
 * minutos. O que ele pedia de "estado de servidor" é este mapa, com TTL curto
 * — e toda falha dele cai na chamada normal, sem cache. O cache é economia,
 * nunca requisito: se ele quebrar, a Ata sai igual, só mais cara.
 *
 * Desligável com `DOCCITI_GEMINI_CACHE=off`.
 */

/**
 * Abaixo disso não vale criar: o provedor recusa prefixo pequeno (o mínimo do
 * explícito é da ordem de milhares de tokens) e, mesmo se aceitasse, a
 * economia não paga a latência da criação. ~2 mil tokens de transcrição, a
 * ~4 caracteres por token em português — que somados ao system passam do
 * mínimo. Errar para baixo é barato: a recusa custa UMA tentativa por
 * transcrição, e a Ata segue sem cache.
 */
export const MIN_CACHE_PREFIX_CHARS = 8_000;

/** Folga para uma Ata inteira — nove seções em sequência. */
const CACHE_TTL_SECONDS = 600;
/** Não reaproveita cache prestes a expirar: renova antes, e não depois do erro. */
const CACHE_RENEW_MARGIN_MS = 90_000;

interface CacheEntry {
  name: string;
  expiresAt: number;
}

/** Chave → cache vivo, ou `null` quando criar já falhou para esta chave. */
const prefixCaches = new Map<string, CacheEntry | null>();

function cacheEnabled(): boolean {
  return process.env.DOCCITI_GEMINI_CACHE?.trim().toLowerCase() !== 'off';
}

/** Hash barato e estável; colisão só custaria um cache errado ser recusado. */
function fingerprint(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

/**
 * O prefixo sai de dentro de `messages[0]`, onde shared.ts o colou. O cache
 * leva system + prefixo; a requisição leva só o resto — é assim que o cache
 * explícito do Gemini funciona: o conteúdo cacheado vem ANTES de `contents`.
 */
function splitPrefix(
  invocation: RawInvocation,
): { prefix: string; rest: CompletionMessage[] } | undefined {
  const length = invocation.cacheablePrefixLength;
  const first = invocation.messages[0];
  if (!length || !first || first.role !== 'user') return undefined;
  const prefix = first.content.slice(0, length);
  const tail = first.content.slice(length).replace(/^\n\n/, '');
  const rest = tail
    ? [{ role: 'user' as const, content: tail }, ...invocation.messages.slice(1)]
    : invocation.messages.slice(1);
  if (rest.length === 0) return undefined;
  return { prefix, rest };
}

async function cacheFor(
  model: string,
  system: string,
  prefix: string,
): Promise<string | undefined> {
  const now = Date.now();
  // O mapa vive enquanto a instância vive; sem isto, cresce uma entrada por Ata.
  for (const [chave, entry] of prefixCaches) {
    if (entry && entry.expiresAt <= now) prefixCaches.delete(chave);
  }

  const key = `${model}|${fingerprint(system)}|${fingerprint(prefix)}`;
  const known = prefixCaches.get(key);
  if (known === null) return undefined;
  if (known && known.expiresAt - CACHE_RENEW_MARGIN_MS > Date.now()) return known.name;

  try {
    const created = await client().caches.create({
      model,
      config: {
        systemInstruction: system,
        contents: [{ role: 'user', parts: [{ text: prefix }] }],
        ttl: `${CACHE_TTL_SECONDS}s`,
      },
    });
    if (!created.name) throw new Error('cache criado sem nome');
    prefixCaches.set(key, { name: created.name, expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000 });
    return created.name;
  } catch (error) {
    // Não tenta de novo para o mesmo prefixo: se o provedor recusou uma vez
    // (modelo sem suporte, prefixo abaixo do mínimo), recusaria nas outras
    // oito seções também, e cada tentativa é latência jogada fora.
    prefixCaches.set(key, null);
    console.warn(
      `[google/${model}] cache explícito indisponível, seguindo sem ele: ` +
        `${((error as Error)?.message ?? String(error)).slice(0, 200)}`,
    );
    return undefined;
  }
}

/** O cache que a requisição usou deixou de valer — a próxima cria outro. */
function forgetCache(name: string): void {
  for (const [key, entry] of prefixCaches) {
    if (entry?.name === name) prefixCaches.delete(key);
  }
}

/** Só para os testes: o mapa vive no módulo e atravessaria casos. */
export function resetPrefixCachesForTests(): void {
  prefixCaches.clear();
  cached = undefined;
}

/** Reconhece 503/UNAVAILABLE — sobrecarga do provedor, transitória. */
export function asOverloaded(model: string, error: unknown): OverloadedError | undefined {
  const status = (error as { status?: unknown })?.status;
  const message = (error as Error)?.message ?? '';
  const overloaded =
    status === 503 ||
    status === 'UNAVAILABLE' ||
    /\b503\b|UNAVAILABLE|overloaded|high demand/i.test(message);
  if (!overloaded) return undefined;
  return new OverloadedError(
    'google',
    model,
    `provedor sobrecarregado (503): ${message.slice(0, 200)}`,
    undefined,
    error,
  );
}

/** Reconhece 429 no formato que o SDK do Google levanta. */
export function asRateLimit(model: string, error: unknown): RateLimitError | undefined {
  const status = (error as { status?: unknown })?.status;
  const message = (error as Error)?.message ?? '';
  const isRateLimit =
    status === 429 ||
    status === 'RESOURCE_EXHAUSTED' ||
    /\b429\b|RESOURCE_EXHAUSTED|rate limit|quota/i.test(message);
  if (!isRateLimit) return undefined;

  // O Gemini devolve `retryDelay` (ex.: "37s") dentro dos detalhes do erro.
  const seconds = /"?retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/i.exec(message)?.[1];

  // E devolve QUAL cota estourou, em `quotaId`. `...PerDay...` é a cota
  // diária, que não reabre esperando — e o Gemini manda um `retryDelay` de
  // dezenas de segundos mesmo nela, o que faz o laço de espera perseguir um
  // limite que só reseta amanhã. É por isto que a distinção é lida daqui.
  const perDay = /"?quotaId"?\s*[:=]\s*"[^"]*PerDay/i.test(message);

  return new RateLimitError(
    'google',
    model,
    perDay
      ? `cota DIÁRIA estourada (429), não adianta esperar: ${message.slice(0, 200)}`
      : `cota estourada (429): ${message.slice(0, 200)}`,
    seconds ? Number(seconds) * 1000 : undefined,
    error,
    perDay,
  );
}

export const googleProvider: Provider = {
  id: 'google',

  supports(capability: Capability): boolean {
    switch (capability) {
      case 'structuredOutput':
        return true;
      case 'contextCache':
        // Cache explícito do `cacheablePrefix` — ver o comentário do topo.
        return true;
      case 'extendedThinking':
        return true;
    }
  },

  maxContextTokens(model: string): number {
    return CONTEXT_WINDOWS[model] ?? FALLBACK_CONTEXT_TOKENS;
  },

  async complete(model: string, req: CompletionRequest) {
    return runCompletion('google', model, req, { nativeStructuredOutput: true }, async (invocation) => {
      const toContents = (messages: CompletionMessage[]): Content[] =>
        messages.map((message) => ({
          // O Gemini chama o turno do assistente de "model".
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        }));

      const shared: GenerateContentConfig = {
        maxOutputTokens: invocation.maxTokens,
        ...(invocation.jsonSchema ? structuredOutputConfig(model, invocation.jsonSchema) : {}),
        ...thinkingConfigFor(model, req.reasoning),
      };

      const plain = () =>
        client().models.generateContent({
          model,
          contents: toContents(invocation.messages),
          config: { systemInstruction: invocation.system, ...shared },
        });

      const split =
        cacheEnabled() && (invocation.cacheablePrefixLength ?? 0) >= MIN_CACHE_PREFIX_CHARS
          ? splitPrefix(invocation)
          : undefined;
      const cacheName = split ? await cacheFor(model, invocation.system, split.prefix) : undefined;

      let response;
      try {
        if (split && cacheName) {
          try {
            // Com cache, `systemInstruction` NÃO pode ir na requisição — ele
            // já está dentro do cache, e mandar de novo é 400.
            response = await client().models.generateContent({
              model,
              contents: toContents(split.rest),
              config: { cachedContent: cacheName, ...shared },
            });
          } catch (error) {
            // 429 e 503 não são culpa do cache: sobem para o laço de espera,
            // que repete com o mesmo cache.
            if (asRateLimit(model, error) || asOverloaded(model, error)) throw error;
            // Qualquer outra recusa com cache (expirou, foi apagado, o
            // modelo não aceita) vira a chamada de sempre. Erro de verdade
            // reaparece nela.
            forgetCache(cacheName);
            response = await plain();
          }
        } else {
          response = await plain();
        }
      } catch (error) {
        // Erro já classificado (chave ausente, 429 traduzido) sobe intacto:
        // reembrulhar produz "[google/modelo] [google/(sem modelo)] ...".
        if (error instanceof ProviderError) throw error;
        const rateLimited = asRateLimit(model, error);
        if (rateLimited) throw rateLimited;
        const overloaded = asOverloaded(model, error);
        if (overloaded) throw overloaded;
        throw new ProviderError('google', model, (error as Error).message, error);
      }

      const text = response.text;
      if (text === undefined) {
        const reason = response.candidates?.[0]?.finishReason ?? 'desconhecido';
        throw new ProviderError('google', model, `resposta sem texto (finishReason: ${reason}).`);
      }

      const usage = response.usageMetadata;
      // `promptTokenCount` do Gemini JÁ INCLUI o conteúdo vindo de cache —
      // é exatamente a convenção normalizada, então não se soma nada aqui.
      // Já `thoughtsTokenCount` é cobrado como saída e vem separado de
      // `candidatesTokenCount`: ignorá-lo subestimaria o custo.
      return {
        text,
        usage: {
          inputTokens: usage?.promptTokenCount ?? 0,
          outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
          cachedInputTokens: usage?.cachedContentTokenCount ?? 0,
        },
      };
    });
  },
};
