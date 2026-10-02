/**
 * O Taq está pronto para responder? A interface pergunta ANTES de a pessoa
 * escrever, para que "configuração pendente" apareça antes da pergunta, e não
 * como a falha dela.
 *
 * Não custa chamada ao provedor: só lê a configuração. Nunca devolve a chave —
 * só se ela existe.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { corsHeaders, rejectIfUnauthorized } from '@/lib/apiGuard';
import { estadoPublico, resolverConfiguracao } from '@/lib/taq/config';

const METODOS = 'GET, OPTIONS';

export function OPTIONS(request: NextRequest): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin'), METODOS),
  });
}

export function GET(request: NextRequest): NextResponse {
  const headers = corsHeaders(request.headers.get('origin'), METODOS);
  const recusa = rejectIfUnauthorized(request, headers);
  if (recusa) return recusa;
  return NextResponse.json(estadoPublico(resolverConfiguracao()), { status: 200, headers });
}
