/**
 * Auditor: uma afirmação está sustentada pelo trecho ORIGINAL da reunião?
 *
 * Roda somente em seções `audit: 'strict'` — hoje Participantes e Decisões —
 * e é a única segunda opinião que sobrou no pipeline. Fica porque não é
 * redundante com o Leitor: ele julga uma afirmação vendo SÓ o trecho citado,
 * o que pega exatamente o erro que quem leu a reunião inteira não vê em si
 * mesmo (o cargo deduzido do tom, a concordância que era de outro assunto).
 *
 * O Auditor lê o trecho original, e só ele. Se validasse contra uma paráfrase
 * estaria auditando uma interpretação, e nunca detectaria erro introduzido na
 * própria interpretação. É a razão de a âncora existir.
 *
 * Ele é genérico: não conhece "participante" nem "decisão". Recebe um texto e
 * as âncoras que o sustentam, recorta a transcrição bruta com folga, marca
 * dentro do recorte exatamente o que foi citado, e pergunta.
 */
import { complete, type CompletionResult, type JsonSchema } from '../ai';
import { renderPrompt } from '../prompts';
import type { LocatedAnchor } from './anchoring';
import type { AuditableClaim } from '../documentData';

/**
 * Folga em volta da âncora. A citação sozinha costuma ser curta demais para
 * julgar: "Concordo." não diz com o quê.
 *
 * A folga NÃO é mais o que carrega a evidência de concordância — quem carrega
 * é `Decision.agreement`, uma citação própria e ancorada. Aqui ela serve só
 * para dar vizinhança legível, e o que foi realmente citado vem marcado entre
 * `⟦ ⟧` para o Auditor julgar centrado nisso. Foi por essa distinção não
 * existir que uma proposta passou como decisão: com 400 caracteres de folga,
 * quase sempre há ALGUMA concordância por perto, inclusive de outro assunto.
 */
export const EXCERPT_PADDING_CHARS = 400;

/** Delimitadores do que foi citado, dentro do trecho. Escolhidos por não
 *  aparecerem em transcrição de reunião — marcador que colide com o texto
 *  transformaria fala do participante em instrução. */
export const QUOTE_OPEN = '⟦';
export const QUOTE_CLOSE = '⟧';

const VERDICTS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'O id da afirmação julgada.' },
          supported: { type: 'boolean' },
          reason: { type: 'string', description: 'Uma frase.' },
        },
        required: ['id', 'supported', 'reason'],
      },
    },
  },
  required: ['verdicts'],
};

export interface AuditVerdict {
  path: string;
  supported: boolean;
  reason: string;
  /** O trecho que foi julgado. Guardado para o relatório: sem ele, um veredito
   *  discutível é impossível de rever sem repetir a chamada. */
  excerpt: string;
  /** A chamada (única) em que este veredito saiu. Ausente = decidido em código. */
  meta?: CompletionResult['meta'];
}

export interface AuditarInput {
  claims: AuditableClaim[];
  transcript: string;
  promptVersion?: `v${number}`;
  padding?: number;
}

export interface AuditarResult {
  verdicts: AuditVerdict[];
  rejected: AuditVerdict[];
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
  calls: CompletionResult['meta'][];
}

interface Range {
  start: number;
  end: number;
}

/**
 * Monta o trecho a julgar a partir das âncoras da afirmação.
 *
 * Devolve `null` quando não há âncora nenhuma: sem evidência não há o que
 * auditar, e aprovar por omissão é o oposto do propósito.
 */
export function buildExcerpt(
  anchors: LocatedAnchor[],
  transcript: string,
  padding: number,
): string | null {
  if (anchors.length === 0) return null;

  // Trechos em ordem, sem repetir sobreposição: duas âncoras vizinhas
  // renderiam o mesmo parágrafo duas vezes e só gastariam token.
  const ranges: Range[] = anchors
    .map((a) => ({
      start: Math.max(0, a.start - padding),
      end: Math.min(transcript.length, a.end + padding),
    }))
    .sort((a, b) => a.start - b.start);

  const merged: Range[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }

  const ordered = [...anchors].sort((a, b) => a.start - b.start);

  return merged.map((range) => renderRange(transcript, range, ordered)).join('\n\n[...]\n\n');
}

