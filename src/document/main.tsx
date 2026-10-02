/**
 * `src/document/index.html` — o ENDEREÇO da tela antiga, que agora só
 * encaminha.
 *
 * ── O que existia aqui ───────────────────────────────────────────────────
 *
 * Uma página própria de 760px para uma reunião: cabeçalho em cartão de vidro,
 * a marca em 40px, o botão verde "Gerar Documento" ocupando a largura inteira,
 * e a transcrição embaixo. Era a tela anterior à norma visual atual, e
 * continuava alcançável — a HOME abria ESTA página ao clicar numa reunião em
 * "Reuniões" e em "Documentos".
 *
 * A experiência dela mora agora dentro da HOME: a reunião com transcrição e
 * notas lado a lado, e a geração salvando na coleção de documentos.
 *
 * ── Por que o arquivo continua existindo ─────────────────────────────────
 *
 * Porque o endereço já foi aberto, e pode estar numa aba fixada, no histórico
 * do navegador ou num link que alguém guardou. Apagar a entrada do manifesto
 * transformaria todos eles em "arquivo não encontrado". Em vez disso, o
 * endereço encaminha para o registro correspondente na interface atual,
 * carregando o `meetingId` junto — quem clicar cai na mesma reunião que
 * esperava ver.
 *
 * `replace`, e não `assign`: a página antiga não deve ficar no histórico do
 * navegador, senão o botão "voltar" traz de volta um redirecionador e a pessoa
 * fica presa num pingue-pongue entre as duas telas.
 */

function destino(): string {
  const params = new URLSearchParams(window.location.search);
  const meetingId = params.get('meetingId') ?? params.get('record');
  const home = chrome.runtime.getURL('src/home/index.html');
  // `record` é o parâmetro que a HOME lê (ver `src/home/rota.ts`), e ele já
  // implica a seção "Reuniões" — não é preciso mandar as duas coisas.
  return meetingId
    ? `${home}?record=${encodeURIComponent(meetingId)}${params.get('foco') === 'notas' ? '&foco=notas' : ''}`
    : `${home}?secao=reunioes`;
}

window.location.replace(destino());
