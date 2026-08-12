/**
 * Adaptador Google Gemini.
 *
 * Nativas usadas: saída estruturada (`responseJsonSchema` +
 * `responseMimeType`) e raciocínio (`thinkingConfig.thinkingLevel`).
 *
 * Cache de contexto: o Gemini tem DUAS formas. O cache explícito exige criar
 * um recurso `cachedContents`, com TTL e cobrança por hora de
 * armazenamento — estado de servidor que este pipeline não quer administrar.
 * O cache implícito é automático a partir da família 2.5, casa por prefixo e
 * não cobra escrita. Usamos o implícito: por isso `supports('contextCache')`
 * é false — não existe controle no nível da requisição, só a disciplina de
 * pôr o conteúdo estável primeiro, que shared.ts já garante para os três.
 *
 * O mínimo para o cache implícito bater é de 2.048 tokens (família 2.5) a
 * 4.096 (3.x). Abaixo disso ele silenciosamente não acontece: sem erro,
 * `cachedContentTokenCount` volta zero.
 */
import { GoogleGenAI, ThinkingLevel, type Content, type GenerateContentConfig } from '@google/genai';
import { ProviderError, type Capability, type CompletionRequest, type Provider } from '../types';
import { requireApiKey, runCompletion } from './shared';

/** `thinkingLevel` é o controle da família 3.x. A 2.5 usa `thinkingBudget`,
 *  que é outro campo — mandar o errado é 400. Só ligamos onde temos certeza. */
function thinkingLevelFor(model: string): ThinkingLevel | undefined {
  return model.startsWith('gemini-3') ? ThinkingLevel.LOW : undefined;
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

      const thinkingLevel = thinkingLevelFor(model);
      const config: GenerateContentConfig = {
        systemInstruction: invocation.system,
        maxOutputTokens: invocation.maxTokens,
        ...(invocation.jsonSchema
          ? {
              responseMimeType: 'application/json',
              responseJsonSchema: invocation.jsonSchema,
            }
          : {}),
        ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
      };

      try {
        const response = await client().models.generateContent({ model, contents, config });

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
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError('google', model, (error as Error).message, error);
      }
    });
  },
};
