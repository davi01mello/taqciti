import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { renderPdf } from './pdf';
import type { DocumentData } from '../documentData';

const ataCompleta: DocumentData = {
  metadata: { date: '12/08/2026', projectName: 'Projeto Fênix' },
  generalTopic: {
    topic: 'Alinhamento de Cronograma e Validação do Tratamento',
    progress:
      'Continuidade do desenvolvimento técnico da plataforma, com foco na parte interna do sistema (banco de dados), além de alinhamento sobre próximos passos.',
  },
  participants: [
    { name: 'Beatriz Lima', role: 'Arquiteta de integração', roleSource: 'meeting', quotes: [] },
    { name: 'Ana Souza', role: 'Gerente de Produto', roleSource: 'meeting', quotes: [] },
    { name: 'Caio Mendes', role: 'Analista de Dados', roleSource: 'meeting', quotes: [] },
  ],
  topicsDiscussed: [
    {
      title: 'Integração com a API da Conta Azul',
      summary:
        'A API travou durante os testes de carga. A equipe explicou que a documentação enviada pelo cliente estava desatualizada, o que gerou atraso.',
      quotes: [],
    },
    { title: 'Banco de dados', summary: 'Modelagem revisada e aprovada.', quotes: [] },
  ],
  decisions: [
    {
      text: 'Adiar a entrega para 28/08/2026',
      agreement: { quote: 'De acordo, sexta.', anchor: { start: 0, end: 5, exact: true } },
      confidence: 'high',
      quotes: [],
    },
    {
      text: 'Cancelar o piloto com o segundo cliente',
      agreement: { quote: 'Cancela.', anchor: { start: 0, end: 8, exact: true } },
      confidence: 'medium',
      quotes: [],
    },
  ],
  outcomes: [{ text: 'Alinhamento entre times sobre o novo prazo.', quotes: [] }],
  outputs: [{ text: 'Lista dos endpoints alterados', quotes: [] }],
  conclusion: { text: 'O projeto segue com a entrega remarcada, sem impacto no escopo.' },
  signature: { name: 'Ana Souza', role: 'Gerente de Projetos' },
};

const DESTINO = process.env.PREVIEW_PDF;

describe.skipIf(!DESTINO)('preview manual', () => {
  it('escreve um PDF pra conferência visual', async () => {
    const buffer = await renderPdf({
      documentType: 'ata',
      data: ataCompleta,
      gaps: [],
      title: 'Ata de Reunião — Projeto Fênix',
    });
    writeFileSync(DESTINO!, buffer);
    console.log('Escrito em', DESTINO, buffer.length, 'bytes');
  });
});
