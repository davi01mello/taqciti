/**
 * Aplica as respostas do usuário e devolve o documento atualizado.
 *
 * **Não chama modelo nenhum.** As perguntas são sobre campos ausentes, a
 * resposta é o valor do campo, e o HTML sai do `DocumentData` — as três coisas
 * são determinísticas. Responder é grátis e instantâneo, e não há risco de o
 * modelo reescrever o que a pessoa digitou.
 *
 * Por isso esta rota também não tem a trava de política de dados: ela não
 * envia nada a provedor nenhum.
 *
 *   curl -X POST http://localhost:3000/api/answers \
 *     -H "x-docciti-key: $DOCCITI_SHARED_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d '{"documentType":"ata","documentData":{...},"gaps":[...],"answers":[...]}'
 */
import { NextResponse, type NextRequest } from 'next/server';
import { corsHeaders, rejectIfUnauthorized } from '@/lib/apiGuard';
import { applyAnswers } from '@/lib/applyAnswers';
import { renderHtml } from '@/lib/render/html';
import { isDocumentType } from '@/lib/documentTypes';
import { TEMPLATES } from '@/lib/templates';
import { assertSemVazamento } from '@/lib/agents/escritor';
import type { DocumentData, Gap } from '@/lib/documentData';
import type { Answer, Question } from '@/lib/generateStep';

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
    documentType?: unknown;
    documentData?: unknown;
    gaps?: unknown;
    answers?: unknown;
    title?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Corpo precisa ser JSON válido.' }, { status: 400, headers });
  }

  if (!isDocumentType(body.documentType)) {
    return NextResponse.json(
      { error: '"documentType" é obrigatório e precisa ser um tipo conhecido.' },
      { status: 400, headers },
    );
  }
  if (typeof body.documentData !== 'object' || body.documentData === null) {
    return NextResponse.json(
      { error: '"documentData" é obrigatório — é ele que as respostas preenchem.' },
      { status: 400, headers },
    );
  }
  if (!Array.isArray(body.answers)) {
    return NextResponse.json({ error: '"answers" precisa ser uma lista.' }, { status: 400, headers });
  }

  const gapsRecebidas = Array.isArray(body.gaps) ? (body.gaps as Gap[]) : [];

  const resultado = applyAnswers(
    body.documentData as DocumentData,
    body.answers as Answer[],
    gapsRecebidas,
  );

  const template = TEMPLATES[body.documentType];
  const titulo =
    typeof body.title === 'string' && body.title.trim()
      ? body.title
      : `${template.label} (sem título)`;

  const html = renderHtml({
    documentType: body.documentType,
    data: resultado.data,
    gaps: resultado.gaps,
    title: titulo,
  });

  // A mesma guarda da geração. O `documentData` chegou pela rede e pode ter
  // sido editado no caminho; a instrução do PDF não pode entrar por aqui.
  try {
    assertSemVazamento(html, 'o HTML do documento');
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400, headers });
  }

  const questions: Question[] = resultado.gaps.map((gap) => ({
    id: `${gap.sectionId}:${gap.field}`,
    sectionId: gap.sectionId,
    question: gap.question,
    why: gap.why,
    optional: !(template.sections.find((s) => s.id === gap.sectionId)?.required ?? true),
  }));

  return NextResponse.json(
    {
      documentData: resultado.data,
      gaps: resultado.gaps,
      questions,
      html,
      aplicadas: resultado.aplicadas,
      // Nunca somem em silêncio: quem chamou precisa saber que respondeu algo
      // que não tinha onde entrar.
      naoAplicadas: resultado.naoAplicadas,
    },
    { status: 200, headers },
  );
}
