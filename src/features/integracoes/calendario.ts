/**
 * A agenda — disponibilidade, e criar, remarcar e cancelar eventos.
 *
 * ── O que cada chamada sabe e o que ela NÃO diz ────────────────────────────
 *
 * `freeBusy` só responde por agenda a que a conta tem acesso. Para os outros o
 * Google devolve `errors` (notFound, sem permissão): aqui isso vira
 * `acesso: false`, e a disponibilidade dessa pessoa fica DESCONHECIDA — nunca
 * "livre". Mesmo com acesso, o que se sabe é ocupado/livre no calendário
 * principal, não que a pessoa está disponível.
 *
 * ── Idempotência ───────────────────────────────────────────────────────────
 *
 * `events.insert` aceita um `id` escolhido por quem cria. Derivado da chave de
 * idempotência da ação, ele faz a repetição (retry, duplo clique, tempo
 * esgotado) bater num 409 em vez de criar um segundo evento e mandar um
 * segundo convite. Remarcar (PATCH) e cancelar (DELETE, com 404/410 aceitos)
 * já são naturalmente repetíveis.
 */
import { ESCOPO_AGENDA_EVENTOS, ESCOPO_AGENDA_LIVRE_OCUPADO } from './escopos';
import { chamarGoogle } from './google';

const BASE = 'https://www.googleapis.com/calendar/v3';

export interface Intervalo {
  inicio: string;
  fim: string;
}

export interface OcupacaoDeUmaPessoa {
  /** `false`: a conta não enxerga a agenda desta pessoa — a disponibilidade é DESCONHECIDA. */
  acesso: boolean;
  ocupado: Intervalo[];
}

interface RespostaFreeBusy {
  calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }>;
}

export async function consultarOcupacao(p: {
  emails: readonly string[];
  inicio: string;
  fim: string;
  fuso: string;
}): Promise<Record<string, OcupacaoDeUmaPessoa>> {
  const { dados } = await chamarGoogle<RespostaFreeBusy>({
    url: `${BASE}/freeBusy`,
    metodo: 'POST',
    corpo: { timeMin: p.inicio, timeMax: p.fim, timeZone: p.fuso, items: p.emails.map((id) => ({ id })) },
    escopos: [ESCOPO_AGENDA_LIVRE_OCUPADO, ESCOPO_AGENDA_EVENTOS],
  });
  const saida: Record<string, OcupacaoDeUmaPessoa> = {};
  for (const email of p.emails) {
    const c = dados.calendars?.[email];
    // Resposta sem a agenda, ou com `errors`: não se sabe. Não se completa com "livre".
    saida[email] =
      !c || (c.errors && c.errors.length > 0)
        ? { acesso: false, ocupado: [] }
        : { acesso: true, ocupado: (c.busy ?? []).map((b) => ({ inicio: b.start, fim: b.end })) };
  }
  return saida;
}

/**
 * Horários de início livres para TODOS, em passos de 30 min, só entre as pessoas
 * com acesso. Quem não tem acesso não entra na conta — e quem chama diz isso.
 */
export function janelasLivres(p: {
  ocupacao: Record<string, OcupacaoDeUmaPessoa>;
  inicio: number;
  fim: number;
  duracaoMin: number;
  /** Faixa do dia (hora local do `fuso`) em que se aceita marcar. */
  diaInicioH?: number;
  diaFimH?: number;
  fuso: string;
  max?: number;
}): Intervalo[] {
  const ocupados = Object.values(p.ocupacao)
    .filter((o) => o.acesso)
    .flatMap((o) => o.ocupado.map((i) => [Date.parse(i.inicio), Date.parse(i.fim)] as const));
  const duracao = p.duracaoMin * 60_000;
  const passo = 30 * 60_000;
  const horaLocal = (ms: number) =>
    Number(
      new Intl.DateTimeFormat('en-US', { timeZone: p.fuso, hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)),
    ) + Number(new Intl.DateTimeFormat('en-US', { timeZone: p.fuso, minute: '2-digit' }).format(new Date(ms))) / 60;
  const de = p.diaInicioH ?? 9;
  const ate = p.diaFimH ?? 18;
  const saida: Intervalo[] = [];
  const primeiro = Math.ceil(p.inicio / passo) * passo;
  for (let t = primeiro; t + duracao <= p.fim && saida.length < (p.max ?? 6); t += passo) {
    const h = horaLocal(t);
    const hFim = horaLocal(t + duracao - 1);
    if (h < de || hFim >= ate || hFim < h) continue;
    if (ocupados.some(([a, b]) => t < b && t + duracao > a)) continue;
    saida.push({ inicio: new Date(t).toISOString(), fim: new Date(t + duracao).toISOString() });
  }
  return saida;
}

export interface EventoDaAgenda {
  id: string;
  titulo: string;
  inicio: string;
  fim: string;
  link?: string;
  cancelado: boolean;
  /** A conta conectada é a organizadora: só nesse caso o Taq mexe no evento. */
  proprio: boolean;
  participantes: string[];
}

