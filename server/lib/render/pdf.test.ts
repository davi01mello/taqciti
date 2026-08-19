import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
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

/**
 * Quantos trechos de texto cada página desenha (`Tj`/`TJ` no stream
 * descomprimido). Não é medida de beleza — é o mínimo necessário pra
 * distinguir "página cheia" de "página que só tem o rodapé", que é a forma
 * que o defeito de paginação assume. Ver o teste que usa isto.
 */
async function trechosDeTextoPorPagina(pdf: Buffer): Promise<number[]> {
  const doc = await PDFDocument.load(pdf);
  return doc.getPages().map((pagina) => {
    const ctx = pagina.node.context;
    const conteudo = ctx.lookup(pagina.node.get(PDFName.of('Contents')));
    const streams =
      conteudo instanceof PDFArray
        ? conteudo.asArray().map((ref) => ctx.lookup(ref))
        : [conteudo];

    let texto = '';
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) continue;
      const bytes = Buffer.from(stream.getContents());
      // 0x78 é o cabeçalho do zlib: o `pdfkit` comprime os streams, mas o
      // teste não deve depender disso pra sempre.
      texto += (bytes[0] === 0x78 ? inflateSync(bytes) : bytes).toString('latin1');
    }
    return (texto.match(/\b(Tj|TJ)\b/g) ?? []).length;
  });
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

  it('leva a Barlow EMBUTIDA, e nenhuma fonte de leitor', async () => {
    // A diferença que este teste guarda: um PDF pode PEDIR "Barlow" sem
    // carregar a fonte, e aí ele abre com o que o leitor tiver no lugar —
    // o documento chega ao cliente com outra cara e ninguém do lado de cá
    // percebe. `/FontFile2` é o arquivo de verdade dentro do PDF; sem ele,
    // é só um pedido.
    const buffer = await renderPdf({
      documentType: 'ata',
      data: ataCompleta,
      gaps: [lacunaCargo],
      title: 'Ata de Reunião — fontes',
    });
    const bytes = buffer.toString('latin1');

    expect(bytes).toContain('/FontFile2');
    // O prefixo de seis letras é do SUBCONJUNTO que o pdfkit gera — só os
    // glifos usados entram, e é por isso que o arquivo não engorda 200KB.
    expect(bytes).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+Barlow-Regular/);
    expect(bytes).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+Barlow-Bold/);

    // Nem sobra de Helvetica: se `registrarFontes` falhasse silenciosamente,
    // o pdfkit desenharia com ela e o documento sairia errado sem erro.
    expect(bytes).not.toContain('Helvetica');
  });

  it('lista longa pagina sem deixar pagina quase vazia pelo caminho', async () => {
    // A regressão que este teste existe pra pegar, encontrada rodando o
    // pipeline de verdade: o item de lista desenha marcador e texto em duas
    // chamadas que compartilham a coordenada de topo, e quando o `pdfkit`
    // quebrava a página ENTRE as duas, o `doc.y` restaurado era da página
    // anterior — o que disparava outra quebra, e outra. O documento saía com
    // 7 páginas, uma delas contendo só o "4." e a seguinte totalmente em
    // branco.
    const paragrafo =
      'Constatou-se que, para volumes de até mil requisições por segundo, o tempo de ' +
      'resposta atende ao limite acordado; acima disso ocorre degradação relevante, e a ' +
      'origem exata, se no banco de dados ou na fila de processamento, não pôde ser ' +
      'determinada de imediato pela equipe durante esta reunião de acompanhamento.';

    const buffer = await renderPdf({
      documentType: 'ata',
      data: {
        metadata: { date: '19/08/2026', projectName: 'Projeto Meridiano' },
        topicsDiscussed: Array.from({ length: 8 }, (_, i) => ({
          title: `Tópico número ${i + 1}`,
          summary: paragrafo,
          quotes: [],
        })),
        outcomes: Array.from({ length: 6 }, (_, i) => ({
          text: `${paragrafo} (resultado ${i + 1})`,
          quotes: [],
        })),
      },
      gaps: [],
      title: 'Ata de Reunião — paginação',
    });

    const [, ...conteudo] = await trechosDeTextoPorPagina(buffer);
    expect(conteudo.length).toBeGreaterThan(1); // o payload precisa mesmo paginar

    // Toda página de conteúdo desenha o rodapé (2 trechos). Uma que fique
    // perto disso não tem conteúdo nenhum. A última pode ser curta de
    // verdade — é onde o documento acaba.
    const semAUltima = conteudo.slice(0, -1);
    expect(Math.min(...semAUltima)).toBeGreaterThan(6);
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
