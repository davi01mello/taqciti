/**
 * O despacho é onde chegam argumentos inventados por um modelo de linguagem.
 * Estes testes cobrem justamente isso: o que acontece quando vem `"12"` em
 * vez de `12`, um tipo solto em vez de um array, um nome de ferramenta que
 * não existe. Nada disso pode virar exceção não tratada — tem que virar uma
 * mensagem que ensina a próxima chamada.
 */
import { describe, expect, it } from 'vitest';
import { acervoDeMemoria } from './acervoDeMemoria';
import { ErroDeUso } from './ferramentas';
import { FERRAMENTAS, NOMES_DE_FERRAMENTA, despachar } from './despacho';

const acervo = () =>
  acervoDeMemoria({
    reuniao: [
      {
        id: 'r1',
        titulo: 'Planejamento',
        inicioMs: Date.UTC(2026, 8, 1),
        duracaoSegundos: 1800,
        participantes: ['Ana'],
        falas: [
          { falante: 'Ana', texto: 'Precisamos fechar o deploy.', offsetMs: 0 },
          { falante: 'Ana', texto: 'Fica para sexta.', offsetMs: 1000 },
        ],
      },
    ],
    documento: [
      {
        id: 'd1',
        titulo: 'Ata',
        texto: 'Conteúdo da ata sobre o deploy.',
        criadoMs: Date.UTC(2026, 8, 2),
        atualizadoMs: Date.UTC(2026, 8, 2),
      },
    ],
  });

describe('catálogo', () => {
  it('toda ferramenta tem descrição e esquema fechado', () => {
    for (const f of FERRAMENTAS) {
      expect(f.description.length, f.name).toBeGreaterThan(40);
      expect(f.inputSchema.additionalProperties, f.name).toBe(false);
      expect(Array.isArray(f.inputSchema.required), f.name).toBe(true);
    }
  });

  it('as quatro nomeadas e os dois aliases estão publicados', () => {
    expect(NOMES_DE_FERRAMENTA).toEqual([
      'buscar',
      'listar',
      'ler',
      'conteudo',
      'search',
      'fetch',
    ]);
  });

  it('nome duplicado quebraria o cliente — não há', () => {
    expect(new Set(NOMES_DE_FERRAMENTA).size).toBe(NOMES_DE_FERRAMENTA.length);
  });
});

describe('tolerância a argumento torto', () => {
  it('aceita número vindo como string', async () => {
    const r = (await despachar(acervo(), 'conteudo', {
      id: 'reuniao:r1',
      de: '1',
    })) as { itens: { em: number }[] };
    expect(r.itens[0]?.em).toBe(1);
  });

  it('aceita um tipo solto onde o esquema pede array', async () => {
    const r = (await despachar(acervo(), 'buscar', {
      consulta: 'deploy',
      tipos: 'documento',
    })) as { itens: { tipo: string }[] };
    expect(r.itens.every((i) => i.tipo === 'documento')).toBe(true);
  });

  it('`de` negativo vira 0 em vez de estourar', async () => {
    const r = (await despachar(acervo(), 'conteudo', {
      id: 'reuniao:r1',
      de: -5,
    })) as { itens: { em: number }[] };
    expect(r.itens[0]?.em).toBe(0);
  });

  it('id ausente ensina o formato', async () => {
    await expect(despachar(acervo(), 'ler', {})).rejects.toThrow(/tipo:id/);
  });

  it('ferramenta inexistente lista as que existem', async () => {
    const erro = await despachar(acervo(), 'listar_tudo', {}).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeUso);
    expect((erro as Error).message).toContain('buscar');
  });
});

describe('aliases do ChatGPT', () => {
  // O formato destas duas é ditado pela OpenAI, não por nós — `results` com
  // `{id, title, url}`, e `fetch` com `{id, title, text, url}`. Ver
  // `chatgpt.ts`, onde a tradução mora, e `chatgpt.test.ts`, onde o contrato
  // é verificado campo a campo.
  //
  // Antes daqui, estes testes afirmavam o formato NOSSO (`itens`,
  // `primeiraFatia`) sob os nomes do ChatGPT — ou seja, verificavam com
  // precisão uma resposta que o ChatGPT não consegue ler.
  it('`search` aceita `query` e devolve `results`', async () => {
    const r = (await despachar(acervo(), 'search', { query: 'deploy' })) as {
      results: unknown[];
    };
    expect(r.results.length).toBeGreaterThan(0);
  });

  it('`fetch` traz o corpo em `text`, com o caminho para continuar', async () => {
    const r = (await despachar(acervo(), 'fetch', { id: 'reuniao:r1' })) as {
      title: string;
      text: string;
    };
    expect(r.title).toBeTruthy();
    expect(r.text.length).toBeGreaterThan(0);
  });

  it('`fetch` num item enorme não devolve o item enorme', async () => {
    const grande = acervoDeMemoria({
      documento: [
        {
          id: 'grande',
          titulo: 'PDF colado',
          texto: 'palavra '.repeat(100_000),
          criadoMs: Date.UTC(2026, 8, 1),
          atualizadoMs: Date.UTC(2026, 8, 1),
        },
      ],
    });
    const r = await despachar(grande, 'fetch', { id: 'documento:grande' });
    expect(JSON.stringify(r).length).toBeLessThan(30_000);
  });
});
