/**
 * O atendimento do MCP sobre HTTP, compartilhado pelas duas rotas.
 *
 * Existe porque o token chega por dois caminhos — `/api/mcp/<token>` e
 * `/api/mcp` (cabeçalho ou query) — e o que acontece DEPOIS de saber quem é a
 * pessoa é idêntico. Duplicar isso seria duplicar o `finally` que fecha o
 * transporte, que é justamente a parte que ninguém lembra de repetir.
 *
 * ── Sem sessão, de propósito ─────────────────────────────────────────────
 *
 * `sessionIdGenerator: undefined` põe o transporte em modo sem estado: cada
 * requisição monta um servidor, responde e morre. Parece desperdício e não é
 * — as quatro ferramentas são de LEITURA e não guardam nada entre chamadas,
 * então não há estado que uma sessão preservasse.
 *
 * O que uma sessão traria é o problema: um mapa de sessões vivas na memória
 * do processo. Na Vercel cada requisição pode cair numa instância diferente
 * (e instâncias morrem sozinhas), então um mapa em memória mandaria o cliente
 * para a sessão errada na primeira vez que houvesse mais de uma. Sem sessão,
 * qualquer instância responde qualquer requisição.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { AcervoPostgres } from '@/lib/conector/acervoPostgres';
import { type Consultador, banco, bancoConfigurado } from '@/lib/conector/banco';
import { construirServidorMcp } from '@/lib/conector/mcp';
import { pessoaDoToken } from '@/lib/identidade/tokenDoConector';

/**
 * 401 SEM `WWW-Authenticate`, e essa ausência é deliberada.
 *
 * A especificação do MCP diz que um 401 com esse cabeçalho SINALIZA "este
 * servidor é um recurso OAuth 2.1" — e manda o cliente ir buscar
 * `/.well-known/oauth-protected-resource`, descobrir um servidor de
 * autorização e tentar REGISTRO DINÂMICO DE CLIENTE (RFC 7591) contra ele.
 *
 * Foi exatamente isso que aconteceu na prática: a Claude tentou "registrar no
 * serviço de login do TaqCiti" e falhou, porque não existe servidor de
 * autorização aqui — de propósito, para não exigir login. O cabeçalho antigo
 * prometia um protocolo que este servidor nunca implementou.
 *
 * Sem o cabeçalho, o 401 continua sendo 401 — só não aciona a descoberta.
 */
export function naoAutorizado(mensagem: string): NextResponse {
  return NextResponse.json({ error: mensagem }, { status: 401 });
}

/**
 * Onde o token veio. Serve ao diagnóstico da rota `/api/mcp`, que precisa
 * distinguir "cliente não mandou nada" de "cliente mandou no cabeçalho".
 */
export type OrigemDoToken = 'caminho' | 'cabecalho' | 'query' | 'ausente';

export interface TokenRecebido {
  token: string | null;
  origem: OrigemDoToken;
}

/** O token de `Authorization: Bearer` ou `?token=`, nessa ordem. */
export function tokenDaRequisicao(request: NextRequest): TokenRecebido {
  const cabecalho = request.headers.get('authorization');
  if (cabecalho) {
    const [esquema, valor] = cabecalho.split(' ');
    if (esquema?.toLowerCase() === 'bearer' && valor?.trim()) {
      return { token: valor.trim(), origem: 'cabecalho' };
    }
  }
  const daQuery = new URL(request.url).searchParams.get('token');
  if (daQuery?.trim()) return { token: daQuery.trim(), origem: 'query' };
  return { token: null, origem: 'ausente' };
}

/**
 * Uma linha por requisição, e nenhum segredo nela.
 *
 * Não é debug esquecido: é o único jeito de enxergar o que um cliente de MCP
 * de outra empresa realmente manda. Foi assim que se descobriu que a Claude
 * sonda o endereço SEM a query string antes de usá-lo — comportamento que
 * nenhum teste local reproduziria, porque nenhum teste local é a Claude.
 *
 * O token nunca entra aqui. `origem` diz por onde ele veio, não qual é.
 */
