/**
 * Extraído de generateDocument.ts — os tipos de documento aceitos, sem
 * depender de nada mais (templates/ e generateStep.ts importam daqui, e
 * generateDocument.ts reexporta pra quem já importava de lá continuar
 * funcionando sem mudar import).
 */
export const DOCUMENT_TYPES = ['ata', 'x1', 'daily', 'planning', 'review'] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export function isDocumentType(value: unknown): value is DocumentType {
  return (
    typeof value === 'string' && (DOCUMENT_TYPES as readonly string[]).includes(value)
  );
}
