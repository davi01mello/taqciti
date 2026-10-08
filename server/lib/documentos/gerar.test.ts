import { afterEach, describe, expect, it, vi } from 'vitest';

const complete = vi.hoisted(() => vi.fn());
vi.mock('../ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai')>()),
  complete,
}));

const { gerarDocumentoPersonalizado, editarDocumentoPersonalizado, ErroDeGeracao, blocoDoModelo, localizadoresDe } =
  await import('./gerar');
const { prontoParaBaixar } = await import('./contratos');

const reply = (parsed: unknown) => ({
  text: JSON.stringify(parsed),
  parsed,
  usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0 },
  meta: { provider: 'google', model: 'falso', latencyMs: 1, repaired: false, rateLimitWaits: 0, overloadWaits: 0 },
});

const FONTE_A = {
  id: 'm-aurora',
  titulo: 'Reunião Aurora',
  texto:
    'Ana: O maior gargalo está na integração com o sistema legado.\n' +
    'Bruno: Podemos avaliar uma camada de API antes de migrar tudo.\n' +
    'Ana: Fechado, começamos pelo piloto no financeiro.',
};
const FONTE_B = {
  id: 'm-borealis',
  titulo: 'Reunião Borealis (OUTRO cliente)',
  texto: 'Carla: O contrato da Borealis vale R$ 900 mil e vence em março.',
};

const fato = (texto: string, fonteId: string, trecho: string) => ({
  tipo: 'paragrafo',
  texto,
  classificacao: 'fato',
  fontes: [{ fonteId, trecho }],
});

const geracaoValida = {
  estrutura: 'Proposta de modernização',
  titulo: 'Proposta para a Aurora',
  subtitulo: 'Diagnóstico e próximos passos',
  secoes: [
    {
      titulo: 'Diagnóstico',
      blocos: [fato('O gargalo está na integração com o legado.', 'm-aurora', 'O maior gargalo está na integração com o sistema legado.')],
    },
    {
      titulo: 'Próximos passos',
      blocos: [
        { tipo: 'paragrafo', texto: 'Recomenda-se começar por uma camada de API.', classificacao: 'recomendacao', fontes: [] },
      ],
    },
  ],
  lacunas: [{ campo: 'Prazo do piloto', pergunta: 'Qual é o prazo previsto para o piloto?' }],
};

afterEach(() => complete.mockReset());

