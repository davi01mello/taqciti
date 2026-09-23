/**
 * Roda a apuração (Leitor → Auditor) sobre as seções pedidas, sem montar o
 * documento — o mesmo `apurar` de `generateStep`, não uma cópia.
 *
 * É a rota de diagnóstico: devolve os dados estruturados, os vereditos da
 * auditoria, o que foi descartado, as lacunas e a saúde das citações por
 * seção.
 *
 *   curl -X POST http://localhost:3000/api/ai/secao \
 *     -H "x-docciti-key: $DOCCITI_SHARED_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d '{"sintetica":true,"sections":["participantes","decisoes"],"transcript":"..."}'
 */
import { NextResponse, type NextRequest } from 'next/server';
import { corsHeaders, maxTranscriptChars, rejectIfUnauthorized } from '@/lib/apiGuard';
import { activeDataPolicyWarning, AGENT_CONFIG, estimateCost } from '@/lib/ai';
import { apurar } from '@/lib/generateStep';
import { TEMPLATES } from '@/lib/templates';
import type { SectionSpec } from '@/lib/templates/types';
import { isDocumentType } from '@/lib/documentTypes';

/** Ver o mesmo comentário em app/api/generate/route.ts: diretiva da Vercel,
 *  INERTE no Railway (que roda processo Node de vida longa, não função
 *  serverless). 300 é o teto duro do plano Hobby, confirmado por deploy real;
 *  fica como porta de volta. */
export const maxDuration = 300;

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
    const { data, gapsPorSecao, report } = await apurar({
      transcript,
      sections,
      known: {},
      answers: [],
    });

    const daSecao = <T extends { sectionId: string }>(section: SectionSpec, itens: T[]): T[] =>
      itens.filter((item) => item.sectionId === section.id);

    const resultados = sections.map((section) => {
      const lida = report.porSecao.find((s) => s.sectionId === section.id);
      return {
        sectionId: section.id,
        title: section.title,
        audit: section.audit,
        fromUserOnly: section.fromUserOnly === true,
        verdicts: daSecao(section, report.verdicts).map((v) => ({
          path: v.path,
          supported: v.supported,
          reason: v.reason,
          excerptChars: v.excerpt.length,
        })),
        discarded: daSecao(section, report.discarded),
        gaps: gapsPorSecao.get(section.id) ?? [],
        // A taxa de âncoras é o principal indicador de saúde do Leitor, que é
        // quem produz `quote`. Citação inexistente aparece aqui inteira —
        // nada some em silêncio.
        citacoes: lida?.quotes ?? null,
        naoLocalizadas: lida?.unlocatable ?? [],
      };
    });

    // Leitor e Auditor rodam em modelos diferentes, com preços diferentes: a
    // conta junta os dois pelo preço do Leitor, que é o mais caro — teto, não
    // valor exato.
    const custo = estimateCost(AGENT_CONFIG.leitor.provider, AGENT_CONFIG.leitor.model, report.usage);

    return RespostaOk({
      modelos: AGENT_CONFIG,
      transcriptChars: transcript.length,
      chamadas: report.calls,
      usage: report.usage,
      custoMaximoUsd: custo ? Number(custo.totalUsd.toFixed(6)) : null,
      secoes: resultados,
      documentData: data,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502, headers });
  }

  function RespostaOk(payload: unknown): NextResponse {
    return NextResponse.json(payload, { status: 200, headers });
  }
}