interface EventoBruto {
  id?: string;
  summary?: string;
  status?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { self?: boolean };
  attendees?: Array<{ email?: string }>;
}

function evento(b: EventoBruto): EventoDaAgenda {
  return {
    id: b.id ?? '',
    titulo: b.summary ?? '(sem título)',
    inicio: b.start?.dateTime ?? b.start?.date ?? '',
    fim: b.end?.dateTime ?? b.end?.date ?? '',
    ...(b.htmlLink ? { link: b.htmlLink } : {}),
    cancelado: b.status === 'cancelled',
    proprio: b.organizer?.self === true,
    participantes: (b.attendees ?? []).map((a) => a.email ?? '').filter(Boolean),
  };
}

const escopoDeEventos = [ESCOPO_AGENDA_EVENTOS];

export async function listarEventosProprios(p: { inicio: string; fim: string; max?: number }): Promise<EventoDaAgenda[]> {
  const url = new URL(`${BASE}/calendars/primary/events`);
  url.searchParams.set('timeMin', p.inicio);
  url.searchParams.set('timeMax', p.fim);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', String(p.max ?? 20));
  const { dados } = await chamarGoogle<{ items?: EventoBruto[] }>({ url: url.toString(), escopos: escopoDeEventos });
  return (dados.items ?? []).map(evento).filter((e) => !e.cancelado);
}

export async function obterEvento(id: string): Promise<EventoDaAgenda | null> {
  const r = await chamarGoogle<EventoBruto>({
    url: `${BASE}/calendars/primary/events/${encodeURIComponent(id)}`,
    escopos: escopoDeEventos,
    aceitar: [404, 410],
  });
  return r.status === 404 || r.status === 410 ? null : evento(r.dados);
}

/**
 * O `id` de evento do Google: 5 a 1024 caracteres entre `a-v` e `0-9`
 * (base32hex). Derivado da chave de idempotência, sempre o mesmo para ela.
 */
export function idDeEventoDaChave(chave: string): string {
  const alfabeto = '0123456789abcdefghijklmnopqrstuv';
  let saida = 'taq';
  for (let rodada = 0; rodada < 4; rodada += 1) {
    let h = 0x811c9dc5 ^ (rodada * 0x9e3779b1);
    for (let i = 0; i < chave.length; i += 1) {
      h ^= chave.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    let n = h >>> 0;
    for (let k = 0; k < 7; k += 1) {
      saida += alfabeto[n & 31];
      n >>>= 5;
    }
  }
  return saida;
}

export interface EventoCriado {
  evento: EventoDaAgenda;
  /** O Google já tinha um evento com este id: a repetição não criou outro. */
  jaExistia: boolean;
}

export async function criarEventoNaAgenda(p: {
  chave: string;
  titulo: string;
  inicio: string;
  fim: string;
  fuso: string;
  participantes: readonly string[];
  descricao?: string;
}): Promise<EventoCriado> {
  const id = idDeEventoDaChave(p.chave);
  const r = await chamarGoogle<EventoBruto>({
    url: `${BASE}/calendars/primary/events?sendUpdates=all`,
    metodo: 'POST',
    corpo: {
      id,
      summary: p.titulo,
      ...(p.descricao ? { description: p.descricao } : {}),
      start: { dateTime: p.inicio, timeZone: p.fuso },
      end: { dateTime: p.fim, timeZone: p.fuso },
      attendees: p.participantes.map((email) => ({ email })),
    },
    escopos: escopoDeEventos,
    aceitar: [409],
  });
  if (r.status !== 409) return { evento: evento(r.dados), jaExistia: false };
  const existente = await obterEvento(id);
  return existente
    ? { evento: existente, jaExistia: true }
    : { evento: { id, titulo: p.titulo, inicio: p.inicio, fim: p.fim, cancelado: false, proprio: true, participantes: [...p.participantes] }, jaExistia: true };
}

export async function remarcarEvento(
  id: string,
  p: { inicio: string; fim: string; fuso: string },
): Promise<EventoDaAgenda> {
  const { dados } = await chamarGoogle<EventoBruto>({
    url: `${BASE}/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=all`,
    metodo: 'PATCH',
    corpo: { start: { dateTime: p.inicio, timeZone: p.fuso }, end: { dateTime: p.fim, timeZone: p.fuso } },
    escopos: escopoDeEventos,
  });
  return evento(dados);
}

/** `jaCancelado`: o evento já não existia — apagar de novo não é erro. */
export async function cancelarEvento(id: string): Promise<{ jaCancelado: boolean }> {
  const r = await chamarGoogle({
    url: `${BASE}/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=all`,
    metodo: 'DELETE',
    escopos: escopoDeEventos,
    aceitar: [404, 410],
  });
  return { jaCancelado: r.status === 404 || r.status === 410 };
}