function registrar(request: NextRequest, origem: OrigemDoToken, resultado: string): void {
  const cabecalhos = request.headers;
  console.log(
    '[mcp]',
    JSON.stringify({
      metodo: request.method,
      caminho: new URL(request.url).pathname,
      origemDoToken: origem,
      resultado,
      accept: cabecalhos.get('accept') ?? null,
      contentType: cabecalhos.get('content-type') ?? null,
      protocolo: cabecalhos.get('mcp-protocol-version') ?? null,
      agente: cabecalhos.get('user-agent')?.slice(0, 80) ?? null,
    }),
  );
}

/**
 * Ajusta a requisição para o transporte aceitar clientes desleixados.
 *
 * O Streamable HTTP exige `Accept: application/json, text/event-stream` e
 * responde 406 sem isso. A regra é boa entre implementações que a seguem, e
 * péssima quando o cliente é uma sonda de verificação de outra empresa que
 * só quer saber se o endereço responde: ela leva 406, conclui "servidor não
 * verificado", e a pessoa vê um aviso sobre algo que funciona.
 *
 * Então, para um POST que claramente é JSON-RPC, completamos o `Accept` em
 * vez de recusar. Não é permissividade genérica: o corpo já é de MCP, o que
 * falta é uma formalidade de cabeçalho que o cliente não sabia mandar.
 *
 * Um GET sem `text/event-stream` NÃO é remendado — ver `respostaDeCortesia`.
 */
function comAcceptCompleto(request: NextRequest): NextRequest {
  const accept = request.headers.get('accept') ?? '';
  const temJson = accept.includes('application/json') || accept.includes('*/*');
  const temSse = accept.includes('text/event-stream');
  if (temJson && temSse) return request;

  const headers = new Headers(request.headers);
  headers.set('accept', 'application/json, text/event-stream');
  return new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
    // @ts-expect-error -- `duplex` é exigido pelo runtime ao reenviar um
    // corpo de stream, e ainda não está no tipo do DOM.
    duplex: 'half',
  }) as unknown as NextRequest;
}

/**
 * A resposta para quem chega com um GET simples, sem pedir SSE.
 *
 * Um cliente de MCP de verdade nunca cai aqui: ou manda POST com JSON-RPC,
 * ou GET pedindo `text/event-stream`. Quem cai aqui é sonda de verificação,
 * monitor de uptime, ou uma pessoa colando o endereço no navegador — e para
 * todos esses, 200 dizendo o que é este endereço é mais útil e mais
 * verificável que o 406 do transporte.
 *
 * Não vaza nada: o token já foi validado antes de chegar aqui, e o corpo não
 * diz de quem é o acervo.
 */
function respostaDeCortesia(): NextResponse {
  return NextResponse.json({
    servico: 'TaqCiti — conector MCP',
    protocolo: 'Model Context Protocol, transporte Streamable HTTP',
    comoUsar:
      'Este endereço é para um cliente de MCP (Claude, ChatGPT). Adicione-o como conector; não há o que ver abrindo no navegador.',
    autenticado: true,
  });
}

/**
 * Resolve o token, monta o servidor e devolve a resposta do transporte.
 *
 * `token` vem de fora porque cada rota o obtém de um lugar diferente; o que
 * está aqui é tudo que não depende dessa escolha.
 */
