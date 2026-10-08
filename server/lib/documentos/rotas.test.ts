import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const complete = vi.hoisted(() => vi.fn());
vi.mock('../ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai')>()),
  complete,
  activeDataPolicyWarning: () => null,
}));

const gerar = await import('../../app/api/documentos/gerar/route');
const editar = await import('../../app/api/documentos/editar/route');
const renderizar = await import('../../app/api/documentos/renderizar/route');

const CHAVE = 'chave-de-teste';
const FONTE = {
  id: 'm1',
  titulo: 'Reunião',
  texto: 'Ana: O maior gargalo está na integração com o sistema legado.',
};

const reply = (parsed: unknown) => ({
  text: '',
  parsed,
  usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
  meta: { provider: 'google', model: 'falso', latencyMs: 1, repaired: false, rateLimitWaits: 0, overloadWaits: 0 },
});

const geracao = {
  estrutura: 'Relatório',
  titulo: 'Relatório de diagnóstico',
  secoes: [
    {
      titulo: 'Diagnóstico',
      blocos: [
        {
          tipo: 'paragrafo',
          texto: 'O gargalo está na integração.',
          classificacao: 'fato',
          fontes: [{ fonteId: 'm1', trecho: 'O maior gargalo está na integração com o sistema legado.' }],
        },
      ],
    },
  ],
  lacunas: [],
};

const post = (rota: { POST: (r: NextRequest) => Promise<Response> }, corpo: unknown, chave: string | null = CHAVE) =>
  rota.POST(
    new NextRequest('http://localhost/api/documentos', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(chave ? { 'x-docciti-key': chave } : {}) },
      body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    }),
  );

beforeEach(() => {
  process.env.DOCCITI_SHARED_KEY = CHAVE;
});
afterEach(() => complete.mockReset());

