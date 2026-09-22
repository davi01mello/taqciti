import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { renderPdf } from './pdf';
import type { DocumentData, Gap } from '../documentData';

const data: DocumentData = {
  qa: [
    {
      pergunta: 'Como você avalia o seu último ciclo, olhando pra entrega e pra colaboração com o time?',
      quotesPergunta: [],
      resposta:
        'Entreguei o que estava no plano, mas acho que travei em duas frentes ao mesmo tempo no meio do trimestre. A colaboração melhorou depois que passei a levar as dúvidas pro daily em vez de segurar.',
      quotesResposta: [],
    },
    {
      pergunta: 'O que te bloqueou mais nesse período?',
      quotesPergunta: [],
      resposta: 'A dependência do time de dados. Ficamos duas semanas esperando um schema.',
      quotesResposta: [],
    },
    {
      pergunta: 'E onde você quer crescer nos próximos seis meses?',
      quotesPergunta: [],
      quotesResposta: [],
    },
  ],
};

const gaps: Gap[] = [
  {
    sectionId: 'perguntas_respostas',
    field: 'qa[2].resposta',
    question: 'Qual foi a resposta do candidato a esta pergunta?',
    why: 'Rejeitada pela conferência contra a transcrição.',
  },
];

const DESTINO = process.env.PREVIEW_X1;

describe.skipIf(!DESTINO)('preview manual (X1)', () => {
  it('escreve o PDF do X1 pra conferência visual', async () => {
    const buffer = await renderPdf({
      documentType: 'x1',
      data,
      gaps,
      title: 'Doc de Conversa 1:1',
    });
    writeFileSync(DESTINO!, buffer);
    console.log('Escrito em', DESTINO, buffer.length, 'bytes');
  });
});
