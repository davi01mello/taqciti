/**
 * O LIMITADOR DE BUSCAS — o teto de quanto um diagnóstico pode gastar.
 *
 * ── Por que um contador, e não só uma decisão boa ────────────────────────
 *
 * Porque a decisão de buscar é local e o gasto é global. Cada pergunta pode ser
 * individualmente razoável — "a biblioteca não tinha nada sobre isto" — e vinte
 * perguntas razoáveis seguidas são uma conta que ninguém autorizou. O teto é o
 * único lugar em que o TOTAL é olhado.
 *
 * ── Por instância, e não global ──────────────────────────────────────────
 *
 * Um limitador por diagnóstico. Um contador de módulo seria compartilhado entre
 * duas gerações simultâneas, e a segunda começaria já sem orçamento por causa da
 * primeira — o tipo de bug que só aparece com dois usuários.
 *
 * ── Ele não bloqueia; ele responde ───────────────────────────────────────
 *
 * `podeBuscar()` responde, `registrarBusca()` cobra. Quem executa continua sendo
 * quem chama. Um limitador que engolisse a chamada esconderia do chamador que
 * houve corte, e o relatório do diagnóstico passaria a mentir por omissão.
 */

export interface LimitadorDeBuscas {
  /** Ainda cabe uma busca? */
  podeBuscar(): boolean;
  /** Quantas ainda cabem. */
  restantes(): number;
  /** Quantas já foram feitas. */
  usadas(): number;
  /**
   * Cobra uma busca. Devolve `false` quando o teto já havia sido atingido — e
   * nesse caso NÃO incrementa: estourar o teto não pode virar dívida.
   */
  registrarBusca(): boolean;
  /** Volta ao começo. Um diagnóstico novo, um orçamento novo. */
  reiniciar(): void;
  readonly maximo: number;
}

/**
 * Três buscas por diagnóstico.
 *
 * Número escolhido pelo formato do problema, não medido: um diagnóstico examina
 * poucos assuntos por reunião, e a biblioteca local deve responder a maioria. É
 * um palpite explícito, configurável por `DIAGNOSTICO_MAX_BUSCAS`, e é candidato
 * a mudar quando houver uso real — está na lista de pendências.
 */
export const MAXIMO_DE_BUSCAS_PADRAO = 3;

export function maximoDeBuscasDoAmbiente(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const cru = env.DIAGNOSTICO_MAX_BUSCAS;
  if (!cru?.trim()) return MAXIMO_DE_BUSCAS_PADRAO;

  const valor = Number.parseInt(cru, 10);
  if (!Number.isFinite(valor) || valor < 0) {
    // Falha alto: um teto mal escrito que virasse o padrão em silêncio faria
    // alguém acreditar ter limitado o gasto sem ter limitado.
    throw new Error(`DIAGNOSTICO_MAX_BUSCAS="${cru}" precisa ser um inteiro >= 0.`);
  }
  return valor;
}

export function criarLimitadorDeBuscas(
  maximo: number = maximoDeBuscasDoAmbiente(),
): LimitadorDeBuscas {
  if (!Number.isInteger(maximo) || maximo < 0) {
    throw new Error(`o teto de buscas precisa ser um inteiro >= 0 (recebi ${maximo}).`);
  }

  let feitas = 0;

  return {
    maximo,
    podeBuscar: () => feitas < maximo,
    restantes: () => Math.max(0, maximo - feitas),
    usadas: () => feitas,
    registrarBusca() {
      if (feitas >= maximo) return false;
      feitas += 1;
      return true;
    },
    reiniciar() {
      feitas = 0;
    },
  };
}
