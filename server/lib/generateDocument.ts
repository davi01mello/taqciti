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
import {
  generateStep,
  type DocumentData,
  type Gap,
  type Question,
  type RenderedSection,
} from './generateStep';
import { assertSemVazamento } from './agents/escritor';
import { renderHtml } from './render/html';

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
  /** O documento em markdown, como sempre foi. */
  content: string;
  /**
   * A camada canônica. `html` e o PDF da Fase 6 renderizam DAQUI — são
   * irmãos, não um derivado do outro, e nenhum dos dois reparseia o
   * markdown.
   */
  documentData: DocumentData;
  /** O mesmo documento em HTML, no subconjunto que o import do Google Docs
   *  aceita (Drive API `files.create`). */
  html: string;
  /** O que ficou por preencher, para a UI de perguntas. */
  questions: Question[];
  /** As mesmas lacunas com o campo que cada uma ocupa. `POST /api/answers`
   *  precisa delas para saber o que preencher e o que sobrou. */
  gaps: Gap[];
}

export async function generateDocument(
  input: GenerateDocumentInput,
): Promise<GenerateDocumentResult> {
  const template = TEMPLATES[input.documentType];

  let completed: RenderedSection[] = [];
  let documentData: DocumentData = {};
  let questions: Question[] = [];
  let gaps: Gap[] = [];
  let done = false;
  while (!done) {
    const step = await generateStep({
      transcript: input.transcript,
      documentType: input.documentType,
      completed,
      answers: [],
      // Devolvido para a passada seguinte. Sem isto, um laço de mais de uma
      // passada recomeçaria com o acumulado vazio.
      documentData,
    });
    completed = [...completed, ...step.sections];
    documentData = step.documentData;
    questions = [...questions, ...step.questions];
    gaps = [...gaps, ...step.gaps];
    done = step.done;
  }

  const title = input.title ? `${template.label} — ${input.title}` : `${template.label} (teste)`;
  const body = completed.map((section) => section.content).join('\n\n');
  const content = input.date ? `${body}\n\nData informada: ${input.date}.` : body;

  const html = renderHtml({ documentType: input.documentType, data: documentData, gaps, title });

  // O HTML sai do `DocumentData`, que veio do Pensante — outro caminho que o
  // do Escritor, e portanto uma segunda porta por onde a instrução de autoria
  // do PDF poderia chegar ao cliente. A guarda vale para os dois.
  assertSemVazamento(html, 'o HTML do documento');

  return { title, content, documentData, html, questions, gaps };
}
