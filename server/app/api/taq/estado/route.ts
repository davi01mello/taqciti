/**
 * O Taq está pronto para responder? A interface pergunta ANTES de a pessoa
 * escrever, para que "configuração pendente" apareça antes da pergunta, e não
 * como a falha dela.
 *
 * Não custa chamada ao provedor: só lê a configuração. Nunca devolve a chave —
 * só se ela existe.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { corsHeaders } from '@/lib/apiGuard';
import { autorizarIa } from '@/lib/guardaDeIa';
import { estadoPublico, resolverConfiguracao } from '@/lib/taq/config';

const METODOS = 'GET, OPTIONS';

export function OPTIONS(request: NextRequest): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin'), METODOS),
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const headers = corsHeaders(request.headers.get('origin'), METODOS);
  const autorizacao = await autorizarIa(request, headers, { cobrar: false });
  if (!autorizacao.ok) return autorizacao.resposta;
  return NextResponse.json(estadoPublico(resolverConfiguracao()), { status: 200, headers });
}
