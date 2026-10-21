/**
 * Quem pode chamar as rotas que gastam modelo — e quanto.
 *
 * ── O problema que isto fecha ────────────────────────────────────────────
 *
 * Até aqui a única tranca de `/api/generate`, `/api/documentos/*` e
 * `/api/taq/*` era o segredo `x-docciti-key`. Ele viaja DENTRO do bundle da
 * extensão (`apiGuard.ts` sempre disse isso), e o bundle é distribuído por
 * ZIP: quem abre o pacote acha a chave e chama o modelo pago em laço, sem
 * identidade e sem teto além do tamanho de cada requisição.
 *
 * ── O que passa a valer ──────────────────────────────────────────────────
 *
 * 1. Com `Authorization: Bearer <id_token do Google>`: a mesma autenticação de
 *    `/api/sync` (domínio do CITi, `lib/identidade/rota.ts`), e a chamada
 *    entra na COTA DIÁRIA da pessoa (`uso_de_ia`). Passou da cota, 429.
 *
 * 2. Sem o cabeçalho: o segredo antigo, enquanto `DOCCITI_CHAVE_LEGADA` não
 *    for `recusar`. É a ponte para as extensões já instaladas, que ainda não
 *    mandam o token. Quando todas tiverem a versão nova, a variável vira
 *    `recusar`, o segredo é rotacionado e esta ponte cai — nessa ordem, porque
 *    rotacionar antes quebra todo mundo que ainda não atualizou.
 *
 * A cota falha ABERTA quando o banco não responde (tabela ainda não criada,
 * pooler fora): a identidade já foi conferida, e travar a geração de ata por
 * não conseguir CONTAR seria o remédio pior que a doença. O teto de gasto no
 * painel de cada provedor é a rede de baixo.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { rejectIfUnauthorized } from './apiGuard';
import { banco, type Consultador } from './conector/banco';
import { autenticar } from './identidade/rota';

function numeroDoAmbiente(nome: string, padrao: number): number {
  const v = Number(process.env[nome]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : padrao;
}

/** Chamadas a modelo por pessoa por dia. Um dia pesado de uso real fica longe disto. */
export function chamadasPorDia(): number {
  return numeroDoAmbiente('TAQCITI_IA_CHAMADAS_DIA', 2_000);
}

/** Caracteres enviados por pessoa por dia (corpo das requisições). */
export function caracteresPorDia(): number {
  return numeroDoAmbiente('TAQCITI_IA_CARACTERES_DIA', 80_000_000);
}

/** A ponte do segredo antigo continua de pé? Ver o cabeçalho. */
export function aceitaChaveLegada(): boolean {
  return process.env.DOCCITI_CHAVE_LEGADA?.trim().toLowerCase() !== 'recusar';
}

export interface UsoDoDia {
  chamadas: number;
  caracteres: number;
}

/** Soma esta chamada ao dia da pessoa e devolve o total já com ela. */
export async function registrarUsoDeIa(
  pessoaId: string,
  caracteres: number,
  pool: Consultador = banco(),
): Promise<UsoDoDia> {
  const r = await pool.query(
    `insert into uso_de_ia (pessoa_id, dia, chamadas, caracteres)
     values ($1, current_date, 1, $2)
     on conflict (pessoa_id, dia) do update
       set chamadas = uso_de_ia.chamadas + 1,
           caracteres = uso_de_ia.caracteres + excluded.caracteres
     returning chamadas, caracteres`,
    [pessoaId, Math.max(0, Math.floor(caracteres))],
  );
  return {
    chamadas: Number(r.rows[0]?.chamadas ?? 0),
    caracteres: Number(r.rows[0]?.caracteres ?? 0),
  };
}

export function passouDaCota(uso: UsoDoDia): boolean {
  return uso.chamadas > chamadasPorDia() || uso.caracteres > caracteresPorDia();
}

/** O tamanho declarado do corpo. Basta como medida: o teto real por requisição é de cada rota. */
function tamanhoDoCorpo(request: NextRequest): number {
  const n = Number(request.headers.get('content-length'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export type AutorizacaoDeIa =
  | { ok: true; pessoaId: string | null }
  | { ok: false; resposta: NextResponse };

/**
 * Autoriza uma rota de IA. `cobrar: false` para as rotas que não chamam
 * modelo (renderizar, preencher respostas, estado): exigem a mesma
 * identidade, mas não gastam cota.
 */
export async function autorizarIa(
  request: NextRequest,
  headers: Record<string, string>,
  { cobrar = true }: { cobrar?: boolean } = {},
): Promise<AutorizacaoDeIa> {
  if (request.headers.get('authorization')) {
    const auth = await autenticar(request, headers);
    if (!auth.ok) return auth;
    if (!cobrar) return { ok: true, pessoaId: auth.pessoaId };

    try {
      const uso = await registrarUsoDeIa(auth.pessoaId, tamanhoDoCorpo(request));
      if (passouDaCota(uso)) {
        return {
          ok: false,
          resposta: NextResponse.json(
            { error: 'Você atingiu o limite diário de uso da IA. Ele volta amanhã.' },
            { status: 429, headers },
          ),
        };
      }
    } catch (erro) {
      console.error('[cota de IA] não foi possível contar o uso', erro);
    }
    return { ok: true, pessoaId: auth.pessoaId };
  }

  if (!aceitaChaveLegada()) {
    return {
      ok: false,
      resposta: NextResponse.json(
        { error: 'Entre com a conta do CITi para usar a IA (falta `Authorization: Bearer`).' },
        { status: 401, headers },
      ),
    };
  }

  const recusa = rejectIfUnauthorized(request, headers);
  if (recusa) return { ok: false, resposta: recusa };
  return { ok: true, pessoaId: null };
}
