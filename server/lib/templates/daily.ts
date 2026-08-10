import type { DocumentTemplate } from './types';

/**
 * `guidance` vem do comentário que já existia em generateDocument.ts:
 * "'daily' pede formato ontem/hoje/bloqueios". Mesmo caso de "ata": ponto
 * de partida natural pra 3 SectionSpec (ontem/hoje/bloqueios) quando a
 * geração real entrar — não dividido nesta rodada, ainda 1 seção só (ver
 * observação na resposta).
 *
 * `audit`/`askWhenMissing`/`omitWhenEmpty`: placeholders neutros pra
 * satisfazer o SectionSpec estendido (rodada da Ata) — daily não muda de
 * conteúdo nesta rodada, ver observação na resposta.
 */
export const daily: DocumentTemplate = {
  documentType: 'daily',
  label: 'Daily',
  sections: [
    {
      id: 'documento',
      title: 'Daily',
      order: 0,
      required: true,
      needs: [],
      guidance: 'Formato ontem/hoje/bloqueios.',
      audit: 'none',
      askWhenMissing: [],
      omitWhenEmpty: false,
    },
  ],
};
