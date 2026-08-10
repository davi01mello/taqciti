import type { DocumentTemplate } from './types';

/**
 * O comentário que já existia em generateDocument.ts não diz nada sobre
 * "review" além do rótulo. Sem texto pra extrair, `guidance` fica vazio de
 * propósito — não inventei conteúdo (ver observação na resposta).
 *
 * `audit`/`askWhenMissing`/`omitWhenEmpty`: placeholders neutros pra
 * satisfazer o SectionSpec estendido (rodada da Ata) — review não muda de
 * conteúdo nesta rodada, ver observação na resposta.
 */
export const review: DocumentTemplate = {
  documentType: 'review',
  label: 'Review',
  sections: [
    {
      id: 'documento',
      title: 'Review',
      order: 0,
      required: true,
      needs: [],
      guidance: '',
      audit: 'none',
      askWhenMissing: [],
      omitWhenEmpty: false,
    },
  ],
};