describe('POST /api/documentos/gerar', () => {
  it('sem a chave: 401, e o modelo não é chamado', async () => {
    const r = await post(gerar, { pedido: 'x', fontes: [FONTE] }, null);
    expect(r.status).toBe(401);
    expect(complete).not.toHaveBeenCalled();
  });

  it('corpo inválido: 400 com a mensagem do campo', async () => {
    expect((await post(gerar, 'não é json')).status).toBe(400);
    const r = await post(gerar, { pedido: 'x', fontes: [] });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('fontes');
    expect(complete).not.toHaveBeenCalled();
  });

  it('gera o documento: 200, PDF real em base64, manifesto e relatório', async () => {
    complete.mockResolvedValue(reply(geracao));
    const r = await post(gerar, {
      pedido: 'Monte um relatório.',
      fontes: [FONTE],
      capa: { cliente: 'Aurora' },
      variante: 'ata',
    });
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(Buffer.from(corpo.pdf, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    expect(corpo.manifesto.paginas).toBeGreaterThanOrEqual(2);
    expect(corpo.relatorio.verificacoesRealizadas.length).toBeGreaterThan(0);
    expect(corpo.arvore.blocos[0]).toMatchObject({ tipo: 'capa', cliente: 'Aurora' });
    // O uso de tokens é interno: não vai para o cliente.
    expect(corpo.usage).toBeUndefined();
  });

  it('nada sustentado pelas fontes: 422 com explicação, não 500', async () => {
    complete.mockResolvedValue(
      reply({
        ...geracao,
        secoes: [
          {
            titulo: 'X',
            blocos: [{ tipo: 'paragrafo', texto: 'Inventado.', classificacao: 'fato', fontes: [{ fonteId: 'm1', trecho: 'não existe' }] }],
          },
        ],
      }),
    );
    const r = await post(gerar, { pedido: 'x', fontes: [FONTE], variante: 'ata' });
    expect(r.status).toBe(422);
    expect((await r.json()).error).toContain('sustentado');
  });

  it('falha do provedor: 502 sem vazar o erro interno', async () => {
    complete.mockRejectedValue(new Error('chave sk-secreta inválida'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await post(gerar, { pedido: 'x', fontes: [FONTE] });
    spy.mockRestore();
    expect(r.status).toBe(502);
    expect(JSON.stringify(await r.json())).not.toContain('sk-secreta');
  });
});

describe('POST /api/documentos/editar', () => {
  async function base() {
    complete.mockResolvedValueOnce(reply(geracao));
    const r = await post(gerar, { pedido: 'x', fontes: [FONTE], variante: 'ata' });
    return (await r.json()).arvore;
  }

  it('aplica o patch na revisão certa e devolve o PDF novo', async () => {
    const arvore = await base();
    complete.mockResolvedValueOnce(
      reply({
        operacoes: [{ op: 'substituir', blockId: 'capa', bloco: { tipo: 'capa', texto: 'Título novo', classificacao: 'recomendacao', fontes: [] } }],
        lacunas: [],
      }),
    );
    const r = await post(editar, {
      arvore,
      revisaoEsperada: arvore.revisao,
      pedido: 'Troque o título da capa.',
      fontes: [FONTE],
      escopo: ['capa'],
      variante: 'ata',
    });
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.aplicadas).toBe(1);
    expect(corpo.arvore.revisao).toBe(arvore.revisao + 1);
    expect(corpo.manifesto.revisaoDoConteudo).toBe(corpo.arvore.revisao);
  });

  it('revisão desatualizada: 409', async () => {
    const arvore = await base();
    complete.mockResolvedValueOnce(
      reply({
        operacoes: [{ op: 'substituir', blockId: 'capa', bloco: { tipo: 'capa', texto: 'Outro', classificacao: 'recomendacao', fontes: [] } }],
        lacunas: [],
      }),
    );
    const r = await post(editar, {
      arvore,
      revisaoEsperada: arvore.revisao + 5,
      pedido: 'Mude a capa.',
      fontes: [FONTE],
      variante: 'ata',
    });
    expect(r.status).toBe(409);
  });

  it('escopo com bloco inexistente: 422', async () => {
    const arvore = await base();
    const r = await post(editar, {
      arvore,
      revisaoEsperada: arvore.revisao,
      pedido: 'x',
      fontes: [FONTE],
      escopo: ['nao-existe'],
    });
    expect(r.status).toBe(422);
  });

  it('árvore malformada: 400', async () => {
    const r = await post(editar, { arvore: { revisao: 1 }, revisaoEsperada: 1, pedido: 'x', fontes: [FONTE] });
    expect(r.status).toBe(400);
  });
});

describe('POST /api/documentos/renderizar', () => {
  const arvore = {
    revisao: 4,
    titulo: 'Doc',
    blocos: [
      { tipo: 'capa', blockId: 'capa', titulo: 'Doc' },
      { tipo: 'paragrafo', blockId: 'p', texto: 'Texto.' },
    ],
  };

  it('árvore → PDF real, sem chamar o modelo, na revisão da árvore', async () => {
    const r = await post(renderizar, { arvore, variante: 'ata' });
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(Buffer.from(corpo.pdf, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    expect(corpo.manifesto.revisaoDoConteudo).toBe(4);
    expect(complete).not.toHaveBeenCalled();
  });

  it('sem chave: 401; árvore com bloco não suportado: 422; variante inexistente: não vira 200', async () => {
    expect((await post(renderizar, { arvore }, null)).status).toBe(401);
    const imagem = { ...arvore, blocos: [{ tipo: 'imagem', blockId: 't', ativoId: 'a', textoAlternativo: 'x' }] };
    expect((await post(renderizar, { arvore: imagem })).status).toBe(422);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await post(renderizar, { arvore, variante: 'nao-existe' })).status).toBeGreaterThanOrEqual(400);
    spy.mockRestore();
  });
});

describe('edição sem fontes', () => {
  it('trocar o título da capa não exige fonte', async () => {
    complete.mockResolvedValueOnce(reply(geracao));
    const g = await post(gerar, { pedido: 'x', fontes: [FONTE], variante: 'ata' });
    const arvore = (await g.json()).arvore;
    complete.mockResolvedValueOnce(
      reply({
        operacoes: [{ op: 'substituir', blockId: 'capa', bloco: { tipo: 'capa', texto: 'Só o título', classificacao: 'recomendacao', fontes: [] } }],
        lacunas: [],
      }),
    );
    const r = await post(editar, { arvore, revisaoEsperada: arvore.revisao, pedido: 'Troque o título.', fontes: [], escopo: ['capa'], variante: 'ata' });
    expect(r.status).toBe(200);
    expect((await r.json()).aplicadas).toBe(1);
    expect(complete.mock.calls[1]![1].cacheablePrefix).toBeUndefined();
  });
});
