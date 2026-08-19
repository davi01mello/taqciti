/**
 * O TEMPO, resolvido no fuso certo — funções puras, sem rede e sem dependência.
 *
 * ── Por que este arquivo existe ────────────────────────────────────────────
 *
 * Antes, o dia de uma reunião era calculado assim:
 *
 *     const d = new Date(anchorMs);
 *     new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
 *
 * `getFullYear()/getMonth()/getDate()` leem o fuso DE QUEM ESTÁ EXECUTANDO. Na
 * extensão isso é o navegador da pessoa; no backend, um contêiner em UTC. Uma
 * reunião às 22h em America/Recife (UTC−3) é 01h do dia seguinte em UTC: a
 * âncora escorrega um dia inteiro, e "amanhã" resolve para depois de amanhã.
 *
 * O mesmo defeito, em outra forma, é `toISOString().slice(0, 10)` — que é UTC
 * sempre, não o dia local de ninguém.
 *
 * A consequência não é cosmética: o sistema agenda no dia errado, e ninguém
 * percebe até alguém não aparecer na reunião. Pior, o resultado depende de ONDE
 * o código roda — a mesma transcrição reprocessada no backend dá outra data que
 * na extensão.
 *
 * ── A regra ────────────────────────────────────────────────────────────────
 *
 *   Nenhum dia, mês ou ano é lido de um `Date` sem dizer em qual fuso.
 *
 * Aqui a aritmética acontece sobre DATA CIVIL — ano, mês e dia como inteiros,
 * sem instante e sem fuso — e a conversão para instante só acontece num lugar
 * (`civilToInstant`), com o offset resolvido por `Intl` PARA A DATA ALVO.
 *
 * ── Horário de verão ───────────────────────────────────────────────────────
 *
 * O offset de um fuso não é constante: America/Sao_Paulo já foi −02:00 no verão,
 * e fusos que ainda praticam mudam duas vezes por ano. Resolver o offset "de
 * hoje" e aplicá-lo a uma data de novembro põe a reunião uma hora fora.
 *
 * `civilToInstant` faz DUAS passadas: estima o instante com o offset da
 * primeira leitura, relê o offset naquele instante e corrige se mudou. É o
 * algoritmo padrão para esta conversão, e é o que acerta a virada.
 *
 * A aritmética de dias (`addDays`, `weekdayOf`) usa `Date.UTC` de propósito:
 * UTC não tem horário de verão, então somar um dia nunca soma 23 ou 25 horas.
 * Isso é correto justamente porque data civil não é instante.
 */

/** Ano/mês/dia sem instante e sem fuso. `month` é 1–12, como as pessoas falam. */
export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/** Hora do relógio, 24h. */
export interface CivilTime {
  hour: number;
  minute: number;
}

/** De onde veio o fuso — e o quanto dá para confiar nele. */
export type TimezoneSource =
  /** Lido do navegador de quem capturou a reunião. É o melhor sinal que existe. */
  | 'extensao'
  /** Declarado no payload por quem enviou. */
  | 'payload'
  /** Fuso do processo do servidor. */
  | 'servidor'
  /** Nenhum sinal: caiu no padrão do produto. */
  | 'padrao';

export type TimezoneConfidence = 'alta' | 'media' | 'baixa';

/** O fuso do produto quando não há nenhum sinal. */
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/**
 * O CONTEXTO TEMPORAL de uma reunião: tudo que é preciso para resolver "terça".
 *
 * Viaja com a reunião de ponta a ponta. Sem ele, o backend recebe um instante e
 * não tem como saber qual era o dia local de quem estava na conversa — que é
 * exatamente contra o que "amanhã" precisa ser resolvido.
 */
export interface MeetingTemporalContext {
  /** RFC 3339 com offset explícito. Nunca "Z" quando o fuso é conhecido. */
  startedAt: string;
  endedAt: string;
  /** IANA, por exemplo "America/Recife". Nunca uma sigla ("BRT") nem um offset. */
  timezone: string;
  timezoneSource: TimezoneSource;
  timezoneConfidence: TimezoneConfidence;
  /** O dia local da reunião no fuso acima — a âncora de "hoje"/"amanhã"/"terça". */
  localDate: string;
  /** A hora local do início. */
  localTime: string;
}

// ─── Leitura de instante em um fuso ────────────────────────────────────────

interface ZonedParts extends CivilDate, CivilTime {
  second: number;
}

/**
 * As partes do relógio de parede de um instante, EM UM FUSO.
 *
 * `Intl.DateTimeFormat` com `timeZone` é a única API de plataforma que faz isto
 * corretamente, incluindo horário de verão e mudanças históricas de regra.
 */
