/**
 * A ESCUTA — "alguém está falando com o Taq agora".
 *
 * Cada tecla no campo da conversa é um sinal: a marca que o anuncia (o seletor
 * da sidebar, a última resposta) reage como quem ouve — as barras se erguem da
 * borda para o centro, como som chegando. É a mesma metáfora do resto da
 * marca: o Taq recebe (ondas que entram) e transmite (ondas que saem).
 *
 * Um barramento de página, sem storage: digitar numa superfície não tem nada a
 * dizer para a outra, e gravar a cada tecla seria ruído no `onChanged`.
 */

const ouvintes = new Set<() => void>();

/** Chamado a cada mudança do rascunho. Barato: ninguém re-renderiza. */
export function anunciarEscrita(): void {
  for (const ouvinte of ouvintes) ouvinte();
}

export function observarEscrita(cb: () => void): () => void {
  ouvintes.add(cb);
  return () => {
    ouvintes.delete(cb);
  };
}
