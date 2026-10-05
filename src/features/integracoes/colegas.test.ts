import { beforeEach, describe, expect, it, vi } from 'vitest';

const memoria = new Map<string, unknown>();
vi.mock('@/shared/services/storage', () => ({
  readLocal: async (k: string) => memoria.get(k) ?? null,
  writeLocal: async (k: string, v: unknown) => void memoria.set(k, v),
}));

import { chaveDoNome, ehEmailDoCiti, papelDoFalante, reconhecerColegas } from './colegas';

beforeEach(() => memoria.clear());

describe('ehEmailDoCiti', () => {
  it('aceita o domínio e os subdomínios', () => {
    expect(ehEmailDoCiti('ana@citi.org.br')).toBe(true);
    expect(ehEmailDoCiti('Ana@CITI.org.br')).toBe(true);
    expect(ehEmailDoCiti('ana@projetos.citi.org.br')).toBe(true);
  });

  it('recusa quem só parece do CITi', () => {
    expect(ehEmailDoCiti('ana@citibank.com')).toBe(false);
    expect(ehEmailDoCiti('ana@citi.org.br.golpe.com')).toBe(false);
    expect(ehEmailDoCiti('ana@meucitі.org.br')).toBe(false);
    expect(ehEmailDoCiti('citi.org.br')).toBe(false);
    expect(ehEmailDoCiti('@citi.org.br')).toBe(false);
    expect(ehEmailDoCiti('ana@gmail.com')).toBe(false);
  });
});

describe('papelDoFalante', () => {
  const colegas = new Set([chaveDoNome('Bruno Lima')]);

  it('separa eu, CITi e de fora', () => {
    expect(papelDoFalante('Ana Souza', 'ana souza', colegas)).toBe('eu');
    expect(papelDoFalante('Bruno Lima', 'Ana Souza', colegas)).toBe('citi');
    expect(papelDoFalante('Carla Dias', 'Ana Souza', colegas)).toBe('externo');
  });

  it('eu vence mesmo se o próprio nome estiver entre os colegas', () => {
    expect(papelDoFalante('Bruno Lima', 'Bruno Lima', colegas)).toBe('eu');
  });

  it('ignora acento e caixa', () => {
    expect(papelDoFalante('BRUNO LIMÁ', null, colegas)).toBe('citi');
  });
});

describe('reconhecerColegas', () => {
  it('só conta nome igual E e-mail do CITi', async () => {
    const buscar = vi.fn(async (nome: string) => {
      if (nome === 'Bruno Lima') return [{ nome: 'Bruno Lima', email: 'bruno@citi.org.br' }];
      if (nome === 'Carla Dias') return [{ nome: 'Carla Dias', email: 'carla@parceiro.com' }];
      return [{ nome: 'Dani Alves Costa', email: 'dani@citi.org.br' }];
    });
    const achados = await reconhecerColegas(['Bruno Lima', 'Carla Dias', 'Dani Alves'], 1_000, buscar);
    expect([...achados]).toEqual(['bruno lima']);
  });

  it('guarda o resultado e não pergunta de novo', async () => {
    const buscar = vi.fn(async () => [{ nome: 'Bruno Lima', email: 'bruno@citi.org.br' }]);
    await reconhecerColegas(['Bruno Lima'], 1_000, buscar);
    await reconhecerColegas(['Bruno Lima'], 2_000, buscar);
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it('sem conexão não guarda "não" e devolve vazio', async () => {
    const buscar = vi.fn(async () => {
      throw new Error('conta_pessoal');
    });
    expect((await reconhecerColegas(['Bruno Lima'], 1_000, buscar)).size).toBe(0);
    expect(memoria.size).toBe(0);
  });

  it('o "não" vale um dia; depois pergunta de novo', async () => {
    const buscar = vi.fn(async () => []);
    await reconhecerColegas(['Bruno Lima'], 0, buscar);
    await reconhecerColegas(['Bruno Lima'], 1_000, buscar);
    expect(buscar).toHaveBeenCalledTimes(1);
    await reconhecerColegas(['Bruno Lima'], 25 * 60 * 60 * 1000, buscar);
    expect(buscar).toHaveBeenCalledTimes(2);
  });
});
