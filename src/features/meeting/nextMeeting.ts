/**
 * A PRÓXIMA REUNIÃO, lida da conversa — função pura, sem rede e sem modelo.
 *
 * ── Por que um analisador e não a IA ───────────────────────────────────────
 *
 * Uma data é um FATO COM ÂNCORA, não um julgamento. "Terça" só vira 15/09
 * sabendo em que dia a reunião aconteceu; "dia 18" em dezembro é janeiro. Isso
 * é aritmética de calendário: verificável, testável com uma tabela de frases e
 * idêntica em toda execução. É a mesma razão pela qual o resto do projeto não
 * deixa número passar por modelo (`mergeCaption`, `readiness`, o agente de
 * contexto) — e uma data é um número.
 *
 * ── A REGRA CENTRAL ────────────────────────────────────────────────────────
 *
 *   Uma data mencionada na transcrição NÃO é automaticamente a data da próxima
 *   reunião.
 *
 * Numa conversa comercial de uma hora aparecem dezenas de datas e horários que
 * não têm nada a ver com agendar: "o contrato vence dia 18", "a entrega está
 * prevista para setembro", "o fechamento acontece toda sexta", "trabalhamos das
 * 8h às 18h", "hoje o processo demora duas horas", "abriram a empresa em 2019".
 *
 * ── A SEGUNDA REGRA, e a que mais custou ───────────────────────────────────
 *
 *   A informação mais recente só vence quando é claramente uma CONFIRMAÇÃO, uma
 *   CORREÇÃO ou uma REMARCAÇÃO — nunca por ser simplesmente a última data dita.
 *
 * A versão anterior escolhia assim:
 *
 *     const comData = [...candidatos].reverse().find((c) => c.date !== null);
 *
 * Literalmente "a última data falada manda". Numa conversa em que alguém diz
 * "podemos terça" no minuto 10 e "quinta a gente fecha o mês" no minuto 50, a
 * segunda vencia — sem nunca ter havido remarcação nenhuma. E, quando havia
 * remarcação de verdade ("esquece terça, fica quarta"), o resultado ficava preso
 * em `parcial` para sempre, porque duas datas quaisquer marcavam conflito.
 *
 * Agora a escolha é por PRECEDÊNCIA SEMÂNTICA (ver `selecionar`): um candidato
 * posterior só substitui o anterior quando traz correção, remarcação ou
 * confirmação. Uma segunda data sem nenhum desses sinais não troca nada — marca
 * conflito, e a tela pergunta. O candidato substituído fica gravado com estado
 * `substituida` e a evidência inteira: o histórico da decisão não se perde.
 *
 * ── O tempo vem de fora, e no fuso certo ───────────────────────────────────
 *
 * Toda a aritmética de datas usa `@/shared/temporal`, sobre DATA CIVIL. A
 * versão anterior fazia `new Date(anchorMs).getFullYear()/getMonth()/getDate()`,
 * que lê o fuso DE QUEM EXECUTA — o navegador na extensão, UTC no contêiner do
 * backend. Uma reunião às 22h em Recife é 01h do dia seguinte em UTC: a âncora
 * escorregava um dia e "amanhã" virava depois de amanhã, com resultado diferente
 * conforme onde o código rodasse.
 *
 * ── Contínuo sem custo ─────────────────────────────────────────────────────
 *
 * Sendo puro, roda sobre os segmentos quantas vezes quiser: durante a reunião,
 * para o painel mostrar a hipótese, e no fim, para o fluxo confirmar.
 *
 * Mesma regra dos outros heurísticos puros da pasta: não sair daqui para
 * lugar nenhum.
 */
import type { TranscriptSegment } from '@/shared/types/domain';
import {
  addDays,
  civilFromIso,
  civilToInstant,
  civilToIso,
  isRealDate,
  localDayOf,
  resolveLocalTimezone,
  weekdayOf,
  type CivilDate,
} from '@/shared/temporal';

/** Mantido para não quebrar quem já lia este campo. Derivado de `status`. */
export type NextMeetingConfidence = 'alta' | 'parcial' | 'nenhuma';

/**
 * O ESTADO de um agendamento, nos seis que o domínio reconhece.
 *
 * `nao_definida` é RESPOSTA, não ausência de dado: separa "a conversa não
 * combinou nada" de "ninguém olhou". Nunca há valor padrão de data ou hora.
 *
 * `substituida` só aparece nos candidatos, nunca no resultado: é o estado de um
 * agendamento que existiu e foi corrigido, e existe para que a evidência do que
 * foi trocado não desapareça quando a correção vence.
 */
export type SchedulingState =
  /** Alguém propôs, ninguém fechou. */
  | 'proposta'
  /** Data, hora e confirmação, sem conflito e no futuro. */
  | 'confirmada'
  /** Falta data ou hora, ou há hesitação/alternativa em aberto. */
  | 'parcial'
  /** Uma correção posterior tomou o lugar deste. */
  | 'substituida'
  /** Alguém desmarcou explicitamente. */
  | 'cancelada'
  /** Nada combinado, ou dito em voz alta que ainda não foi definido. */
  | 'nao_definida';

/** O estado do RESULTADO. `substituida` não vaza para cá. */
export type NextMeetingStatus = Exclude<SchedulingState, 'substituida'>;

/** O que falta para o candidato virar compromisso. */
export type MissingField = 'data' | 'hora' | 'confirmacao';

/**
 * Um CANDIDATO de agendamento: a unidade coerente.
 *
 * Data, hora, confirmação e evidência pertencem ao mesmo candidato de propósito.
 * Era a ausência dessa unidade que permitia a data de uma fala casar com o
 * horário de outra e a confirmação de um agendamento validar outro.
 */
