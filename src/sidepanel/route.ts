/**
 * O que a saída larga foi pedida para mostrar, lido da própria URL.
 *
 * ── Por que a rota não pode ser só a fase ──────────────────────────────────
 *
 * `App` roteava exclusivamente por `state.phase`: ociosa mostrava o histórico,
 * gravando mostrava a transcrição ao vivo, terminada mostrava o resumo. Isso
 * está certo para quem ABRE o TaqCITi (o ícone, o menu de painel lateral do
 * Chrome): a reunião de agora é o que interessa.
 *
 * Está errado para quem pediu uma tela específica. O botão do rodapé do
 * histórico, no painel, abria uma aba que — com uma reunião em curso — mostrava
 * a transcrição ao vivo, e dali não havia nenhum caminho de volta para a lista.
 * O botão prometia o histórico e nunca o entregava; era isso o "não funciona".
 *
 * A query string é o veículo certo para esse pedido, e não um estado no
 * storage: ela pertence à ABA, não ao produto. Duas abas podem estar em
 * reuniões diferentes do histórico, recarregar mantém onde se estava, e o
 * pedido morre junto com a aba — sem nada para limpar depois.
 */

export interface WideViewRequest {
  /** Mostrar o histórico, seja qual for a fase da reunião. */
  history: boolean;
  /** Abrir já nesta reunião do histórico, em vez da lista. */
  recordId: string | null;
}

/** Nenhum pedido: a tela vem da fase, como sempre veio. */
export const NO_WIDE_VIEW_REQUEST: WideViewRequest = {
  history: false,
  recordId: null,
};

/**
 * Lê o pedido de `location.search`.
 *
 * `record` implica `view=history` mesmo sozinho: pedir uma reunião do histórico
 * já é pedir o histórico, e exigir os dois parâmetros juntos só criaria uma URL
 * meio válida capaz de cair na tela errada.
 */
export function readWideViewRequest(search: string): WideViewRequest {
  const params = new URLSearchParams(search);
  const record = params.get('record')?.trim() ?? '';
  const recordId = record.length > 0 ? record : null;

  return {
    history: params.get('view') === 'history' || recordId !== null,
    recordId,
  };
}
