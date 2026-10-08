import { NextResponse, type NextRequest } from 'next/server';
import { corsHeaders, maxTranscriptChars, rejectIfUnauthorized } from '@/lib/apiGuard';
import { activeDataPolicyWarning } from '@/lib/ai';
import { editarDocumentoPersonalizado } from '@/lib/documentos/gerar';
import {
  corpoDeEdicaoSchema,
  erroConhecido,
  mensagemDeValidacao,
  serializarResultado,
  totalDeCaracteres,
} from '@/lib/documentos/requisicao';

/**
 * Alteração pontual de um documento personalizado, por patch de blocos sobre
 * a revisão que a pessoa estava vendo. Resposta 409 = a revisão mudou.
 */
export const maxDuration = 300;

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

  const validado = corpoDeEdicaoSchema.safeParse(corpo);
  if (!validado.success) {
    return NextResponse.json({ error: mensagemDeValidacao(validado.error) }, { status: 400, headers });
  }
  const entrada = validado.data;

  const limite = maxTranscriptChars();
  const total = totalDeCaracteres(entrada.fontes);
  if (total > limite) {
    return NextResponse.json(
      { error: `As fontes somam ${total} caracteres e o limite é ${limite}.` },
      { status: 413, headers },
    );
  }

  const aviso = activeDataPolicyWarning();
  if (aviso && entrada.sintetica !== true) {
    return NextResponse.json(
      {
        error:
          'A configuração ativa envia o conteúdo para treinamento do provedor. ' +
          'Só conteúdo sintético é aceito — declare "sintetica": true no corpo.',
        aviso,
      },
      { status: 400, headers },
    );
  }

  try {
    const { sintetica: _sintetica, ...pedido } = entrada;
    const resultado = await editarDocumentoPersonalizado(pedido);
    return NextResponse.json(serializarResultado(resultado), { status: 200, headers });
  } catch (erro) {
    const conhecido = erroConhecido(erro);
    if (conhecido) return NextResponse.json({ error: conhecido.error }, { status: conhecido.status, headers });
    console.error('[documentos/editar]', erro);
    return NextResponse.json(
      { error: 'Não foi possível alterar o documento agora. Tente de novo em instantes.' },
      { status: 502, headers },
    );
  }
}