export interface SchedulingCandidate {
  /** Estável dentro de uma leitura: `c1`, `c2`… Permite apontar `supersedes`. */
  id: string;
  /** A ordem em que apareceu na transcrição. Auditoria da decisão. */
  order: number;
  /** yyyy-mm-dd, já resolvido contra a data LOCAL da reunião. */
  date: string | null;
  /** HH:mm em 24h. */
  time: string | null;
  /** Fuso de quem capturou — declarado, nunca inferido do texto. */
  timezone: string;
  /**
   * A finalidade, quando a própria frase a diz ("apresentar a proposta").
   * Null é o normal: o objetivo é semântico, e quem o resolve é a triagem.
   */
  objective: string | null;
  /** Os trechos literais que sustentam este candidato. Nenhum fato sem origem. */
  evidence: string[];
  /** A frase demonstra intenção de AGENDAR. Sem isto não há candidato. */
  schedulingIntent: boolean;
  /** Alguém fechou ("ficou combinado", "te mando o convite"). */
  confirmed: boolean;
  /** Hesitação na mesma frase ("talvez", "a gente vê"). */
  hedged: boolean;
  /** Duas opções na mesma frase ("terça ou quinta"): ninguém escolheu. */
  alternatives: boolean;
  /** A frase CORRIGE um agendamento anterior ("na verdade", "muda para"). */
  correction: boolean;
  /** Existe outro candidato com data diferente e sem correção: ninguém decidiu. */
  conflicting: boolean;
  /** O estado deste candidato. */
  state: SchedulingState;
  /** O `id` do candidato que este substituiu, quando houve correção. */
  supersedes: string | null;
}

export interface NextMeetingHypothesis {
  found: boolean;
  status: NextMeetingStatus;
  date: string | null;
  time: string | null;
  timezone: string;
  confidence: NextMeetingConfidence;
  /** O trecho literal que sustenta a leitura. */
  evidence: string | null;
  /** O candidato coerente por trás da leitura; null quando não há. */
  candidate: SchedulingCandidate | null;
  /**
   * Os candidatos que foram CORRIGIDOS ao longo da conversa, em ordem, com a
   * evidência preservada. Vazio no caso comum. É o que permite a tela mostrar
   * "era terça, virou quarta" em vez de só a data final.
   */
  superseded: SchedulingCandidate[];
  /** O que a tela precisa pedir. Vazio quando `confirmada`. */
  missing: MissingField[];
}

const NAO_DEFINIDA: Omit<NextMeetingHypothesis, 'timezone'> = {
  found: false,
  status: 'nao_definida',
  date: null,
  time: null,
  confidence: 'nenhuma',
  evidence: null,
  candidate: null,
  superseded: [],
  missing: ['data', 'hora'],
};

/** 0 = domingo, como `Date.getDay()`. */
const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

const MONTHS: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

/** Números por extenso que aparecem em hora falada ("às nove", "às três"). */
const SPOKEN_HOURS: Record<string, number> = {
  uma: 1,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
};

/**
 * Sinais de que a frase está FALANDO DE AGENDAR.
 *
 * OBRIGATÓRIOS. Antes uma data de calendário ("18/09") e um horário ("às 14h")
 * valiam sozinhos, "porque ninguém os diz sem motivo" — mas dizem, e o tempo
 * todo: "o contrato vence 18/09", "trabalhamos das 8h às 18h". A exceção era a
 * origem dos falsos positivos que mais custam, porque produzem um evento no
 * calendário de alguém.
 */
const SCHEDULING = [
  /*
   * Formas explícitas, não radicais.
   *
   * O radical "fech" pegaria "o fechamento acontece dia 18" — um fato de
   * operação, não um agendamento. Em português a conjugação é a maior fonte de
   * falso NEGATIVO daqui, então as formas comuns entram uma por uma; errar por
   * não detectar é recuperável (a tela pergunta), errar por detectar demais põe
   * um compromisso falso na agenda de alguém.
   */
  'marcar',
  'marcamos',
  'marcado',
  'marcada',
  'marque',
  'marquei',
  'agendar',
  'agendado',
  'agendada',
  'agende',
  'combinado',
  'combinamos',
  'fechado',
  'fechamos',
  'fechar',
  'feche',
  'fica pra',
  'fica para',
  // Hora fechada antes da data: marcador específico; `fica` sozinho é amplo
  // demais e voltaria a transformar frases operacionais em agendamento.
  'entao fica as',
  // As formas no passado são as mais comuns quando já ficou resolvido.
  'ficou pra',
  'ficou para',
  'ficamos',
  'reuniao',
  'call',
  'conversa',
  'conversar',
  'conversamos',
  'apresentar',
  'apresentacao',
  'proxima',
  'proximo',
  'nos falamos',
  'a gente se fala',
  'te mando',
  'mando o convite',
  'convite',
  'disponibilidade',
  'agenda',
  'encontro',
  // "que vem" / "que vier" apontam para o futuro por si.
  'que vem',
  'que vier',
  /*
   * Os verbos de REMARCAÇÃO não entram aqui, e a razão importa: esta lista é
   * casada por SUBSTRING, sem fronteira de palavra. "melhor" pegaria "o melhor
   * caso é 18/09" e "adia" pegaria "o adiantamento é dia 10" — dois falsos
   * positivos que produzem evento na agenda de alguém. A intenção de uma
   * correção é reconhecida por `CORRECTION`, cujos padrões têm `\b`.
   */
];

/** Verbos que transformam uma cogitação em compromisso. */
const CONFIRMATION = [
  'ficou combinado',
  'fica combinado',
  'combinado',
  'combinamos',
  'fechado',
  'fechamos',
  'agendado',
  'agendada',
  'marcado',
  'marcada',
  'marcamos',
  'vamos marcar',
  'vou marcar',
  'te mando o convite',
  'mando o convite',
  'confirmado',
  'confirmada',
];

/** Marcas de hipótese: derrubam a confirmação mesmo com data e hora na frase. */
const HEDGING = [
  'talvez',
  'quem sabe',
  'a gente ve',
  'se der',
  'se possivel',
  'se rolar',
  'pode ser que',
  'pode ser',
  'acho que da',
  'eventualmente',
];

