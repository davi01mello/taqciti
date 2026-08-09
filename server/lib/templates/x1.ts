import type { DocumentTemplate } from './types';

/**
 * `guidance` vem do comentário que já existia em generateDocument.ts:
 * "'x1' pede tom de conversa individual". Não há mais nada especificado
 * pra x1 no código atual além disso.
 */
export const x1: DocumentTemplate = {
  documentType: 'x1',
  label: 'Doc Conversa (X1)',
  sections: [
    {
      id: 'documento',
      // Título preserva o texto exato do STUB_HEADINGS pré-extração
      // ("Doc de Conversa 1:1 — X1"), diferente do `label` do template
      // ("Doc Conversa (X1)") — mantém o heading do stub idêntico ao de
      // antes da extração.
      title: 'Doc de Conversa 1:1 — X1',
      order: 0,
      required: true,
      needs: [],
      guidance: 'Tom de conversa individual.',
    },
  ],
};
