/**
 * Documentos personalizados do lado da extensão — dados sintéticos.
 *
 * Seguram: o documento e o histórico nascem juntos (e um não sobrevive sem o
 * outro), gravar exige a revisão lida, restaurar cria versão nova em vez de
 * reescrever, o histórico tem teto, e cada status do servidor vira uma
 * mensagem com a causa certa.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { apagarDocumento, lerDocumentos } from '../store';
import { editarPersonalizado, gerarPersonalizado, renderizarArvore } from './cliente';
import { guardarEdicao, guardarGeracao } from './documento';
import { arvoreParaMarkdown } from './markdown';
import type { ArvoreDoDocumento, ResultadoDoServidor } from './tipos';
import {
  lerHistorico,
  MAX_VERSOES,
  registrarVersao,
  restaurarVersao,
  versaoAtual,
} from './versoes';

const arvore = (revisao: number, titulo = 'Proposta Aurora'): ArvoreDoDocumento => ({
  revisao,
  titulo,
  lacunas: [],
  blocos: [
    { tipo: 'capa', blockId: 'capa', variante: 'padrao', titulo, subtitulo: 'Diagnóstico', fontes: [], origem: 'agente' },
    { tipo: 'titulo', blockId: 't1', nivel: 1, texto: 'Contexto', fontes: [], origem: 'agente' },
    { tipo: 'paragrafo', blockId: 'p1', texto: 'O gargalo é a integração.', fontes: [], origem: 'agente' },
    { tipo: 'lista', blockId: 'l1', ordenada: true, itens: ['Validar', 'Estimar'], fontes: [], origem: 'agente' },
  ],
});

const resultado = (revisao: number, extra: Partial<ResultadoDoServidor> = {}): ResultadoDoServidor => ({
  arvore: arvore(revisao),
  pdf: 'JVBERg==',
  manifesto: {
    revisaoDoConteudo: revisao,
    perfilId: 'citi',
    perfilVersao: 2,
    perfilEstado: 'provisorio',
    rendererVersao: 'x',
    ativosEFontes: [],
    formatos: [{ formato: 'pdf', hash: 'a'.repeat(64) }],
    paginas: 3,
  },
  relatorio: { problemas: [], verificacoesRealizadas: ['x'], limitacoes: [] },
  avisos: [],
  lacunas: [],
  ...extra,
});

const PEDIDO = { pedido: 'Monte uma proposta.', fontes: [{ id: 'm1', titulo: 'R', texto: 'texto' }], variante: 'editorial' };

beforeEach(() => {
  installChromeStorageMock();
});

describe('markdown da árvore', () => {
  it('a capa vira título, e os blocos mantêm a ordem e a numeração', () => {
    expect(arvoreParaMarkdown(arvore(1))).toBe(
      ['# Proposta Aurora', '', '_Diagnóstico_', '', '## Contexto', '', 'O gargalo é a integração.', '', '1. Validar\n2. Estimar'].join('\n'),
    );
  });

  it('sumário não ganha números inventados na vista em texto; imagem e referência têm representação', () => {
    const a = arvore(1);
    const base = { fontes: [], origem: 'agente' as const };
    a.blocos.push(
      { ...base, tipo: 'sumario', blockId: 's' },
      { ...base, tipo: 'imagem', blockId: 'i', ativoId: 'forma-3d-1', textoAlternativo: 'Forma 3D', legenda: 'Arte.' },
      { ...base, tipo: 'referencia', blockId: 'r', texto: 'Fonte: reunião.' },
    );
    const md = arvoreParaMarkdown(a);
    expect(md).not.toContain('Sumário');
    expect(md).toContain('_[Imagem: Forma 3D]_\nArte.');
    expect(md).toContain('> Fonte: reunião.');
  });

  it('a tabela vira tabela em markdown, com a legenda abaixo', () => {
    const a = arvore(1);
    a.blocos.push({
      tipo: 'tabela',
      blockId: 'tab',
      cabecalho: ['Item', 'Valor'],
      linhas: [['A | B', 'R$ 1']],
      legenda: 'Fonte: reunião.',
      fontes: [],
      origem: 'agente',
    });
    expect(arvoreParaMarkdown(a)).toContain('| Item | Valor |\n| --- | --- |\n| A \\| B | R$ 1 |\n_Fonte: reunião._');
  });
});

describe('guardarGeracao', () => {
  it('cria o documento listável e o histórico, com as fontes e a variante', async () => {
    const { documento, historico } = await guardarGeracao(resultado(1), PEDIDO, { meetingId: 'm1' });
    expect(documento).toMatchObject({ tipo: 'personalizado', origem: 'gerado', meetingId: 'm1', title: 'Proposta Aurora' });
    expect(documento.content).toContain('## Contexto');
    expect(historico).toMatchObject({ documentoId: documento.id, variante: 'editorial', fontesIds: ['m1'] });
    expect(versaoAtual(historico)).toMatchObject({ revisao: 1, origem: 'geracao', pedido: PEDIDO.pedido, problemas: 0 });
    expect((await lerDocumentos()).map((d) => d.id)).toEqual([documento.id]);
  });

  it('guarda só a árvore e o manifesto — nunca o PDF', async () => {
    const { documento } = await guardarGeracao(resultado(1), PEDIDO);
    const historico = await lerHistorico(documento.id);
    expect(JSON.stringify(historico)).not.toContain('JVBERg');
  });
});

describe('guardarEdicao', () => {
  it('acrescenta a versão, sobe a revisão e atualiza o texto do documento', async () => {
    const { documento } = await guardarGeracao(resultado(1), PEDIDO);
    const editada = resultado(2, { aplicadas: 1 });
    editada.arvore = arvore(2, 'Título novo');
    const r = await guardarEdicao(documento.id, 1, editada, 'Troque o título.');
    expect(r.tipo).toBe('ok');
    const historico = (await lerHistorico(documento.id))!;
    expect(historico.versoes.map((v) => [v.revisao, v.origem])).toEqual([
      [1, 'geracao'],
      [2, 'edicao'],
    ]);
    expect((await lerDocumentos())[0]).toMatchObject({ title: 'Título novo' });
  });

  it('edição sem operação aplicada não cria versão', async () => {
    const { documento } = await guardarGeracao(resultado(1), PEDIDO);
    expect(await guardarEdicao(documento.id, 1, resultado(1, { aplicadas: 0 }), 'x')).toEqual({ tipo: 'sem_mudanca' });
    expect((await lerHistorico(documento.id))!.versoes).toHaveLength(1);
  });

  it('revisão velha dá conflito e não grava nada', async () => {
    const { documento } = await guardarGeracao(resultado(1), PEDIDO);
    await guardarEdicao(documento.id, 1, resultado(2, { aplicadas: 1 }), 'a');
    const r = await guardarEdicao(documento.id, 1, resultado(3, { aplicadas: 1 }), 'b');
    expect(r.tipo).toBe('conflito');
    expect((await lerHistorico(documento.id))!.versoes).toHaveLength(2);
  });

  it('documento sem histórico: inexistente', async () => {
    expect(await guardarEdicao('nao-existe', 1, resultado(2, { aplicadas: 1 }), 'x')).toEqual({ tipo: 'inexistente' });
  });
});

describe('registrarVersao', () => {
  it('recusa revisão que não avança', async () => {
    const { documento } = await guardarGeracao(resultado(1), PEDIDO);
    const r = await registrarVersao(documento.id, 1, {
      revisao: 1,
      arvore: arvore(1),
      criadaEm: 1,
      origem: 'edicao',
      problemas: 0,
    });
    expect(r.tipo).toBe('invalida');
  });

  it('poda o histórico no teto e preserva sempre a atual', async () => {
    const { documento } = await guardarGeracao(resultado(1), PEDIDO);
    for (let rev = 2; rev <= MAX_VERSOES + 5; rev++) {
      const r = await registrarVersao(documento.id, rev - 1, {
        revisao: rev,
        arvore: arvore(rev),
        criadaEm: rev,
        origem: 'edicao',
        problemas: 0,
      });
      expect(r.tipo).toBe('ok');
    }
    const h = (await lerHistorico(documento.id))!;
    expect(h.versoes).toHaveLength(MAX_VERSOES);
    expect(versaoAtual(h).revisao).toBe(MAX_VERSOES + 5);
    expect(h.versoes[0]!.revisao).toBe(6);
  });
});

describe('restaurarVersao', () => {
  it('volta a uma revisão antiga COMO versão nova, sem reescrever o histórico', async () => {
    const { documento } = await guardarGeracao(resultado(1), PEDIDO);
    const editada = resultado(2, { aplicadas: 1 });
    editada.arvore = arvore(2, 'Outro título');
    await guardarEdicao(documento.id, 1, editada, 'mudei');

    const r = await restaurarVersao(documento.id, 1, 2);
    expect(r.tipo).toBe('ok');
    const h = (await lerHistorico(documento.id))!;
    expect(h.versoes.map((v) => v.revisao)).toEqual([1, 2, 3]);
    const nova = versaoAtual(h);
    expect(nova).toMatchObject({ revisao: 3, origem: 'restauracao' });
    expect(nova.arvore.titulo).toBe('Proposta Aurora');
    expect(nova.arvore.revisao).toBe(3);
    // O arquivo desta versão ainda não existe: sem manifesto, não "pronto".
    expect(nova.manifesto).toBeUndefined();
    // As antigas continuam intactas.
    expect(h.versoes[1]!.arvore.titulo).toBe('Outro título');
  });

  it('revisão alvo inexistente ou revisão esperada velha são recusadas', async () => {
    const { documento } = await guardarGeracao(resultado(1), PEDIDO);
    expect((await restaurarVersao(documento.id, 9, 1)).tipo).toBe('invalida');
    expect((await restaurarVersao(documento.id, 1, 7)).tipo).toBe('conflito');
    expect((await restaurarVersao('nao-existe', 1, 1)).tipo).toBe('inexistente');
  });
});

describe('apagar', () => {
  it('apagar o documento apaga o histórico junto', async () => {
    const { documento } = await guardarGeracao(resultado(1), PEDIDO);
    await apagarDocumento(documento.id);
    expect(await lerHistorico(documento.id)).toBeNull();
    expect(await lerDocumentos()).toEqual([]);
  });
});

describe('cliente da API', () => {
  const fetchMock = vi.fn();
  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  const resposta = (status: number, corpo: unknown) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => corpo }) as Response;

  it('sucesso devolve os dados; a chamada leva a chave e NÃO se declara sintética', async () => {
    fetchMock.mockResolvedValue(resposta(200, resultado(1)));
    const r = await gerarPersonalizado({ ...PEDIDO });
    expect(r.status).toBe('ok');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/api/documentos/gerar');
    expect(init.headers).toHaveProperty('x-docciti-key');
    expect(init.body).not.toContain('sintetica');
  });

  it.each([
    [401, 'chave', 'recusou a chave'],
    [409, 'conflito', 'mudou'],
    [413, 'longo', 'longas demais'],
    [422, 'sem_conteudo', 'Não foi possível montar'],
    [502, 'indisponivel', 'erro (502)'],
  ])('status %i vira o código %s com a mensagem certa', async (status, codigo, trecho) => {
    fetchMock.mockResolvedValue(resposta(status, {}));
    const r = await editarPersonalizado({ arvore: arvore(1), revisaoEsperada: 1, pedido: 'x', fontes: PEDIDO.fontes });
    expect(r).toMatchObject({ status: 'erro', codigo });
    expect((r as { message: string }).message).toContain(trecho);
  });

  it('usa a mensagem do servidor quando ela vem (400 e 422)', async () => {
    fetchMock.mockResolvedValue(resposta(422, { error: 'Nada ficou sustentado pelas fontes.' }));
    const r = await gerarPersonalizado({ ...PEDIDO });
    expect(r).toMatchObject({ codigo: 'sem_conteudo', message: 'Nada ficou sustentado pelas fontes.' });
  });

  it('falha de rede diz as duas causas possíveis', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed'));
    const r = await renderizarArvore(arvore(1));
    expect(r).toMatchObject({ status: 'erro', codigo: 'rede' });
    expect((r as { message: string }).message).toContain('bloqueado');
  });
});