/**
 * CORREÇÃO e REMARCAÇÃO — o sinal que autoriza um candidato a derrubar o outro.
 *
 * Sem esta lista não havia como distinguir "esquece terça, fica quarta" (uma
 * remarcação, em que a quarta é a verdade) de "podemos terça… a entrega é
 * quinta" (duas datas sobre assuntos diferentes, em que nada foi remarcado). A
 * versão anterior tratava as duas iguais, e por isso precisava marcar conflito
 * em todo caso de duas datas — inclusive nas remarcações legítimas.
 *
 * As formas são específicas de propósito. "Melhor" sozinho aparece em "melhor
 * caso", "o melhor preço", "melhor pra vocês"; só conta grudado num marcador de
 * tempo, que é como ele aparece numa remarcação ("melhor quinta", "melhor dia
 * 20", "melhor às 16h").
 */
const CORRECTION: readonly RegExp[] = [
  /\bna verdade\b/,
  /\bmelhor\s+(a\s+|na\s+|no\s+|o\s+|dia\s+|as\s+)?(segunda|terca|quarta|quinta|sexta|sabado|domingo|amanha|meio|\d)/,
  /\b(muda|mudar|mudamos|mudando|mude)\s+(pra|para)\b/,
  /\b(troca|trocar|trocamos|trocando|troque)\s+(pra|para)\b/,
  /\bvamos trocar\b/,
  /\bremarca(r|ndo|mos|da|do|)\b/,
  /\besquece(r|mos)?\b/,
  /\bdesconsidera\b/,
  /\bem vez d[eo]\b/,
  /\bao inves d[eo]\b/,
  /\b(antecipa|antecipar|antecipando)\b/,
  /\b(adia|adiar|adiamos|adiando)\b/,
  /\b(passa|passar|passamos)\s+(pra|para)\s+(a\s+|o\s+)?(segunda|terca|quarta|quinta|sexta|sabado|domingo|dia|amanha|as\s)/,
  /\bme confundi\b/,
  /\berrei\b/,
  /\bcorrigindo\b/,
  // "não, muda para…", "não, fica quarta" — a negação que abre uma correção.
  /\bnao,\s+(fica|vamos|melhor|muda|troca|e|eh|deixa)\b/,
  // Preferência explícita por outra hora interrompe o vínculo com a hora
  // anterior. Exige o "não" e uma hora logo depois para não transformar
  // preferências comerciais genéricas em remarcação.
  /\bnao,\s+(eu\s+)?prefir(o|imos)\s+(as\s+)?(meio|\d{1,2}|uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)(?=\s*(h|horas?|:|$))/,
];

/**
 * CANCELAMENTO explícito da próxima conversa.
 *
 * Só conta com contexto de agenda por perto (ver `cancelamentoEm`): "cancelamos
 * o contrato antigo" e "desmarcaram o pedido" são fatos da operação do cliente,
 * não a reunião sendo desmarcada.
 */
const CANCELLATION: readonly RegExp[] = [
  /\bcancel(a|ar|amos|ado|ada|ei|em)\b/,
  /\bdesmarc(a|ar|amos|ado|ada|ei|ou)\b/,
  /\bnao vai (dar|rolar|ter|acontecer)\b/,
  /\bdeixa (pra|para) la\b/,
];

/**
 * INDEFINIÇÃO dita em voz alta: "ainda não definimos".
 *
 * É diferente de não haver candidato nenhum. Aqui a conversa TOCOU no assunto e
 * decidiu não decidir — e a resposta honesta é `nao_definida`, não a última data
 * que passou perto.
 */
const DEFERRAL: readonly RegExp[] = [
  /\bainda nao (definimos|decidimos|marcamos|temos data|sabemos|fechamos)\b/,
  /\bnao (definimos|decidimos) (nada|ainda|a data)\b/,
  /\b(depois|dps) (a gente|nos|eu) (marca|marcamos|vemos|ve|combina|combinamos|vejo)\b/,
  /\bdepois (marcamos|combinamos|a gente marca|eu te falo)\b/,
  /\ba definir\b/,
  /\b(te|lhe) (aviso|confirmo|falo|retorno)\b/,
  /\bfica(mos)? de (marcar|combinar|ver)\b/,
  /\bvamos ver (depois|mais pra frente|mais na frente)\b/,
  /\bsem data (definida|ainda)\b/,
];

/**
 * Duas alternativas na MESMA frase: "pode ser terça ou quinta".
 *
 * `findDate` devolve só a primeira ocorrência, então o contador de datas
 * distintas entre candidatos não pega este caso — e "ou" era o sinal óbvio. Mas
 * `'ou '` como substring casa dentro de "vou marcar" (v-o-u-espaço) e marcaria
 * uma confirmação como hesitação, que é o erro oposto. Daí a checagem ser
 * estrutural: dois tokens de data na frase, ligados por "ou".
 */
function alternativesIn(sentence: string): boolean {
  const dias = sentence.match(/\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)\b/g) ?? [];
  const distintos = new Set(dias);
  if (distintos.size > 1) return true;
  const datas = sentence.match(/\b\d{1,2}\/\d{1,2}\b/g) ?? [];
  if (datas.length > 1) return true;
  // "amanhã ou depois de amanhã", "terça ou dia 18"
  return /\bou\b/.test(sentence) && (dias.length > 0 || datas.length > 0);
}

/**
 * O VETO. Frases que falam de data e não de agendamento.
 *
 * Existe porque a intenção de agendar sozinha não basta: uma frase pode ter as
 * duas coisas. "Toda sexta a gente conversa sobre o fechamento" tem "conversa"
 * (intenção) e "toda sexta" (rotina) — e não é um agendamento. O veto vence a
 * intenção, sempre: errar para o lado de não criar evento é recuperável;
 * errar para o outro lado põe um compromisso falso na agenda de alguém.
 */
