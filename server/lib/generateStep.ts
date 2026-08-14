/**
 * PONTO ÚNICO DE TROCA da geração. É aqui que a rede de agentes encosta no
 * contrato de `/api/generate`.
 *
 * Contrato pensado pra chunking: cada chamada pode devolver UMA seção (ou
 * um lote) com `done: false`, e quem chama laça até `done: true`,
 * acumulando em `completed` e repassando `answers` de perguntas já
 * respondidas. Esta implementação faz tudo numa PASSADA SÓ — devolve as
 * seções que faltam e `done: true` — mas `completed` é respeitado de
 * verdade: seção que já veio pronta não é regerada, e as seções seguintes a
 * recebem para não repetir nem contradizer.
 *
 * O pipeline por seção é: Pensante → (Auditor, se `strict`) → Escritor.
 * A transcrição chega ao Pensante e para nele; o Escritor só vê dados já
 * conferidos.
 */
import type { DocumentType } from './documentTypes';
import { TEMPLATES } from './templates';
import type { DocumentData, Gap } from './documentData';
import { runSection } from './agents/sectionPipeline';
import { assertSemVazamento, escrever } from './agents/escritor';

export type SectionConfidence = 'ok' | 'partial' | 'missing';

export interface RenderedSection {
  id: string;
  title: string;
  content: string;
  confidence: SectionConfidence;
}

export interface Question {
  id: string;
  sectionId: string;
  question: string;
  why: string;
  suggestions?: string[];
  optional: boolean;
}

export interface Answer {
  questionId: string;
  answer: string;
}

export interface GenerateStepInput {
  transcript: string;
  documentType: DocumentType;
  /** Seções já prontas de passadas anteriores, pra coerência entre seções. */
  completed: RenderedSection[];
  /** Respostas a perguntas de passadas anteriores. Não se pergunta duas vezes. */
  answers: Answer[];
}

export interface GenerateStepResult {
  sections: RenderedSection[];
  questions: Question[];
  done: boolean;
}

/**
 * A tela de perguntas não existe e **não bloqueia nada**. As perguntas voltam
 * populadas para quando ela existir; enquanto isso, a lacuna aparece marcada
 * dentro do próprio documento.
 */
function questionFor(gap: Gap, required: boolean): Question {
  return {
    id: `${gap.sectionId}:${gap.field}`,
    sectionId: gap.sectionId,
    question: gap.question,
    why: gap.why,
    optional: !required,
  };
}

export async function generateStep(
  input: GenerateStepInput,
): Promise<GenerateStepResult> {
  const template = TEMPLATES[input.documentType];

  const ordenadas = template.sections.slice().sort((a, b) => a.order - b.order);
  const jaPronta = new Set(input.completed.map((s) => s.id));

  // O acumulado atravessa as seções: é o "não perguntar o que já foi
  // determinado" e o "não contradizer o que já foi escrito" da especificação.
  let known: DocumentData = {};
  let completed = [...input.completed];

  const novas: RenderedSection[] = [];
  const questions: Question[] = [];

  for (const section of ordenadas) {
    if (jaPronta.has(section.id)) continue;

    const run = await runSection({
      section,
      transcript: input.transcript,
      known,
      answers: input.answers,
    });
    known = run.data;

    for (const gap of run.gaps) questions.push(questionFor(gap, section.required));

    const escrita = await escrever({
      section,
      data: known,
      gaps: run.gaps,
      completed,
    });

    // `omitWhenEmpty` — a seção sumiu. Some do documento, não do relatório:
    // as perguntas dela já foram acumuladas acima.
    if (!escrita.section) continue;

    novas.push(escrita.section);
    completed = [...completed, escrita.section];
  }

  // Guarda final sobre o documento MONTADO. As seções já foram conferidas uma
  // a uma; esta pega o que só existe na junção — e custa uma varredura de
  // string contra a possibilidade de a instrução do PDF chegar num cliente.
  assertSemVazamento(completed.map((s) => s.content).join('\n\n'), 'o documento montado');

  return { sections: novas, questions, done: true };
}
