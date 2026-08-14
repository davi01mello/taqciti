/**
 * Roda o pipeline de UMA seção ponta a ponta: Pensante → Auditor.
 *
 * Existe para exercitar as Fases 3 e 4 antes de a Fase 5 montar o documento
 * inteiro. Recebe a transcrição e o id da seção; devolve os dados
 * estruturados, os vereditos da auditoria, o que foi descartado e as lacunas.
 *
 *   curl -X POST http://localhost:3000/api/ai/secao \
 *     -H "x-docciti-key: $DOCCITI_SHARED_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d '{"sintetica":true,"sections":["participantes","decisoes"],"transcript":"..."}'
 */
import { NextResponse, type NextRequest } from 'next/server';
import { corsHeaders, maxTranscriptChars, rejectIfUnauthorized } from '@/lib/apiGuard';
import { activeDataPolicyWarning, AGENT_CONFIG, estimateCost } from '@/lib/ai';
import { runSection } from '@/lib/agents/sectionPipeline';
import { TEMPLATES } from '@/lib/templates';
import { isDocumentType } from '@/lib/documentTypes';
import type { DocumentData } from '@/lib/documentData';

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
    sections?: unknown;
    documentType?: unknown;
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

  const documentType = isDocumentType(body.documentType) ? body.documentType : 'ata';
  const template = TEMPLATES[documentType];

  const pedidas = Array.isArray(body.sections) ? body.sections.filter((s) => typeof s === 'string') : null;
  const sections = template.sections
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter((section) => !pedidas || pedidas.includes(section.id));

  if (sections.length === 0) {
    return NextResponse.json(
      {
        error: `Nenhuma seção corresponde. Disponíveis em "${documentType}": ${template.sections
          .map((s) => s.id)
          .join(', ')}.`,
      },
      { status: 400, headers },
    );
  }

  try {
    const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
    let known: DocumentData = {};
    const resultados = [];

    for (const section of sections) {
      const run = await runSection({ section, transcript, known, answers: [] });

      // As seções seguintes veem o que as anteriores determinaram — é o
      // "não perguntar o que já foi determinado" da especificação.
      known = run.data;

      usage.inputTokens += run.usage.inputTokens;
      usage.outputTokens += run.usage.outputTokens;
      usage.cachedInputTokens += run.usage.cachedInputTokens;

      resultados.push({
        sectionId: section.id,
        title: section.title,
        audit: section.audit,
        audited: run.audited,
        passes: run.passes,
        verdicts: run.verdicts.map((v) => ({
          path: v.path,
          supported: v.supported,
          reason: v.reason,
          excerptChars: v.excerpt.length,
        })),
        discarded: run.discarded,
        gaps: run.gaps,
        // A taxa de âncoras é o principal indicador de saúde do Pensante
        // desde que é ele quem produz `quote`. Citação inexistente aparece
        // aqui inteira — nada some em silêncio.
        citacoes: run.quotes,
        naoLocalizadas: run.unlocatable,
      });
    }

    const custo = estimateCost(AGENT_CONFIG.pensante.provider, AGENT_CONFIG.pensante.model, usage);

    return RespostaOk({
      modelos: AGENT_CONFIG,
      transcriptChars: transcript.length,
      usage,
      custoAproximadoUsd: custo ? Number(custo.totalUsd.toFixed(6)) : null,
      secoes: resultados,
      documentData: known,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502, headers });
  }

  function RespostaOk(payload: unknown): NextResponse {
    return NextResponse.json(payload, { status: 200, headers });
  }
}