const NOT_SCHEDULING: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  // Rotina e recorrência: descreve como a operação funciona, não um encontro.
  { pattern: /\b(toda|todas as|todo|todos os|cada)\s/, why: 'rotina recorrente' },
  { pattern: /\b(sempre|semanalmente|mensalmente|diariamente|de praxe)\b/, why: 'rotina' },
  // Vencimento e prazo: data de contrato, de fatura, de entrega.
  { pattern: /\b(vence|venceu|vencendo|vencimento|expira|expirou|validade)\b/, why: 'vencimento' },
  { pattern: /\b(prazo|deadline|previst[ao]|entrega|entregar|vira|renova|renovacao)\b/, why: 'prazo de entrega' },
  // Horário comercial e faixas: "das 8h às 18h", "de 9 às 17".
  { pattern: /\b(d[ae]s?\s+\d{1,2}\s*h?\s*(as|ate)\s+\d{1,2})/, why: 'faixa de horário' },
  { pattern: /\b(horario comercial|expediente|funciona(mos)? d[ae])\b/, why: 'horário comercial' },
  // Duração: "demora duas horas", "leva 3h", "dura meia hora".
  { pattern: /\b(demora|demoram|leva|levam|dura|duram|gasta|gastam)\b/, why: 'duração' },
  { pattern: /\b\d{1,2}\s*h(oras)?\s+(de|para)\s/, why: 'duração' },
  // Passado: histórico da empresa, quando algo aconteceu.
  { pattern: /\b(desde|em)\s+(19|20)\d{2}\b/, why: 'data histórica' },
  { pattern: /\b(fundad[ao]|abri(u|ram)|comec(ou|amos)|foi|era|estava|tinha)\b/, why: 'passado' },
  // Feriado e aniversário: datas do calendário que não são reunião.
  { pattern: /\b(feriado|feriadao|natal|carnaval|ano novo|pascoa)\b/, why: 'feriado' },
  { pattern: /\b(aniversario|nasceu|faz anos)\b/, why: 'aniversário' },
];

/**
 * A finalidade, quando a PRÓPRIA frase a diz. Não é inferência: é leitura.
 * Null é o resultado normal, e a triagem resolve o objetivo de verdade.
 */
const OBJECTIVE_HINTS: ReadonlyArray<{ pattern: RegExp; objective: string }> = [
  { pattern: /\b(apresentar|apresentacao) (a |da )?proposta\b/, objective: 'apresentacao_proposta' },
  { pattern: /\bproposta\b/, objective: 'apresentacao_proposta' },
  { pattern: /\bdiagnostico tecnico\b/, objective: 'diagnostico_tecnico' },
  { pattern: /\b(time|equipe) (de |das )?(solucoes|tecnic[ao])\b/, objective: 'diagnostico_tecnico' },
  { pattern: /\bdiagnostico\b/, objective: 'diagnostico' },
  { pattern: /\bnegocia(r|cao)\b/, objective: 'negociacao' },
];

/**
 * Distância máxima, em caracteres, entre a data e a palavra de agendamento.
 *
 * As legendas do Meet chegam sem pontuação final com frequência, então uma
 * "frase" pode ser um parágrafo inteiro. Sem proximidade, um trecho de
 * diagnóstico com "hoje" e um "conversa" trinta linhas depois passariam pelo
 * portão juntos. Sessenta caracteres é cerca de uma oração.
 */
const INTENT_WINDOW = 60;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function addDaysIso(base: CivilDate, days: number): string {
  return civilToIso(addDays(base, days));
}

/**
 * O próximo dia da semana ESTRITAMENTE depois da âncora.
 *
 * Numa reunião de terça, "terça" é a terça seguinte — ninguém marca para o dia
 * em que já está conversando. "Hoje" é a única forma de significar hoje, e tem
 * regra própria.
 */
function nextWeekday(anchor: CivilDate, weekday: number): CivilDate {
  const delta = (weekday - weekdayOf(anchor) + 7) % 7;
  return addDays(anchor, delta === 0 ? 7 : delta);
}

/**
 * Dia e mês para a próxima ocorrência futura.
 *
 * "Dia 18" dito em 20 de dezembro é 18 de janeiro, não o 18 que já passou.
 * Sem essa regra o sistema agenda para trás e ninguém percebe até o evento
 * não aparecer no calendário.
 */
function nextDayMonth(anchor: CivilDate, day: number, month: number | null): CivilDate | null {
  for (const year of [anchor.year, anchor.year + 1]) {
    for (const candidateMonth of month ? [month] : monthsFrom(anchor, year)) {
      const date: CivilDate = { year, month: candidateMonth, day };
      // Rejeita "31 de fevereiro" em vez de deixar rolar para março.
      if (!isRealDate(date)) continue;
      if (compareCivil(date, anchor) > 0) return date;
    }
  }
  return null;
}

