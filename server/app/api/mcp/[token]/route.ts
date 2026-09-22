/**
 * O endereço do conector: `/api/mcp/<token>`.
 *
 * ── Por que o token vive no CAMINHO, e não na query ──────────────────────
 *
 * Porque a Claude descarta a query string antes de verificar o servidor, e
 * isso não é palpite — está no log de produção:
 *
 *   POST /api/mcp → 401   ← a sonda, sem o `?token=` que a pessoa colou
 *   POST /api/mcp → 200   ← a chamada real, 38s depois, com o token
 *
 * A sonda sem credencial levava a Claude a dizer "não foi possível determinar
 * como este servidor faz login", e a única saída era a pessoa clicar em
 * "continuar mesmo assim" — um aviso de segurança para algo que funcionava.
 *
 * O comportamento tem base na especificação: a "URI canônica" de um servidor
 * MCP é definida sem query nem fragmento (RFC 8707), então um cliente que
 * canonicaliza antes de sondar perde tudo que estiver depois do `?`. O
 * caminho, não — ele É a identidade do recurso. Com o token aqui, a sonda e a
 * chamada real são a MESMA requisição, e nenhuma das duas dá 401.
 *
 * Continua sendo credencial ao portador numa URL, com o mesmo preço de
 * sempre (aparece em log e em histórico de proxy) e as mesmas três defesas:
 * aparece uma vez, o banco guarda só o hash, revogar é imediato. O que muda é
 * só ONDE na URL — e essa escolha é sobre funcionar, não sobre segurança.
 */
import type { NextRequest } from 'next/server';
import { atenderMcp, naoAutorizado } from '@/lib/conector/atenderMcp';

/**
 * Node, e não Edge: o driver `pg` abre socket TCP, que o runtime de borda não
 * tem. Sem esta linha o build passa e a rota falha em produção na primeira
 * consulta — o pior lugar para descobrir.
 */
export const runtime = 'nodejs';

type Contexto = { params: Promise<{ token: string }> };

async function atender(request: NextRequest, { params }: Contexto): Promise<Response> {
  const { token } = await params;
  const limpo = decodeURIComponent(token ?? '').trim();
  if (!limpo) {
    return naoAutorizado(
      'Falta o token do conector. Gere um endereço na seção Conexões do TaqCiti.',
    );
  }
  return atenderMcp(request, { token: limpo, origem: 'caminho' });
}

export const POST = atender;
/** O transporte usa GET para o canal de eventos, quando o cliente o abre. */
export const GET = atender;
export const DELETE = atender;
