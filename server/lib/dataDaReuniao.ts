/**
 * A data da reunião é CONHECIDA. Ninguém precisa deduzi-la.
 *
 * A extensão manda `date` no corpo de `/api/generate` — é
 * `new Date(record.startedAt).toISOString()`, o carimbo real de quando a
 * captura começou. Mesmo assim, até aqui:
 *
 *   1. o valor era colado no FIM do markdown como texto cru
 *      ("Data informada: 2026-08-22T14:30:00.000Z."), onde ninguém o lia como
 *      data e o leitor via um timestamp ISO no rodapé da ata;
 *   2. o modelo nunca o recebia. O `guidance` da Identificação manda deduzir a
 *      data da transcrição, e transcrição de reunião quase nunca diz que dia é
 *      — então `metadata.date` ficava vazio e a ata saía com
 *      `[A preencher: data]` para uma informação que o servidor tinha na mão.
 *
 * Pedir a um modelo o que já se sabe é caro de duas formas: gasta token e
 * introduz a chance de ele errar. Aqui a data é preenchida em CÓDIGO, antes do
 * pipeline rodar, e o Pensante fica livre para cuidar do que só ele pode fazer.
 *
 * ── O fuso, que é onde isto morde ──────────────────────────────────────────
 *
 * `toISOString()` é UTC. Uma reunião às 21h em São Paulo (UTC−3) vira
 * `2026-08-23T00:00:00.000Z`: formatar isso ingenuamente escreve **23/08**, um
 * dia à frente. Toda reunião da noite sairia com a data errada, e o erro é do
 * tipo que passa despercebido — ninguém confere o dia da semana de uma ata.
 *
 * Por isso a conversão é explícita, via `Intl` com `timeZone`, e nunca pelos
 * getters locais do `Date` (que dependeriam do fuso da máquina onde o servidor
 * roda — hoje um contêiner do Railway em `mia1`, Miami, que não é o fuso de
 * ninguém envolvido na reunião).
 */

/**
 * O fuso em que as datas são escritas.
 *
 * Constante e não "o fuso do servidor", porque o servidor não tem nada a ver
 * com a reunião: ele roda em Miami hoje e pode rodar em qualquer lugar amanhã,
 * e a data da ata mudaria junto sem ninguém mexer em nada.
 *
 * `DOCCITI_TIMEZONE` sobrescreve, para quando houver time fora do Brasil. O
 * ideal seria o fuso vir da extensão junto com a data, já que quem sabe onde a
 * reunião aconteceu é o navegador de quem gravou — mas isso é mudança de
 * contrato, e portanto de instalador. Isto aqui resolve hoje, do lado do
 * servidor, e cobre o caso real.
 */
const FUSO_PADRAO = 'America/Sao_Paulo';

export function fusoDoDocumento(): string {
  return process.env.DOCCITI_TIMEZONE?.trim() || FUSO_PADRAO;
}

/**
 * ISO (ou qualquer coisa que o `Date` aceite) → `DD/MM/AAAA` no fuso do
 * documento. `undefined` quando não dá para saber.
 *
 * Devolve `undefined` — e não a data de hoje — para entrada ausente ou
 * inválida. Um palpite silencioso aqui poria uma data ERRADA numa ata que vai
 * para cliente, e a lacuna honesta (`[A preencher: data]`) é muito menos pior
 * do que isso.
 */
export function formatarDataDaReuniao(iso: string | undefined): string | undefined {
  if (!iso?.trim()) return undefined;

  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return undefined;

  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: fusoDoDocumento(),
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(quando);

  const pegar = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? '';

  const dia = pegar('day');
  const mes = pegar('month');
  const ano = pegar('year');
  if (!dia || !mes || !ano) return undefined;

  return `${dia}/${mes}/${ano}`;
}