/** Ordem entre datas civis: negativo se a < b. */
function compareCivil(a: CivilDate, b: CivilDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/** Meses a tentar quando só o dia foi dito: do mês da âncora em diante. */
function monthsFrom(anchor: CivilDate, year: number): number[] {
  const start = year === anchor.year ? anchor.month : 1;
  return Array.from({ length: 12 - start + 1 }, (_, i) => start + i);
}

interface Found {
  value: string;
  /** Posição no texto — alimenta a checagem de proximidade da intenção. */
  index: number;
}

/**
 * A ocorrência que interessa: a primeira, ou a ÚLTIMA numa frase de correção.
 *
 * "Esquece terça, fica quarta" tem dois dias na mesma frase, e o que vale é o
 * segundo — é para ele que a conversa está mudando. Pegar o primeiro (que era o
 * que `String.match` fazia) devolvia justamente a data que acabou de ser
 * descartada, e o sistema remarcaria para o dia errado com toda a confiança.
 */
type MatchPick = 'first' | 'last';

function pickMatch(sentence: string, re: RegExp, pick: MatchPick): RegExpMatchArray | null {
  const todas = [...sentence.matchAll(new RegExp(re.source, `${re.flags}g`))];
  if (todas.length === 0) return null;
  return (pick === 'last' ? todas[todas.length - 1] : todas[0]) as RegExpMatchArray;
}

/** Procura data numa frase já normalizada. Devolve null quando não há. */
function findDate(sentence: string, anchor: CivilDate, pick: MatchPick = 'first'): Found | null {
  // "hoje" / "amanhã" / "depois de amanhã" — os únicos relativos absolutos.
  const depois = sentence.match(/\bdepois de amanha\b/);
  if (depois) return { value: addDaysIso(anchor, 2), index: depois.index ?? 0 };
  const amanha = sentence.match(/\bamanha\b/);
  if (amanha) return { value: addDaysIso(anchor, 1), index: amanha.index ?? 0 };
  const hoje = sentence.match(/\bhoje\b/);
  if (hoje) return { value: civilToIso(anchor), index: hoje.index ?? 0 };

  // dd/mm ou dd/mm/aaaa
  const slash = pickMatch(sentence, /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, pick);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    const rawYear = slash[3];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      if (rawYear) {
        const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
        const date: CivilDate = { year, month, day };
        return isRealDate(date) ? { value: civilToIso(date), index: slash.index ?? 0 } : null;
      }
      const resolved = nextDayMonth(anchor, day, month);
      if (resolved) return { value: civilToIso(resolved), index: slash.index ?? 0 };
    }
  }

  // "18 de setembro" / "dia 18 de setembro"
  const named = pickMatch(
    sentence,
    /\b(?:dia\s+)?(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/,
    pick,
  );
  if (named) {
    const resolved = nextDayMonth(anchor, Number(named[1]), MONTHS[named[2] as string] ?? null);
    if (resolved) return { value: civilToIso(resolved), index: named.index ?? 0 };
  }

  // Dia da semana. Aceita "terca", "terca-feira", "na quinta", "segunda que vem".
  const weekday = pickMatch(
    sentence,
    /\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:\s*-?\s*feira)?\b/,
    pick,
  );
  if (weekday) {
    const target = WEEKDAYS[weekday[1] as string];
    if (target !== undefined) {
      const base = nextWeekday(anchor, target);
      /*
       * Só "SEMANA que vem" empurra sete dias — nunca "segunda que vem".
       *
       * Numa sexta, "segunda que vem" é a segunda seguinte para a maioria de
       * quem fala português do Brasil: "que vem" qualifica o dia, não a
       * semana. A distinção entre as duas formas não é confiável entre
       * falantes, então o parser fica com a leitura literal e deixa a
       * ambiguidade para a tela confirmar, em vez de inventar uma regra que
       * move a data uma semana em silêncio.
       */
      const proximaSemana = /\b(semana que vem|proxima semana|semana seguinte)\b/.test(sentence);
      const mesmaSemana = compareCivil(base, addDays(anchor, 7)) < 0;
      return {
        value: civilToIso(proximaSemana && mesmaSemana ? addDays(base, 7) : base),
        index: weekday.index ?? 0,
      };
    }
  }

  // "semana que vem" sozinho: sem dia, não vira data — vira candidato parcial.
  return null;
}

/** Procura hora numa frase já normalizada. Devolve "HH:mm" ou null. */
function findTime(sentence: string, pick: MatchPick = 'first'): Found | null {
  const meioDia = sentence.match(/\bmeio[-\s]?dia\b/);
  if (meioDia) return { value: '12:00', index: meioDia.index ?? 0 };

  /*
   * "15h", "15h30", "15:00", "as 9h", "16 horas", "16 horas da tarde".
   *
   * "horas?" TEM que vir antes de "h" na alternativa: só "h" também bate com
   * o "h" inicial da palavra "horas", mas aí o \b final cai no meio da
   * palavra ("h|oras") e nunca fecha — a hora inteira era descartada em
   * silêncio sempre que alguém dizia "16 horas" por extenso em vez de "16h".
   */
  const numeric = pickMatch(sentence, /\b(\d{1,2})\s*(?:horas?|h|:)\s*(\d{2})?\b/, pick);
  if (numeric) {
    const hour = Number(numeric[1]);
    const minute = numeric[2] ? Number(numeric[2]) : 0;
    if (hour <= 23 && minute <= 59) {
      const hh = String(applyPeriod(hour, sentence)).padStart(2, '0');
      return { value: `${hh}:${String(minute).padStart(2, '0')}`, index: numeric.index ?? 0 };
    }
  }

  // "as nove da manha", "as tres da tarde"
  const spoken = pickMatch(
    sentence,
    /\bas\s+(uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\b/,
    pick,
  );
  if (spoken) {
    const hour = SPOKEN_HOURS[spoken[1] as string];
    if (hour !== undefined) {
      const hh = String(applyPeriod(hour, sentence)).padStart(2, '0');
      return { value: `${hh}:00`, index: spoken.index ?? 0 };
    }
  }
  return null;
}

/**
 * "três da tarde" é 15h, "nove da noite" é 21h.
 *
 * Sem isto uma reunião marcada para as três da tarde entra no calendário às
 * três da manhã — o tipo de erro que só aparece quando alguém perde a reunião.
 */
function applyPeriod(hour: number, sentence: string): number {
  if (hour === 12) return /\bda (noite|madrugada)\b/.test(sentence) ? 0 : 12;
  if (hour > 12) return hour;
  if (/\bda (tarde|noite)\b/.test(sentence)) return hour < 12 ? hour + 12 : hour;
  // "da manhã" mantém a hora como dita: nove da manhã é 9h.
  return hour;
}

/** A frase fala de agendar PERTO da posição encontrada? */
function intentNear(sentence: string, index: number): boolean {
  const inicio = Math.max(0, index - INTENT_WINDOW);
  const janela = sentence.slice(inicio, index + INTENT_WINDOW);
  return SCHEDULING.some((word) => janela.includes(word));
}

/** Algum veto se aplica a esta frase? Devolve o motivo, para o log. */
function vetoFor(sentence: string): string | null {
  for (const { pattern, why } of NOT_SCHEDULING) {
    if (pattern.test(sentence)) return why;
  }
  return null;
}

function objectiveIn(sentence: string): string | null {
  for (const { pattern, objective } of OBJECTIVE_HINTS) {
    if (pattern.test(sentence)) return objective;
  }
  return null;
}

function matchesAny(sentence: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(sentence));
}

/**
 * A frase cancela a próxima conversa?
 *
 * Exige contexto de agenda junto: "cancelamos o contrato" e "o cliente
 * desmarcou o pedido" são fatos da operação, não a reunião sendo desmarcada.
 */
