/**
 * Manda as respostas do usuário ao servidor e recebe o documento atualizado.
 *
 * **Nenhum modelo roda nisso.** As perguntas são sobre campos que ficaram
 * ausentes, a resposta É o valor do campo, e o HTML é reconstruído a partir da
 * estrutura. Responder é instantâneo e não custa nada — e o texto que a pessoa
 * digitou entra exatamente como ela digitou, sem passar por reescrita.
 */
import {
  SERVER_BASE_URL,
  SERVER_SHARED_KEY,
  SERVER_SHARED_KEY_HEADER,
} from '@/shared/config/serverConfig';
import type { DocumentType } from './generateDocument';

export interface Pergunta {
  id: string;
  sectionId: string;
  question: string;
  why: string;
  optional: boolean;
}

/** Lacuna. O `field` é o que o servidor usa para saber onde preencher. */
export interface Lacuna {
  sectionId: string;
  field: string;
  question: string;
  why: string;
}

export interface Resposta {
  questionId: string;
  answer: string;
}

export type AplicarRespostasResult =
  | {
      status: 'success';
      html: string;
      documentData: unknown;
      gaps: Lacuna[];
      questions: Pergunta[];
      /** Respostas que não tinham onde entrar. Nunca somem em silêncio. */
      naoAplicadas: Resposta[];
    }
  | { status: 'error'; message: string };

export async function aplicarRespostas(input: {
  documentType: DocumentType;
  documentData: unknown;
  gaps: Lacuna[];
  answers: Resposta[];
  title: string;
}): Promise<AplicarRespostasResult> {
  try {
    const response = await fetch(`${SERVER_BASE_URL}/api/answers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [SERVER_SHARED_KEY_HEADER]: SERVER_SHARED_KEY,
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const corpo = (await response.json().catch(() => ({}))) as { error?: string };
      return {
        status: 'error',
        message: corpo.error ?? `O servidor respondeu com erro (${response.status}).`,
      };
    }

    const data = (await response.json()) as Omit<
      Extract<AplicarRespostasResult, { status: 'success' }>,
      'status'
    >;
    return { status: 'success', ...data };
  } catch {
    return {
      status: 'error',
      message: 'Não foi possível falar com o servidor para salvar as respostas.',
    };
  }
}
