import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { corsHeaders, rejectIfUnauthorized } from '@/lib/apiGuard';
import { compilarPdf } from '@/lib/documentos/compilador';
import { contentTreeSchema } from '@/lib/documentos/contentTree';
import { erroConhecido, mensagemDeValidacao } from '@/lib/documentos/requisicao';

/**
 * Árvore → PDF, SEM modelo. A árvore é a fonte de verdade e o PDF é derivado
 * dela: com isto o cliente guarda só a árvore (kilobytes) e pede o arquivo
 * quando precisa — abrir uma versão antiga, baixar, conferir a paginação. Sem
 * chamada ao provedor, sem custo e sem a trava de política de dados: nada novo
 * sai da máquina além do que a pessoa já guardou.
 */
const corpoSchema = z.object({
  arvore: contentTreeSchema,
  variante: z.string().min(1).optional(),
});

export function OPTIONS(request: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const headers = corsHeaders(request.headers.get('origin'));
  const unauthorized = rejectIfUnauthorized(request, headers);
  if (unauthorized) return unauthorized;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição precisa ser JSON válido.' }, { status: 400, headers });
  }
  const validado = corpoSchema.safeParse(corpo);
  if (!validado.success) {
    return NextResponse.json({ error: mensagemDeValidacao(validado.error) }, { status: 400, headers });
  }

  try {
    const { arvore, variante } = validado.data;
    const compilado = await compilarPdf(arvore, variante ? { variante } : {});
    return NextResponse.json(
      {
        pdf: compilado.pdf.toString('base64'),
        manifesto: compilado.manifesto,
        avisos: compilado.avisos,
        substituicoes: compilado.substituicoes,
      },
      { status: 200, headers },
    );
  } catch (erro) {
    const conhecido = erroConhecido(erro);
    if (conhecido) return NextResponse.json({ error: conhecido.error }, { status: conhecido.status, headers });
    console.error('[documentos/renderizar]', erro);
    return NextResponse.json({ error: 'Não foi possível gerar o arquivo agora.' }, { status: 500, headers });
  }
}
