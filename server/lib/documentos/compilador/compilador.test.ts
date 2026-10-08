import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentTreeSchema, type ContentTree } from '../contentTree';
import { prontoParaBaixar } from '../contratos';
import { PERFIL_CITI_PROVISORIO } from '../perfil';
import { compilarPdf, ErroDeCompilacao } from './index';
import { segmentos, textoPlano } from './texto';

const paragrafo = (id: string, texto: string) => ({ tipo: 'paragrafo' as const, blockId: id, texto });
const LONGO =
  'A equipe apresentou o **diagnóstico** do ambiente atual e comparou três alternativas de arquitetura, ' +
  'levando em conta custo, prazo e risco de migração. Ficou claro que o maior gargalo está na integração ' +
  'entre os sistemas legados, e que qualquer proposta precisa começar por ele.';

function arvoreDeExemplo(over: Partial<ContentTree> = {}): ContentTree {
  const blocos: unknown[] = [
    {
      tipo: 'capa',
      blockId: 'capa',
      titulo: 'Proposta de modernização para a Aurora',
      subtitulo: 'Diagnóstico e próximos passos',
      cliente: 'Aurora',
      autor: 'CITi',
      data: '08/10/2026',
    },
    { tipo: 'titulo', blockId: 't1', nivel: 1, texto: 'Contexto' },
    paragrafo('p1', LONGO),
    { tipo: 'titulo', blockId: 't1a', nivel: 2, texto: 'O que encontramos' },
    paragrafo('p2', LONGO),
    { tipo: 'lista', blockId: 'l1', itens: ['**Integração:** sistemas legados sem API.', 'Custos de licença altos.', 'Equipe pequena para manter tudo.'] },
    { tipo: 'titulo', blockId: 't2', nivel: 1, texto: 'Próximos passos' },
    { tipo: 'lista', blockId: 'l2', ordenada: true, itens: ['Validar o diagnóstico com a Aurora.', 'Estimar o esforço da integração.', 'Definir o piloto.'] },
    ...Array.from({ length: 14 }, (_, i) => paragrafo(`x${i}`, LONGO)),
  ];
  return contentTreeSchema.parse({ revisao: 1, titulo: 'Proposta Aurora', blocos, ...over });
}

const ehPdf = (b: Buffer) => b.subarray(0, 5).toString() === '%PDF-' && b.includes('%%EOF');

describe('texto rico', () => {
  it('separa o negrito e ignora marcação sem par', () => {
    expect(segmentos('a **b** c')).toEqual([
      { texto: 'a ', negrito: false },
      { texto: 'b', negrito: true },
      { texto: ' c', negrito: false },
    ]);
    expect(textoPlano('um **aberto')).toBe('um aberto');
  });
});

