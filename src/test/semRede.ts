/**
 * Nenhum teste unitário fala com a rede de verdade.
 *
 * A sidebar e a home montam o `App` inteiro, e ele pergunta ao servidor se o
 * assistente está disponível. Sem isto essa pergunta ia a `localhost:3000` (ou
 * ao servidor do `.env`, na máquina de quem desenvolve) e o teste corria contra
 * ela: no Windows a conexão recusada voltava rápido o bastante, no Linux do CI
 * não — o painel ficava em "Verificando o assistente…" e três testes quebravam
 * sem defeito nenhum no código.
 *
 * Aqui a rede está sempre fora do ar, e de forma imediata. Quem precisa de uma
 * resposta troca o `fetch` por conta própria (`vi.stubGlobal('fetch', …)`), e a
 * troca é desfeita ao fim do teste, voltando a este valor.
 *
 * Exceção: os testes `*.live.test.ts`, que só rodam com `TAQ_LIVE_URL` e existem
 * justamente para falar com um servidor de verdade.
 */
if (!process.env.TAQ_LIVE_URL) {
  globalThis.fetch = () =>
    Promise.reject(new TypeError('Failed to fetch (rede desligada nos testes)'));
}
