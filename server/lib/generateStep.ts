/**
 * PONTO ÚNICO DE TROCA quando a geração de verdade (rede de agentes) entrar.
 *
 * Contrato pensado pra chunking: cada chamada pode devolver UMA seção (ou
 * um lote) com `done: false`, e quem chama laça até `done: true`,
 * acumulando em `completed` e repassando `answers` de perguntas já
 * respondidas. Nesta rodada faz tudo numa PASSADA SÓ: devolve todas as
 * seções do template de uma vez, sempre `done: true`, nunca gera pergunta
 * — a geração em si ainda é stub (ver server/lib/templates/).
 *
 * `completed`, `answers`, `questions` e `done` existem e são respeitados no
 * contrato mesmo sem uso real ainda. NÃO REMOVER por parecerem inúteis
 * hoje: é o mesmo laço do lado de quem chama (generateDocument.ts) nos
 * dois casos, passada única ou chunked de verdade.
 */
import type { DocumentType } from './documentTypes';
import { TEMPLATES } from './templates';
import type { SectionSpec } from './templates/types';

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
  /** Seções já prontas de passadas anteriores, pra coerência entre seções.
   *  Vazio é o caso normal desta rodada (passada única) — não é tratado
   *  como "primeira chamada" especial, só não há nada ainda pra reaproveitar. */
  completed: RenderedSection[];
  /** Respostas a perguntas de passadas anteriores. Vazio é o caso normal
   *  desta rodada — mesmo raciocínio de `completed`. */
  answers: Answer[];
}

export interface GenerateStepResult {
  sections: RenderedSection[];
  questions: Question[];
  done: boolean;
}

function renderSectionStub(section: SectionSpec, transcript: string): RenderedSection {
  return {
    id: section.id,
    title: section.title,
    content: `## ${section.title} (stub)\n\nTranscrição recebida com ${transcript.length} caracteres.`,
    confidence: 'ok',
  };
}

export async function generateStep(
  input: GenerateStepInput,
): Promise<GenerateStepResult> {
  const template = TEMPLATES[input.documentType];

  const sections = template.sections
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((section) => renderSectionStub(section, input.transcript));

  return { sections, questions: [], done: true };
}