export function partsInZone(instantMs: number, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(instantMs))) {
    parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Alguns motores devolvem "24" para meia-noite em hour12:false.
    hour: parts.hour === '24' ? 0 : Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * O offset do fuso, em minutos, NAQUELE instante.
 *
 * Positivo a leste de Greenwich. `America/Recife` devolve −180.
 */
export function offsetMinutesAt(instantMs: number, timeZone: string): number {
  try {
    const p = partsInZone(instantMs, timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return Math.round((asUtc - instantMs) / 60_000);
  } catch {
    /*
     * Fuso desconhecido (string inválida vinda de um payload antigo): trata como
     * UTC em vez de derrubar o fluxo. Quem chamou marca a confiança como baixa;
     * perder precisão é recuperável, perder a reunião não.
     */
    return 0;
  }
}

/**
 * Offset puro — "-03:00", "+0300", "+03", "Z". NÃO é fuso: não carrega regra
 * de horário de verão, então não resolve "terça que vem" em lugar nenhum.
 *
 * Precisa de teste próprio porque o `Intl` ACEITA offset como `timeZone` e
 * não reclama; quem tem que recusar é este arquivo.
 */
const OFFSET_PURO = /^[+-]\d{2}(:?\d{2})?$|^[Zz]$/;

/**
 * `true` se o fuso é um identificador IANA que a plataforma reconhece.
 *
 * Quem decide é o `Intl`, e não uma regra de formato nossa. A versão anterior
 * exigia uma "/" no nome — atalho para barrar sigla ("BRT") e offset
 * ("-03:00") de uma vez —, mas isso recusava junto os identificadores IANA de
 * um componente só, e o mais comum deles é **UTC**. O efeito: em qualquer
 * máquina configurada em UTC (servidor, imagem corporativa, boa parte do
 * Linux), o fuso de quem capturou era descartado em silêncio e trocado por
 * `America/Sao_Paulo` com confiança `baixa` — ou seja, o dia local da reunião
 * podia sair errado justamente no dado que existe para resolver "amanhã".
 * Passou despercebido porque as máquinas de desenvolvimento estavam todas em
 * America/*; apareceu no primeiro CI, que roda em UTC.
 */
export function isValidTimezone(timeZone: string): boolean {
  if (!timeZone || OFFSET_PURO.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

// ─── Conversão civil ↔ instante ────────────────────────────────────────────

/**
 * O INSTANTE de uma data e hora locais em um fuso. O único lugar que faz isto.
 *
 * Duas passadas porque o offset depende do instante, e o instante depende do
 * offset. A primeira estimativa usa o offset lido tratando o horário local como
 * se fosse UTC; a segunda relê o offset no instante estimado e corrige quando a
 * data cai do outro lado de uma virada de horário de verão.
 *
 * Em horário PULADO (a hora que não existe na madrugada da virada), o resultado
 * é o instante imediatamente seguinte à virada — a mesma escolha que o Google
 * Calendar faz, e a única que não perde o compromisso.
 */
export function civilToInstant(date: CivilDate, time: CivilTime, timeZone: string): number {
  const asUtc = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);
  const primeiro = offsetMinutesAt(asUtc, timeZone);
  const estimado = asUtc - primeiro * 60_000;
  const segundo = offsetMinutesAt(estimado, timeZone);
  return segundo === primeiro ? estimado : asUtc - segundo * 60_000;
}

/** "−03:00" a partir de minutos. O formato que RFC 3339 exige. */
export function formatOffset(minutes: number): string {
  const sinal = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sinal}${hh}:${mm}`;
}

/**
 * Data e hora locais → RFC 3339 com offset explícito.
 *
 * `2026-09-18T14:00:00-03:00`, nunca `...Z` e nunca sem offset: um horário sem
 * fuso é uma ambiguidade que alguém vai resolver errado mais tarde.
 */
export function toRfc3339(date: CivilDate, time: CivilTime, timeZone: string): string {
  const instante = civilToInstant(date, time, timeZone);
  const offset = offsetMinutesAt(instante, timeZone);
  const d = `${pad4(date.year)}-${pad2(date.month)}-${pad2(date.day)}`;
  const t = `${pad2(time.hour)}:${pad2(time.minute)}:00`;
  return `${d}T${t}${formatOffset(offset)}`;
}

/**
 * O DIA LOCAL de um instante, no fuso dado. Substitui `toISOString().slice(0,10)`.
 *
 * Esta é a função cuja ausência causava o deslocamento de dia. Toda vez que o
 * código precisa saber "que dia era", é daqui que a resposta vem.
 */
export function localDayOf(instantMs: number, timeZone: string): string {
  const p = partsInZone(instantMs, timeZone);
  return `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** A hora local de um instante, "HH:mm". */
export function localTimeOf(instantMs: number, timeZone: string): string {
  const p = partsInZone(instantMs, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** O instante como RFC 3339 no fuso dado — com offset, nunca "Z". */
export function instantToRfc3339(instantMs: number, timeZone: string): string {
  const p = partsInZone(instantMs, timeZone);
  const offset = offsetMinutesAt(instantMs, timeZone);
  return (
    `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}` +
    `T${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}${formatOffset(offset)}`
  );
}

// ─── Aritmética de data civil ──────────────────────────────────────────────

/**
 * Soma dias a uma data civil. Vira mês, ano e bissexto corretamente.
 *
 * Usa `Date.UTC` de propósito: UTC não tem horário de verão, então "mais um dia"
 * é sempre exatamente 24 horas. Aplicar isto a um instante em fuso local é que
 * seria errado — e é por isso que a função recebe e devolve DATA CIVIL, não
 * instante.
 */
export function addDays(date: CivilDate, days: number): CivilDate {
  const base = Date.UTC(date.year, date.month - 1, date.day);
  const d = new Date(base + days * 86_400_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** 0 = domingo, como `Date.getDay()`. */
export function weekdayOf(date: CivilDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** A data existe? Rejeita "31 de fevereiro", que o `Date` rolaria para março. */
export function isRealDate(date: CivilDate): boolean {
  if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > 31) return false;
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day));
  return d.getUTCMonth() === date.month - 1 && d.getUTCDate() === date.day;
}

/** Diferença em dias inteiros entre duas datas civis (b − a). */
export function daysBetween(a: CivilDate, b: CivilDate): number {
  const ma = Date.UTC(a.year, a.month - 1, a.day);
  const mb = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((mb - ma) / 86_400_000);
}

// ─── Serialização ──────────────────────────────────────────────────────────

/** "2026-09-18" → data civil. `null` quando o formato não bate. */
export function civilFromIso(text: string): CivilDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  return isRealDate(date) ? date : null;
}

/** Data civil → "2026-09-18". */
export function civilToIso(date: CivilDate): string {
  return `${pad4(date.year)}-${pad2(date.month)}-${pad2(date.day)}`;
}

/** "14:30" → hora civil. `null` quando o formato não bate. */
export function timeFromIso(text: string): CivilTime | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const time = { hour: Number(m[1]), minute: Number(m[2]) };
  return time.hour <= 23 && time.minute <= 59 ? time : null;
}

/** Hora civil → "14:30". */
export function timeToIso(time: CivilTime): string {
  return `${pad2(time.hour)}:${pad2(time.minute)}`;
}

// ─── Contexto temporal ─────────────────────────────────────────────────────

/**
 * Monta o contexto temporal de uma reunião a partir dos instantes e do fuso.
 *
 * Fuso inválido ou ausente não é erro: cai para o padrão do produto com
 * confiança `baixa`, e o resto do sistema passa a saber que aquele dado é
 * fraco — o que é bem diferente de fingir que é forte.
 */
export function buildTemporalContext(input: {
  startedAtMs: number;
  endedAtMs: number;
  timezone: string | null | undefined;
  source: TimezoneSource;
}): MeetingTemporalContext {
  const valido = input.timezone != null && isValidTimezone(input.timezone);
  const timezone = valido ? (input.timezone as string) : DEFAULT_TIMEZONE;
  const timezoneSource: TimezoneSource = valido ? input.source : 'padrao';
  const timezoneConfidence: TimezoneConfidence = !valido
    ? 'baixa'
    : input.source === 'extensao'
      ? 'alta'
      : input.source === 'payload'
        ? 'media'
        : 'baixa';

  return {
    startedAt: instantToRfc3339(input.startedAtMs, timezone),
    endedAt: instantToRfc3339(input.endedAtMs, timezone),
    timezone,
    timezoneSource,
    timezoneConfidence,
    localDate: localDayOf(input.startedAtMs, timezone),
    localTime: localTimeOf(input.startedAtMs, timezone),
  };
}

/**
 * O fuso de quem está capturando. Declarado pela plataforma, nunca adivinhado
 * de texto.
 */
export function resolveLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function pad4(value: number): string {
  return String(value).padStart(4, '0');
}