function cancelamentoEm(sentence: string): boolean {
  if (!matchesAny(sentence, CANCELLATION)) return false;
  if (vetoFor(sentence) !== null) return false;
  return (
    SCHEDULING.some((word) => sentence.includes(word)) ||
    /\b(domingo|segunda|terca|quarta|quinta|sexta|sabado|amanha|hoje)\b/.test(sentence) ||
    // "cancelamos" sozinho, sem objeto, numa conversa comercial é a reunião.
    /^(entao\s+)?(vamos\s+)?cancel|^(entao\s+)?(vamos\s+)?desmarc/.test(sentence.trim())
  );
}

/**
 * Quebra a fala em unidades analisáveis.
 *
 * Pontuação final quando existe; as legendas do Meet muitas vezes não a têm, e
 * nesse caso a fala inteira é uma unidade — a checagem de proximidade
 * (`intentNear`) é o que impede um parágrafo longo de casar coisas distantes.
 */
function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Distância máxima, em falas, para fundir data e hora ditas em separado. */
const MERGE_WINDOW = 2;

/**
 * Funde candidatos ADJACENTES que se completam.
 *
 * "Fica pra quinta" … "às 14h então" são duas falas do MESMO agendamento, e
 * separá-las perderia o compromisso. O mesmo vale no sentido contrário:
 * "pode ser às 15h?" … "quinta então, fechado" — a hora vem primeiro, a data
 * confirma depois. Mas a fusão é a operação mais perigosa daqui — foi ela,
 * feita sem critério, que combinava a data de um vencimento com o horário de
 * uma reunião. Então só acontece quando a continuidade é inequívoca, nos dois
 * sentidos:
 *
 *   - um candidato tem data e não tem hora, e o outro o contrário (ou vice-versa);
 *   - os dois demonstram intenção de agendar;
 *   - estão a no máximo `MERGE_WINDOW` falas de distância;
 *   - NENHUM outro candidato com o mesmo campo (data, ou hora) aparece entre eles.
 *
 * A última condição é o que impede "quinta" … "ou melhor, sexta" … "às 14h" de
 * virar quinta às 14h: com uma data nova no meio, o vínculo se rompeu. Espelhado
 * para hora: "às 15h" … "ou melhor, às 16h" … "quinta" não pode virar 15h.
 */
function merge(candidatos: SchedulingCandidate[]): SchedulingCandidate[] {
  const saida: SchedulingCandidate[] = [];
  const usados = new Set<number>();

  for (let i = 0; i < candidatos.length; i += 1) {
    if (usados.has(i)) continue;
    const atual = candidatos[i] as SchedulingCandidate;

    if (atual.date !== null && atual.time === null) {
      for (let j = i + 1; j < candidatos.length; j += 1) {
        const proximo = candidatos[j] as SchedulingCandidate;
        const distancia = proximo.order - atual.order;
        if (distancia > MERGE_WINDOW) break;
        // Data nova no meio: o vínculo se rompeu, e fundir seria inventar.
        if (proximo.date !== null && proximo.date !== atual.date) break;
        if (proximo.time === null) continue;
        if (!proximo.schedulingIntent) continue;
        /*
         * Uma CORREÇÃO não se funde: ela substitui. Fundi-la aqui daria o
         * horário novo à data velha e a correção sumiria sem deixar rastro.
         */
        if (proximo.correction) break;

        usados.add(j);
        usados.add(i);
        saida.push({
          ...atual,
          time: proximo.time,
          objective: atual.objective ?? proximo.objective,
          evidence: [...atual.evidence, ...proximo.evidence],
          confirmed: atual.confirmed || proximo.confirmed,
          hedged: atual.hedged || proximo.hedged,
          alternatives: atual.alternatives || proximo.alternatives,
        });
        break;
      }
    } else if (atual.time !== null && atual.date === null) {
      /*
       * O ESPELHO do caso acima: a HORA foi dita primeiro ("pode ser às
       * 15h?"), e a DATA veio depois, junto da confirmação ("quinta então,
       * fechado"). Antes desta metade, esse padrão nunca fundia — a data
       * ficava presa como candidato à parte e a hora se perdia. Mesmos
       * critérios de segurança do caso original, na direção oposta.
       */
      for (let j = i + 1; j < candidatos.length; j += 1) {
        const proximo = candidatos[j] as SchedulingCandidate;
        const distancia = proximo.order - atual.order;
        if (distancia > MERGE_WINDOW) break;
        // Hora nova no meio: o vínculo se rompeu, espelhando o caso da data.
        if (proximo.time !== null && proximo.time !== atual.time) break;
        if (proximo.date === null) continue;
        if (!proximo.schedulingIntent) continue;
        if (proximo.correction) break;

        usados.add(j);
        usados.add(i);
        saida.push({
          ...atual,
          date: proximo.date,
          objective: atual.objective ?? proximo.objective,
          evidence: [...atual.evidence, ...proximo.evidence],
          confirmed: atual.confirmed || proximo.confirmed,
          hedged: atual.hedged || proximo.hedged,
          alternatives: atual.alternatives || proximo.alternatives,
        });
        break;
      }
    }

    if (!usados.has(i)) saida.push(atual);
  }

  return saida;
}

/**
 * A ESCOLHA — por precedência semântica, não por posição.
 *
 * Percorre os candidatos em ordem mantendo uma fonte de verdade corrente. Um
 * candidato posterior só toma o lugar do atual quando traz um sinal que
 * justifique: correção/remarcação explícita, ou confirmação de uma data nova.
 * Uma segunda data sem nenhum desses sinais NÃO troca nada — marca conflito, e
 * a tela pergunta.
 *
 * É aqui que mora a diferença entre "esquece terça, fica quarta" (remarcação: a
 * quarta é a verdade, a terça fica gravada como substituída) e "podemos terça…
 * a entrega é quinta" (dois assuntos: nada foi remarcado, e ninguém decidiu).
 */
