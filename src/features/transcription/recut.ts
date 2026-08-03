/**
 * Recorte da captura contra uma linha de base — função pura.
 *
 * Ao retomar uma pausa, a linha de legenda que está na tela já contém o que
 * foi dito DURANTE a pausa. O texto visível no instante da retomada vira a
 * "linha de base": só o que vier depois dela conta como fala nova.
 *
 * Quando o Meet reaproveita a linha para outra fala, o texto deixa de começar
 * pela base — aí a base morre e o texto inteiro é fala nova.
 */

export interface BaselineCut {
  /** Fala nova desde o recorte. Vazio = nada foi dito ainda. */
  text: string;
  /** false quando a linha passou a conter outra fala: a base não vale mais. */
  baselineHolds: boolean;
}

export function cutAgainstBaseline(text: string, baseline: string): BaselineCut {
  if (!text.startsWith(baseline)) return { text, baselineHolds: false };
  return { text: text.slice(baseline.length).trim(), baselineHolds: true };
}

/**
 * O que fazer com um texto de legenda, dado o recorte. É a regra inteira da
 * pausa em uma função pura — o provider só executa a decisão.
 *
 * - `emit`: fala nova de verdade.
 * - `skip`: nada novo desde o recorte.
 * - `rebaseline`: a base quebrou num nó de QUARENTENA. Reancora e não emite.
 * - `reset`: a base quebrou num nó nascido depois do recorte; ali a linha
 *   realmente passou a conter outra fala.
 */
export type BaselineDecision =
  | { action: 'emit'; text: string }
  | { action: 'skip' }
  | { action: 'rebaseline'; baseline: string }
  | { action: 'reset'; text: string };

/**
 * ⚠️ A DECISÃO QUE CORRIGE O VAZAMENTO DA PAUSA.
 *
 * O caso `rebaseline` existe porque a base quebra o tempo todo em uso real: o
 * reconhecedor do Meet REESCREVE palavras já exibidas ("vou" vira "vamos"), e
 * no modo degradado do parser o nó é a região inteira, cujo prefixo muda a cada
 * linha que rola. Tratar isso como fala nova emitia o texto INTEIRO do nó — ou
 * seja, tudo o que foi dito durante a pausa, de uma vez.
 *
 * Em nó de quarentena a leitura certa é a oposta: aquele nó é passado, e
 * qualquer coisa que ele diga a mais é resto da pausa.
 */
export function resolveAgainstBaseline(
  text: string,
  baseline: string | undefined,
  quarantined: boolean,
): BaselineDecision {
  if (baseline === undefined) return { action: 'emit', text };

  const cut = cutAgainstBaseline(text, baseline);
  if (cut.baselineHolds) {
    return cut.text.length === 0 ? { action: 'skip' } : { action: 'emit', text: cut.text };
  }
  if (quarantined) return { action: 'rebaseline', baseline: text };
  return { action: 'reset', text };
}
