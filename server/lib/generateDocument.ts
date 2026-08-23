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
import { formatarDataDaReuniao } from './dataDaReuniao';
import { renderHtml } from './render/html';
import { renderPdf } from './render/pdf';

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
  /**
   * O mesmo documento em PDF, pronto pra baixar — base64, porque a rota
   * devolve JSON. Ausente quando a geração do PDF falhou: o HTML e o
   * download continuam funcionando, só sem PDF daquela vez (ver o
   * try/catch abaixo).
   */
  pdf?: string;
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

  /*
   * A data entra ANTES do pipeline, não depois.
   *
   * `input.date` é o carimbo real do início da captura, mandado pela extensão.
   * Semeado aqui, ele já está em `documentData` quando a seção Identificação
   * roda: o `merge` dela preserva o que já se sabe, e o `detectGaps` não abre
   * lacuna para um campo preenchido. O resultado é a ata sair com a data certa
   * em vez de `[A preencher: data]` para algo que o servidor tinha na mão.
   *
   * Semear DEPOIS do laço não resolveria: o markdown de cada seção é montado
   * durante o pipeline, então a Identificação já teria sido escrita com a
   * lacuna dentro. Ver `dataDaReuniao.ts` para o fuso, que é onde isto morde.
   */
  const dataDaReuniao = formatarDataDaReuniao(input.date);
  let documentData: DocumentData = dataDaReuniao ? { metadata: { date: dataDaReuniao } } : {};

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
  // Sem "Data informada: <ISO>" no rodapé. Aquilo despejava um timestamp cru
  // ("2026-08-22T14:30:00.000Z") no fim da ata que o cliente lê, e existia
  // porque a data não tinha para onde ir. Agora ela tem: a Identificação.
  const content = completed.map((section) => section.content).join('\n\n');

  const html = renderHtml({ documentType: input.documentType, data: documentData, gaps, title });

  // O HTML sai do `DocumentData`, que veio do Pensante — outro caminho que o
  // do Escritor, e portanto uma segunda porta por onde a instrução de autoria
  // do PDF poderia chegar ao cliente. A guarda vale para os dois.
  assertSemVazamento(html, 'o HTML do documento');

  // Sem `assertSemVazamento` própria aqui: o PDF desenha exatamente os
  // mesmos campos de `documentData` que o HTML acima de já conferiu — texto
  // dentro de um PDF fica em streams comprimidos, então varrer os bytes
  // crus do arquivo não pegaria nada mesmo que houvesse algo (e daria falsa
  // confiança). A garantia real é a fonte ser a mesma, já verificada.
  //
  // Isolado de propósito: o PDF é irmão do HTML, não pré-requisito dele. Se
  // `pdfkit` lançar por qualquer motivo, a geração inteira não pode morrer
  // por causa disso — o HTML e o caminho de download continuam de pé, só
  // sem PDF nesta chamada.
  let pdf: string | undefined;
  try {
    const pdfBuffer = await renderPdf({ documentType: input.documentType, data: documentData, gaps, title });
    pdf = pdfBuffer.toString('base64');
  } catch (error) {
    console.error('[generateDocument] falha ao gerar o PDF — devolvendo sem ele', error);
  }

  return { title, content, documentData, html, pdf, questions, gaps };
}
