/**
 * ÚNICO lugar que decide "o que" o documento pós-reunião vira. Nesta fase é
 * um stub fixo por tipo, só pra provar que a transcrição E o tipo certo
 * chegaram de verdade no servidor (mostra a contagem de caracteres
 * recebida). Quando a IA de verdade entrar (fase futura, com chave de API),
 * cada `documentType` aqui dentro vira um prompt/instrução diferente — esta
 * continua sendo a única função que muda, a rota em
 * app/api/generate/route.ts não precisa mudar nada.
 */
export const DOCUMENT_TYPES = ['ata', 'x1', 'daily', 'planning', 'review'] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export function isDocumentType(value: unknown): value is DocumentType {
  return (
    typeof value === 'string' && (DOCUMENT_TYPES as readonly string[]).includes(value)
  );
}

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  ata: 'Ata de Reunião',
  x1: 'Doc Conversa (X1)',
  daily: 'Daily',
  planning: 'Planning',
  review: 'Review',
};

// Cabeçalho do stub por tipo — quando a IA real entrar, cada um destes vira
// o ponto de partida de um prompt diferente (ex: "ata" pede resumo +
// decisões + próximos passos; "x1" pede tom de conversa individual; "daily"
// pede formato ontem/hoje/bloqueios etc.).
const STUB_HEADINGS: Record<DocumentType, string> = {
  ata: '## Ata de Reunião (stub)',
  x1: '## Doc de Conversa 1:1 — X1 (stub)',
  daily: '## Daily (stub)',
  planning: '## Planning (stub)',
  review: '## Review (stub)',
};

export interface GenerateDocumentInput {
  transcript: string;
  title?: string;
  date?: string;
  documentType: DocumentType;
}

export interface GenerateDocumentResult {
  title: string;
  content: string;
}

export function generateDocument(input: GenerateDocumentInput): GenerateDocumentResult {
  const label = DOCUMENT_TYPE_LABELS[input.documentType];
  const title = input.title ? `${label} — ${input.title}` : `${label} (teste)`;

  const content = [
    STUB_HEADINGS[input.documentType],
    '',
    `Transcrição recebida com ${input.transcript.length} caracteres.`,
    input.date ? `Data informada: ${input.date}.` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return { title, content };
}
