/**
 * Auditor: uma afirmação está sustentada pelo trecho ORIGINAL da reunião?
 *
 * Roda somente em seções `audit: 'strict'` — hoje Participantes e Decisões.
 *
 * O Auditor lê o trecho original, NÃO a compactação. Se validasse contra o
 * contexto compactado estaria auditando uma interpretação, e nunca detectaria
 * erro introduzido na própria compactação. É a razão de a âncora existir.
 *
 * Ele é genérico: não conhece "participante" nem "decisão". Recebe um texto e
 * os ids que o sustentam, recupera os `CompactedStatement`, usa a âncora para
 * recortar a transcrição bruta com folga, e pergunta.
 */
import type { CompactedStatement } from '../compactedContext';
import { complete, type CompletionResult, type JsonSchema } from '../ai';
import { renderPrompt } from '../prompts';
import { excerptFor } from './anchoring';
import type { AuditableClaim } from '../documentData';

/** Folga em volta da âncora. A citação sozinha costuma ser curta demais para
 *  julgar: "Concordo." não diz com o quê, e é justamente a concordância que
 *  transforma proposta em decisão. */
export const EXCERPT_PADDING_CHARS = 400;

const VERDICT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    supported: { type: 'boolean' },
    reason: { type: 'string', description: 'Uma frase.' },
  },
  required: ['supported', 'reason'],
};

export interface AuditVerdict {
  path: string;
  supported: boolean;
  reason: string;
  /** O trecho que foi julgado. Guardado para o relatório: sem ele, um veredito
   *  discutível é impossível de rever sem repetir a chamada. */
  excerpt: string;
  meta?: CompletionResult['meta'];
  usage?: CompletionResult['usage'];
}

export interface AuditarInput {
  claims: AuditableClaim[];
  statements: CompactedStatement[];
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

/**
 * Monta o trecho a julgar a partir das âncoras das afirmações vinculadas.
 *
 * Afirmação suspeita (`anchor: null`) é ignorada aqui — ela nem deveria ter
 * chegado ao Pensante. Quando NENHUMA âncora sobra, não há trecho e a
 * afirmação é rejeitada sem gastar chamada: sem evidência não há o que
 * auditar, e aprovar por omissão é o oposto do propósito.
 */
export function buildExcerpt(
  claim: AuditableClaim,
  byId: Map<string, CompactedStatement>,
  transcript: string,
  padding: number,
): string | null {
  const anchors = claim.statementIds
    .map((id) => byId.get(id)?.anchor)
    .filter((anchor): anchor is NonNullable<typeof anchor> => Boolean(anchor));

  if (anchors.length === 0) return null;

  // Trechos em ordem, sem repetir sobreposição: duas âncoras vizinhas
  // renderiam o mesmo parágrafo duas vezes e só gastariam token.
  const ranges = anchors
    .map((a) => ({
      start: Math.max(0, a.start - padding),
      end: Math.min(transcript.length, a.end + padding),
    }))
    .sort((a, b) => a.start - b.start);

  const merged: typeof ranges = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }

  return merged.map((r) => excerptFor(transcript, r)).join('\n\n[...]\n\n');
}

export async function auditar(input: AuditarInput): Promise<AuditarResult> {
  const byId = new Map(input.statements.map((s) => [s.id, s]));
  const padding = input.padding ?? EXCERPT_PADDING_CHARS;
  const system = renderPrompt('auditor', input.promptVersion ?? 'v1');

  const verdicts: AuditVerdict[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  const calls: CompletionResult['meta'][] = [];

  for (const claim of input.claims) {
    const excerpt = buildExcerpt(claim, byId, input.transcript, padding);

    if (excerpt === null) {
      verdicts.push({
        path: claim.path,
        supported: false,
        reason:
          'Nenhuma âncora localizável sustenta esta afirmação — não há trecho da ' +
          'transcrição para conferir.',
        excerpt: '',
      });
      continue;
    }

    const result = await complete('auditor', {
      system,
      messages: [
        {
          role: 'user',
          content: [
            '# Trecho da transcrição',
            '',
            excerpt,
            '',
            '# Afirmação a conferir',
            '',
            claim.text,
          ].join('\n'),
        },
      ],
      maxTokens: 2_000,
      jsonSchema: VERDICT_SCHEMA,
    });

    const parsed = (result.parsed ?? {}) as { supported?: boolean; reason?: string };
    calls.push(result.meta);
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    usage.cachedInputTokens += result.usage.cachedInputTokens ?? 0;

    verdicts.push({
      path: claim.path,
      // Resposta malformada conta como NÃO sustentada. Na dúvida, rejeitar:
      // afirmação descartada vira lacuna, aprovada por engano vira fato
      // inventado num documento que será lido como registro da reunião.
      supported: parsed.supported === true,
      reason: parsed.reason ?? '(sem justificativa)',
      excerpt,
      meta: result.meta,
      usage: result.usage,
    });
  }

  return {
    verdicts,
    rejected: verdicts.filter((v) => !v.supported),
    usage,
    calls,
  };
}
