/**
 * Roda o Analista sobre uma transcrição e devolve o contexto compactado com
 * as métricas de saúde.
 *
 * Gasta tokens de verdade. Recusa transcrição quando a configuração ativa
 * manda conteúdo para treinamento e o chamador não declarou `sintetica: true`.
 *
 *   curl -X POST http://localhost:3000/api/ai/analista \
 *     -H "x-docciti-key: $DOCCITI_SHARED_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d '{"sintetica":true,"transcript":"..."}'
 */
import { NextResponse, type NextRequest } from 'next/server';
import { corsHeaders, maxTranscriptChars, rejectIfUnauthorized } from '@/lib/apiGuard';
import { activeDataPolicyWarning, AGENT_CONFIG, estimateCost } from '@/lib/ai';
import { analisar } from '@/lib/agents/analista';
import { excerptFor } from '@/lib/agents/anchoring';
import { isSuspect } from '@/lib/compactedContext';

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

  let body: {
    transcript?: unknown;
    sintetica?: unknown;
    amostra?: unknown;
    // Só para exercitar o janelamento contra transcrição curta. Em uso
    // normal ficam ausentes e valem os padrões da especificação.
    windowChars?: unknown;
    overlapChars?: unknown;
  };
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

  const aviso = activeDataPolicyWarning();
  if (aviso && body.sintetica !== true) {
    return NextResponse.json(
      {
        error:
          'A configuração ativa envia conteúdo para treinamento do provedor. ' +
          'Só transcrição sintética é aceita — declare "sintetica": true no corpo.',
        aviso,
      },
      { status: 400, headers },
    );
  }

  try {
    const { context, stats, calls, usage } = await analisar(transcript, {
      ...(typeof body.windowChars === 'number' ? { windowChars: body.windowChars } : {}),
      ...(typeof body.overlapChars === 'number' ? { overlapChars: body.overlapChars } : {}),
    });
    const cost = estimateCost(
      AGENT_CONFIG.analista.provider,
      AGENT_CONFIG.analista.model,
      usage,
    );

    const amostraSize = typeof body.amostra === 'number' ? body.amostra : 5;
    const suspeitas = context.statements.filter(isSuspect);

    return NextResponse.json(
      {
        modelo: AGENT_CONFIG.analista,
        stats,
        usage,
        custoUsd: cost ? Number(cost.totalUsd.toFixed(6)) : null,
        latenciaTotalMs: calls.reduce((total, meta) => total + meta.latencyMs, 0),
        reparos: calls.filter((meta) => meta.repaired).length,
        esperas429: calls.reduce((total, meta) => total + meta.rateLimitWaits, 0),
        entities: context.entities,
        kinds: context.statements.reduce<Record<string, number>>((counts, s) => {
          counts[s.kind] = (counts[s.kind] ?? 0) + 1;
          return counts;
        }, {}),
        // As suspeitas primeiro: são o que precisa de olho humano.
        suspeitas: suspeitas.map((s) => ({ id: s.id, text: s.text, quote: s.quote })),
        amostra: context.statements.slice(0, amostraSize).map((s) => ({
          id: s.id,
          kind: s.kind,
          text: s.text,
          quote: s.quote,
          anchor: s.anchor,
          // O trecho que a âncora REALMENTE aponta. É o que o Auditor da
          // Fase 4 vai ler; se ele não bater com `quote`, a âncora está
          // deslocada e a auditoria leria o trecho errado.
          trechoAncorado: s.anchor ? excerptFor(transcript, s.anchor) : null,
        })),
        statements: context.statements,
      },
      { status: 200, headers },
    );
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502, headers });
  }
}
