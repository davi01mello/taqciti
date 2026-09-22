/**
 * O conector inteiro, ponta a ponta: um cliente MCP de verdade conversando
 * com o nosso servidor, sobre um Postgres de verdade.
 *
 * ── Por que este teste existe além dos outros ─────────────────────────────
 *
 * `ferramentas.test.ts` prova a lógica e o orçamento. `acervoPostgres.test.ts`
 * prova o SQL. Nenhum dos dois prova que aquilo ATRAVESSA o protocolo — e é
 * atravessando que as coisas quebram: um `inputSchema` que o cliente recusa,
 * um resultado com formato de conteúdo errado, um erro de uso que vira falha
 * de protocolo em vez de resposta legível.
 *
 * Aqui o `Client` do SDK faz o handshake de verdade, lista as ferramentas de
 * verdade e as chama de verdade. Se o formato estiver errado, o cliente
 * recusa — que é exatamente o que a Claude faria.
 *
 * O transporte é em memória em vez de HTTP porque o que está sob teste é o
 * protocolo e o conteúdo, não o Next. A rota é uma casca fina por cima
 * disto (ver `app/api/mcp/route.ts`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AcervoPostgres } from './acervoPostgres';
import type { Consultador } from './banco';
import { gravarDocumento, gravarNota, gravarReuniao } from './escrita';
import { garantirPessoa } from './pessoa';
import { construirServidorMcp } from './mcp';
import { NOMES_DE_FERRAMENTA } from './despacho';

const BASE = Date.UTC(2026, 8, 1);

/**
 * O texto de uma resposta de ferramenta, já desembrulhado do protocolo.
 *
 * Recebe `unknown` porque `callTool` devolve uma UNIÃO: o formato atual
 * (`content`) e o de compatibilidade com clientes antigos (`toolResult`).
 * Tipar o parâmetro como `{ content?: unknown }` recusaria a união inteira —
 * e afunilar aqui, num ajudante de teste, é mais honesto do que espalhar
 * asserção por vinte chamadas.
 */
function texto(resultado: unknown): string {
  const blocos = ((resultado as { content?: unknown }).content ?? []) as {
    type: string;
    text?: string;
  }[];
  return blocos
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
}

function json<T>(resultado: unknown): T {
  return JSON.parse(texto(resultado)) as T;
}

