/**
 * "Quem está chamando?" — a resposta, para as rotas que precisam dela.
 *
 * Todas as rotas do acervo começam igual: pegar o token do Google do
 * cabeçalho, conferir com o Google, achar (ou criar) a pessoa. Este arquivo é
 * esse começo, num lugar só — porque repetido em cada rota, é questão de
 * tempo até uma delas esquecer um passo, e o passo esquecido não falha: ele
 * atende.
 *
 * ── Por que estas rotas NÃO exigem `x-docciti-key` ───────────────────────
 *
 * O segredo compartilhado existe para proteger a COTA de `/api/generate`:
 * atrás daquela rota há uma chave de API paga, e qualquer varredura que
 * descubra a URL gasta dinheiro de alguém. Ele nunca foi autenticação — o
 * próprio `apiGuard.ts` diz isso, e o segredo viaja dentro do bundle da
 * extensão.
 *
 * Aqui a proteção é o token do Google, que é autenticação de verdade, por
 * pessoa, verificada contra o Google a cada uso. Somar o segredo por cima não
 * acrescentaria segurança nenhuma (quem abre o pacote o acha) e
 * acrescentaria um modo de falhar: a extensão com a chave errada receberia
 * 401 numa rota que não depende dela.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { garantirPessoa } from '@/lib/conector/pessoa';
import { bancoConfigurado } from '@/lib/conector/banco';
import { IdentidadeRecusada, identidadeDoToken } from './google';

/** O token do Google chega como `Authorization: Bearer <token>`. */
function tokenDoCabecalho(request: NextRequest): string | null {
  const bruto = request.headers.get('authorization');
  if (!bruto) return null;
  const [esquema, valor] = bruto.split(' ');
  if (esquema?.toLowerCase() !== 'bearer' || !valor?.trim()) return null;
  return valor.trim();
}

export type Autenticacao =
  | { ok: true; pessoaId: string; email: string }
  | { ok: false; resposta: NextResponse };

/**
 * Resolve quem está chamando, ou devolve a resposta de erro pronta.
 *
 * Devolve a resposta em vez de lançar para que o chamador não possa
 * ESQUECER de tratar: `if (!auth.ok) return auth.resposta;` é uma linha que o
 * TypeScript cobra, porque sem ela `auth.pessoaId` não existe no tipo.
 */
export async function autenticar(
  request: NextRequest,
  headers: Record<string, string>,
): Promise<Autenticacao> {
  if (!bancoConfigurado()) {
    return {
      ok: false,
      resposta: NextResponse.json(
        {
          error:
            'Servidor sem DATABASE_URL. O acervo do conector precisa de banco — ' +
            'ver server/.env.example.',
        },
        { status: 503, headers },
      ),
    };
  }

  const token = tokenDoCabecalho(request);
  if (!token) {
    return {
      ok: false,
      resposta: NextResponse.json(
        { error: 'Falta o cabeçalho `Authorization: Bearer <token do Google>`.' },
        { status: 401, headers },
      ),
    };
  }

  try {
    const identidade = await identidadeDoToken(token);
    const pessoaId = await garantirPessoa(identidade);
    return { ok: true, pessoaId, email: identidade.email };
  } catch (erro) {
    // Recusa é 401: o chamador reautentica e tenta de novo. Qualquer outra
    // coisa é 5xx — e a distinção não é cosmética, porque um 401 faz a
    // extensão descartar o token em cache e pedir outro, o que é exatamente
    // a coisa errada a fazer quando o Google está fora do ar.
    if (erro instanceof IdentidadeRecusada) {
      return {
        ok: false,
        resposta: NextResponse.json({ error: erro.message }, { status: 401, headers }),
      };
    }
    console.error('[identidade] falha ao verificar o token', erro);
    return {
      ok: false,
      resposta: NextResponse.json(
        { error: 'Não foi possível verificar a identidade agora. Tente de novo.' },
        { status: 502, headers },
      ),
    };
  }
}
