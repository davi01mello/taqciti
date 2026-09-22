/**
 * O teto de cada resposta do conector, em caracteres — aplicado no código.
 *
 * ── Por que isto é um módulo, e não uma boa intenção ──────────────────────
 *
 * Um conector dá à IA acesso ao acervo INTEIRO. O modo de falhar não é ela
 * não achar as coisas: é ela achar todas de uma vez. `listar reuniões` sobre
 * doze reuniões de uma hora são centenas de milhares de tokens numa única
 * resposta de ferramenta — a janela acaba antes de a pergunta ser respondida,
 * e o que sobra de contexto é justamente a parte que não interessava.
 *
 * Pedir comportamento na descrição da ferramenta ("devolva pouco") não
 * resolve, porque quem monta a resposta é este servidor, não o modelo. Então
 * o teto é imposto aqui, e é a última coisa que roda antes de a resposta sair
 * (`aplicarTeto`). Nenhum registro patológico — uma reunião de seis horas, um
 * documento colado de um PDF — consegue furá-lo.
 *
 * ── Caracteres, não tokens ────────────────────────────────────────────────
 *
 * Contar token de verdade exigiria o tokenizador de cada modelo, e eles
 * discordam entre si. Caractere é uma aproximação grosseira e ESTÁVEL: em
 * português, algo entre 3 e 4 caracteres por token. Os tetos abaixo estão
 * calibrados nisso, com folga — errar para menos custa uma chamada a mais,
 * errar para mais custa a conversa inteira.
 *
 * ── O corte tem que ser legível ───────────────────────────────────────────
 *
 * Um texto cortado no meio de uma palavra e sem aviso é pior do que texto
 * nenhum: o modelo lê o fragmento como se fosse o fim do conteúdo e responde
 * com confiança sobre uma frase que não terminou. Por isso todo corte cai em
 * fronteira de palavra e deixa uma MARCA dizendo o que ficou de fora e como
 * pedir o resto.
 */

/**
 * Os tetos. Todos em caracteres do JSON serializado, exceto onde dito.
 *
 * `resposta` é o teto duro do envelope inteiro; os outros são tetos por peça,
 * e existem para que o corte caia numa peça pouco importante em vez de
 * amputar a resposta no fim.
 */
export const ORCAMENTO = {
  /** Teto duro de qualquer resposta de ferramenta. */
  resposta: 24_000,
  /** Trecho de um resultado de busca. */
  trecho: 260,
  /** O envelope de um item (metadados + orientação), sem o corpo. */
  envelope: 1_400,
  /** Uma fatia de corpo (transcrição, documento, conversa). */
  fatia: 8_000,
  /** Quantos resultados uma busca devolve, no máximo. */
  hits: 12,
  /** Quantos itens uma página de índice devolve, no máximo. */
  pagina: 25,
  /** Quantas falas uma fatia de transcrição devolve, no máximo. */
  falas: 40,
} as const;

/** O que a marca de corte diz. Uma frase, e ela ensina o próximo passo. */
const MARCA = '…[cortado]';

/**
 * Corta na fronteira de palavra mais próxima abaixo do teto.
 *
 * Volta até um espaço para não entregar "reestrutur"; se não houver espaço
 * nenhum na janela (uma URL gigante, um base64 que vazou), corta seco — é
 * melhor devolver um pedaço feio do que estourar o teto.
 */
export function cortar(texto: string, teto: number): string {
  if (texto.length <= teto) return texto;
  const janela = teto - MARCA.length;
  if (janela <= 0) return MARCA;
  const bruto = texto.slice(0, janela);
  const ultimoEspaco = bruto.lastIndexOf(' ');
  // Só respeita a fronteira se ela não jogar fora mais de 20% da janela —
  // senão um texto sem espaços perderia quase tudo.
  const corte = ultimoEspaco > janela * 0.8 ? ultimoEspaco : janela;
  return bruto.slice(0, corte).trimEnd() + MARCA;
}

/** Normaliza espaço em branco. Transcrição vem com quebra e espaço duplo. */
export function achatar(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

/**
 * O contrato de TODA resposta do conector.
 *
 * `total`/`mostrando`/`proximo` não são enfeite: são o que transforma um
 * resultado cortado em um resultado navegável. Sem eles o modelo não tem como
 * saber que existe mais nem como pedir — e a alternativa a saber é inventar.
 */
export interface Resposta<T> {
  itens: T[];
  /** Quantos existem ao todo, antes de qualquer corte. */
  total: number;
  /** Quantos vieram nesta resposta. */
  mostrando: number;
  /**
   * O valor de `de` que traz a próxima página. Ausente quando acabou — e a
   * ausência é a única forma de dizer "acabou", por isso ela é significativa.
   */
  proximo?: number;
  /** Presente só quando algo foi cortado pelo teto. Explica o quê. */
  aviso?: string;
}

/**
 * A última tranca, aplicada depois de a resposta estar montada.
 *
 * Os tetos por peça já deveriam bastar. Este existe porque "deveriam" não é
 * uma garantia: basta um item com quarenta participantes, ou uma busca que
 * casa com doze reuniões de título longo, para a soma das peças passar do
 * teto do envelope. Aqui a resposta é medida JÁ SERIALIZADA — do jeito exato
 * que vai sair — e encolhida item a item até caber.
 *
 * Encolhe pelo fim porque os itens chegam ordenados por relevância: o
 * primeiro a sair é sempre o menos útil.
 */
export function aplicarTeto<R extends Resposta<unknown>>(resposta: R): R {
  const tamanho = (r: R) => JSON.stringify(r).length;
  if (tamanho(resposta) <= ORCAMENTO.resposta) return resposta;

  // Clonar-e-mutar em vez de montar o objeto novo de uma vez: o genérico é a
  // resposta INTEIRA (que carrega campos próprios de cada ferramenta, como
  // `id` e `unidade`), e um literal com spread não é atribuível a `R`.
  const cortada = { ...resposta } as R;
  cortada.itens = [...resposta.itens];
  while (cortada.itens.length > 1 && tamanho(cortada) > ORCAMENTO.resposta) {
    cortada.itens.pop();
  }
  cortada.mostrando = cortada.itens.length;
  const sobraram = resposta.itens.length - cortada.itens.length;
  cortada.aviso =
    `A resposta passava do teto de ${ORCAMENTO.resposta} caracteres; ` +
    `${sobraram} ${sobraram === 1 ? 'item saiu' : 'itens saíram'}. ` +
    `Peça uma faixa menor ou refine a busca.`;
  return cortada;
}
