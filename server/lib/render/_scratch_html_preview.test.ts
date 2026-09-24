import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { renderHtml } from './html';
import type { DocumentData } from '../documentData';

const data: DocumentData = {
  metadata: { date: '12/08/2026', projectName: 'Projeto Fênix' },
  generalTopic: {
    topic: 'Alinhamento de Cronograma e Validação do Tratamento',
    progress:
      'Continuidade do desenvolvimento técnico da plataforma, com foco na parte interna do sistema (banco de dados), além de alinhamento sobre próximos passos.',
  },
  participants: [
    { name: 'Beatriz Lima', role: 'Arquiteta de integração', roleSource: 'meeting', quotes: [] },
    { name: 'Ana Souza', role: 'Gerente de Produto', roleSource: 'meeting', quotes: [] },
  ],
  topicsDiscussed: [
    {
      title: 'Integração com a API da Conta Azul',
      summary: 'A API travou durante os testes de carga.',
      quotes: [],
    },
  ],
  decisions: [
    {
      text: 'Adiar a entrega para 28/08/2026',
      agreement: { quote: 'De acordo.', anchor: { start: 0, end: 5, exact: true } },
      confidence: 'high',
      quotes: [],
    },
  ],
  outcomes: [{ text: 'Alinhamento entre times sobre o novo prazo.', quotes: [] }],
  outputs: [{ text: 'Lista dos endpoints alterados', quotes: [] }],
  conclusion: { text: 'O projeto segue com a entrega remarcada, sem impacto no escopo.' },
  signature: { name: 'Ana Souza', role: 'Gerente de Projetos' },
};

const DESTINO = process.env.PREVIEW_HTML;

describe.skipIf(!DESTINO)('preview manual (html)', () => {
  it('escreve o HTML pra conferência visual', () => {
    const html = renderHtml({
      documentType: 'ata',
      data,
      gaps: [],
      title: 'Ata de Reunião — Projeto Fênix',
    });
    writeFileSync(DESTINO!, html, 'utf8');
    console.log('Escrito em', DESTINO, html.length, 'bytes');
  });
});
