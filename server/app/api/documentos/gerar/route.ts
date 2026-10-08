import { NextResponse, type NextRequest } from 'next/server';
import { corsHeaders, maxTranscriptChars, rejectIfUnauthorized } from '@/lib/apiGuard';
import { activeDataPolicyWarning } from '@/lib/ai';
import { gerarDocumentoPersonalizado } from '@/lib/documentos/gerar';
import {
  corpoDeGeracaoSchema,
  erroConhecido,
  mensagemDeValidacao,
  serializarResultado,
  totalDeCaracteres,
} from '@/lib/documentos/requisicao';

/**
 * Documento personalizado a partir de um pedido em linguagem natural e das
 * fontes que a pessoa escolheu. Mesma tranca e mesmo CORS de `/api/generate`
 * (ver o comentário de lá). Sobre `maxDuration`, vale o que está dito lá: é
 * diretiva da Vercel e fica inerte no host atual.
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

  const validado = corpoDeGeracaoSchema.safeParse(corpo);
  if (!validado.success) {
    return NextResponse.json({ error: mensagemDeValidacao(validado.error) }, { status: 400, headers });
  }
  const entrada = validado.data;

  const limite = maxTranscriptChars();
  const total = totalDeCaracteres(entrada.fontes);
  if (total > limite) {
    return NextResponse.json(
      {
        error:
          `As fontes somam ${total} caracteres e o limite é ${limite}. ` +
          'Selecione menos fontes ou um recorte menor.',
      },
      { status: 413, headers },
    );
  }

  const aviso = activeDataPolicyWarning();
  if (aviso && entrada.sintetica !== true) {
    return NextResponse.json(
      {
        error:
          'A configuração ativa envia o conteúdo para treinamento do provedor, com possível ' +
          'revisão humana. Só conteúdo sintético é aceito — declare "sintetica": true no corpo.',
        aviso,
      },
      { status: 400, headers },
    );
  }

  try {
    const { sintetica: _sintetica, ...pedido } = entrada;
    const resultado = await gerarDocumentoPersonalizado(pedido);
    return NextResponse.json(serializarResultado(resultado), { status: 200, headers });
  } catch (erro) {
    const conhecido = erroConhecido(erro);
    if (conhecido) return NextResponse.json({ error: conhecido.error }, { status: conhecido.status, headers });
    console.error('[documentos/gerar]', erro);
    return NextResponse.json(
      { error: 'Não foi possível gerar o documento agora. Tente de novo em instantes.' },
      { status: 502, headers },
    );
  }
}
