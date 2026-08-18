import type { DocumentTemplate } from './types';

/**
 * X1 — documento de entrevista individual: pares pergunta do entrevistador
 * (RH/Gente e Gestão) e resposta do candidato, na ordem em que apareceram.
 *
 * `guidance` aqui é a ÚNICA fonte da regra de extração — o Pensante não
 * conhece o formato de X1 além do que está escrito abaixo. Ver
 * `SECTION_DATA_SPECS['perguntas_respostas']` em `documentData.ts` para como
 * cada par vira dado estruturado e auditável, e `SECTION_RENDERERS` em
 * `render/html.ts` para como cada par vira as duas linhas rotuladas
 * ("Gente e gestão" / "Entrevistado") no documento final.
 */
export const x1: DocumentTemplate = {
  documentType: 'x1',
  label: 'Doc Conversa (X1)',
  // Reaproveita o título que já existia no stub anterior — não é uma marca
  // nova, é o nome que este documento já tinha.
  documentTitle: 'Doc de Conversa 1:1 — X1',
  sections: [
    {
      id: 'perguntas_respostas',
      title: 'Perguntas e respostas',
      order: 1,
      required: true,
      audit: 'strict',
      omitWhenEmpty: true,
      needs: [
        'cada pergunta feita pelo entrevistador/RH',
        'a resposta do candidato a cada pergunta',
      ],
      guidance: [
        'Esta é uma transcrição de ENTREVISTA individual, não de reunião de equipe.',
        'Identifique CADA pergunta feita pelo entrevistador (RH/Gente e Gestão) ao',
        'candidato, na ordem em que aparecem na conversa, e a resposta que o candidato',
        'deu a cada uma.',
        'Uma pergunta pode ter sido reformulada ou repetida — trate como UMA pergunta',
        'só, associada à resposta que efetivamente a respondeu.',
        'Pergunta de acompanhamento ("e por quê?", "pode dar um exemplo?") que aprofunda',
        'a MESMA pergunta anterior não vira um par novo — funde a resposta com a anterior.',
        'Condense fala longa preservando o sentido; não corte a resposta a ponto de',
        'perder o que foi efetivamente dito, e não invente nada que a pessoa não disse.',
        'Comentários da própria entrevistadora sem pergunta associada, small talk e',
        'trechos administrativos (agenda, próximos passos do processo seletivo) não são',
        'pares pergunta/resposta — omita-os.',
      ].join(' '),
      askWhenMissing: [],
    },
  ],
};
