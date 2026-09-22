/**
 * O teto de buscas por diagnóstico.
 */
import { describe, expect, it } from 'vitest';
import {
  MAXIMO_DE_BUSCAS_PADRAO,
  criarLimitadorDeBuscas,
  maximoDeBuscasDoAmbiente,
} from './limite';

describe('contagem', () => {
  it('conta o que foi usado e o que resta', () => {
    const limitador = criarLimitadorDeBuscas(3);
    expect(limitador.restantes()).toBe(3);

    limitador.registrarBusca();
    expect(limitador.usadas()).toBe(1);
    expect(limitador.restantes()).toBe(2);
  });

  it('para no teto', () => {
    const limitador = criarLimitadorDeBuscas(2);
    expect(limitador.registrarBusca()).toBe(true);
    expect(limitador.registrarBusca()).toBe(true);
    expect(limitador.registrarBusca()).toBe(false);
    expect(limitador.podeBuscar()).toBe(false);
  });

  /*
   * Estourar o teto não pode virar dívida: se a tentativa recusada contasse, um
   * `reiniciar()` depois de dez tentativas devolveria um orçamento já negativo.
   */
  it('a tentativa recusada não incrementa', () => {
    const limitador = criarLimitadorDeBuscas(1);
    limitador.registrarBusca();
    limitador.registrarBusca();
    limitador.registrarBusca();
    expect(limitador.usadas()).toBe(1);
    expect(limitador.restantes()).toBe(0);
  });

  it('reiniciar devolve o orçamento inteiro', () => {
    const limitador = criarLimitadorDeBuscas(2);
    limitador.registrarBusca();
    limitador.reiniciar();
    expect(limitador.usadas()).toBe(0);
    expect(limitador.podeBuscar()).toBe(true);
  });

  it('teto zero não deixa buscar nada', () => {
    const limitador = criarLimitadorDeBuscas(0);
    expect(limitador.podeBuscar()).toBe(false);
    expect(limitador.registrarBusca()).toBe(false);
  });

  /*
   * Um contador de módulo seria compartilhado entre dois diagnósticos
   * simultâneos, e o segundo começaria sem orçamento por causa do primeiro.
   */
  it('cada limitador tem o seu próprio contador', () => {
    const a = criarLimitadorDeBuscas(2);
    const b = criarLimitadorDeBuscas(2);
    a.registrarBusca();
    expect(b.usadas()).toBe(0);
  });

  it('recusa teto inválido em vez de aceitar em silêncio', () => {
    expect(() => criarLimitadorDeBuscas(-1)).toThrow(/inteiro/);
    expect(() => criarLimitadorDeBuscas(1.5)).toThrow(/inteiro/);
  });
});

describe('o teto vindo do ambiente', () => {
  it('sem variável, usa o padrão', () => {
    expect(maximoDeBuscasDoAmbiente({} as unknown as NodeJS.ProcessEnv)).toBe(MAXIMO_DE_BUSCAS_PADRAO);
  });

  it('lê o inteiro da variável', () => {
    expect(
      maximoDeBuscasDoAmbiente({ DIAGNOSTICO_MAX_BUSCAS: '7' } as unknown as NodeJS.ProcessEnv),
    ).toBe(7);
  });

  it('zero é um valor legítimo — desliga a busca web', () => {
    expect(
      maximoDeBuscasDoAmbiente({ DIAGNOSTICO_MAX_BUSCAS: '0' } as unknown as NodeJS.ProcessEnv),
    ).toBe(0);
  });

  /*
   * Falha alto: um teto mal escrito que virasse o padrão em silêncio faria
   * alguém acreditar ter limitado o gasto sem ter limitado.
   */
  it('valor inválido falha em vez de virar o padrão', () => {
    expect(() =>
      maximoDeBuscasDoAmbiente({ DIAGNOSTICO_MAX_BUSCAS: 'muitas' } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/inteiro/);
    expect(() =>
      maximoDeBuscasDoAmbiente({ DIAGNOSTICO_MAX_BUSCAS: '-2' } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/inteiro/);
  });
});
