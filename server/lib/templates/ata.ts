import type { DocumentTemplate } from './types';

/**
 * `guidance` vem do comentário que já existia em generateDocument.ts antes
 * desta extração: "'ata' pede resumo + decisões + próximos passos". Ainda
 * 1 seção só — as nove seções reais (identificação, participantes,
 * decisões etc.) dependem do PDF do modelo e da especificação do DocCiti,
 * que não chegaram nesta rodada (ver observação na resposta). Divisão fica
 * pra quando os dois anexos estiverem disponíveis.
 *
 * `audit`/`askWhenMissing`/`omitWhenEmpty`: placeholders neutros só pra
 * satisfazer o SectionSpec estendido — mesma ressalva do `guidance` acima,
 * não é decisão de conteúdo real pra esta seção-tronco única.
 */
export const ata: DocumentTemplate = {
  documentType: 'ata',
  label: 'Ata de Reunião',
  sections: [
    {
      id: 'documento',
      title: 'Ata de Reunião',
      order: 0,
      required: true,
      needs: [],
      guidance: 'Resumo, decisões e próximos passos.',
      audit: 'none',
      askWhenMissing: [],
      omitWhenEmpty: false,
    },
  ],
};
