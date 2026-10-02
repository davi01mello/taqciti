/**
 * Horários com FUSO EXPLÍCITO — a conta que o agendamento não pode errar.
 *
 * O modelo propõe datas e horas LOCAIS ("2026-10-02", "14:00"), resolvidas a
 * partir do "Hoje" e do fuso que o contexto informa. A conversão para um
 * instante absoluto é daqui, em código, pelo banco de fusos do próprio
 * navegador (`Intl`) — inclusive horário de verão onde houver.
 *
 * Não há integração de calendário nesta versão: o que sai daqui é uma SUGESTÃO
 * de horário, com disponibilidade não verificada, e um link que abre o
 * formulário de evento do Google Agenda já preenchido. Quem cria o evento é a
 * pessoa, lá; o link não leva convidados, então nada é enviado a ninguém.
 */

/** O deslocamento do fuso naquele instante, em ms (positivo a leste de UTC). */
function deslocamento(instante: number, fuso: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instante));
  const v = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  const comoUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
  return comoUtc - Math.floor(instante / 1000) * 1000;
}

export function fusoValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

/** "2026-10-02" + "14:00" no fuso → instante em ms. Lança se a data não existe. */
export function localParaInstante(data: string, hora: string, fuso: string): number {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  const h = /^(\d{2}):(\d{2})$/.exec(hora);
  if (!d || !h) throw new Error('Data ou hora em formato inválido.');
  const [ano, mes, dia] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [hh, mm] = [Number(h[1]), Number(h[2])];
  if (hh > 23 || mm > 59) throw new Error('Hora inválida.');
  const comoUtc = Date.UTC(ano, mes - 1, dia, hh, mm);
  const conferida = new Date(comoUtc);
  if (conferida.getUTCMonth() !== mes - 1 || conferida.getUTCDate() !== dia)
    throw new Error('Data inexistente.');
  // Duas passadas: a primeira acerta o deslocamento, a segunda corrige a
  // borda do horário de verão.
  let instante = comoUtc - deslocamento(comoUtc, fuso);
  instante = comoUtc - deslocamento(instante, fuso);
  return instante;
}

/** O dia local (AAAA-MM-DD) de um instante, no fuso. */
export function diaLocal(instante: number, fuso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(new Date(instante));
}

/** "qui., 02/10, 14:00" — como a pessoa lê, no fuso dela. */
export function rotuloDoHorario(instante: number, fuso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(instante));
}

function compacto(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * O formulário de evento do Google Agenda, preenchido. Sem `add` (convidados):
 * abrir o link não convida ninguém, e a pessoa revisa antes de salvar.
 */
export function linkDoGoogleAgenda(p: {
  titulo: string;
  inicio: string;
  fim: string;
  fuso: string;
  descricao?: string;
}): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: p.titulo,
    dates: `${compacto(p.inicio)}/${compacto(p.fim)}`,
    ctz: p.fuso,
    ...(p.descricao ? { details: p.descricao } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
