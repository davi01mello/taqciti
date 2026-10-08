import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PERFIL_CITI_PROVISORIO,
  perfilSchema,
  problemasDoPerfil,
  resolverPerfil,
  resolverVariante,
  diagnosticarVariante,
  varianteAplicavel,
  PAPEIS_DE_ESTILO,
} from './perfil';
import {
  aplicarPatch,
  blocoSchema,
  ConflitoDeRevisao,
  contentTreeSchema,
  validarArvore,
  type ContentTree,
} from './contentTree';
import { documentBriefSchema, prontoParaBaixar, type RenderManifest } from './contratos';

const arvore = (over: Partial<ContentTree> = {}): ContentTree =>
  contentTreeSchema.parse({
    revisao: 3,
    titulo: 'Proposta Aurora',
    blocos: [
      { tipo: 'capa', blockId: 'capa', titulo: 'Proposta Aurora' },
      { tipo: 'titulo', blockId: 't1', nivel: 1, texto: 'Contexto' },
      { tipo: 'paragrafo', blockId: 'p1', texto: 'Texto.', classificacao: 'fato', fontes: [{ fonteId: 'm1' }] },
    ],
    ...over,
  });

describe('perfil documental', () => {
  it('o perfil provisório é válido, provisório e não tem validador', () => {
    expect(() => perfilSchema.parse(PERFIL_CITI_PROVISORIO)).not.toThrow();
    expect(PERFIL_CITI_PROVISORIO.estado).toBe('provisorio');
    expect(problemasDoPerfil(PERFIL_CITI_PROVISORIO)).toEqual([]);
  });

  it('tem as variantes ata (padrão) e editorial', () => {
    expect(PERFIL_CITI_PROVISORIO.variantes.map((v) => v.id)).toEqual(['ata', 'editorial']);
    expect(resolverVariante(PERFIL_CITI_PROVISORIO).id).toBe('ata');
    expect(resolverVariante(PERFIL_CITI_PROVISORIO, 'editorial').id).toBe('editorial');
    expect(() => resolverVariante(PERFIL_CITI_PROVISORIO, 'inexistente')).toThrow();
  });

  it('toda variante define todos os papéis de estilo, cada um com proveniência', () => {
    for (const variante of PERFIL_CITI_PROVISORIO.variantes) {
      for (const papel of PAPEIS_DE_ESTILO) {
        expect(variante.estilos[papel]?.proveniencia.referencia, `${variante.id}/${papel}`).toBeTruthy();
      }
    }
  });

  it('o que não vem do modelo é marcado como inferido, não como observado', () => {
    const ata = resolverVariante(PERFIL_CITI_PROVISORIO, 'ata');
    const editorial = resolverVariante(PERFIL_CITI_PROVISORIO, 'editorial');
    expect(ata.estilos.legenda?.proveniencia.tipo).toBe('inferida');
    expect(editorial.estilos.legenda?.proveniencia.tipo).toBe('inferida');
  });

  it('a variante editorial registra as medidas e as cores observadas na apostila', () => {
    const editorial = resolverVariante(PERFIL_CITI_PROVISORIO, 'editorial');
    expect(editorial.pagina.margemPt.valor).toBe(54);
    expect(editorial.estilos.corpo?.valor).toMatchObject({ tamanhoPt: 9.7, entrelinha: 1.54 });
    expect(editorial.cores.verde?.valor).toBe('#12957A');
    expect(editorial.cores.fundoDestaqueEscuro?.valor).toBe('#081021');
    expect(editorial.componentes.map((c) => c.id)).toEqual(
      expect.arrayContaining(['capa_gradiente', 'destaque_formula', 'atividade_com_pauta', 'tabela_listrada']),
    );
  });

  it('a variante ata é aplicável sem nenhuma pendência', () => {
    const ata = resolverVariante(PERFIL_CITI_PROVISORIO, 'ata');
    expect(diagnosticarVariante(ata)).toEqual([]);
    expect(varianteAplicavel(ata)).toBe(true);
  });

  it('a editorial é aplicável, mas só pelas substituições autorizadas — e o diagnóstico as lista', () => {
    const editorial = resolverVariante(PERFIL_CITI_PROVISORIO, 'editorial');
    const faltas = diagnosticarVariante(editorial);
    expect(faltas.length).toBeGreaterThan(0);
    expect(faltas.every((f) => f.tipo === 'fonte_ausente' && f.substituicao)).toBe(true);
    expect(faltas.find((f) => f.item.startsWith('Neue Haas'))?.substituicao).toBe('Barlow');
    expect(faltas.find((f) => f.item.startsWith('Monoespaçada'))?.substituicao).toBe('JetBrains Mono');
    expect(varianteAplicavel(editorial)).toBe(true);
    // Toda substituição tem registro de quem autorizou.
    for (const fonte of editorial.fontes.filter((f) => f.substituicaoAutorizada)) {
      expect(fonte.autorizacao, fonte.familia).toBeTruthy();
    }
  });

  it('sem a autorização, fonte ausente volta a bloquear a variante', () => {
    const base = resolverVariante(PERFIL_CITI_PROVISORIO, 'editorial');
    const semAutorizacao = {
      ...base,
      fontes: base.fontes.map(({ substituicaoAutorizada: _s, autorizacao: _a, ...f }) => f),
    };
    expect(varianteAplicavel(semAutorizacao)).toBe(false);
  });

  it('ativo ausente bloqueia, e todo arquivo declarado existe no disco', () => {
    const base = resolverVariante(PERFIL_CITI_PROVISORIO, 'editorial');
    expect(
      varianteAplicavel({
        ...base,
        ativos: [...base.ativos, { id: 'x', descricao: 'Arte que falta', disponibilidade: 'ausente' }],
      }),
    ).toBe(false);

    const raiz = resolve(__dirname, '../../..');
    for (const variante of PERFIL_CITI_PROVISORIO.variantes) {
      const arquivos = [...variante.ativos, ...variante.fontes]
        .filter((i) => i.disponibilidade === 'presente' && i.arquivo)
        .map((i) => i.arquivo!);
      for (const arquivo of arquivos) {
        expect(existsSync(resolve(raiz, arquivo)), arquivo).toBe(true);
      }
    }
  });
  it('o perfil avisa que a apostila é só referência visual', () => {
    expect(PERFIL_CITI_PROVISORIO.observacoes.join(' ')).toContain('ESTILO VISUAL');
  });

  it('validado sem quem validou é inconsistente, e provisório com validação também', () => {
    expect(problemasDoPerfil({ ...PERFIL_CITI_PROVISORIO, estado: 'validado' })).toHaveLength(1);
    expect(
      problemasDoPerfil({ ...PERFIL_CITI_PROVISORIO, validacao: { por: 'x', em: '2026-10-08' } }),
    ).toHaveLength(1);
  });

  it('perfil inexistente falha em vez de cair em padrão inventado', () => {
    expect(resolverPerfil('citi').id).toBe('citi');
    expect(() => resolverPerfil('outro')).toThrow();
  });
});
describe('ContentTree', () => {
  it('não aceita bloco de HTML livre nem tipo desconhecido', () => {
    expect(blocoSchema.safeParse({ tipo: 'html', blockId: 'x', html: '<b>' }).success).toBe(false);
  });

  it('imagem exige texto alternativo', () => {
    expect(blocoSchema.safeParse({ tipo: 'imagem', blockId: 'i', ativoId: 'a' }).success).toBe(false);
  });

  it('árvore correta não tem problemas', () => {
    expect(validarArvore(arvore())).toEqual([]);
  });

  it('acusa id duplicado, capa fora do começo, fato sem fonte e bloco não suportado', () => {
    const problemas = validarArvore(
      arvore({
        blocos: [
          { tipo: 'titulo', blockId: 'a', nivel: 1, texto: 'A', fontes: [], origem: 'agente' },
          { tipo: 'capa', blockId: 'a', variante: 'padrao', titulo: 'C', fontes: [], origem: 'agente' },
          { tipo: 'paragrafo', blockId: 'b', texto: 'x', classificacao: 'fato', fontes: [], origem: 'agente' },
          { tipo: 'sumario', blockId: 's', fontes: [], origem: 'agente' },
        ],
      }),
    ).map((p) => p.problema);
    expect(problemas).toEqual(
      expect.arrayContaining([
        'blockId duplicado.',
        'A capa só pode ser o primeiro bloco.',
        'Fato sem fonte registrada.',
        'O bloco "sumario" ainda não é suportado pelo compilador.',
      ]),
    );
  });

  it('patch troca só o bloco pedido, sobe a revisão e preserva o resto', () => {
    const antes = arvore();
    const depois = aplicarPatch(antes, 3, [
      {
        op: 'substituir',
        blockId: 'capa',
        bloco: blocoSchema.parse({ tipo: 'capa', blockId: 'capa', titulo: 'Novo título' }),
      },
    ]);
    expect(depois.revisao).toBe(4);
    expect(depois.blocos[0]).toMatchObject({ titulo: 'Novo título' });
    expect(depois.blocos.slice(1)).toEqual(antes.blocos.slice(1));
    expect(antes.revisao).toBe(3);
  });

  it('patch com revisão velha é recusado, e bloco inexistente também', () => {
    expect(() => aplicarPatch(arvore(), 2, [])).toThrow(ConflitoDeRevisao);
    expect(() => aplicarPatch(arvore(), 3, [{ op: 'remover', blockId: 'nao-existe' }])).toThrow();
  });

  it('insere depois de um bloco, ou no começo com null', () => {
    const novo = blocoSchema.parse({ tipo: 'paragrafo', blockId: 'n', texto: 'N' });
    expect(aplicarPatch(arvore(), 3, [{ op: 'inserir_depois', blockId: 't1', bloco: novo }]).blocos[2]).toMatchObject({ blockId: 'n' });
    expect(aplicarPatch(arvore(), 3, [{ op: 'inserir_depois', blockId: null, bloco: novo }]).blocos[0]).toMatchObject({ blockId: 'n' });
  });
});

describe('contratos', () => {
  it('o brief nasce com perfil CITi, idioma pt-BR e sem pendências', () => {
    const brief = documentBriefSchema.parse({
      finalidade: 'Proposta',
      pedido: 'Monte uma proposta',
      fontesSelecionadas: ['m1'],
      formatos: ['pdf'],
    });
    expect(brief).toMatchObject({ perfilId: 'citi', idioma: 'pt-BR', camposPendentes: [] });
  });

  it('só está pronto para baixar com artefato da revisão corrente', () => {
    const manifesto: RenderManifest = {
      revisaoDoConteudo: 3,
      perfilId: 'citi',
      perfilVersao: 1,
      perfilEstado: 'provisorio',
      rendererVersao: '1',
      ativosEFontes: [],
      formatos: [{ formato: 'pdf', hash: 'a'.repeat(64) }],
    };
    expect(prontoParaBaixar(manifesto, 3, 'pdf')).toBe(true);
    expect(prontoParaBaixar(manifesto, 4, 'pdf')).toBe(false);
    expect(prontoParaBaixar(manifesto, 3, 'docx')).toBe(false);
    expect(prontoParaBaixar(undefined, 3, 'pdf')).toBe(false);
  });
});
