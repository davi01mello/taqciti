/**
 * A biblioteca — CRUD, busca, e as invariantes do arquivo semeado.
 *
 * Todo teste que escreve trabalha num arquivo temporário próprio; nenhum toca o
 * arquivo de produção. O único que lê o de produção só LÊ — e é ele que garante
 * que os dados semeados continuam válidos contra o schema.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { abrirBiblioteca, normalizar, termosDe, CAMINHO_PADRAO, ErroDaBiblioteca } from './biblioteca';
import { CATEGORIAS, validarReferencia, type Referencia } from './tipos';

let pasta: string;
let caminho: string;

const MODELO: Referencia = {
  id: 'teste-1',
  titulo: 'Perguntar pelo passado',
  autor: 'Instituto de Teste',
  link: 'https://example.org/teste',
  data: '2024-03-11',
  categoria: 'entender_dor',
  assunto: 'entrevista com cliente',
  tipo: 'pesquisa',
  quando_aplicar: 'Quando o cliente fala do futuro.',
};

beforeEach(async () => {
  pasta = await mkdtemp(join(tmpdir(), 'taqciti-biblioteca-'));
  caminho = join(pasta, 'referencias.json');
});

afterEach(async () => {
  await rm(pasta, { recursive: true, force: true });
});

describe('CRUD', () => {
  it('uma biblioteca que ainda não existe é uma biblioteca vazia', async () => {
    // É o estado de quem acabou de clonar o repositório: não pode ser erro.
    expect(await abrirBiblioteca(caminho).listar()).toEqual([]);
  });

  it('cria, lê de volta e mantém os campos', async () => {
    const biblioteca = abrirBiblioteca(caminho);
    await biblioteca.criar(MODELO);
    expect(await biblioteca.obter('teste-1')).toEqual(MODELO);
    expect(await biblioteca.listar()).toHaveLength(1);
  });

  it('recusa id repetido em vez de sobrescrever calado', async () => {
    const biblioteca = abrirBiblioteca(caminho);
    await biblioteca.criar(MODELO);
    await expect(biblioteca.criar(MODELO)).rejects.toThrow(/já existe/);
  });

  it('recusa referência inválida com todos os motivos de uma vez', async () => {
    const biblioteca = abrirBiblioteca(caminho);
    const erro = await biblioteca
      .criar({ ...MODELO, link: 'javascript:alert(1)', data: '11/03/2024' })
      .then(
        () => null,
        (e: unknown) => e as Error,
      );

    expect(erro).toBeInstanceOf(ErroDaBiblioteca);
    expect(erro!.message).toContain('"link"');
    expect(erro!.message).toContain('"data"');
  });

  it('atualiza só o que foi pedido', async () => {
    const biblioteca = abrirBiblioteca(caminho);
    await biblioteca.criar(MODELO);
    const atualizada = await biblioteca.atualizar('teste-1', { assunto: 'outro assunto' });

    expect(atualizada.assunto).toBe('outro assunto');
    expect(atualizada.titulo).toBe(MODELO.titulo);
  });

  /*
   * O id é o que um insight já emitido guardou para citar a fonte. Deixá-lo
   * mudar numa atualização quebraria a citação de um insight que ninguém tocou.
   */
  it('a atualização não consegue trocar o id', async () => {
    const biblioteca = abrirBiblioteca(caminho);
    await biblioteca.criar(MODELO);
    const atualizada = await biblioteca.atualizar('teste-1', {
      titulo: 'Outro título',
    } as Partial<Referencia>);
    expect(atualizada.id).toBe('teste-1');
  });

  it('atualizar o que não existe falha dizendo o id', async () => {
    await expect(abrirBiblioteca(caminho).atualizar('fantasma', {})).rejects.toThrow(/fantasma/);
  });

  it('uma atualização que invalida a referência é recusada, e nada é gravado', async () => {
    const biblioteca = abrirBiblioteca(caminho);
    await biblioteca.criar(MODELO);
    await expect(biblioteca.atualizar('teste-1', { link: 'nem-url-e' })).rejects.toThrow(/link/);
    expect((await biblioteca.obter('teste-1'))!.link).toBe(MODELO.link);
  });

  it('apagar devolve se apagou', async () => {
    const biblioteca = abrirBiblioteca(caminho);
    await biblioteca.criar(MODELO);
    expect(await biblioteca.apagar('teste-1')).toBe(true);
    expect(await biblioteca.apagar('teste-1')).toBe(false);
    expect(await biblioteca.listar()).toEqual([]);
  });
});

