import type { DocumentTemplate } from './types';

/**
 * `guidance` vem do comentário que já existia em generateDocument.ts antes
 * desta extração: "'ata' pede resumo + decisões + próximos passos". Ainda
 * 1 seção só — o gerador atual nunca produziu mais que um bloco por tipo,
 * então dividir em 3 SectionSpec agora seria inventar estrutura que não
 * está implementada hoje. Esse texto é o ponto de partida natural pra
 * dividir em resumo/decisões/próximos-passos quando a geração real entrar;
 * não fiz a divisão nesta rodada (ver observação na resposta).
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
    },
  ],
};
