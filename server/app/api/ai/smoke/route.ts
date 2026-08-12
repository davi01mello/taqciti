/**
 * Teste de fumaça da camada multi-provedor. POST, não GET, porque cada
 * execução gasta tokens de verdade — não é coisa pra um prefetch disparar.
 *
 * Faz duas chamadas triviais por provedor: uma de texto puro e uma com
 * `jsonSchema`, que é onde se vê se a saída estruturada nativa está de pé e
 * se o provedor precisou de reparo. Devolve também a tabela de capacidades
 * e a configuração por agente em vigor.
 *
 * Uma chave ausente derruba só o provedor dela: o objetivo é comparar os
 * três sem ser obrigado a assinar os três de uma vez.
 *
 *   curl -X POST http://localhost:3000/api/ai/smoke \
 *     -H "x-docciti-key: $DOCCITI_SHARED_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d '{"providers":["anthropic"]}'
 */
import { NextResponse, type NextRequest } from 'next/server';
import { corsHeaders, rejectIfUnauthorized } from '@/lib/apiGuard';
import {
  AGENT_CONFIG,
  capabilityTable,
  estimateCost,
  getProvider,
  isProviderId,
  matrixFor,
  PROVIDER_IDS,
  type CompletionResult,
  type JsonSchema,
  type ProviderId,
} from '@/lib/ai';

/** Schema mínimo que exercita objeto, string, enum e campo obrigatório. */
const SMOKE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    saudacao: { type: 'string', description: 'A palavra exata "ok".' },
    idioma: { type: 'string', enum: ['pt', 'en'] },
  },
  required: ['saudacao', 'idioma'],
  additionalProperties: false,
};

interface CallReport {
  ok: boolean;
  model: string;
  output?: string;
  parsed?: unknown;
  repaired?: boolean;
  latencyMs?: number;
  usage?: CompletionResult['usage'];
  costUsd?: number;
  error?: string;
}

function report(result: CompletionResult): CallReport {
  const cost = estimateCost(result.meta.provider, result.meta.model, result.usage);
  return {
    ok: true,
    model: result.meta.model,
    output: result.text.slice(0, 400),
    ...(result.parsed !== undefined ? { parsed: result.parsed } : {}),
    repaired: result.meta.repaired,
    latencyMs: result.meta.latencyMs,
    usage: result.usage,
    ...(cost ? { costUsd: Number(cost.totalUsd.toFixed(6)) } : {}),
  };
}

function failure(model: string, error: unknown): CallReport {
  return { ok: false, model, error: (error as Error).message };
}

async function smokeProvider(id: ProviderId) {
  const provider = getProvider(id);
  // Configuração "barata" da matriz: é o modelo certo pra uma chamada cuja
  // única função é provar que o encanamento liga.
  const entry = matrixFor(id).find((candidate) => candidate.tier === 'barato');
  if (!entry) throw new Error(`Matriz sem configuração barata para ${id}.`);
  const model = entry.model;

  let text: CallReport;
  try {
    text = report(
      await provider.complete(model, {
        system: 'Você responde em português, com o mínimo de palavras possível.',
        messages: [{ role: 'user', content: 'Responda apenas com a palavra: ok' }],
        maxTokens: 4096,
      }),
    );
  } catch (error) {
    text = failure(model, error);
  }

  let json: CallReport;
  try {
    json = report(
      await provider.complete(model, {
        system: 'Você responde em português.',
        messages: [{ role: 'user', content: 'Preencha o schema com a saudação "ok" em português.' }],
        maxTokens: 4096,
        jsonSchema: SMOKE_SCHEMA,
      }),
    );
  } catch (error) {
    json = failure(model, error);
  }

  return {
    provider: id,
    contextWindowTokens: provider.maxContextTokens(model),
    text,
    json,
  };
}

export function OPTIONS(request: NextRequest): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin')),
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const headers = corsHeaders(request.headers.get('origin'));

  const unauthorized = rejectIfUnauthorized(request, headers);
  if (unauthorized) return unauthorized;

  let requested: ProviderId[] = [...PROVIDER_IDS];
  try {
    const body = (await request.json()) as { providers?: unknown };
    if (Array.isArray(body?.providers)) {
      const invalid = body.providers.filter((id) => !isProviderId(id));
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: `Provedor desconhecido: ${invalid.join(', ')}. Use anthropic, google ou xai.` },
          { status: 400, headers },
        );
      }
      requested = body.providers as ProviderId[];
    }
  } catch {
    // Corpo vazio é o caso normal: testa os três.
  }

  const results = [];
  for (const id of requested) {
    results.push(await smokeProvider(id));
  }

  return NextResponse.json(
    { capabilities: capabilityTable(), agentConfig: AGENT_CONFIG, results },
    { status: 200, headers },
  );
}