describe('gerarDocumentoPersonalizado', () => {
  it('gera árvore, PDF e manifesto; capa vem da pessoa, não do modelo', async () => {
    complete.mockResolvedValue(
      reply({ ...geracaoValida, titulo: 'Proposta para a Aurora', secoes: geracaoValida.secoes }),
    );
    const r = await gerarDocumentoPersonalizado({
      pedido: 'Monte uma proposta para a Aurora com o que discutimos.',
      fontes: [FONTE_A],
      capa: { cliente: 'Aurora', autor: 'CITi', data: '08/10/2026' },
      variante: 'ata',
    });

    expect(r.pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(r.manifesto.paginas).toBeGreaterThanOrEqual(2);
    expect(r.manifesto.revisaoDoConteudo).toBe(r.arvore.revisao);
    expect(prontoParaBaixar(r.manifesto, r.arvore.revisao, 'pdf')).toBe(true);
    expect(r.arvore.blocos[0]).toMatchObject({ tipo: 'capa', cliente: 'Aurora', autor: 'CITi', data: '08/10/2026' });
    expect(r.lacunas).toEqual([{ campo: 'Prazo do piloto', pergunta: 'Qual é o prazo previsto para o piloto?' }]);
    expect(r.relatorio.problemas).toEqual([]);
    // Honestidade do relatório: a inspeção visual não aconteceu.
    expect(r.relatorio.limitacoes.join(' ')).toContain('não foram inspecionadas visualmente');
  });

  it('o modelo recebe só as fontes selecionadas, e as fontes vão no prefixo', async () => {
    complete.mockResolvedValue(reply(geracaoValida));
    await gerarDocumentoPersonalizado({ pedido: 'x', fontes: [FONTE_A], variante: 'ata' });
    const [agente, req] = complete.mock.calls[0]!;
    expect(agente).toBe('leitor');
    expect(req.cacheablePrefix).toContain('FONTE m-aurora');
    expect(req.cacheablePrefix).not.toContain('Borealis');
    expect(req.system).toContain('Não invente nomes');
  });

  it('REMOVE fato sem citação localizável e o registra como problema de sustentação', async () => {
    complete.mockResolvedValue(
      reply({
        ...geracaoValida,
        secoes: [
          {
            titulo: 'Diagnóstico',
            blocos: [
              fato('O gargalo está na integração.', 'm-aurora', 'O maior gargalo está na integração com o sistema legado.'),
              fato('O orçamento aprovado é de R$ 500 mil.', 'm-aurora', 'O orçamento aprovado é de R$ 500 mil.'),
            ],
          },
        ],
      }),
    );
    const r = await gerarDocumentoPersonalizado({ pedido: 'x', fontes: [FONTE_A], variante: 'ata' });
    const textos = JSON.stringify(r.arvore.blocos);
    expect(textos).toContain('gargalo');
    expect(textos).not.toContain('R$ 500 mil');
    expect(r.relatorio.problemas).toHaveLength(1);
    expect(r.relatorio.problemas[0]).toMatchObject({ tipo: 'sustentacao' });
  });

  it('fonte de outro cliente não sustenta nada: citação da Borealis é descartada', async () => {
    complete.mockResolvedValue(
      reply({
        ...geracaoValida,
        secoes: [
          {
            titulo: 'Contrato',
            blocos: [fato('O contrato vale R$ 900 mil.', 'm-borealis', 'O contrato da Borealis vale R$ 900 mil e vence em março.')],
          },
        ],
      }),
    );
    // A Borealis NÃO foi selecionada: só a Aurora chega ao gerador.
    await expect(gerarDocumentoPersonalizado({ pedido: 'x', fontes: [FONTE_A], variante: 'ata' })).rejects.toThrow(
      /Nenhum trecho do documento ficou sustentado/,
    );
  });

  it('seção que perde todo o conteúdo some com o título', async () => {
    complete.mockResolvedValue(
      reply({
        ...geracaoValida,
        secoes: [
          ...geracaoValida.secoes,
          { titulo: 'Orçamento', blocos: [fato('Custa R$ 1 milhão.', 'm-aurora', 'Custa R$ 1 milhão.')] },
        ],
      }),
    );
    const r = await gerarDocumentoPersonalizado({ pedido: 'x', fontes: [FONTE_A], variante: 'ata' });
    expect(JSON.stringify(r.arvore.blocos)).not.toContain('Orçamento');
  });

  it('recomendação entra como recomendação, sem exigir citação', async () => {
    complete.mockResolvedValue(reply(geracaoValida));
    const r = await gerarDocumentoPersonalizado({ pedido: 'x', fontes: [FONTE_A], variante: 'ata' });
    const rec = r.arvore.blocos.find((b) => b.classificacao === 'recomendacao');
    expect(rec).toBeDefined();
    expect(rec?.fontes).toEqual([]);
  });

  it('avisa quando passa do limite firme de páginas, sem cortar nada', async () => {
    complete.mockResolvedValue(reply(geracaoValida));
    const r = await gerarDocumentoPersonalizado({
      pedido: 'x',
      fontes: [FONTE_A],
      variante: 'ata',
      extensao: { paginas: 1, tipo: 'firme' },
    });
    expect(r.relatorio.problemas.some((p) => p.tipo === 'visual' && p.descricao.includes('limite pedido'))).toBe(true);
    expect(JSON.stringify(r.arvore.blocos)).toContain('gargalo');
  });

  it('entrada ruim: pedido vazio, sem fontes ou fonte repetida', async () => {
    await expect(gerarDocumentoPersonalizado({ pedido: ' ', fontes: [FONTE_A] })).rejects.toBeInstanceOf(ErroDeGeracao);
    await expect(gerarDocumentoPersonalizado({ pedido: 'x', fontes: [] })).rejects.toThrow(/Nenhuma fonte/);
    await expect(gerarDocumentoPersonalizado({ pedido: 'x', fontes: [FONTE_A, FONTE_A] })).rejects.toThrow(/repetida/);
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('blocoDoModelo', () => {
  const ctx = { locators: localizadoresDe([FONTE_A]), origem: 'agente' as const };

  it('aceita citação com espaço e caixa diferentes (normalização leve), rejeita paráfrase', () => {
    const ok = blocoDoModelo(fato('x', 'm-aurora', 'o maior gargalo   está na integração com o sistema legado.'), 'b1', ctx);
    expect('bloco' in ok).toBe(true);
    const parafrase = blocoDoModelo(fato('x', 'm-aurora', 'O principal problema é o legado.'), 'b2', ctx);
    expect('problema' in parafrase).toBe(true);
  });

  it('tipo desconhecido vira problema estrutural, não exceção', () => {
    const r = blocoDoModelo({ tipo: 'html', texto: '<b>', classificacao: 'recomendacao' }, 'b3', ctx);
    expect(r).toMatchObject({ problema: { tipo: 'estrutural' } });
  });
});

describe('editarDocumentoPersonalizado', () => {
  async function documentoBase() {
    complete.mockResolvedValueOnce(reply(geracaoValida));
    return gerarDocumentoPersonalizado({
      pedido: 'x',
      fontes: [FONTE_A],
      capa: { cliente: 'Aurora', autor: 'CITi', data: '08/10/2026' },
      variante: 'ata',
    });
  }

  it('troca só o título da capa: corpo intacto, dados da pessoa preservados, revisão sobe', async () => {
    const base = await documentoBase();
    complete.mockResolvedValueOnce(
      reply({
        operacoes: [
          { op: 'substituir', blockId: 'capa', bloco: { tipo: 'capa', texto: 'Novo título', classificacao: 'recomendacao', fontes: [] } },
        ],
        lacunas: [],
      }),
    );
    const r = await editarDocumentoPersonalizado({
      arvore: base.arvore,
      revisaoEsperada: base.arvore.revisao,
      pedido: 'Troque apenas o título da capa para Novo título.',
      fontes: [FONTE_A],
      escopo: ['capa'],
      variante: 'ata',
    });
    expect(r.aplicadas).toBe(1);
    expect(r.arvore.revisao).toBe(base.arvore.revisao + 1);
    expect(r.arvore.blocos[0]).toMatchObject({ tipo: 'capa', titulo: 'Novo título', cliente: 'Aurora', autor: 'CITi' });
    expect(r.arvore.blocos.slice(1)).toEqual(base.arvore.blocos.slice(1));
    expect(r.manifesto.revisaoDoConteudo).toBe(r.arvore.revisao);
    expect(prontoParaBaixar(r.manifesto, base.arvore.revisao, 'pdf')).toBe(false);
  });

  it('operação fora do escopo é recusada e nada muda', async () => {
    const base = await documentoBase();
    const alvo = base.arvore.blocos.find((b) => b.tipo === 'paragrafo')!;
    complete.mockResolvedValueOnce(
      reply({ operacoes: [{ op: 'remover', blockId: alvo.blockId }], lacunas: [] }),
    );
    const r = await editarDocumentoPersonalizado({
      arvore: base.arvore,
      revisaoEsperada: base.arvore.revisao,
      pedido: 'Mude a capa.',
      fontes: [FONTE_A],
      escopo: ['capa'],
      variante: 'ata',
    });
    expect(r.aplicadas).toBe(0);
    expect(r.recusadas[0]).toContain('fora do escopo');
    expect(r.arvore.blocos).toEqual(base.arvore.blocos);
  });

  it('edição humana sobrevive: bloco de pessoa não selecionado não é alterado', async () => {
    const base = await documentoBase();
    const alvo = base.arvore.blocos.find((b) => b.tipo === 'paragrafo')!;
    const arvore = {
      ...base.arvore,
      blocos: base.arvore.blocos.map((b) => (b.blockId === alvo.blockId ? { ...b, origem: 'pessoa' as const } : b)),
    };
    complete.mockResolvedValueOnce(
      reply({ operacoes: [{ op: 'remover', blockId: alvo.blockId }], lacunas: [] }),
    );
    const r = await editarDocumentoPersonalizado({
      arvore,
      revisaoEsperada: arvore.revisao,
      pedido: 'Reescreva o documento inteiro.',
      fontes: [FONTE_A],
      variante: 'ata',
    });
    expect(r.aplicadas).toBe(0);
    expect(r.recusadas[0]).toContain('escrito por uma pessoa');
  });

  it('conteúdo novo sem sustentação é descartado e entra no relatório', async () => {
    const base = await documentoBase();
    const ultimo = base.arvore.blocos[base.arvore.blocos.length - 1]!;
    complete.mockResolvedValueOnce(
      reply({
        operacoes: [
          { op: 'inserir_depois', blockId: ultimo.blockId, bloco: fato('O custo total é R$ 2 milhões.', 'm-aurora', 'custo total R$ 2 milhões') },
        ],
        lacunas: [{ campo: 'Custo', pergunta: 'Qual é o custo total?' }],
      }),
    );
    const r = await editarDocumentoPersonalizado({
      arvore: base.arvore,
      revisaoEsperada: base.arvore.revisao,
      pedido: 'Inclua o custo total.',
      fontes: [FONTE_A],
      variante: 'ata',
    });
    expect(r.aplicadas).toBe(0);
    expect(JSON.stringify(r.arvore.blocos)).not.toContain('2 milhões');
    expect(r.relatorio.problemas[0]).toMatchObject({ tipo: 'sustentacao' });
    expect(r.lacunas).toEqual([{ campo: 'Custo', pergunta: 'Qual é o custo total?' }]);
  });

  it('revisão velha é recusada (conflito), sem gerar arquivo', async () => {
    const base = await documentoBase();
    complete.mockResolvedValueOnce(
      reply({
        operacoes: [
          { op: 'substituir', blockId: 'capa', bloco: { tipo: 'capa', texto: 'Outro', classificacao: 'recomendacao', fontes: [] } },
        ],
        lacunas: [],
      }),
    );
    await expect(
      editarDocumentoPersonalizado({
        arvore: base.arvore,
        revisaoEsperada: base.arvore.revisao - 1,
        pedido: 'Mude a capa.',
        fontes: [FONTE_A],
        variante: 'ata',
      }),
    ).rejects.toThrow(/Revisão esperada/);
  });

  it('a capa não pode ser removida, e bloco inexistente no escopo é erro de entrada', async () => {
    const base = await documentoBase();
    complete.mockResolvedValueOnce(reply({ operacoes: [{ op: 'remover', blockId: 'capa' }], lacunas: [] }));
    const r = await editarDocumentoPersonalizado({
      arvore: base.arvore,
      revisaoEsperada: base.arvore.revisao,
      pedido: 'Tire a capa.',
      fontes: [FONTE_A],
      variante: 'ata',
    });
    expect(r.recusadas[0]).toContain('a capa não pode ser removida');
    await expect(
      editarDocumentoPersonalizado({
        arvore: base.arvore,
        revisaoEsperada: base.arvore.revisao,
        pedido: 'x',
        fontes: [FONTE_A],
        escopo: ['nao-existe'],
      }),
    ).rejects.toBeInstanceOf(ErroDeGeracao);
  });
});

describe('tabelas na geração', () => {
  const tabela = (over: Record<string, unknown> = {}) => ({
    tipo: 'tabela',
    cabecalho: ['Item', 'Situação'],
    linhas: [
      ['Integração', 'Gargalo principal'],
      ['Piloto', 'Começa no financeiro', 'coluna extra que deve ser descartada'],
      ['Prazo'],
    ],
    legenda: 'Resumo do diagnóstico.',
    classificacao: 'fato',
    fontes: [{ fonteId: 'm-aurora', trecho: 'O maior gargalo está na integração com o sistema legado.' }],
    ...over,
  });

  it('tabela sustentada entra, com as linhas normalizadas para o número de colunas', async () => {
    complete.mockResolvedValue(reply({ ...geracaoValida, secoes: [{ titulo: 'Quadro', blocos: [tabela()] }] }));
    const r = await gerarDocumentoPersonalizado({ pedido: 'x', fontes: [FONTE_A], variante: 'ata' });
    const bloco = r.arvore.blocos.find((b) => b.tipo === 'tabela');
    expect(bloco).toMatchObject({
      cabecalho: ['Item', 'Situação'],
      linhas: [
        ['Integração', 'Gargalo principal'],
        ['Piloto', 'Começa no financeiro'],
        ['Prazo', ''],
      ],
      legenda: 'Resumo do diagnóstico.',
    });
    expect(r.pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('tabela de fatos sem citação localizável é removida como qualquer fato', async () => {
    complete.mockResolvedValue(
      reply({
        ...geracaoValida,
        secoes: [
          ...geracaoValida.secoes,
          { titulo: 'Orçamento', blocos: [tabela({ fontes: [{ fonteId: 'm-aurora', trecho: 'custo de R$ 9 milhões' }] })] },
        ],
      }),
    );
    const r = await gerarDocumentoPersonalizado({ pedido: 'x', fontes: [FONTE_A], variante: 'ata' });
    expect(r.arvore.blocos.some((b) => b.tipo === 'tabela')).toBe(false);
    expect(r.relatorio.problemas[0]).toMatchObject({ tipo: 'sustentacao' });
  });

  it('tabela sem colunas é descartada como inválida, sem exceção', () => {
    const r = blocoDoModelo(tabela({ cabecalho: [] }), 'b1', { locators: localizadoresDe([FONTE_A]), origem: 'agente' });
    expect(r).toMatchObject({ problema: { tipo: 'estrutural' } });
  });
});
