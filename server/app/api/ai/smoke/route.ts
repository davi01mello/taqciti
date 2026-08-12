/**
 * Teste de fumaça da camada multi-provedor. POST, não GET, porque cada
 * execução gasta tokens de verdade — não é coisa pra um prefetch disparar.
 *
 * Faz duas chamadas triviais por provedor: uma de texto puro e uma com
 * `jsonSchema`. Devolve, por provedor: o texto retornado, `usage` completo,
 * o custo calculado pela tabela de preços, se `parsed` veio preenchido, se
 * houve reparo e quantas vezes esperou por 429.
 *
 * A rota FALHA (`ok: false`) quando `usage.inputTokens` vem 0, nulo ou
 * ausente, mesmo com HTTP 200 do provedor. Motivo: **forma de payload
 * aceita e usage lido corretamente são duas provas diferentes, e só a
 * primeira vem de graça no 200.** Um adaptador com normalização de usage
 * errada responde 200 normalmente e reporta custo zero — o defeito só
 * apareceria quando o harness dissesse que uma geração completa custou
 * nada, ou pior, não apareceria.
 *
 *   curl -X POST http://localhost:3000/api/ai/smoke \
 *     -H "x-docciti-key: $DOCCITI_SHARED_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d '{"providers":["anthropic"]}'
 */
import { NextResponse, type NextRequest } from 'next/server';
import { corsHeaders, rejectIfUnauthorized } from '@/lib/apiGuard';
import {
  activeDataPolicyWarning,
  AGENT_CONFIG,
  API_KEY_ENV_VAR,
  capabilityTable,
  cheapestProductionEntry,
  dataPolicyWarning,
  estimateCost,
  getProvider,
  hasApiKey,
  isProviderId,
  PROVIDER_IDS,
  type CompletionResult,
  AGENT_NAMES,
  type JsonSchema,
  type ProviderId,
} from '@/lib/ai';
import { assertUsable } from '@/lib/ai/smokeAssertions';

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
  /** Por que falhou, quando `ok` é false. Pode ser erro do provedor OU
   *  asserção nossa violada com HTTP 200. */
  failure?: string;
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  costUsd?: number;
  parsedPreenchido?: boolean;
  parsed?: unknown;
  repaired?: boolean;
  rateLimitWaits?: number;
  latencyMs?: number;
}

function report(result: CompletionResult, expectParsed: boolean): CallReport {
  const failures = assertUsable(result, expectParsed);
  const cost = estimateCost(result.meta.provider, result.meta.model, result.usage);

  return {
    ok: failures.length === 0,
    model: result.meta.model,
    ...(failures.length > 0 ? { failure: failures.join(' ') } : {}),
    text: result.text.slice(0, 400),
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cachedInputTokens: result.usage.cachedInputTokens ?? 0,
    ...(cost ? { costUsd: Number(cost.totalUsd.toFixed(8)) } : {}),
    parsedPreenchido: result.parsed !== undefined,
    ...(result.parsed !== undefined ? { parsed: result.parsed } : {}),
    repaired: result.meta.repaired,
    rateLimitWaits: result.meta.rateLimitWaits,
    latencyMs: result.meta.latencyMs,
  };
}

function failure(model: string, error: unknown): CallReport {
  return { ok: false, model, failure: (error as Error).message };
}

/**
 * Quais modelos de um fornecedor vale a pena exercitar, e por quê.
 *
 * Não basta o piso de produção. O pipeline pode estar rodando num modelo
 * DIFERENTE do piso — hoje está: a configuração ativa é `gemini-2.5-flash`
 * e o piso é `gemini-3.5-flash-lite`. Testar só o piso deixaria sem prova
 * exatamente o caminho que o pipeline usa, que no caso da família 2.5 é um
 * caminho de código próprio (`responseSchema` em vez de
 * `responseJsonSchema`, `thinkingBudget` em vez de `thinkingLevel`).
 */
function targetsFor(id: ProviderId): Array<{ model: string; papel: string }> {
  const piso = cheapestProductionEntry(id).model;
  const ativos = [...new Set(
    AGENT_NAMES.map((agent) => AGENT_CONFIG[agent])
      .filter((config) => config.provider === id)
      .map((config) => config.model),
  )];

  const targets = new Map<string, string[]>();
  for (const model of ativos) targets.set(model, ['configuração ativa do pipeline']);
  targets.set(piso, [...(targets.get(piso) ?? []), 'piso de produção da matriz']);

  return [...targets].map(([model, papeis]) => ({ model, papel: papeis.join(' + ') }));
}

async function smokeModel(id: ProviderId, model: string, papel: string) {
  const provider = getProvider(id);

  let text: CallReport;
  try {
    text = report(
      await provider.complete(model, {
        system: 'Você responde em português, com o mínimo de palavras possível.',
        messages: [{ role: 'user', content: 'Responda apenas com a palavra: ok' }],
        maxTokens: 4096,
      }),
      false,
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
      true,
    );
  } catch (error) {
    json = failure(model, error);
  }

  return {
    provider: id,
    model,
    papel,
    contextWindowTokens: provider.maxContextTokens(model),
    ok: text.ok && json.ok,
    text,
    json,
  };
}

async function smokeProvider(id: ProviderId) {
  const reports = [];
  for (const { model, papel } of targetsFor(id)) {
    reports.push(await smokeModel(id, model, papel));
  }
  return reports;
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

  // Fornecedor sem chave é PULADO com motivo, nunca omitido: um relatório
  // que mostra só o Gemini parece dizer que o Gemini ganhou, quando os
  // outros dois nem correram.
  const executados = requested.filter((id) => hasApiKey(id));
  const pulados = requested
    .filter((id) => !hasApiKey(id))
    .map((id) => ({ provider: id, reason: `${API_KEY_ENV_VAR[id]} não está definida — não executado.` }));

  const results = [];
  for (const id of executados) {
    results.push(...(await smokeProvider(id)));
  }

  const avisos = [
    activeDataPolicyWarning(),
    ...executados.map((id) => dataPolicyWarning(cheapestProductionEntry(id))),
  ].filter((aviso): aviso is string => aviso !== null);

  return NextResponse.json(
    {
      // Pulo não conta como falha, mas também não conta como sucesso: sem
      // nenhuma execução, não há o que aprovar.
      ok: results.length > 0 && results.every((result) => result.ok),
      capabilities: capabilityTable(),
      agentConfig: AGENT_CONFIG,
      results,
      pulados,
      avisos,
      naoVerificado: [
        'Cache de contexto. Uma chamada única não exercita cache: o breakpoint ' +
          'de `cache_control` (Anthropic) e o cache implícito (Google, xAI) só ' +
          'rendem no SEGUNDO request com o mesmo prefixo, e o prefixo aqui é ' +
          'curto demais para atingir o mínimo cacheável de qualquer um deles. ' +
          'Portanto `cachedInputTokens: 0` abaixo é o esperado e NÃO prova nada ' +
          'sobre o cache funcionar. O ganho de cache entra direto na conta de ' +
          'custo por documento, então isso fica em aberto até a Fase 2 fazer ' +
          'chamadas repetidas com o mesmo contexto compactado.',
        'Espera por 429. O laço tem teste unitário, mas nenhuma chamada real ' +
          'tomou 429 ainda — `rateLimitWaits: 0` aqui não prova que a espera ' +
          'funciona contra a API de verdade.',
      ],
    },
    { status: 200, headers },
  );
}