function selecionar(candidatos: SchedulingCandidate[]): {
  vencedor: SchedulingCandidate | null;
  substituidos: SchedulingCandidate[];
  conflicting: boolean;
} {
  let vencedor: SchedulingCandidate | null = null;
  const substituidos: SchedulingCandidate[] = [];
  let conflicting = false;

  for (const c of candidatos) {
    if (vencedor === null) {
      vencedor = c;
      continue;
    }

    // COMPLETA: o corrente ainda não tem data e este traz uma, sem corrigir nada.
    if (vencedor.date === null && c.date !== null && !c.correction) {
      vencedor = {
        ...c,
        time: vencedor.time ?? c.time,
        objective: vencedor.objective ?? c.objective,
        evidence: [...vencedor.evidence, ...c.evidence],
        confirmed: vencedor.confirmed || c.confirmed,
        hedged: vencedor.hedged || c.hedged,
        alternatives: vencedor.alternatives || c.alternatives,
      };
      continue;
    }

    // CORREÇÃO/REMARCAÇÃO: o novo vira a fonte de verdade.
    if (c.correction && (c.date !== null || c.time !== null)) {
      const anterior: SchedulingCandidate = { ...vencedor, state: 'substituida' };
      substituidos.push(anterior);
      vencedor = {
        ...c,
        /*
         * Correção só de DATA mantém a hora; só de HORA mantém a data. É o que
         * "esquece terça, fica quarta" (mesma hora) e "melhor às 16h" (mesmo
         * dia) significam para quem falou — e inventar o campo que faltou seria
         * exatamente o que este arquivo existe para não fazer.
         */
        date: c.date ?? vencedor.date,
        time: c.time ?? vencedor.time,
        /*
         * O compromisso não foi retirado, só mudou de lugar: uma remarcação de
         * algo que estava fechado continua fechada, a menos que a própria
         * correção hesite ("na verdade talvez quinta").
         */
        confirmed: c.confirmed || (vencedor.confirmed && !c.hedged),
        objective: c.objective ?? vencedor.objective,
        supersedes: anterior.id,
      };
      continue;
    }

    // Mesma data: acrescenta o que faltava (hora, confirmação, objetivo).
    if (c.date !== null && c.date === vencedor.date) {
      vencedor = {
        ...vencedor,
        time: vencedor.time ?? c.time,
        objective: vencedor.objective ?? c.objective,
        evidence: [...vencedor.evidence, ...c.evidence],
        confirmed: vencedor.confirmed || c.confirmed,
        hedged: vencedor.hedged || c.hedged,
        alternatives: vencedor.alternatives || c.alternatives,
      };
      continue;
    }

    // CONFIRMAÇÃO de uma data nova: fecha o assunto sem precisar de "na verdade".
    if (c.date !== null && c.confirmed && !c.hedged) {
      const anterior: SchedulingCandidate = { ...vencedor, state: 'substituida' };
      substituidos.push(anterior);
      vencedor = { ...c, supersedes: anterior.id };
      continue;
    }

    // Data DIFERENTE sem correção e sem confirmação: ninguém decidiu.
    if (c.date !== null && c.date !== vencedor.date) {
      conflicting = true;
      if (c.hedged || c.alternatives) {
        vencedor = { ...vencedor, hedged: true };
      }
      continue;
    }

    // Sobrou hora solta longe da data: não funde (seria o defeito antigo).
    if (c.hedged || c.alternatives) vencedor = { ...vencedor, hedged: true };
  }

  return { vencedor, substituidos, conflicting };
}

/** O candidato tem data e hora no futuro em relação à âncora? */
function isFuture(candidate: SchedulingCandidate, anchorMs: number): boolean {
  if (candidate.date === null) return false;
  const date = civilFromIso(candidate.date);
  if (date === null) return false;
  const [hh, mm] = (candidate.time ?? '23:59').split(':').map(Number);
  /*
   * O instante é resolvido NO FUSO DA REUNIÃO. Antes era
   * `Date.parse('2026-09-18T14:00:00')` — sem offset, o que o motor interpreta
   * no fuso de quem executa e compara com um epoch absoluto. O mesmo candidato
   * dava respostas diferentes na extensão e no servidor.
   */
  const quando = civilToInstant(date, { hour: hh ?? 23, minute: mm ?? 59 }, candidate.timezone);
  return Number.isFinite(quando) && quando > anchorMs;
}

/**
 * A hipótese da próxima reunião, lida da transcrição inteira.
 *
 * @param anchorMs quando a reunião aconteceu — é contra ela que "terça" e
 *   "amanhã" são resolvidos. Nunca use `Date.now()` aqui: reprocessar a mesma
 *   transcrição amanhã tem que dar a mesma data.
 * @param timezone o fuso IANA da reunião. É o que transforma `anchorMs` no DIA
 *   local certo — sem ele, uma reunião de fim de noite resolve para o dia
 *   seguinte no servidor e para o dia certo na extensão.
 */
