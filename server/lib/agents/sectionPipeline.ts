/**
 * O laço Pensante ↔ Auditor de uma seção.
 *
 * Pensante propõe → Auditor rejeita → Pensante tenta de novo com a
 * justificativa da rejeição → se rejeitar outra vez, a afirmação é
 * DESCARTADA e vira lacuna. Nunca entra no documento.
 *
 * **No máximo duas passadas por afirmação.** A especificação pede para evitar
 * ciclo infinito e não define o teto; este é o teto. Descartar é o
 * comportamento correto: uma decisão inventada numa ata é pior que uma ata
 * incompleta.
 *
 * O Auditor só roda em seção `audit: 'strict'` — hoje Participantes e
 * Decisões. Nas demais o Pensante manda sozinho.
 */
import type { CompactedContext } from '../compactedContext';
import type { SectionSpec } from '../templates/types';
import { specForSection, type DocumentData, type Gap } from '../documentData';
import type { Answer } from '../generateStep';
import { auditar, type AuditVerdict } from './auditor';
import { pensar } from './pensante';

export const MAX_PASSES = 2;

export interface SectionRunInput {
  context: CompactedContext;
  section: SectionSpec;
  transcript: string;
  known: DocumentData;
  answers: Answer[];
}

export interface DiscardedClaim {
  path: string;
  text: string;
  reason: string;
}

export interface SectionRunResult {
  data: DocumentData;
  gaps: Gap[];
  /** Quantas passadas do Pensante foram gastas (1 ou 2). */
  passes: number;
  audited: boolean;
  verdicts: AuditVerdict[];
  /** Rejeitadas duas vezes — fora do documento, viraram lacuna. */
  discarded: DiscardedClaim[];
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
}

const zeroUsage = () => ({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });

function addUsage(
  target: { inputTokens: number; outputTokens: number; cachedInputTokens: number },
  source: { inputTokens: number; outputTokens: number; cachedInputTokens?: number },
): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cachedInputTokens += source.cachedInputTokens ?? 0;
}

export async function runSection(input: SectionRunInput): Promise<SectionRunResult> {
  const spec = specForSection(input.section);
  const usage = zeroUsage();

  // Passada 1.
  let attempt = await pensar({
    context: input.context,
    section: input.section,
    known: input.known,
    answers: input.answers,
  });
  addUsage(usage, attempt.usage);

  if (input.section.audit !== 'strict') {
    return {
      data: attempt.data,
      gaps: attempt.gaps,
      passes: 1,
      audited: false,
      verdicts: [],
      discarded: [],
      usage,
    };
  }

  let claims = spec.claims(attempt.data, input.section.id);
  let audit = await auditar({
    claims,
    statements: input.context.statements,
    transcript: input.transcript,
  });
  addUsage(usage, audit.usage);

  if (audit.rejected.length === 0) {
    return {
      data: attempt.data,
      gaps: attempt.gaps,
      passes: 1,
      audited: true,
      verdicts: audit.verdicts,
      discarded: [],
      usage,
    };
  }

  // Passada 2, com as justificativas da rejeição em mãos.
  const rejections = audit.rejected.map((verdict) => {
    const claim = claims.find((c) => c.path === verdict.path);
    return `"${claim?.text ?? verdict.path}" — ${verdict.reason}`;
  });

  attempt = await pensar({
    context: input.context,
    section: input.section,
    known: input.known,
    answers: input.answers,
    rejections,
  });
  addUsage(usage, attempt.usage);

  claims = spec.claims(attempt.data, input.section.id);
  audit = await auditar({
    claims,
    statements: input.context.statements,
    transcript: input.transcript,
  });
  addUsage(usage, audit.usage);

  // Fim do teto: o que ainda está rejeitado sai do documento.
  const rejectedPaths = new Set(audit.rejected.map((v) => v.path));
  const discarded: DiscardedClaim[] = audit.rejected.map((verdict) => ({
    path: verdict.path,
    text: claims.find((c) => c.path === verdict.path)?.text ?? verdict.path,
    reason: verdict.reason,
  }));

  spec.drop(attempt.data, rejectedPaths, input.section.id);

  return {
    data: attempt.data,
    gaps: [...attempt.gaps, ...discardedAsGaps(input.section, discarded)],
    passes: 2,
    audited: true,
    verdicts: audit.verdicts,
    discarded,
    usage,
  };
}

/**
 * Afirmação descartada vira lacuna: o documento precisa mostrar que ali
 * FALTA algo, e não que ali não havia nada. São coisas diferentes para quem
 * lê a ata depois.
 */
function discardedAsGaps(section: SectionSpec, discarded: DiscardedClaim[]): Gap[] {
  return discarded.map((item) => ({
    sectionId: section.id,
    field: item.path,
    question:
      `A afirmação "${item.text}" não foi confirmada pela transcrição. ` +
      'Ela deve constar na ata? Se sim, com que redação?',
    why: `Rejeitada duas vezes pela conferência contra o trecho original: ${item.reason}`,
  }));
}