describe('o arquivo', () => {
  it('JSON quebrado falha alto, com o caminho', async () => {
    await writeFile(caminho, '{isto não é json', 'utf8');
    await expect(abrirBiblioteca(caminho).listar()).rejects.toThrow(/não é JSON válido/);
  });

  it('uma referência inválida no arquivo falha com a posição, em vez de sumir', async () => {
    await writeFile(caminho, JSON.stringify([MODELO, { ...MODELO, id: 'x', categoria: 'inventada' }]), 'utf8');
    await expect(abrirBiblioteca(caminho).listar()).rejects.toThrow(/posição 1/);
  });

  it('não deixa arquivo temporário para trás', async () => {
    const biblioteca = abrirBiblioteca(caminho);
    await biblioteca.criar(MODELO);
    await expect(readFile(`${caminho}.tmp`, 'utf8')).rejects.toThrow();
  });
});

describe('busca', () => {
  const povoar = async () => {
    const biblioteca = abrirBiblioteca(caminho);
    await biblioteca.criar(MODELO);
    await biblioteca.criar({
      ...MODELO,
      id: 'teste-2',
      titulo: 'Migração de dados legados',
      assunto: 'migração, risco não dimensionado',
      categoria: 'avaliar_execucao',
      tipo: 'opiniao',
      data: '2025-05-22',
    });
    await biblioteca.criar({
      ...MODELO,
      id: 'teste-3',
      titulo: 'Execução e retrabalho',
      assunto: 'retrabalho',
      categoria: 'avaliar_execucao',
      data: '2023-01-01',
    });
    return biblioteca;
  };

  it('filtra por categoria sem texto nenhum', async () => {
    const biblioteca = await povoar();
    const achados = await biblioteca.buscar({ categoria: 'avaliar_execucao' });
    expect(achados.map((a) => a.referencia.id)).toEqual(['teste-2', 'teste-3']);
  });

  it('acha por assunto, ignorando acento e caixa', async () => {
    const biblioteca = await povoar();
    const achados = await biblioteca.buscar({ texto: 'MIGRACAO' });
    expect(achados).toHaveLength(1);
    expect(achados[0]!.referencia.id).toBe('teste-2');
  });

  it('ordena por quantidade de termos encontrados', async () => {
    const biblioteca = await povoar();
    const achados = await biblioteca.buscar({ texto: 'migração dados' });
    expect(achados[0]!.referencia.id).toBe('teste-2');
    expect(achados[0]!.termosEncontrados).toBe(2);
  });

  it('empate é desfeito pela data, da mais nova para a mais velha', async () => {
    const biblioteca = await povoar();
    const achados = await biblioteca.buscar({ texto: 'teste', categoria: 'avaliar_execucao' });
    // "Instituto de Teste" está no autor das duas: mesmo número de termos.
    expect(achados.map((a) => a.referencia.id)).toEqual(['teste-2', 'teste-3']);
  });

  it('texto que não casa com nada devolve vazio, e não a lista inteira', async () => {
    const biblioteca = await povoar();
    expect(await biblioteca.buscar({ texto: 'salamandra' })).toEqual([]);
  });

  it('combina texto e filtro', async () => {
    const biblioteca = await povoar();
    const achados = await biblioteca.buscar({ texto: 'teste', tipo: 'opiniao' });
    expect(achados.map((a) => a.referencia.id)).toEqual(['teste-2']);
  });

  it('respeita o limite', async () => {
    const biblioteca = await povoar();
    expect(await biblioteca.buscar({ texto: 'teste', limite: 1 })).toHaveLength(1);
  });

  it('porCategoria devolve a lista crua daquela etapa', async () => {
    const biblioteca = await povoar();
    expect(await biblioteca.porCategoria('entender_dor')).toHaveLength(1);
  });
});

describe('normalização de texto', () => {
  it('tira acento e caixa', () => {
    expect(normalizar('Execução DIÁRIA')).toBe('execucao diaria');
  });

  it('quebra em termos, sem repetir e sem monossílabo de ruído', () => {
    expect(termosDe('a dor do cliente, a dor!')).toEqual(['dor', 'do', 'cliente']);
  });
});

describe('os dados semeados', () => {
  const biblioteca = abrirBiblioteca(CAMINHO_PADRAO);

  it('todos passam pelo schema', async () => {
    for (const referencia of await biblioteca.listar()) {
      expect(validarReferencia(referencia).ok, referencia.id).toBe(true);
    }
  });

  it('há de 3 a 5 exemplos em cada categoria', async () => {
    for (const categoria of CATEGORIAS) {
      const quantas = (await biblioteca.porCategoria(categoria)).length;
      expect(quantas, categoria).toBeGreaterThanOrEqual(3);
      expect(quantas, categoria).toBeLessThanOrEqual(5);
    }
  });

  /*
   * Os dados desta fase são inventados, e precisam PARECER inventados. Uma
   * referência de exemplo que se passasse por fonte real acabaria citada num
   * insight, para um cliente, como se existisse.
   */
  it('todos se anunciam como exemplo', async () => {
    for (const referencia of await biblioteca.listar()) {
      expect(referencia.titulo, referencia.id).toMatch(/^\[EXEMPLO\]/);
      expect(referencia.link, referencia.id).toContain('example.org');
    }
  });

  it('os ids são únicos', async () => {
    const ids = (await biblioteca.listar()).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