export function detectNextMeeting(
  segments: readonly Pick<TranscriptSegment, 'text'>[],
  anchorMs: number,
  timezone: string = resolveLocalTimezone(),
): NextMeetingHypothesis {
  /*
   * A ÂNCORA é o dia LOCAL da reunião, no fuso dela. Esta linha é a correção do
   * defeito mais antigo do arquivo: `new Date(ms).getDate()` lia o fuso do
   * processo, e uma reunião às 22h em Recife virava o dia seguinte no backend.
   */
  const anchor = civilFromIso(localDayOf(anchorMs, timezone));
  if (anchor === null) return { ...NAO_DEFINIDA, timezone };

  const brutos: SchedulingCandidate[] = [];
  /** Posições das falas que cancelam e das que adiam a decisão. */
  const cancelamentos: number[] = [];
  const adiamentos: number[] = [];
  let posicao = 0;

  for (const segment of segments) {
    for (const raw of sentencesOf(segment.text)) {
      posicao += 1;
      const sentence = normalize(raw);

      if (cancelamentoEm(sentence)) cancelamentos.push(posicao);
      if (matchesAny(sentence, DEFERRAL)) adiamentos.push(posicao);

      /*
       * Numa frase de CORREÇÃO, o que vale é a ÚLTIMA menção: "esquece terça,
       * fica quarta" está mudando PARA quarta. Ler a primeira devolveria
       * exatamente a data que acabou de ser descartada.
       */
      const corrige = matchesAny(sentence, CORRECTION);
      const pick: MatchPick = corrige ? 'last' : 'first';
      const date = findDate(sentence, anchor, pick);
      const time = findTime(sentence, pick);
      if (date === null && time === null) continue;

      // O VETO vence a intenção: vencimento, rotina, duração e passado não são
      // agendamento, mesmo quando a frase também fala de conversar.
      if (vetoFor(sentence) !== null) continue;

      /*
       * A INTENÇÃO é obrigatória, e precisa estar PERTO.
       *
       * Nem data explícita nem horário provam reunião sozinhos — "o contrato
       * vence 18/09" e "trabalhamos das 8h às 18h" são exatamente isso. E a
       * proximidade importa porque uma legenda do Meet sem pontuação pode ser um
       * parágrafo inteiro.
       */
      const ancoraIntencao = date?.index ?? time?.index ?? 0;
      /*
       * Uma CORREÇÃO é intenção de agendar por definição — "em vez de terça,
       * quarta" não contém nenhum verbo de marcar, e ainda assim é uma
       * remarcação. Os padrões de `CORRECTION` têm fronteira de palavra, então
       * servem de portão sem o risco de substring que a lista `SCHEDULING` tem.
       */
      if (!corrige && !intentNear(sentence, ancoraIntencao)) continue;

      /*
       * "Terça OU quinta" são duas opções em aberto. "Esquece terça, fica
       * quarta" tem os mesmos dois dias na frase e não é alternativa nenhuma —
       * é uma troca já decidida. Sem esta distinção toda remarcação nascia
       * marcada como hesitação e nunca chegava a `confirmada`.
       */
      const alternativas = !corrige && alternativesIn(sentence);
      brutos.push({
        id: `c${brutos.length + 1}`,
        order: posicao,
        date: date?.value ?? null,
        time: time?.value ?? null,
        timezone,
        objective: objectiveIn(sentence),
        evidence: [raw.trim()],
        schedulingIntent: true,
        // Confirmação e hesitação são DESTE candidato, não da conversa inteira.
        confirmed: CONFIRMATION.some((verb) => sentence.includes(verb)),
        hedged: HEDGING.some((word) => sentence.includes(word)) || alternativas,
        alternatives: alternativas,
        correction: corrige,
        conflicting: false,
        state: 'proposta',
        supersedes: null,
      });
    }
  }

  if (brutos.length === 0) {
    /*
     * Ninguém propôs nada. Um cancelamento ou um "ainda não definimos" sem
     * candidato nenhum não muda a resposta: continua `nao_definida`.
     */
    return { ...NAO_DEFINIDA, timezone };
  }

  const { vencedor, substituidos, conflicting } = selecionar(merge(brutos));
  if (vencedor === null) return { ...NAO_DEFINIDA, timezone };

  /*
   * CANCELAMENTO e ADIAMENTO só valem quando vêm DEPOIS do que foi combinado.
   * "Cancelamos a de ontem, e vamos marcar quinta" não desmarca a quinta.
   */
  const ultimaEvidencia = vencedor.order;
  const cancelada = cancelamentos.some((p) => p > ultimaEvidencia);
  const adiada = !cancelada && adiamentos.some((p) => p > ultimaEvidencia);

  const noPassado = vencedor.date !== null && !isFuture(vencedor, anchorMs);

  if (cancelada) {
    /*
     * A conversa desmarcou. A data continua no candidato para auditoria — e para
     * o motor saber QUAL evento cancelar no calendário — mas não há compromisso.
     */
    const candidate: SchedulingCandidate = { ...vencedor, conflicting, state: 'cancelada' };
    return {
      found: false,
      status: 'cancelada',
      date: null,
      time: null,
      timezone,
      confidence: 'nenhuma',
      evidence: candidate.evidence[0] ?? null,
      candidate,
      superseded: substituidos,
      missing: ['data', 'hora'],
    };
  }

  if (adiada) {
    // Disseram em voz alta que ainda não definiram. A resposta honesta é essa,
    // não a última data que passou perto do assunto.
    const candidate: SchedulingCandidate = { ...vencedor, conflicting, state: 'nao_definida' };
    return {
      ...NAO_DEFINIDA,
      timezone,
      evidence: candidate.evidence[0] ?? null,
      candidate,
      superseded: substituidos,
    };
  }

  const missing: MissingField[] = [];
  if (vencedor.date === null || noPassado) missing.push('data');
  if (vencedor.time === null) missing.push('hora');
  if (!vencedor.confirmed || vencedor.hedged || conflicting || noPassado) {
    missing.push('confirmacao');
  }

  /*
   * CONFIRMADA exige tudo junto: intenção, data, hora, confirmação, ausência de
   * conflito e horário futuro. E, mesmo assim, a tela pede confirmação humana
   * antes de criar evento — "confirmada por evidência" é o que a conversa disse,
   * não autorização para escrever na agenda de alguém.
   */
  const confirmada =
    vencedor.date !== null &&
    vencedor.time !== null &&
    vencedor.confirmed &&
    !vencedor.hedged &&
    !conflicting &&
    !noPassado;

  const status: NextMeetingStatus = confirmada ? 'confirmada' : 'parcial';
  const candidate: SchedulingCandidate = {
    ...vencedor,
    conflicting,
    state: status,
  };

  return {
    found: true,
    status,
    date: vencedor.date,
    time: vencedor.time,
    timezone,
    confidence: confirmada ? 'alta' : 'parcial',
    evidence: candidate.evidence[0] ?? null,
    candidate,
    superseded: substituidos,
    missing: confirmada ? [] : missing,
  };
}

/** O fuso de quem capturou. Declarado, nunca adivinhado do texto. */
export { resolveLocalTimezone as resolveTimezone };
