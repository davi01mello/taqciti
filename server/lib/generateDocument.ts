/**
 * Fachada fina sobre generateStep: chama em laço até `done`, concatena as
 * seções na ordem do template, devolve `{title, content}` como sempre
 * devolveu. É o atalho "documento inteiro numa tacada" que
 * app/api/generate/route.ts expõe hoje — quem quiser controle fino (uma
 * seção por vez, perguntas, respostas) usa generateStep direto.
 *
 * A decisão de "o que" o documento vira não mora mais aqui: mora nos
 * templates (server/lib/templates/) e em generateStep.ts. Esta função só
 * orquestra e formata o resultado final.
 */
import {
  DOCUMENT_TYPES,
  isDocumentType,
  type DocumentType,
} from './documentTypes';
import { TEMPLATES } from './templates';
import { generateStep, type RenderedSection } from './generateStep';

export { DOCUMENT_TYPES, isDocumentType };
export type { DocumentType };

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

export async function generateDocument(
  input: GenerateDocumentInput,
): Promise<GenerateDocumentResult> {
  const template = TEMPLATES[input.documentType];

  let completed: RenderedSection[] = [];
  let done = false;
  while (!done) {
    const step = await generateStep({
      transcript: input.transcript,
      documentType: input.documentType,
      completed,
      answers: [],
    });
    completed = [...completed, ...step.sections];
    done = step.done;
  }

  const title = input.title ? `${template.label} — ${input.title}` : `${template.label} (teste)`;
  const body = completed.map((section) => section.content).join('\n\n');
  const content = input.date ? `${body}\n\nData informada: ${input.date}.` : body;

  return { title, content };
}
