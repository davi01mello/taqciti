/**
 * Bench de comparação entre modelos, sobre a tarefa do Analista.
 *
 * Diferente de `/api/ai/smoke`, que só prova que o encanamento liga: aqui a
 * chamada é realista (transcrição inteira, schema do tamanho do de verdade),
 * então o custo medido extrapola e a qualidade é observável.
 *
 * Roda SEQUENCIALMENTE, com pausa entre modelos, porque a chave de
 * desenvolvimento é free tier e limite por minuto é fácil de estourar.
 *
 * A transcrição vem no corpo e precisa ser SINTÉTICA. A rota recusa quando a
 * configuração ativa manda conteúdo para treinamento e o chamador não
 * declarou `sintetica: true` — a regra vale mais checada do que lembrada.
 *
 *   curl -X POST http://localhost:3000/api/ai/bench \
 *     -H "x-docciti-key: $DOCCITI_SHARED_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d '{"models":["gemini-2.5-flash"],"sintetica":true,"transcript":"..."}'
 */
import { NextResponse, type NextRequest } from 'next/server';
import { corsHeaders, maxTranscriptChars, rejectIfUnauthorized } from '@/lib/apiGuard';
import {
  activeDataPolicyWarning,
  estimateCost,
  getProvider,
  isProviderId,
  type ProviderId,
} from '@/lib/ai';
import {
  BENCH_SCHEMA,
  BENCH_SYSTEM,
  checkAnchors,
  countKinds,
  type BenchOutput,
} from '@/lib/ai/bench';

/** Ver o mesmo comentário em app/api/generate/route.ts — vários modelos em
 *  sequência, com pausa entre eles, soma o mesmo risco de teto de função do
 *  Vercel, ainda mais fácil de estourar aqui. 300 é o teto duro do plano
 *  Hobby, confirmado por deploy real. */
export const maxDuration = 300;

/** Pausa entre modelos, para não empilhar requisições numa chave free tier. */
const PAUSA_ENTRE_MODELOS_MS = 2_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ModelSpec {
  provider: ProviderId;
  model: string;
}

/** Aceita `"gemini-2.5-flash"` (assume google) ou `"provedor:modelo"`. */
function parseModelSpec(raw: string): ModelSpec | string {
  const separator = raw.indexOf(':');
  if (separator === -1) {
    if (raw.startsWith('gemini-')) return { provider: 'google', model: raw };
    if (raw.startsWith('claude-')) return { provider: 'anthropic', model: raw };
    if (raw.startsWith('grok-')) return { provider: 'xai', model: raw };
    return `"${raw}": não dá para inferir o provedor. Use "provedor:modelo".`;
  }
  const provider = raw.slice(0, separator).trim();
  const model = raw.slice(separator + 1).trim();
  if (!isProviderId(provider)) return `"${raw}": provedor "${provider}" desconhecido.`;
  if (!model) return `"${raw}": modelo vazio.`;
  return { provider, model };
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

  let body: { models?: unknown; transcript?: unknown; sintetica?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Corpo precisa ser JSON válido.' }, { status: 400, headers });
  }

  const { transcript } = body;
  if (typeof transcript !== 'string' || transcript.trim().length === 0) {
    return NextResponse.json(
      { error: '"transcript" é obrigatório e precisa ser uma string não vazia.' },
      { status: 400, headers },
    );
  }
  const limite = maxTranscriptChars();
  if (transcript.length > limite) {
    return NextResponse.json(
      { error: `"transcript" tem ${transcript.length} caracteres e o limite é ${limite}.` },
      { status: 413, headers },
    );
  }

  // A proibição de transcrição real em free tier vale mais checada do que
  // lembrada: aqui ela é uma condição, não um comentário no README.
  const aviso = activeDataPolicyWarning();
  if (aviso && body.sintetica !== true) {
    return NextResponse.json(
      {
        error:
          'A configuração ativa envia conteúdo para treinamento do provedor. ' +
          'Só transcrição sintética é aceita — declare "sintetica": true no corpo ' +
          'para confirmar que esta não é gravação real de reunião.',
        aviso,
      },
      { status: 400, headers },
    );
  }

  if (!Array.isArray(body.models) || body.models.length === 0) {
    return NextResponse.json(
      { error: '"models" é obrigatório: uma lista de modelos a comparar.' },
      { status: 400, headers },
    );
  }

  const specs: ModelSpec[] = [];
  const invalidos: string[] = [];
  for (const raw of body.models) {
    if (typeof raw !== 'string') {
      invalidos.push(String(raw));
      continue;
    }
    const parsed = parseModelSpec(raw);
    if (typeof parsed === 'string') invalidos.push(parsed);
    else specs.push(parsed);
  }
  if (invalidos.length > 0) {
    return NextResponse.json({ error: invalidos.join(' ') }, { status: 400, headers });
  }

  const results = [];
  for (const [index, spec] of specs.entries()) {
    if (index > 0) await sleep(PAUSA_ENTRE_MODELOS_MS);

    try {
      const result = await getProvider(spec.provider).complete(spec.model, {
        system: BENCH_SYSTEM,
        messages: [
          { role: 'user', content: `Compacte a transcrição a seguir.\n\n${transcript}` },
        ],
        maxTokens: 16_000,
        jsonSchema: BENCH_SCHEMA,
      });

      const parsed = result.parsed as BenchOutput | undefined;
      const statements = parsed?.statements ?? [];
      const cost = estimateCost(spec.provider, spec.model, result.usage);

      results.push({
        provider: spec.provider,
        model: spec.model,
        ok: true,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cachedInputTokens: result.usage.cachedInputTokens ?? 0,
        custoUsd: cost ? Number(cost.totalUsd.toFixed(6)) : null,
        latencyMs: result.meta.latencyMs,
        repaired: result.meta.repaired,
        rateLimitWaits: result.meta.rateLimitWaits,
        statements: statements.length,
        // Caracteres antes / depois — a razão de compactação.
        razaoCompactacao:
          statements.length === 0
            ? null
            : Number(
                (
                  transcript.length /
                  statements.reduce((total, s) => total + (s.text?.length ?? 0), 0)
                ).toFixed(2),
              ),
        kinds: countKinds(statements),
        ancoras: checkAnchors(statements, transcript),
        entities: parsed?.entities ?? null,
        // Todos, não uma amostra: a classificação de `kind` é o que separa
        // os modelos, e ela não se julga por contagem — precisa ler qual
        // afirmação foi chamada de decisão.
        statementsCompletos: statements,
      });
    } catch (error) {
      results.push({
        provider: spec.provider,
        model: spec.model,
        ok: false,
        erro: (error as Error).message,
      });
    }
  }

  return NextResponse.json(
    {
      transcriptChars: transcript.length,
      avisos: aviso ? [aviso] : [],
      results,
    },
    { status: 200, headers },
  );
}
