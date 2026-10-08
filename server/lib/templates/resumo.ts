import type { DocumentTemplate } from './types';

/**
 * Resumo completo — a reunião inteira contada por trechos, na ordem em que
 * aconteceu. Diferente do X1 (pares de pergunta e resposta de uma conversa
 * individual) e da Ata (síntese por tópico, com decisões), aqui a organização
 * é o RELÓGIO: começo, meio e fim, trecho a trecho.
 *
 * `guidance` é a única fonte da regra. Os carimbos `[HH:MM:SS]` que o modelo
 * usa para marcar o intervalo vêm de `transcriptToText` (src/features/history/
 * export.ts), que os escreve a cada troca de falante. Ver
 * `SECTION_DATA_SPECS['resumo_por_periodo']` em `documentData.ts` para como
 * cada trecho vira dado auditável, e `SECTION_RENDERERS` em `render/html.ts`
 * para o desenho.
 */
export const resumo: DocumentTemplate = {
  documentType: 'resumo',
  label: 'Resumo completo',
  documentTitle: 'Resumo completo da reunião',
  sections: [
    {
      id: 'resumo_por_periodo',
      title: 'Resumo por período',
      order: 1,
      required: true,
      audit: 'strict',
      omitWhenEmpty: true,
      needs: ['os assuntos tratados, trecho a trecho, do começo ao fim da reunião'],
      guidance: [
        'Escreva o resumo COMPLETO da reunião dividido em trechos de tempo, em ordem',
        'cronológica: o primeiro trecho cobre o começo, o último cobre o fim, e nenhuma',
        'parte relevante da reunião pode ficar sem trecho.',
        'Cada trecho agrupa o que foi tratado num mesmo momento — quando o assunto',
        'dominante muda, começa um trecho novo. Não use trechos de tamanho fixo e não',
        'crie trechos artificiais: uma reunião curta pode ter dois ou três; uma longa,',
        'bem mais. Um assunto que volta mais tarde ganha um trecho novo naquele ponto,',
        'sem ser fundido com o trecho antigo.',
        'Para cada trecho dê: um título curto do assunto dominante; o início e o fim',
        'COPIADOS dos carimbos [HH:MM:SS] da transcrição (o fim de um trecho é o início',
        'do seguinte; o do último é o último carimbo da reunião) — omita os dois se a',
        'transcrição não tiver carimbos, e nunca calcule nem invente um horário; e um',
        'resumo em prosa corrida (um a três parágrafos curtos) do que foi dito: contexto,',
        'quem trouxe o quê, argumentos, dúvidas, números e nomes citados, o que ficou',
        'combinado ou em aberto naquele momento.',
        'Escreva em terceira pessoa e no passado, com suas próprias palavras, sem copiar',
        'a conversa. Seja fiel: não acrescente interpretação, decisão ou conclusão que',
        'não tenha sido dita, e não transforme proposta em decisão.',
        'Cada trecho precisa de citações LITERAIS da transcrição que o sustentem — as',
        'falas mais representativas dele, espalhadas pelo trecho. Trecho sem citação',
        'localizável é descartado inteiro pelo auditor.',
        'Conversa social, problemas de áudio e trechos sem conteúdo não ganham trecho',
        'próprio; só entram se mudarem o rumo da reunião.',
      ].join(' '),
      askWhenMissing: [],
    },
  ],
};
