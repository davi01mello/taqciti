/**
 * Adaptador xAI (Grok), via `fetch` contra o endpoint compatível com OpenAI
 * em https://api.x.ai/v1/chat/completions.
 *
 * Não há SDK oficial em TypeScript: a recomendação da própria xAI é usar o
 * pacote `openai` apontando o baseURL para eles. Instalar o cliente inteiro
 * da OpenAI só para falar com o Grok é dependência grande demais para um
 * endpoint só — daí o `fetch` direto, que é a outra opção que a
 * documentação deles apresenta.
 *
 * Duas capacidades ficam em false aqui e o motivo é o mesmo nos dois casos:
 * elas EXISTEM, mas não há controle no nível da requisição. O cache de
 * prompt é automático (a xAI reporta `cached_tokens`, mas não se liga nem
 * se posiciona), e o raciocínio é escolhido pelo ID do modelo — a linha tem
 * variantes `-reasoning` e `-non-reasoning` em vez de um parâmetro.
 */
import { ProviderError, type Capability, type CompletionRequest, type Provider } from '../types';
import { requireApiKey, runCompletion } from './shared';

const ENDPOINT = 'https://api.x.ai/v1/chat/completions';

/** Uma passada do Analista sobre transcrição longa não é rápida; 10 min é
 *  teto de sanidade, não expectativa. */
const REQUEST_TIMEOUT_MS = 600_000;

const CONTEXT_WINDOWS: Record<string, number> = {
  'grok-4.5': 500_000,
  'grok-4.3': 1_000_000,
  'grok-4.20-0309-reasoning': 1_000_000,
  'grok-4.20-0309-non-reasoning': 1_000_000,
  'grok-4.20-multi-agent-0309': 1_000_000,
  'grok-build-0.1': 256_000,
};

const FALLBACK_CONTEXT_TOKENS = 256_000;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string };
}

export const xaiProvider: Provider = {
  id: 'xai',

  supports(capability: Capability): boolean {
    switch (capability) {
      case 'structuredOutput':
        return true;
      case 'contextCache':
        return false;
      case 'extendedThinking':
        return false;
    }
  },

  maxContextTokens(model: string): number {
    return CONTEXT_WINDOWS[model] ?? FALLBACK_CONTEXT_TOKENS;
  },

  async complete(model: string, req: CompletionRequest) {
    return runCompletion('xai', model, req, { nativeStructuredOutput: true }, async (invocation) => {
      const apiKey = requireApiKey('xai', 'XAI_API_KEY');

      const body = {
        model,
        max_tokens: invocation.maxTokens,
        messages: [
          { role: 'system', content: invocation.system },
          ...invocation.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ],
        ...(invocation.jsonSchema
          ? {
              response_format: {
                type: 'json_schema' as const,
                // `name` é obrigatório no formato compatível com OpenAI.
                // `strict` fica de fora de propósito: no modo estrito todo
                // campo precisa ser required e additionalProperties false, o
                // que proibiria os campos ausentes que a especificação do
                // DocCiti usa justamente pra representar lacuna.
                json_schema: { name: 'resposta', schema: invocation.jsonSchema },
              },
            }
          : {}),
      };

      let response: Response;
      try {
        response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        throw new ProviderError('xai', model, `falha de rede: ${(error as Error).message}`, error);
      }

      const raw = await response.text();
      let payload: ChatCompletionResponse;
      try {
        payload = JSON.parse(raw) as ChatCompletionResponse;
      } catch {
        throw new ProviderError('xai', model, `HTTP ${response.status}, corpo não-JSON: ${raw.slice(0, 300)}`);
      }

      if (!response.ok) {
        throw new ProviderError(
          'xai',
          model,
          `HTTP ${response.status}: ${payload.error?.message ?? raw.slice(0, 300)}`,
        );
      }

      const text = payload.choices?.[0]?.message?.content;
      if (typeof text !== 'string') {
        const reason = payload.choices?.[0]?.finish_reason ?? 'desconhecido';
        throw new ProviderError('xai', model, `resposta sem conteúdo (finish_reason: ${reason}).`);
      }

      // No formato da OpenAI, `prompt_tokens` já inclui `cached_tokens` e
      // `completion_tokens` já inclui os tokens de raciocínio — os dois
      // batem com a convenção normalizada sem soma extra.
      return {
        text,
        usage: {
          inputTokens: payload.usage?.prompt_tokens ?? 0,
          outputTokens: payload.usage?.completion_tokens ?? 0,
          cachedInputTokens: payload.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        },
      };
    });
  },
};
