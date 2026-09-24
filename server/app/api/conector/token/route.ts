/**
 * Os tokens que a Claude e o ChatGPT apresentam — criar, listar, revogar.
 *
 * Quem chama é a página Conexões da extensão, autenticada pela conta Google
 * de quem está usando (ver `lib/identidade/rota.ts`). Cada pessoa só alcança
 * os próprios tokens; o `pessoaId` sai da autenticação, nunca do corpo.
 *
 *   POST   cria um token e devolve o valor em claro UMA vez
 *   GET    lista o histórico (sem nunca devolver o token)
 *   DELETE revoga
 *
 *   curl -X POST https://<servidor>/api/conector/token \
 *     -H "Authorization: Bearer $TOKEN_DO_GOOGLE" \
 *     -H "Content-Type: application/json" -d '{"rotulo":"Claude"}'
 */
import { NextResponse, type NextRequest } from 'next/server';
import { corsHeaders } from '@/lib/apiGuard';
import { autenticar } from '@/lib/identidade/rota';
import {
  criarTokenDoConector,
  listarTokens,
  revogarToken,
} from '@/lib/identidade/tokenDoConector';

const METODOS = 'GET, POST, DELETE, OPTIONS';

export function OPTIONS(request: NextRequest): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin'), METODOS),
  });
}

/**
 * A URL que a pessoa cola no cliente de MCP.
 *
 * Montada a partir da requisição e não de uma variável de ambiente: o
 * servidor responde no domínio que o cliente usou para chegar, e uma
 * constante fixa entregaria o domínio de produção para quem está em
 * desenvolvimento — um endereço que funciona em toda tela e falha só na hora
 * de conectar.
 *
 * O token vai no CAMINHO, não em `?token=`: a Claude descarta a query string
 * ao verificar o servidor, e o endereço com query fazia ela avisar que não
 * sabia como o servidor autentica. Ver o cabeçalho de `app/api/mcp/[token]`.
 */
function urlDoConector(request: NextRequest, token: string): string {
  const origem = new URL(request.url).origin;
  return `${origem}/api/mcp/${encodeURIComponent(token)}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const headers = corsHeaders(request.headers.get('origin'), METODOS);
  const auth = await autenticar(request, headers);
  if (!auth.ok) return auth.resposta;

  let rotulo: string | undefined;
  try {
    const corpo = (await request.json()) as { rotulo?: unknown };
    if (typeof corpo.rotulo === 'string' && corpo.rotulo.trim()) {
      rotulo = corpo.rotulo.trim().slice(0, 80);
    }
  } catch {
    // Corpo vazio é legítimo: rótulo é opcional.
  }

  const { token, id } = await criarTokenDoConector(auth.pessoaId, rotulo);

  return NextResponse.json(
    {
      id,
      // A ÚNICA vez que o valor existe fora do navegador de quem pediu: o
      // banco só tem o hash. Quem chamou precisa mostrá-lo agora.
      token,
      url: urlDoConector(request, token),
    },
    { status: 201, headers },
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const headers = corsHeaders(request.headers.get('origin'), METODOS);
  const auth = await autenticar(request, headers);
  if (!auth.ok) return auth.resposta;

  return NextResponse.json(
    { email: auth.email, tokens: await listarTokens(auth.pessoaId) },
    { status: 200, headers },
  );
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const headers = corsHeaders(request.headers.get('origin'), METODOS);
  const auth = await autenticar(request, headers);
  if (!auth.ok) return auth.resposta;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Informe `?id=` do token a revogar.' }, { status: 400, headers });
  }

  // `revogarToken` filtra por pessoa: um id de outra pessoa simplesmente não
  // casa, e a resposta é a mesma de um id inexistente. De propósito —
  // responder "esse token existe, mas não é seu" confirmaria a existência.
  const revogou = await revogarToken(auth.pessoaId, id);
  return NextResponse.json({ revogou }, { status: revogou ? 200 : 404, headers });
}
