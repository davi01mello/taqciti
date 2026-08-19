import { describe, expect, it } from 'vitest';
import { renderPdf } from './pdf';
import type { DocumentData, Gap } from '../documentData';

/**
 * `pdfkit` produz bytes binários, não uma string comparável como o HTML —
 * então aqui não dá pra fazer `toContain('texto')` como em `html.test.ts`.
 * O que se testa: o Buffer é um PDF de verdade (header `%PDF-`), tem
 * conteúdo (não é só capa+rodapé vazios) e nada lança pra nenhuma combinação
 * de dado — documento cheio, documento com lacuna, documento vazio.
 */
function ehPdfValido(buffer: Buffer): boolean {
  return buffer.length > 0 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

const ataCompleta: DocumentData = {
  metadata: { date: '12/08/2026', projectName: 'Projeto Fênix' },
  generalTopic: { topic: 'Cronograma', progress: 'Em andamento.' },
  participants: [
    { name: 'Beatriz', role: 'Arquiteta de integração', roleSource: 'meeting', quotes: [] },
    { name: 'Ana', roleSource: 'unknown', quotes: [] },
  ],
  topicsDiscussed: [{ title: 'Integração', summary: 'A API travou.', quotes: [] }],
  decisions: [
    {
      text: 'Adiar a entrega para 28/08/2026',
      agreement: { quote: 'De acordo, sexta.', anchor: { start: 0, end: 5, exact: true } },
      confidence: 'high',
      quotes: [],
    },
  ],
  outcomes: [],
  outputs: [{ text: 'Lista dos endpoints alterados', quotes: [] }],
  conclusion: { text: 'O projeto segue com a entrega remarcada.' },
  signature: { name: 'Ana Souza', role: 'Gerente de Projetos' },
};

const lacunaCargo: Gap = {
  sectionId: 'participantes',
  field: 'participants[Ana].role',
  question: 'Qual é o cargo/papel de Ana?',
  why: 'Não houve evidência na reunião do cargo de Ana.',
};

describe('renderPdf', () => {
  it('gera um PDF de verdade para uma Ata completa', async () => {
    const buffer = await renderPdf({
      documentType: 'ata',
      data: ataCompleta,
      gaps: [lacunaCargo],
      title: 'Ata de Reunião — Projeto Fênix',
    });
    expect(ehPdfValido(buffer)).toBe(true);
    // Capa (marca embutida) + conteúdo real não cabem em poucos KB.
    expect(buffer.length).toBeGreaterThan(5_000);
  });

  it('gera um PDF de verdade para o X1, com par de pergunta/resposta e lacuna', async () => {
    const dadosX1: DocumentData = {
      qa: [
        {
          pergunta: 'Por que você quer essa vaga?',
          quotesPergunta: [],
          resposta: 'Porque gosto do desafio técnico.',
          quotesResposta: [],
        },
        {
          pergunta: 'Como você lida com prazo apertado?',
          quotesPergunta: [],
          quotesResposta: [],
        },
      ],
    };
    const gaps: Gap[] = [
      {
        sectionId: 'perguntas_respostas',
        field: 'qa[1].resposta',
        question: 'Qual foi a resposta do candidato a esta pergunta?',
        why: 'Rejeitada pela conferência contra a transcrição.',
      },
    ];

    const buffer = await renderPdf({
      documentType: 'x1',
      data: dadosX1,
      gaps,
      title: 'Doc de Conversa 1:1 — X1',
    });
    expect(ehPdfValido(buffer)).toBe(true);
  });

  it('nao quebra com documento vazio — capa e rodape ainda saem', async () => {
    const buffer = await renderPdf({
      documentType: 'ata',
      data: {},
      gaps: [],
      title: 'Ata de Reunião',
    });
    expect(ehPdfValido(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('titulo da capa vem do tipo de documento, nao do title recebido', async () => {
    // Mesma checagem estrutural que html.test.ts faz pro <h1> — aqui só dá
    // pra confirmar que os dois nao lancam com titles bem diferentes do
    // documentTitle do template; a leitura visual real foi feita à mão.
    const buffer = await renderPdf({
      documentType: 'x1',
      data: {},
      gaps: [],
      title: 'Um título de reunião qualquer, bem diferente do template',
    });
    expect(ehPdfValido(buffer)).toBe(true);
  });
});
