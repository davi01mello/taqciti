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
 * Cache de contexto: o Gemini tem duas formas. A explícita exige criar um
 * recurso `cachedContents`, com TTL e cobrança por hora de armazenamento —
 * estado de servidor que este pipeline não quer administrar. A implícita é
 * automática a partir da família 2.5, casa por prefixo e não cobra escrita.
 * Usamos a implícita: por isso `supports('contextCache')` é false — não
 * existe controle no nível da requisição, só a disciplina de pôr o conteúdo
 * estável primeiro, que shared.ts já garante para os três.
 *
 * O mínimo para o cache implícito bater é de 2.048 tokens (família 2.5) a
 * 4.096 (3.x). Abaixo disso ele silenciosamente não acontece: sem erro,
 * `cachedContentTokenCount` volta zero.
 */
import { GoogleGenAI, ThinkingLevel, type GenerateContentConfig, type Content } from '@google/genai';
import {
  ProviderError,
  RateLimitError,
  type Capability,
  type CompletionRequest,
  type JsonSchema,
  type Provider,
} from '../types';
import { toGeminiSchema } from './geminiSchema';
import { requireApiKey, runCompletion } from './shared';

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

/** Monta a parte de raciocínio conforme a família do modelo. */
function thinkingConfigFor(model: string): Partial<GenerateContentConfig> {
  if (familyOf(model) === '3.x') {
    return {
      thinkingConfig: { thinkingLevel: THINKING_LEVEL[model] ?? DEFAULT_THINKING_LEVEL },
    };
  }
  // -1 é "automático": deixa o modelo decidir quanto pensar, que é o
  // equivalente mais próximo do adaptativo dos outros provedores. 0
  // desligaria, e nós não queremos essa decisão implícita aqui.
  return { thinkingConfig: { thinkingBudget: -1 } };
}

/** Reconhece 429 no formato que o SDK do Google levanta. */
function asRateLimit(model: string, error: unknown): RateLimitError | undefined {
  const status = (error as { status?: unknown })?.status;
  const message = (error as Error)?.message ?? '';
  const isRateLimit =
    status === 429 ||
    status === 'RESOURCE_EXHAUSTED' ||
    /\b429\b|RESOURCE_EXHAUSTED|rate limit|quota/i.test(message);
  if (!isRateLimit) return undefined;

  // O Gemini devolve `retryDelay` (ex.: "37s") dentro dos detalhes do erro.
  const seconds = /"?retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/i.exec(message)?.[1];
  return new RateLimitError(
    'google',
    model,
    `cota estourada (429): ${message.slice(0, 200)}`,
    seconds ? Number(seconds) * 1000 : undefined,
    error,
  );
}

export const googleProvider: Provider = {
  id: 'google',

  supports(capability: Capability): boolean {
    switch (capability) {
      case 'structuredOutput':
        return true;
      case 'contextCache':
        // Só cache implícito — não há controle por requisição. Ver o
        // comentário do topo antes de trocar isto para true.
        return false;
      case 'extendedThinking':
        return true;
    }
  },

  maxContextTokens(model: string): number {
    return CONTEXT_WINDOWS[model] ?? FALLBACK_CONTEXT_TOKENS;
  },

  async complete(model: string, req: CompletionRequest) {
    return runCompletion('google', model, req, { nativeStructuredOutput: true }, async (invocation) => {
      const contents: Content[] = invocation.messages.map((message) => ({
        // O Gemini chama o turno do assistente de "model".
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      }));

      const config: GenerateContentConfig = {
        systemInstruction: invocation.system,
        maxOutputTokens: invocation.maxTokens,
        ...(invocation.jsonSchema ? structuredOutputConfig(model, invocation.jsonSchema) : {}),
        ...thinkingConfigFor(model),
      };

      let response;
      try {
        response = await client().models.generateContent({ model, contents, config });
      } catch (error) {
        // Erro já classificado (chave ausente, 429 traduzido) sobe intacto:
        // reembrulhar produz "[google/modelo] [google/(sem modelo)] ...".
        if (error instanceof ProviderError) throw error;
        const rateLimited = asRateLimit(model, error);
        if (rateLimited) throw rateLimited;
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
