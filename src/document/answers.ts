/**
 * As lacunas e perguntas que o servidor devolve junto com um documento gerado.
 *
 * Só os tipos: a tela que respondia essas perguntas na extensão saiu com a
 * página antiga de documento (ver `main.tsx`). O servidor continua mandando
 * os campos, e `generateDocument.ts` os carrega adiante.
 */

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
