/**
 * O orçamento do banco — para a sincronização não derrubar a Supabase.
 *
 * ── O risco concreto ──────────────────────────────────────────────────────
 *
 * O plano gratuito da Supabase tem 500 MB. Passou disso, o banco vira SOMENTE
 * LEITURA — e não é só a sincronização que para: é tudo que escreve, inclusive
 * o conector e o resto do produto. Prints (imagens) são o que enche: 40 por
 * pessoa, centenas de KB cada. Texto é barato; imagem não.
 *
 * Duas travas, de camadas diferentes, porque uma não segura:
 *
 *  1. COTA POR PESSOA. Ninguém sozinho consome o orçamento de todos. Medida em
 *     bytes LÓGICOS (o que a pessoa mandou), de propósito: é previsível para
 *     quem manda e não depende de como o Postgres comprimiu.
 *
 *  2. DISJUNTOR GLOBAL, pelo tamanho REAL do banco. Mesmo com cotas, muita
 *     gente junta pode chegar lá. Passou do limite, o servidor recusa escritas
 *     novas (nunca exclusões, que liberam espaço) até voltar para baixo.
 *     Fica abaixo dos 500 MB para sobrar folga ao resto do banco.
 *
 * Recusar por cota NÃO é falha definitiva: o item volta a ser tentado quando
 * houver espaço (a extensão não o dá como enviado). Ver `route.ts`.
 *
 * ── Lápides expiram ───────────────────────────────────────────────────────
 *
 * Uma exclusão deixa uma linha (lápide) para as outras máquinas ficarem
 * sabendo. Sem limpeza, o que é apagado nunca deixa de ocupar uma linha. Passados
 * 90 dias, a lápide sai: uma máquina que ficou offline mais que isso mantém o
 * item apagado como "zumbi" local, mas nunca o ressuscita no servidor (só um
 * item alterado sobe).
 */
import { banco, type Consultador } from './banco';

const MB = 1024 * 1024;

function mbDoAmbiente(nome: string, padrao: number): number {
  const v = Number(process.env[nome]);
  return Number.isFinite(v) && v > 0 ? v : padrao;
}

/** Quanto UMA pessoa pode ocupar (cópias + prints + histórico). */
export function cotaDaPessoaBytes(): number {
  // Inteiro: é um número de bytes, e 0.3 MB não pode virar 314572.8.
  return Math.floor(mbDoAmbiente('TAQCITI_COTA_MB', 25) * MB);
}

/** Acima disto, o banco inteiro para de aceitar escritas novas. */
export function limiteDoBancoBytes(): number {
  return Math.floor(mbDoAmbiente('TAQCITI_LIMITE_BANCO_MB', 400) * MB);
}

/** Dias que uma lápide dura. */
export const DIAS_DA_LAPIDE = 90;

/** O que a pessoa ocupa hoje: só o que a volta restauraria (não as lápides). */
export async function usoDaPessoa(pessoaId: string, pool: Consultador = banco()): Promise<number> {
  const r = await pool.query(
    `select
       (select coalesce(sum(tamanho), 0) from copia_local where pessoa_id = $1 and not apagado)
     + (select coalesce(sum(tamanho), 0) from print_local where pessoa_id = $1 and not apagado)
     + (select coalesce(sum(tamanho), 0) from historico_do_documento where pessoa_id = $1)
       as uso`,
    [pessoaId],
  );
  return Number(r.rows[0]?.uso ?? 0);
}

/** O tamanho lógico de um registro que já existe, ou 0. Para cobrar só a DIFERENÇA numa edição. */
export async function tamanhoAtual(
  tabela: 'copia_local' | 'print_local' | 'historico_do_documento',
  pessoaId: string,
  chave: { colecao?: string; id: string },
  pool: Consultador = banco(),
): Promise<number> {
  const filtro = tabela === 'copia_local' ? 'and colecao = $3 ' : '';
  const apagado = tabela === 'historico_do_documento' ? '' : 'and not apagado ';
  const valores = tabela === 'copia_local' ? [pessoaId, chave.id, chave.colecao] : [pessoaId, chave.id];
  const r = await pool.query(
    `select tamanho from ${tabela} where pessoa_id = $1 and id = $2 ${filtro}${apagado}`,
    valores,
  );
  return Number(r.rows[0]?.tamanho ?? 0);
}

/** Quantas linhas de um tipo de projeção a pessoa tem. Ver `projecoes.ts`. */
export async function contarItens(
  pessoaId: string,
  tipo: 'reuniao' | 'documento' | 'conversa' | 'nota',
  pool: Consultador = banco(),
): Promise<number> {
  // `tipo` é uma união fechada de literais, como em `escrita.ts`.
  const r = await pool.query(`select count(*) as n from ${tipo} where pessoa_id = $1`, [pessoaId]);
  return Number(r.rows[0]?.n ?? 0);
}

// ----------------------------------------------------- o disjuntor global

const VALIDADE_DO_DISJUNTOR_MS = 60_000;
let ultimaMedida: { cheio: boolean; em: number } | null = null;

/** Esquece a última medida. Só os testes precisam. */
export function reiniciarDisjuntor(): void {
  ultimaMedida = null;
}

/**
 * O banco passou do limite?
 *
 * Medido no máximo uma vez por minuto por instância: `pg_database_size` varre
 * o catálogo e não precisa ser exato a cada lote. Falha ABERTA — se a medida
 * não funcionar, a sincronização continua; o disjuntor é uma proteção extra,
 * não um requisito para aceitar dados, e travar tudo por não conseguir medir
 * seria o remédio pior que a doença.
 */
export async function bancoCheio(pool: Consultador = banco()): Promise<boolean> {
  const agora = Date.now();
  if (ultimaMedida && agora - ultimaMedida.em < VALIDADE_DO_DISJUNTOR_MS) return ultimaMedida.cheio;
  try {
    const r = await pool.query('select pg_database_size(current_database()) as tamanho');
    const cheio = Number(r.rows[0]?.tamanho ?? 0) > limiteDoBancoBytes();
    ultimaMedida = { cheio, em: agora };
    return cheio;
  } catch (erro) {
    console.error('[cota] não foi possível medir o banco', erro);
    return false;
  }
}

// ------------------------------------------------------ limpar as lápides

/** Apaga as lápides velhas desta pessoa. Barato: só mexe nas linhas dela. */
export async function purgarLapides(pessoaId: string, pool: Consultador = banco()): Promise<number> {
  const corte = `now() - interval '${DIAS_DA_LAPIDE} days'`;
  const a = await pool.query(
    `delete from copia_local where pessoa_id = $1 and apagado and atualizado_em < ${corte} returning 1`,
    [pessoaId],
  );
  const b = await pool.query(
    `delete from print_local where pessoa_id = $1 and apagado and atualizado_em < ${corte} returning 1`,
    [pessoaId],
  );
  return a.rows.length + b.rows.length;
}