/** Recorta o intervalo marcando, dentro dele, o que foi de fato citado. */
function renderRange(transcript: string, range: Range, anchors: LocatedAnchor[]): string {
  let out = '';
  let cursor = range.start;

  for (const anchor of anchors) {
    // Âncora fora deste intervalo, ou já engolida por uma anterior que se
    // sobrepunha a ela — marcar de novo abriria delimitador dentro de
    // delimitador.
    if (anchor.start < cursor || anchor.end > range.end) continue;
    out += transcript.slice(cursor, anchor.start);
    out += `${QUOTE_OPEN}${transcript.slice(anchor.start, anchor.end)}${QUOTE_CLOSE}`;
    cursor = anchor.end;
  }

  return out + transcript.slice(cursor, range.end);
}

/**
 * UMA chamada para todas as afirmações, e não uma por afirmação.
 *
 * Antes eram ~11 chamadas por Ata (um participante ou uma decisão cada), e em
 * todas o prompt de sistema inteiro ia de novo para julgar um trecho de 800
 * caracteres. O julgamento continua sendo por afirmação — cada uma leva o seu
 * trecho e o prompt proíbe usar o trecho de uma como evidência de outra —; o
 * que se junta é só o envelope.
 */
export async function auditar(input: AuditarInput): Promise<AuditarResult> {
  const padding = input.padding ?? EXCERPT_PADDING_CHARS;

  const verdicts: AuditVerdict[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  const calls: CompletionResult['meta'][] = [];

  const aJulgar: { id: string; claim: AuditableClaim; excerpt: string }[] = [];

  for (const claim of input.claims) {
    // Rejeição decidida em CÓDIGO. Hoje: decisão cuja concordância não existe
    // na transcrição. Não é opinião do modelo, é ausência de evidência — e
    // gastar token para confirmar o que já se sabe seria só custo.
    if (claim.blocker) {
      verdicts.push({ path: claim.path, supported: false, reason: claim.blocker, excerpt: '' });
      continue;
    }

    const excerpt = buildExcerpt(claim.anchors, input.transcript, padding);

    if (excerpt === null) {
      verdicts.push({
        path: claim.path,
        supported: false,
        reason:
          'Nenhuma citação localizável sustenta esta afirmação — não há trecho da ' +
          'transcrição para conferir.',
        excerpt: '',
      });
      continue;
    }

    // Id curto e sem significado: o path (`participants[0]`) no lugar dele
    // convidaria o modelo a julgar pelo nome do campo.
    aJulgar.push({ id: `a${aJulgar.length + 1}`, claim, excerpt });
  }

  if (aJulgar.length > 0) {
    const result = await complete('auditor', {
      system: renderPrompt('auditor', input.promptVersion ?? 'v3'),
      messages: [
        {
          role: 'user',
          content: aJulgar
            .map(({ id, claim, excerpt }) =>
              [
                `# Afirmação ${id}`,
                '',
                '## Trecho da transcrição',
                '',
                excerpt,
                '',
                '## Afirmação a conferir',
                '',
                claim.text,
              ].join('\n'),
            )
            .join('\n\n---\n\n'),
        },
      ],
      maxTokens: 2_000 + aJulgar.length * 500,
      jsonSchema: VERDICTS_SCHEMA,
    });

    calls.push(result.meta);
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    usage.cachedInputTokens += result.usage.cachedInputTokens ?? 0;

    const porId = new Map<string, { supported?: unknown; reason?: unknown }>();
    const lista = ((result.parsed ?? {}) as { verdicts?: unknown }).verdicts;
    for (const v of Array.isArray(lista) ? lista : []) {
      const id = (v as { id?: unknown })?.id;
      // Id repetido: vale o PRIMEIRO. Deixar o último vencer daria ao modelo
      // um jeito de "corrigir" uma rejeição mais abaixo na mesma resposta.
      if (typeof id === 'string' && !porId.has(id)) porId.set(id, v as never);
    }

    for (const { id, claim, excerpt } of aJulgar) {
      const parsed = porId.get(id);
      verdicts.push({
        path: claim.path,
        // Veredito ausente ou malformado conta como NÃO sustentado. Na dúvida,
        // rejeitar: afirmação descartada vira lacuna, aprovada por engano vira
        // fato inventado num documento que será lido como registro da reunião.
        supported: parsed?.supported === true,
        reason:
          typeof parsed?.reason === 'string'
            ? parsed.reason
            : '(o Auditor não devolveu veredito para esta afirmação)',
        excerpt,
        meta: result.meta,
      });
    }
  }

  // Na ordem das afirmações recebidas, não na ordem em que foram decididas.
  const ordem = new Map(input.claims.map((claim, index) => [claim.path, index]));
  verdicts.sort((a, b) => (ordem.get(a.path) ?? 0) - (ordem.get(b.path) ?? 0));

  return {
    verdicts,
    rejected: verdicts.filter((v) => !v.supported),
    usage,
    calls,
  };
}
