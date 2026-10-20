/**
 * A "cabeça" do cursor: o maior `seq` que esta instância sabe que existe para
 * uma pessoa — o que faz o polling automático custar ZERO consultas.
 *
 * Com a atualização automática, cada extensão pergunta "o que mudou depois do
 * cursor N?" a cada poucos minutos, e quase sempre a resposta é "nada". Sem
 * isto, cada pergunta é uma ida ao Postgres (e uma conexão do pooler da
 * Supabase) para ouvir "nada". Com isto, se a instância já viu o banco até `N`
 * e ninguém escreveu desde então, responde vazio sem tocar no banco.
 *
 * ── O que é, e o que não é ────────────────────────────────────────────────
 *
 * Cache em memória POR INSTÂNCIA, como `cache.ts` — e com a mesma limitação
 * dita com franqueza: uma escrita que cai em OUTRA instância da Vercel não
 * invalida este mapa. O custo é só atraso, nunca dado errado: a outra máquina
 * enxerga a mudança quando o TTL vence (15 s), e a escrita local invalida na
 * hora. Nada aqui devolve dado velho como se fosse novo — devolve "nada de
 * novo AINDA", que o próximo poll corrige.
 */

const TTL_MS = 15_000;

interface Cabeca {
  /** Tudo com `seq` <= isto já foi visto por esta instância. */
  seq: number;
  expiraEm: number;
}

const cabecas = new Map<string, Cabeca>();
/** Sobe a cada escrita. Ver `lembrarCabeca`. */
const geracoes = new Map<string, number>();

/** `true` quando dá para responder "nada de novo" sem consultar o banco. */
export function semNovidade(pessoaId: string, desde: number): boolean {
  const c = cabecas.get(pessoaId);
  if (!c || c.expiraEm <= Date.now()) return false;
  return desde >= c.seq;
}

/** Anote isto ANTES de consultar o banco e passe a `lembrarCabeca`. */
export function geracaoDe(pessoaId: string): number {
  return geracoes.get(pessoaId) ?? 0;
}

/**
 * Registra que a leitura até `seq` não achou mais nada.
 *
 * Só vale se NENHUMA escrita desta pessoa aconteceu desde `geracao`. Sem essa
 * checagem há uma corrida: a consulta acha o banco vazio, uma escrita chega e
 * invalida, e só então esta chamada grava "nada de novo" — afirmando por 15 s
 * uma coisa que já deixou de ser verdade.
 */
export function lembrarCabeca(pessoaId: string, seq: number, geracao: number): void {
  if (geracaoDe(pessoaId) !== geracao) return;
  cabecas.set(pessoaId, { seq, expiraEm: Date.now() + TTL_MS });
}

/** Toda escrita chama isto: depois dela, a cabeça conhecida deixa de valer. */
export function invalidarCabeca(pessoaId: string): void {
  cabecas.delete(pessoaId);
  geracoes.set(pessoaId, geracaoDe(pessoaId) + 1);
}

/** Só os testes precisam. */
export function limparCabecas(): void {
  cabecas.clear();
  geracoes.clear();
}