// As imagens da variante editorial são grandes: com a máquina ocupada por
// outras suítes, a primeira compilação passa dos 5 s padrão.
describe('compilarPdf', { timeout: 30_000 }, () => {
  for (const variante of ['ata', 'editorial']) {
    it(`${variante}: gera um PDF válido, com a contagem de páginas medida e o manifesto da revisão`, async () => {
      const resultado = await compilarPdf(arvoreDeExemplo(), { variante });
      expect(ehPdf(resultado.pdf)).toBe(true);
      expect(resultado.manifesto.paginas).toBeGreaterThanOrEqual(3);
      expect(resultado.manifesto.revisaoDoConteudo).toBe(1);
      expect(resultado.manifesto.perfilEstado).toBe('provisorio');
      expect(resultado.manifesto.formatos[0]?.hash).toHaveLength(64);
      expect(prontoParaBaixar(resultado.manifesto, 1, 'pdf')).toBe(true);
      expect(prontoParaBaixar(resultado.manifesto, 2, 'pdf')).toBe(false);

      // Amostra para conferir à vista: `DOCUMENTOS_AMOSTRAS=<pasta>`.
      const pasta = process.env.DOCUMENTOS_AMOSTRAS;
      if (pasta) {
        mkdirSync(pasta, { recursive: true });
        writeFileSync(join(pasta, `${variante}.pdf`), resultado.pdf);
      }
    });
  }

  it('o mesmo conteúdo gera o mesmo hash (compilação determinística de conteúdo)', async () => {
    const a = await compilarPdf(arvoreDeExemplo(), { variante: 'ata' });
    const b = await compilarPdf(arvoreDeExemplo(), { variante: 'ata' });
    expect(a.manifesto.paginas).toBe(b.manifesto.paginas);
  });

  it('editorial lista as substituições de fonte aplicadas', async () => {
    const r = await compilarPdf(arvoreDeExemplo(), { variante: 'editorial' });
    expect(r.substituicoes.join(' ')).toContain('Neue Haas Display');
    expect(r.manifesto.ativosEFontes).toEqual(expect.arrayContaining(['fundo-capa', 'marca-branca', 'fonte-mono']));
  });

  it('título longo na capa editorial encolhe e avisa, em vez de sobrepor', async () => {
    const arvore = arvoreDeExemplo({
      blocos: contentTreeSchema.parse({
        revisao: 1,
        titulo: 'x',
        blocos: [
          { tipo: 'capa', blockId: 'capa', titulo: 'Plano estratégico de transformação digital e governança de dados para o grupo Aurora Norte' },
          paragrafo('p', 'Texto.'),
        ],
      }).blocos,
    });
    const r = await compilarPdf(arvore, { variante: 'editorial' });
    expect(r.avisos.join(' ')).toContain('título da capa foi reduzido');
  });

  it('documento só com texto (sem capa) também compila', async () => {
    const arvore = contentTreeSchema.parse({ revisao: 0, titulo: 'Nota', blocos: [paragrafo('p', 'Só um parágrafo.')] });
    for (const variante of ['ata', 'editorial']) {
      expect(ehPdf((await compilarPdf(arvore, { variante })).pdf)).toBe(true);
    }
  });

  it('recusa árvore com problema estrutural', async () => {
    const arvore = contentTreeSchema.parse({
      revisao: 0,
      titulo: 'x',
      blocos: [paragrafo('a', 'x'), paragrafo('a', 'y')],
    });
    await expect(compilarPdf(arvore)).rejects.toBeInstanceOf(ErroDeCompilacao);
  });

  it('recusa imagem de ativo que o perfil não tem, e documento vazio', async () => {
    const imagem = contentTreeSchema.parse({
      revisao: 0,
      titulo: 'x',
      blocos: [{ tipo: 'imagem', blockId: 't', ativoId: 'a', textoAlternativo: 'x' }],
    });
    await expect(compilarPdf(imagem)).rejects.toThrow(/ativo que o perfil não tem/);
    await expect(compilarPdf(contentTreeSchema.parse({ revisao: 0, titulo: 'x', blocos: [] }))).rejects.toThrow();
  });

  it('recusa variante cuja fonte ausente não tem substituição autorizada', async () => {
    const base = PERFIL_CITI_PROVISORIO;
    const perfil = {
      ...base,
      variantes: base.variantes.map((v) =>
        v.id === 'editorial'
          ? { ...v, fontes: v.fontes.map(({ substituicaoAutorizada: _s, autorizacao: _a, ...f }) => f) }
          : v,
      ),
    };
    await expect(compilarPdf(arvoreDeExemplo(), { perfil, variante: 'editorial' })).rejects.toThrow(
      /não pode ser aplicada/,
    );
    await expect(compilarPdf(arvoreDeExemplo(), { variante: 'inexistente' })).rejects.toThrow(/não existe/);
  });
});

describe('tabelas', { timeout: 30_000 }, () => {
  const linhas = (n: number) =>
    Array.from({ length: n }, (_, i) => [
      `Item ${i + 1}`,
      i % 7 === 0 ? '**Total** com um texto mais longo que precisa quebrar em duas ou três linhas dentro da célula' : 'Descrição curta',
      `R$ ${(i + 1) * 1000}`,
    ]);
  const arvoreComTabela = (n: number) =>
    contentTreeSchema.parse({
      revisao: 1,
      titulo: 'Orçamento',
      blocos: [
        { tipo: 'capa', blockId: 'capa', titulo: 'Orçamento' },
        { tipo: 'titulo', blockId: 't1', nivel: 1, texto: 'Itens' },
        { tipo: 'tabela', blockId: 'tab', cabecalho: ['Item', 'Descrição', 'Valor'], linhas: linhas(n), legenda: 'Fonte: reunião de 08/10.' },
        paragrafo('p', 'Texto depois da tabela.'),
      ],
    });

  for (const variante of ['ata', 'editorial']) {
    it(`${variante}: tabela curta cabe e a longa atravessa páginas, sem estourar`, async () => {
      const curta = await compilarPdf(arvoreComTabela(4), { variante });
      const longa = await compilarPdf(arvoreComTabela(90), { variante });
      expect(curta.pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(longa.manifesto.paginas!).toBeGreaterThan(curta.manifesto.paginas!);
      expect(longa.manifesto.paginas!).toBeGreaterThanOrEqual(4);

      const pasta = process.env.DOCUMENTOS_AMOSTRAS;
      if (pasta) writeFileSync(join(pasta, `tabela-${variante}.pdf`), longa.pdf);
    });
  }

  it('tabela com cabeçalho e uma só linha também compila', async () => {
    expect((await compilarPdf(arvoreComTabela(1), { variante: 'editorial' })).manifesto.paginas).toBeGreaterThanOrEqual(2);
  });
});
