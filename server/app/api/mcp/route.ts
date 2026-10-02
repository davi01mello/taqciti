/**
 * O endereço antigo do conector: `/api/mcp`, com o token no cabeçalho
 * `Authorization: Bearer` ou em `?token=`.
 *
 * O endereço que a página Conexões entrega hoje é `/api/mcp/<token>` — ver o
 * cabeçalho daquele arquivo para o porquê. Esta rota continua existindo por
 * dois motivos, nenhum deles nostalgia:
 *
 * 1. **Endereços já colados continuam valendo.** Quem adicionou o conector
 *    antes da mudança tem `?token=` gravado na configuração do assistente. Se
 *    esta rota sumisse, o conector quebraria sem nada na tela explicando.
 *
 * 2. **Cabeçalho é o jeito certo, quando o cliente deixa.** A especificação do
 *    MCP manda a credencial em `Authorization: Bearer` e proíbe token na URL.
 *    Um cliente que permita configurar cabeçalho deve usar este endereço.
 *
 * O preço é que a sonda de verificação da Claude bate aqui sem credencial e
 * leva 401 — e é justamente por isso que o endereço entregue não é este.
 */
import type { NextRequest } from 'next/server';
import { atenderMcp, tokenDaRequisicao } from '@/lib/conector/atenderMcp';

/**
 * Node, e não Edge: o driver `pg` abre socket TCP, que o runtime de borda não
 * tem. Sem esta linha o build passa e a rota falha em produção na primeira
 * consulta — o pior lugar para descobrir.
 */
export const runtime = 'nodejs';

function atender(request: NextRequest): Promise<Response> {
  return atenderMcp(request, tokenDaRequisicao(request));
}

export const POST = atender;
/** O transporte usa GET para o canal de eventos, quando o cliente o abre. */
export const GET = atender;
export const DELETE = atender;
