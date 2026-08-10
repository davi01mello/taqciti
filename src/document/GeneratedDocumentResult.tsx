/**
 * Exibição do resultado de POST /api/generate — mesma marcação que
 * DocumentPage.tsx já usava inline, extraída pra ser reaproveitada onde o
 * menu "Gerar Documento" também aparece (side panel, painel no Meet).
 */
import { DOCUMENT_TYPE_LABELS, type GenerationResult } from './generateDocument';

export function GeneratedDocumentResult({
  result,
}: {
  result: Extract<GenerationResult, { status: 'success' }>;
}) {
  return (
    <div className="mt-6 border-t border-borderc pt-6">
      <p className="mb-3 text-caption font-semibold uppercase tracking-wide text-muted">
        Documento gerado — {DOCUMENT_TYPE_LABELS[result.documentType]}
      </p>
      <h2 className="mb-2 text-title font-bold">{result.title}</h2>
      <p className="whitespace-pre-wrap text-read text-foreground/90">{result.content}</p>
    </div>
  );
}