export async function atenderMcp(
  request: NextRequest,
  recebido: TokenRecebido,
  /**
   * O banco, injetável — mesmo padrão de `acervoPostgres.ts` e `escrita.ts`.
   *
   * Não é simetria por simetria: sem isto a casca HTTP ficaria sem teste, e
   * foi EXATAMENTE aqui que se escondeu o bug do corpo vazio. Os testes
   * passam o PGlite e exercitam esta função inteira, incluindo o ponto em
   * que a resposta é materializada antes de o transporte fechar.
   */
  pool?: Consultador,
): Promise<Response> {
  if (!pool && !bancoConfigurado()) {
    registrar(request, recebido.origem, 'sem-banco');
    return NextResponse.json(
      { error: 'Servidor sem DATABASE_URL — o acervo não está disponível.' },
      { status: 503 },
    );
  }
  const consultador = pool ?? banco();

  if (!recebido.token) {
    registrar(request, recebido.origem, '401-sem-token');
    return naoAutorizado(
      'Falta o token do conector. Gere um endereço na seção Conexões do TaqCiti.',
    );
  }

  const pessoaId = await pessoaDoToken(recebido.token, consultador);
  if (!pessoaId) {
    // Mesma resposta para token inexistente e token revogado: distinguir os
    // dois diria a quem está tentando que um valor existiu.
    registrar(request, recebido.origem, '401-token-invalido');
    return naoAutorizado('Token inválido ou revogado. Gere outro endereço em Conexões.');
  }

  if (request.method === 'GET') {
    const querSse = (request.headers.get('accept') ?? '').includes('text/event-stream');
    // Canal de eventos do servidor. Em modo SEM SESSÃO ele não tem o que
    // entregar — nada aqui envia notificação fora de uma resposta — e manter
    // o stream aberto só prenderia a função até o tempo limite da Vercel,
    // cobrando execução para não dizer nada. 405 é a resposta que a
    // especificação prevê para quem não oferece stream neste endereço, e os
    // clientes seguem sem ele.
    if (querSse) {
      registrar(request, recebido.origem, '405-sem-stream');
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Este servidor não abre canal de eventos (modo sem sessão).' },
          id: null,
        },
        { status: 405 },
      );
    }
    // Não é requisição de MCP: responde o que é, em vez do 406 do
    // transporte. Ver `respostaDeCortesia`.
    registrar(request, recebido.origem, 'cortesia');
    return respostaDeCortesia();
  }

  registrar(request, recebido.origem, 'ok');

  const servidor = construirServidorMcp(
    new AcervoPostgres(pessoaId, consultador),
    new URL(request.url).origin,
  );
  const transporte = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    /**
     * Resposta em JSON, não em SSE — e isto é uma CORREÇÃO DE BUG, não
     * preferência de estilo.
     *
     * No padrão (SSE), `handleRequest` devolve uma resposta cujo corpo é um
     * stream que o transporte ainda vai preencher. O `finally` abaixo fechava
     * transporte e servidor imediatamente, antes de qualquer byte ser
     * escrito — e o cliente recebia 200 com corpo VAZIO e ficava esperando
     * até estourar o tempo. O sintoma enganava duas vezes: o status era 200,
     * e o log do servidor dizia que tudo correu bem.
     *
     * Nenhum teste pegava isso porque os testes exercitam
     * `construirServidorMcp` direto, sem a casca HTTP; e nenhuma sonda com
     * `curl`/`fetch` pegava porque ler um corpo vazio não parece erro. Só um
     * cliente MCP de verdade, esperando a resposta, revelou.
     *
     * Em modo sem sessão não há nada a transmitir progressivamente: cada
     * requisição é uma pergunta com uma resposta, e as respostas têm teto de
     * tamanho (ver `orcamento.ts`). JSON é o formato certo para isso, e tem a
     * propriedade que o serverless exige — a resposta está completa antes de
     * a função terminar.
     */
    enableJsonResponse: true,
  });

  try {
    await servidor.connect(transporte);
    const resposta = await transporte.handleRequest(comAcceptCompleto(request));
    // Materializa o corpo ANTES do `finally`. Mesmo com JSON, devolver a
    // resposta sem tê-la lido deixaria a corrida de novo de pé: quem fecha o
    // transporte não pode ser mais rápido que quem escreve a resposta.
    const corpo = await resposta.arrayBuffer();
    return new Response(corpo, { status: resposta.status, headers: resposta.headers });
  } finally {
    // Sem isto, cada requisição deixa um servidor e um transporte vivos: a
    // instância vaza memória devagar até ser reciclada, e a causa não aparece
    // em teste nenhum porque testes acabam.
    await transporte.close().catch(() => {});
    await servidor.close().catch(() => {});
  }
}
