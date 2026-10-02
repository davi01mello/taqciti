/**
 * O contrato do ChatGPT — os nomes de campo que ele procura e mais nada.
 *
 * Estes testes não conferem se o conteúdo está bonito; conferem se os CAMPOS
 * se chamam o que a documentação da OpenAI diz que se chamam. É a única
 * coisa que importa aqui, e é exatamente o que estava errado antes: o
 * conector devolvia o formato de `buscar` (`{itens: [...]}`) sob os nomes
 * `search`/`fetch`. Nada quebrava, nada dava erro — o ChatGPT simplesmente
 * não achava campo nenhum que reconhecesse, e o conector parecia mudo.
 *
 * Por isso as asserções são literais sobre `results`, `id`, `title`, `url`,
 * `text`. Um teste que só checasse "devolveu alguma coisa" teria passado com
 * o formato errado.
 */
import { describe, expect, it } from 'vitest';
import { paraBuscaDoChatGpt, paraDocumentoDoChatGpt, urlDoItem } from './chatgpt';
import { acervoDeMemoria } from './acervoDeMemoria';
import { despachar } from './despacho';
import type { Corpo, Envelope } from './ferramentas';
import type { ReuniaoDoAcervo } from './tipos';

const ORIGEM = 'https://servidor.test';

const REUNIAO: ReuniaoDoAcervo = {
  id: 'r1',
  titulo: 'Retrospectiva de setembro',
  inicioMs: Date.UTC(2026, 8, 10, 13),
  duracaoSegundos: 2400,
  participantes: ['Ana', 'Bruno'],
  falas: [
    { falante: 'Ana', texto: 'O relatório de outubro precisa sair antes do feriado.', offsetMs: 0 },
    { falante: 'Bruno', texto: 'Eu faço o relatório até quarta.', offsetMs: 3000 },
  ],
};

describe('urlDoItem', () => {
  it('monta um endereço absoluto quando sabe a origem', () => {
    expect(urlDoItem('reuniao:r1', ORIGEM)).toBe(`${ORIGEM}/item/reuniao%3Ar1`);
  });

  it('sem origem, devolve caminho relativo em vez de inventar domínio', () => {
    expect(urlDoItem('reuniao:r1')).toBe('/item/reuniao%3Ar1');
  });
});

describe('paraBuscaDoChatGpt', () => {
  it('devolve `results` com exatamente id, title e url', () => {
    const traduzido = paraBuscaDoChatGpt(
      { itens: [{ id: 'reuniao:r1', titulo: 'Retrospectiva de setembro' }] },
      ORIGEM,
    );
    expect(traduzido).toEqual({
      results: [
        {
          id: 'reuniao:r1',
          title: 'Retrospectiva de setembro',
          url: `${ORIGEM}/item/reuniao%3Ar1`,
        },
      ],
    });
  });

  it('busca sem acerto vira lista vazia, não ausência de campo', () => {
    // `results: []` é uma resposta; `undefined` faz o ChatGPT tratar como
    // falha da ferramenta.
    expect(paraBuscaDoChatGpt({ itens: [] }, ORIGEM)).toEqual({ results: [] });
    expect(paraBuscaDoChatGpt({}, ORIGEM)).toEqual({ results: [] });
  });
});

describe('paraDocumentoDoChatGpt', () => {
  const envelope: Envelope = {
    id: 'reuniao:r1',
    tipo: 'reuniao',
    titulo: 'Retrospectiva de setembro',
    data: '2026-09-10',
    sobre: { duração: '40 min', participantes: 'Ana, Bruno' },
    abertura: 'Ana: O relatório…',
    corpo: { unidade: 'falas', total: 2 },
    comoLer: 'conteudo(id="reuniao:r1", de=0)',
  };

  const corpo: Corpo = {
    id: 'reuniao:r1',
    unidade: 'falas',
    itens: [
      { em: 0, autor: 'Ana', texto: 'O relatório precisa sair.' },
      { em: 1, autor: 'Bruno', texto: 'Eu faço até quarta.' },
    ],
    total: 2,
    mostrando: 2,
  };

  it('tem os quatro campos obrigatórios com os nomes certos', () => {
    const doc = paraDocumentoDoChatGpt(envelope, corpo, ORIGEM);
    expect(Object.keys(doc).sort()).toEqual(['id', 'metadata', 'text', 'title', 'url']);
    expect(doc.title).toBe('Retrospectiva de setembro');
    expect(doc.text).toContain('Ana: O relatório precisa sair.');
    expect(doc.text).toContain('Bruno: Eu faço até quarta.');
  });

  it('quando há mais corpo, o texto diz como continuar', () => {
    // Sem esta linha, o modelo vê um documento que parece completo e para —
    // e a metade que faltava nunca é pedida.
    const cortado: Corpo = { ...corpo, mostrando: 1, itens: [corpo.itens[0]!], proximo: 1 };
    const doc = paraDocumentoDoChatGpt(envelope, cortado, ORIGEM);
    expect(doc.text).toContain('de=1');
    expect(doc.text).toContain('Mostrando 1 de 2');
  });

  it('quando o corpo acabou, não promete continuação que não existe', () => {
    expect(paraDocumentoDoChatGpt(envelope, corpo, ORIGEM).text).not.toContain('Para o resto');
  });
});

describe('despachar pelos nomes do ChatGPT', () => {
  const acervo = acervoDeMemoria({ reuniao: [REUNIAO] });

  it('`search` devolve o formato do ChatGPT, não o de `buscar`', async () => {
    const r = (await despachar(acervo, 'search', { query: 'relatório' }, ORIGEM)) as {
      results?: { id: string; title: string; url: string }[];
      itens?: unknown;
    };
    expect(r.itens).toBeUndefined();
    expect(r.results?.[0]?.id).toBe('reuniao:r1');
    expect(r.results?.[0]?.title).toBe('Retrospectiva de setembro');
    expect(r.results?.[0]?.url).toContain('/item/');
  });

  it('`fetch` devolve texto de verdade no campo `text`', async () => {
    const r = (await despachar(acervo, 'fetch', { id: 'reuniao:r1' }, ORIGEM)) as {
      text?: string;
      title?: string;
    };
    expect(r.title).toBe('Retrospectiva de setembro');
    expect(r.text).toContain('relatório');
  });

  it('`buscar` continua no formato de sempre — a Claude não foi afetada', async () => {
    const r = (await despachar(acervo, 'buscar', { consulta: 'relatório' })) as {
      itens?: unknown[];
      results?: unknown;
    };
    expect(r.results).toBeUndefined();
    expect(r.itens).toHaveLength(1);
  });
});
