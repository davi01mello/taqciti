/**
 * Cache do acervo — em memória, por INSTÂNCIA do processo.
 *
 * ── O que isto resolve, e o que isto não resolve ──────────────────────────
 *
 * `buscar → ler → conteudo` (ver `README.md`) faz várias chamadas de `obter`
 * para o MESMO id na mesma conversa — `ler` traz o item, `conteudo` busca de
 * novo para fatiar, e paginar com `proximo` busca de novo a cada página. Sem
 * cache, cada uma dessas é uma ida ao Postgres para o mesmo dado que acabou de
 * vir de lá.
 *
 * O que isto NÃO é: um cache compartilhado entre instâncias da Vercel. Cada
 * instância tem o seu `Map`, ele nasce vazio a cada cold start, e uma escrita
 * que acontece noutra instância não é vista aqui até o TTL expirar. Para o
 * volume de tráfego de hoje (leitura de acervo por pessoa, dezenas de
 * reuniões) isso é uma folga aceitável — e um cache compartilhado de verdade
 * (Redis/Upstash) é dependência nova, com conta e custo, que não entra sem
 * decisão explícita.
 *
 * ── Por que a invalidação é obrigatória, não cosmética ────────────────────
 *
 * Toda escrita (`escrita.ts`) chama `invalidarPessoa` depois de gravar. Sem
 * isso, sincronizar uma reunião editada devolveria a versão velha para a
 * Claude até o TTL vencer — silenciosamente, porque nada aqui lança erro. A
 * invalidação é POR PESSOA inteira, não por chave fina: é mais grosso do que
 * precisaria ser, mas errar para o lado de invalidar demais é seguro; errar
 * para o lado de invalidar de menos é servir dado velho sem ninguém notar.
 */

/** Quanto tempo uma entrada vale. Curto de propósito — isto é folga para uma
 *  rajada de chamadas na mesma conversa, não um substituto para o banco. */
const TTL_MS = 30_000;

interface Entrada<T> {
  valor: T;
  expiraEm: number;
}

const cache = new Map<string, Entrada<unknown>>();

/**
 * Memoiza `buscar` sob `chave`, por `TTL_MS`.
 *
 * Chamadas concorrentes para a mesma chave ainda não cacheada podem disparar
 * `buscar` mais de uma vez — não há trava de "já estou buscando isso". Para o
 * volume de hoje isso é desperdício raro e inofensivo; uma trava de stampede
 * seria máquina a mais para um caso que praticamente não acontece.
 */
export async function comCache<T>(chave: string, buscar: () => Promise<T>): Promise<T> {
  const agora = Date.now();
  const achada = cache.get(chave);
  if (achada && achada.expiraEm > agora) return achada.valor as T;

  const valor = await buscar();
  cache.set(chave, { valor, expiraEm: agora + TTL_MS });
  return valor;
}

/** Descarta tudo que pertence a uma pessoa. Chamado a cada escrita ou remoção. */
export function invalidarPessoa(pessoaId: string): void {
  const prefixo = `${pessoaId}:`;
  for (const chave of cache.keys()) {
    if (chave.startsWith(prefixo)) cache.delete(chave);
  }
}

/** Só para teste: zera tudo, para um teste não ver o que outro cacheou. */
export function limparCache(): void {
  cache.clear();
}
