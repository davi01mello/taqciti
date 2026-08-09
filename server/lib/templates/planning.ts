import type { DocumentTemplate } from './types';

/**
 * O comentário que já existia em generateDocument.ts não diz nada sobre
 * "planning" além do rótulo (cobre ata/x1/daily e para num "etc."). Sem
 * texto pra extrair, `guidance` fica vazio de propósito — não inventei
 * conteúdo (ver observação na resposta).
 */
export const planning: DocumentTemplate = {
  documentType: 'planning',
  label: 'Planning',
  sections: [
    {
      id: 'documento',
      title: 'Planning',
      order: 0,
      required: true,
      needs: [],
      guidance: '',
    },
  ],
};