describe('o conector por MCP', () => {
  let pglite: PGlite;
  let cliente: Client;

  beforeAll(async () => {
    pglite = new PGlite();
    const pool = pglite as unknown as Consultador;
    await pglite.exec(readFileSync(join(process.cwd(), 'lib', 'conector', 'esquema.sql'), 'utf8'));

    const pessoa = await garantirPessoa(
      { googleSub: 'mcp-teste', email: 'ana@citi.org.br' },
      pool,
    );

    await gravarReuniao(
      pessoa,
      {
        id: 'r1',
        titulo: 'Planejamento do trimestre',
        inicioMs: BASE,
        duracaoSegundos: 3600,
        participantes: ['Ana Souza', 'Beatriz Lima'],
        falas: [
          ...Array.from({ length: 120 }, (_, i) => ({
            falante: 'Ana Souza',
            texto: `Assunto ${i} discutido com algum detalhe para a fatia ter peso.`,
            offsetMs: i * 1000,
          })),
          { falante: 'Beatriz Lima', texto: 'Eu assumo o deploy na sexta.', offsetMs: 200_000 },
        ],
      },
      pool,
    );
    await gravarDocumento(
      pessoa,
      {
        id: 'd1',
        titulo: 'Ata do planejamento',
        texto: 'A decisão foi manter o cronograma.',
        criadoMs: BASE + 1000,
        atualizadoMs: BASE + 1000,
        tipoGerado: 'ata',
        reuniaoId: 'r1',
      },
      pool,
    );
    await gravarNota(
      pessoa,
      {
        id: 'r1',
        reuniaoId: 'r1',
        reuniaoTitulo: 'Planejamento do trimestre',
        texto: 'Cobrar o deploy na segunda.',
        atualizadaMs: BASE + 2000,
        marcacoes: { decisao: 1 },
        prints: 2,
      },
      pool,
    );

    const servidor = construirServidorMcp(new AcervoPostgres(pessoa, pool));
    const [doCliente, doServidor] = InMemoryTransport.createLinkedPair();
    cliente = new Client({ name: 'teste', version: '1.0.0' });
    // `connect` do cliente dispara o handshake de verdade: se as
    // capacidades ou a versão de protocolo estiverem erradas, falha aqui.
    await Promise.all([servidor.connect(doServidor), cliente.connect(doCliente)]);
  });

  afterAll(async () => {
    await cliente.close();
    await pglite.close();
  });

  it('o handshake passa e o servidor se identifica', () => {
    expect(cliente.getServerVersion()?.name).toBe('taqciti');
    expect(cliente.getServerCapabilities()?.tools).toBeDefined();
  });

  it('as instruções ensinam a escada antes da primeira chamada', () => {
    const instrucoes = cliente.getInstructions() ?? '';
    expect(instrucoes).toContain('buscar');
    expect(instrucoes).toContain('proximo');
  });

  it('o cliente aceita o catálogo — os esquemas são válidos para ele', async () => {
    const { tools } = await cliente.listTools();
    expect(tools.map((t) => t.name)).toEqual(NOMES_DE_FERRAMENTA);
    for (const t of tools) {
      expect(t.inputSchema.type, t.name).toBe('object');
      expect(t.description, t.name).toBeTruthy();
    }
  });

  it('buscar atravessa o protocolo e devolve a posição do acerto', async () => {
    const r = await cliente.callTool({ name: 'buscar', arguments: { consulta: 'deploy' } });
    const corpo = json<{ itens: { id: string; tipo: string; posicao: number }[] }>(r);
    const naReuniao = corpo.itens.find((i) => i.tipo === 'reuniao');
    expect(naReuniao?.id).toBe('reuniao:r1');
    expect(naReuniao?.posicao).toBe(120);
  });

  it('a escada funciona: buscar → conteudo cai no trecho certo', async () => {
    // O percurso que o produto promete, feito pelo protocolo inteiro.
    const busca = await cliente.callTool({ name: 'buscar', arguments: { consulta: 'deploy' } });
    const acerto = json<{ itens: { id: string; tipo: string; posicao: number }[] }>(
      busca,
    ).itens.find((i) => i.tipo === 'reuniao')!;

    const fatia = await cliente.callTool({
      name: 'conteudo',
      arguments: { id: acerto.id, de: acerto.posicao, quantidade: 1 },
    });
    const corpo = json<{ itens: { texto: string }[] }>(fatia);
    expect(corpo.itens[0]?.texto).toContain('deploy');
  });

  it('nenhuma resposta estoura o orçamento, mesmo pedindo tudo', async () => {
    for (const chamada of [
      { name: 'listar', arguments: { tipo: 'reuniao', quantidade: 10_000 } },
      { name: 'conteudo', arguments: { id: 'reuniao:r1', de: 0, quantidade: 10_000 } },
      { name: 'ler', arguments: { id: 'reuniao:r1' } },
      { name: 'buscar', arguments: { consulta: 'assunto' } },
    ]) {
      const r = await cliente.callTool(chamada);
      expect(texto(r).length, chamada.name).toBeLessThanOrEqual(24_000);
    }
  });

  it('ler não traz o corpo, e diz como pedi-lo', async () => {
    const r = await cliente.callTool({ name: 'ler', arguments: { id: 'reuniao:r1' } });
    const envelope = json<{ corpo: { total: number }; comoLer: string }>(r);
    expect(envelope.corpo.total).toBe(121);
    expect(envelope.comoLer).toContain('conteudo');
    expect(texto(r)).not.toContain('Eu assumo o deploy na sexta');
  });

  it('id inventado vira resposta legível, não falha de protocolo', async () => {
    // O modelo lê isto como conteúdo e corrige sozinho. Um erro JSON-RPC ele
    // não leria — a chamada só falharia.
    const r = await cliente.callTool({ name: 'ler', arguments: { id: 'nao-existe' } });
    expect(r.isError).toBe(true);
    expect(texto(r)).toContain('tipo:id');
  });

  it('ferramenta inexistente também é resposta, e lista as que existem', async () => {
    const r = await cliente.callTool({ name: 'me_da_tudo', arguments: {} });
    expect(r.isError).toBe(true);
    expect(texto(r)).toContain('buscar');
  });

  it('paginar até o fim funciona pelo protocolo', async () => {
    let de: number | undefined = 0;
    let lidas = 0;
    let voltas = 0;
    while (de !== undefined) {
      const r = await cliente.callTool({
        name: 'conteudo',
        arguments: { id: 'reuniao:r1', de },
      });
      const p = json<{ itens: unknown[]; mostrando: number; proximo?: number }>(r);
      lidas += p.mostrando;
      de = p.proximo;
      if (++voltas > 50) throw new Error('paginação não terminou');
    }
    expect(lidas).toBe(121);
  });

  it('o alias `fetch` traz envelope e primeira fatia', async () => {
    const r = await cliente.callTool({ name: 'fetch', arguments: { id: 'documento:d1' } });
    const corpo = json<{ titulo: string; primeiraFatia: { itens: unknown[] } }>(r);
    expect(corpo.titulo).toBe('Ata do planejamento');
    expect(corpo.primeiraFatia.itens.length).toBeGreaterThan(0);
  });

  it('a nota chega com a contagem de prints, sem imagem nenhuma', async () => {
    const r = await cliente.callTool({ name: 'ler', arguments: { id: 'nota:r1' } });
    expect(texto(r)).toContain('2 (as imagens não são expostas');
    expect(texto(r)).not.toContain('data:image');
  });
});
