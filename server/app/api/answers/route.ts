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
import { z } from 'zod';
import { corsHeaders } from '@/lib/apiGuard';
import { autorizarIa } from '@/lib/guardaDeIa';
import { applyAnswers } from '@/lib/applyAnswers';
import { renderHtml } from '@/lib/render/html';
import { renderPdfDoCatalogo } from '@/lib/documentos/doCatalogo';
import { isDocumentType } from '@/lib/documentTypes';
import { TEMPLATES } from '@/lib/templates';
import { assertSemVazamento } from '@/lib/vazamento';
import type { DocumentData, Gap } from '@/lib/documentData';
import type { Answer, Question } from '@/lib/generateStep';

const respostasSchema = z
  .array(z.object({ questionId: z.string().max(300), answer: z.string().max(5_000) }))
  .max(200);

const lacunasSchema = z
  .array(
    z
      .object({
        sectionId: z.string().max(200),
        field: z.string().max(300),
        question: z.string().max(2_000),
        why: z.string().max(2_000),
      })
      .passthrough(),
  )
  .max(500);

export function OPTIONS(request: NextRequest): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin')),
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const headers = corsHeaders(request.headers.get('origin'));

  const autorizacao = await autorizarIa(request, headers, { cobrar: false });
  if (!autorizacao.ok) return autorizacao.resposta;

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
  // Forma e teto das listas antes de qualquer uso: com `as`, um item torto
  // virava TypeError (500) dentro do render, e uma lista enorme, trabalho à toa.
  const respostas = respostasSchema.safeParse(body.answers);
  if (!respostas.success) {
    return NextResponse.json(
      { error: '"answers" precisa ser uma lista de { questionId, answer } (até 200).' },
      { status: 400, headers },
    );
  }
  const lacunas = lacunasSchema.safeParse(body.gaps ?? []);
  if (!lacunas.success) {
    return NextResponse.json(
      { error: '"gaps", quando enviado, precisa ser uma lista de lacunas (até 500).' },
      { status: 400, headers },
    );
  }

  const resultado = applyAnswers(
    body.documentData as DocumentData,
    respostas.data as Answer[],
    lacunas.data as Gap[],
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

  // Mesmo isolamento de /api/generate: o PDF é irmão do HTML, não
  // pré-requisito. Sem isso, responder uma pergunta faria o download voltar
  // a ser HTML mesmo quando a geração original tinha PDF — inconsistente
  // pra quem só respondeu uma lacuna.
  let pdf: string | undefined;
  try {
    const pdfBuffer = await renderPdfDoCatalogo({
      documentType: body.documentType,
      data: resultado.data,
      gaps: resultado.gaps,
      ...(typeof body.title === 'string' && body.title.trim() ? { tituloDaReuniao: body.title } : {}),
    });
    pdf = pdfBuffer.toString('base64');
  } catch (error) {
    console.error('[api/answers] falha ao gerar o PDF — devolvendo sem ele', error);
  }

  return NextResponse.json(
    {
      documentData: resultado.data,
      gaps: resultado.gaps,
      questions,
      html,
      pdf,
      aplicadas: resultado.aplicadas,
      // Nunca somem em silêncio: quem chamou precisa saber que respondeu algo
      // que não tinha onde entrar.
      naoAplicadas: resultado.naoAplicadas,
    },
    { status: 200, headers },
  );
}
