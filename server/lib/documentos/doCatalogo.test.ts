/**
 * Os tipos do catálogo no padrão da Apostila — e nenhum campo "[A preencher]".
 * Sem modelo: os dados são montados à mão, no formato que o Leitor devolve.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DocumentData, Gap } from '../documentData';
import { DOCUMENT_TYPES } from '../documentTypes';
import { renderHtml } from '../render/html';
import { arvoreDoCatalogo, DocumentoSemConteudoError, renderPdfDoCatalogo } from './doCatalogo';

const q = (quote: string) => ({ quote, anchor: null });
const ata: DocumentData = {
  metadata: { date: '20/10/2026' },
  generalTopic: {
    topic: 'Atualizações do sistema e validação das funcionalidades',
    progress: 'Extensão e cadastro de empreendimentos concluídos; dashboard entregue para validação.',
  },
  participants: [
    { name: 'Pessoa A', role: 'Desenvolvedora', roleSource: 'meeting', quotes: [] },
    { name: 'Pessoa B', roleSource: 'unknown', quotes: [] },
    { name: 'Você', roleSource: 'unknown', quotes: [] },
  ],
  topicsDiscussed: [
    { title: 'Instalação da extensão', summary: 'A extensão não aparece na barra de ferramentas.\nSuporte individual combinado.', quotes: [] },
    { title: 'Dashboard', summary: 'A taxa de aprovação de 17% veio de dados de teste.', quotes: [] },
  ],
  decisions: [{ text: 'Incluir filtro por tipo de financiamento.', agreement: q('ok'), confidence: 'high', quotes: [] }],
  outcomes: [{ text: 'Dados de teste identificados como causa da divergência.', quotes: [] }],
  outputs: [{ text: 'Dashboard entregue para validação.', quotes: [] }],
  conclusion: { text: 'Os ajustes serão feitos até a próxima rodada.' },
  signature: {},
};

const generico = (id: string): DocumentData => ({
  generic: { [id]: [{ text: 'Primeiro ponto.', quotes: [] }, { text: 'Segundo ponto.', quotes: [] }] },
});

const casos: Record<string, DocumentData> = {
  ata,
  resumo: {
    periods: [
      { title: 'Abertura', start: '00:00:59', end: '00:05:14', summary: 'Alinhamento inicial.\nInstalação da extensão.', quotes: [] },
      { title: 'Dashboard', start: '00:05:14', summary: 'Revisão dos indicadores.', quotes: [] },
    ],
  },
  x1: { qa: [{ pergunta: 'Como foi seu semestre?', quotesPergunta: [], resposta: 'Foi bom, aprendi bastante.', quotesResposta: [] }] },
  daily: generico('documento'),
  planning: generico('documento'),
  review: generico('documento'),
};

const textoDe = (arvore: ReturnType<typeof arvoreDoCatalogo>) =>
  arvore.blocos
    .map((b) => ('texto' in b ? b.texto : 'itens' in b ? b.itens.join(' ') : 'titulo' in b ? b.titulo : ''))
    .join('\n');

describe('tipos do catálogo no estilo da Apostila', () => {
  it('cobre todos os tipos do catálogo', () => {
    expect(Object.keys(casos).sort()).toEqual([...DOCUMENT_TYPES].sort());
  });

  for (const tipo of DOCUMENT_TYPES) {
    it(`${tipo}: compila em PDF editorial, com capa gráfica e sem placeholder`, async () => {
      const entrada = { documentType: tipo, data: casos[tipo]!, tituloDaReuniao: 'Alinhamento semanal' };
      const arvore = arvoreDoCatalogo(entrada);
      expect(arvore.blocos[0]).toMatchObject({ tipo: 'capa', variante: 'editorial' });
      expect(textoDe(arvore)).not.toMatch(/A preencher|\[|\]/);

      const pdf = await renderPdfDoCatalogo(entrada);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

      const pasta = process.env.DOCUMENTOS_AMOSTRAS;
      if (pasta) {
        mkdirSync(pasta, { recursive: true });
        writeFileSync(join(pasta, `catalogo-${tipo}.pdf`), pdf);
      }
    });
  }

  it('cargo ausente: sai só o nome; "Você" não é nome e não entra', () => {
    const texto = textoDe(arvoreDoCatalogo({ documentType: 'ata', data: ata }));
    expect(texto).toContain('Pessoa A** – Desenvolvedora');
    expect(texto).toMatch(/\*\*Pessoa B\*\*(?! –)/);
    expect(texto).not.toContain('Você');
  });

  it('a numeração é uma só: título que o modelo já numerou não dobra', () => {
    const data: DocumentData = {
      topicsDiscussed: [
        { title: '1. Instalação da extensão', summary: 'x', quotes: [] },
        { title: '2- Dashboard', summary: 'y', quotes: [] },
      ],
      periods: [{ title: '1) Abertura', summary: 'z', quotes: [] }],
    };
    const topicos = textoDe(arvoreDoCatalogo({ documentType: 'ata', data }));
    expect(topicos).toContain('1. Instalação da extensão');
    expect(topicos).toContain('2. Dashboard');
    expect(topicos).not.toMatch(/\d\.\s+\d[.\-]/);
    expect(textoDe(arvoreDoCatalogo({ documentType: 'resumo', data }))).toContain('1. Abertura');
  });

  it('resumo: o horário do trecho fica numa linha própria, não dentro do título', () => {
    const blocos = arvoreDoCatalogo({ documentType: 'resumo', data: casos.resumo! }).blocos;
    const titulo = blocos.find((b) => b.tipo === 'titulo') as { texto: string };
    expect(titulo.texto).toBe('1. Abertura');
    expect(textoDe(arvoreDoCatalogo({ documentType: 'resumo', data: casos.resumo! }))).toContain('**00:00:59 – 00:05:14**');
  });

  it('sem nome de quem assina não há fecho', () => {
    expect(textoDe(arvoreDoCatalogo({ documentType: 'ata', data: ata }))).not.toContain('Atenciosamente');
    const assinada = { ...ata, signature: { name: 'Pessoa A', role: 'Desenvolvedora' } };
    expect(textoDe(arvoreDoCatalogo({ documentType: 'ata', data: assinada }))).toContain('Atenciosamente');
  });

  it('subtítulo da capa: projeto, senão o título da reunião, senão o tópico', () => {
    const capa = (data: DocumentData, tituloDaReuniao?: string) =>
      arvoreDoCatalogo({ documentType: 'ata', data, ...(tituloDaReuniao ? { tituloDaReuniao } : {}) }).blocos[0] as { subtitulo?: string };
    expect(capa({ ...ata, metadata: { date: '20/10/2026', projectName: 'Fênix' } }, 'Semanal').subtitulo).toBe('Fênix');
    expect(capa(ata, 'Semanal').subtitulo).toBe('Semanal');
    expect(capa(ata).subtitulo).toBe(ata.generalTopic!.topic);
  });

  it('X1 numa reunião que não é entrevista falha com o motivo, em vez de um PDF vazio', async () => {
    await expect(renderPdfDoCatalogo({ documentType: 'x1', data: { metadata: { date: '20/10/2026' } } })).rejects.toBeInstanceOf(
      DocumentoSemConteudoError,
    );
    await expect(renderPdfDoCatalogo({ documentType: 'x1', data: {} })).rejects.toThrow(/entrevistas 1:1/);
  });

  it('lacuna que não é extrema não aparece em lugar nenhum; a extrema sim, no HTML', () => {
    const comum: Gap = { sectionId: 'participantes', field: 'participants[Pessoa B].role', question: 'Qual é o cargo?', why: '' };
    const html = renderHtml({ documentType: 'ata', data: ata, gaps: [comum], title: 'Ata' });
    expect(html).not.toContain('A preencher');
    const extrema = renderHtml({
      documentType: 'ata',
      data: ata,
      gaps: [{ ...comum, field: 'metadata.date', sectionId: 'identificacao', question: 'Que dia foi?', extrema: true }, comum],
      title: 'Ata',
    });
    expect(extrema).not.toContain('Qual é o cargo?');
    expect(extrema).toContain('Que dia foi?');
  });
});
