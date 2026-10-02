/**
 * O cache de buscas. O relógio é injetado — nada aqui espera de verdade.
 */
import { describe, expect, it } from 'vitest';
import { TTL_PADRAO_MS, chaveDaConsulta, criarCacheDeResultados } from './cache';

/** Um relógio que anda quando o teste manda. */
function relogio(inicio = 0) {
  let agora = inicio;
  return { agora: () => agora, avancar: (ms: number) => (agora += ms) };
}

describe('a chave', () => {
  it('ignora caixa, acento e ordem dos termos', () => {
    expect(chaveDaConsulta('Migração de Dados')).toBe(chaveDaConsulta('dados migracao de'));
  });

  it('não repete termo', () => {
    expect(chaveDaConsulta('prazo prazo prazo')).toBe('prazo');
  });
});

describe('guardar e obter', () => {
  /*
   * A chave normaliza caixa, acento e ordem — e mais nada. Ela não tira palavra
   * vazia porque o que entra aqui é a consulta JÁ FORMATADA por
   * `formatarQueryWeb`, que tirou. Normalizar de novo, aqui, seria a mesma regra
   * escrita em dois lugares.
   */
  it('devolve o que foi guardado, mesmo com caixa e ordem diferentes', () => {
    const cache = criarCacheDeResultados<string[]>();
    cache.guardar('risco migração dados', ['resultado A']);
    expect(cache.obter('DADOS MIGRAÇÃO risco')).toEqual(['resultado A']);
  });

  it('não devolve o que nunca foi guardado', () => {
    expect(criarCacheDeResultados().obter('nada disso')).toBeUndefined();
  });

  it('`tem` responde sem trazer o valor — é o que a decisão de busca pergunta', () => {
    const cache = criarCacheDeResultados<number>();
    cache.guardar('prazo', 1);
    expect(cache.tem('prazo')).toBe(true);
    expect(cache.tem('outro assunto')).toBe(false);
  });
});

describe('validade', () => {
  it('vence depois do TTL', () => {
    const t = relogio();
    const cache = criarCacheDeResultados<number>({ ttlMs: 1000, agora: t.agora });

    cache.guardar('prazo', 1);
    t.avancar(999);
    expect(cache.obter('prazo')).toBe(1);

    t.avancar(2);
    expect(cache.obter('prazo')).toBeUndefined();
  });

  it('ler não estende a validade', () => {
    const t = relogio();
    const cache = criarCacheDeResultados<number>({ ttlMs: 1000, agora: t.agora });

    cache.guardar('prazo', 1);
    t.avancar(900);
    cache.obter('prazo');
    t.avancar(200);
    expect(cache.obter('prazo')).toBeUndefined();
  });

  it('guardar de novo renova', () => {
    const t = relogio();
    const cache = criarCacheDeResultados<number>({ ttlMs: 1000, agora: t.agora });

    cache.guardar('prazo', 1);
    t.avancar(900);
    cache.guardar('prazo', 2);
    t.avancar(200);
    expect(cache.obter('prazo')).toBe(2);
  });

  it('a entrada vencida some ao ser lida, em vez de ocupar espaço', () => {
    const t = relogio();
    const cache = criarCacheDeResultados<number>({ ttlMs: 10, agora: t.agora });
    cache.guardar('prazo', 1);
    t.avancar(20);
    cache.obter('prazo');
    expect(cache.tamanho()).toBe(0);
  });

  it('`limpar` varre o que venceu e diz quantos saíram', () => {
    const t = relogio();
    const cache = criarCacheDeResultados<number>({ ttlMs: 100, agora: t.agora });
    cache.guardar('a', 1);
    cache.guardar('b', 2);
    t.avancar(150);
    cache.guardar('c', 3);

    expect(cache.limpar()).toBe(2);
    expect(cache.tamanho()).toBe(1);
  });

  it('o padrão é uma hora', () => {
    const t = relogio();
    const cache = criarCacheDeResultados<number>({ agora: t.agora });
    cache.guardar('prazo', 1);
    t.avancar(TTL_PADRAO_MS - 1);
    expect(cache.tem('prazo')).toBe(true);
    t.avancar(2);
    expect(cache.tem('prazo')).toBe(false);
  });
});

describe('teto de tamanho', () => {
  it('a mais antiga sai quando estoura', () => {
    const cache = criarCacheDeResultados<number>({ tamanhoMaximo: 2 });
    cache.guardar('a', 1);
    cache.guardar('b', 2);
    cache.guardar('c', 3);

    expect(cache.tamanho()).toBe(2);
    expect(cache.obter('a')).toBeUndefined();
    expect(cache.obter('c')).toBe(3);
  });

  /*
   * Regravar precisa renovar a POSIÇÃO, e não só o instante — senão uma consulta
   * repetida continuaria sendo a primeira a ser expulsa por antiguidade.
   */
  it('regravar tira a entrada da fila de expulsão', () => {
    const cache = criarCacheDeResultados<number>({ tamanhoMaximo: 2 });
    cache.guardar('a', 1);
    cache.guardar('b', 2);
    cache.guardar('a', 10);
    cache.guardar('c', 3);

    expect(cache.obter('a')).toBe(10);
    expect(cache.obter('b')).toBeUndefined();
  });
});
