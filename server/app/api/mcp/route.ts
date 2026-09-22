/**
 * O endereço que a Claude e o ChatGPT consultam. MCP sobre HTTP.
 *
 * ── Sem sessão, de propósito ─────────────────────────────────────────────
 *
 * `sessionIdGenerator: undefined` põe o transporte em modo sem estado: cada
 * requisição monta um servidor, responde e morre. Parece desperdício e não é
 * — as quatro ferramentas são de LEITURA e não guardam nada entre chamadas,
 * então não há estado que uma sessão preservasse.
 *
 * O que uma sessão traria é o problema: um mapa de sessões vivas na memória
 * do processo. No Railway isso significa que uma reimplantação derruba todas
 * as conversas em curso, e que duas réplicas mandam o cliente para a sessão
 * errada metade das vezes. Sem sessão, qualquer instância responde qualquer
 * requisição.
 *
 * ── A credencial ─────────────────────────────────────────────────────────
 *
 * O token do conector, por `Authorization: Bearer` ou `?token=`. Os dois
 * porque os clientes divergem: alguns deixam configurar cabeçalho, outros só
 * aceitam uma URL. A URL que a página Conexões entrega usa a query, que é o
 * denominador comum.
 *
 * Token em URL aparece em log de servidor e em histórico de proxy. Isso é
 * conhecido e é o preço de não exigir login — mitigado por ser revogável a
 * qualquer momento e por a página dizer, na cara, que o endereço é uma
 * senha. O cabeçalho é preferido quando o cliente permite.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { AcervoPostgres } from '@/lib/conector/acervoPostgres';
import { bancoConfigurado } from '@/lib/conector/banco';
import { construirServidorMcp } from '@/lib/conector/mcp';
import { pessoaDoToken } from '@/lib/identidade/tokenDoConector';

/**
 * Node, e não Edge: o driver `pg` abre socket TCP, que o runtime de borda não
 * tem. Sem esta linha o build passa e a rota falha em produção na primeira
 * consulta — o pior lugar para descobrir.
 */
export const runtime = 'nodejs';

function tokenDaRequisicao(request: NextRequest): string | null {
  const cabecalho = request.headers.get('authorization');
  if (cabecalho) {
    const [esquema, valor] = cabecalho.split(' ');
    if (esquema?.toLowerCase() === 'bearer' && valor?.trim()) return valor.trim();
  }
  return new URL(request.url).searchParams.get('token');
}

/**
 * 401 com `WWW-Authenticate`.
 *
 * O cabeçalho não é formalidade: é por ele que um cliente de MCP distingue
 * "preciso de credencial" de "o servidor quebrou", e é o que faz a Claude
 * mostrar "reconectar" em vez de um erro genérico.
 */
function naoAutorizado(mensagem: string): NextResponse {
  return NextResponse.json(
    { error: mensagem },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="taqciti"' } },
  );
}

async function atender(request: NextRequest): Promise<Response> {
  if (!bancoConfigurado()) {
    return NextResponse.json(
      { error: 'Servidor sem DATABASE_URL — o acervo não está disponível.' },
      { status: 503 },
    );
  }

  const token = tokenDaRequisicao(request);
  if (!token) {
    return naoAutorizado(
      'Falta o token do conector. Gere um endereço na seção Conexões do TaqCiti.',
    );
  }

  const pessoaId = await pessoaDoToken(token);
  if (!pessoaId) {
    // Mesma resposta para token inexistente e token revogado: distinguir os
    // dois diria a quem está tentando que um valor existiu.
    return naoAutorizado('Token inválido ou revogado. Gere outro endereço em Conexões.');
  }

  const servidor = construirServidorMcp(new AcervoPostgres(pessoaId));
  const transporte = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await servidor.connect(transporte);
    return await transporte.handleRequest(request);
  } finally {
    // Sem isto, cada requisição deixa um servidor e um transporte vivos: o
    // processo do Railway vaza memória devagar até ser reiniciado, e a causa
    // não aparece em teste nenhum porque testes acabam.
    await transporte.close().catch(() => {});
    await servidor.close().catch(() => {});
  }
}

export const POST = atender;
/** O transporte usa GET para o canal de eventos, quando o cliente o abre. */
export const GET = atender;
export const DELETE = atender;
