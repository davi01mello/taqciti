/**
 * O barramento do agente.
 *
 * O que estes testes protegem é a HONESTIDADE dos estados, não a animação: um
 * desfecho que expira sozinho, ou um texto parcial que sobrevive ao pedido
 * seguinte, viram interface contando uma coisa que não aconteceu.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACOMODAR_MS,
  _resetarAgente,
  agenteAgora,
  estaTrabalhando,
  observarAgente,
  publicarAtividade,
  publicarParcial,
} from './atividade';

beforeEach(() => {
  _resetarAgente();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  _resetarAgente();
});

describe('o estado do agente', () => {
  it('nasce em repouso — que é o estado de produção hoje', () => {
    expect(agenteAgora()).toEqual({ atividade: 'repouso', parcial: '' });
    expect(estaTrabalhando('repouso')).toBe(false);
  });

  it('emite o valor atual ao assinar, como os demais observadores', () => {
    const visto = vi.fn();
    observarAgente(visto);
    expect(visto).toHaveBeenCalledWith({ atividade: 'repouso', parcial: '' });
  });

  it('avisa quem assinou a cada mudança, e só nas mudanças', () => {
    const visto = vi.fn();
    observarAgente(visto);
    visto.mockClear();

    publicarAtividade('preparando');
    publicarAtividade('preparando');

    expect(visto).toHaveBeenCalledTimes(1);
  });

  it('para de avisar depois de cancelada a assinatura', () => {
    const visto = vi.fn();
    const parar = observarAgente(visto);
    parar();
    visto.mockClear();

    publicarAtividade('escrevendo');

    expect(visto).not.toHaveBeenCalled();
  });
});

describe('o desfecho de uma resposta', () => {
  /*
   * "Concluído" é o único estado com prazo: ele serve para a ondinha se
   * acomodar, e depois disso não há mais nada de diferente a dizer.
   */
  it('concluído vira repouso sozinho, depois da acomodação', () => {
    publicarAtividade('escrevendo');
    publicarAtividade('concluido');
    expect(agenteAgora().atividade).toBe('concluido');

    vi.advanceTimersByTime(ACOMODAR_MS + 10);

    expect(agenteAgora().atividade).toBe('repouso');
  });

  /*
   * Falha e cancelamento NÃO expiram. Apagá-los sozinho seria a interface
   * esquecendo um desfecho que a pessoa talvez não tenha visto — e o requisito
   * pede justamente que os dois sejam comunicados.
   */
  it.each(['falhou', 'cancelado'] as const)('%s permanece até o próximo pedido', (fim) => {
    publicarAtividade('preparando');
    publicarAtividade(fim);

    vi.advanceTimersByTime(ACOMODAR_MS * 5);

    expect(agenteAgora().atividade).toBe(fim);

    publicarAtividade('preparando');
    expect(agenteAgora().atividade).toBe('preparando');
  });

  it('um pedido novo cancela a acomodação do anterior', () => {
    publicarAtividade('concluido');
    publicarAtividade('preparando');

    vi.advanceTimersByTime(ACOMODAR_MS + 10);

    // Sem o cancelamento, o temporizador do "concluído" jogaria o agente de
    // volta para repouso no meio do pedido seguinte.
    expect(agenteAgora().atividade).toBe('preparando');
  });
});

describe('o texto que chega em progressão', () => {
  it('só cresce enquanto o agente está escrevendo', () => {
    publicarAtividade('preparando');
    publicarParcial('isto não deveria aparecer');
    expect(agenteAgora().parcial).toBe('');

    publicarAtividade('escrevendo');
    publicarParcial('Pelo que ficou');
    expect(agenteAgora().parcial).toBe('Pelo que ficou');
  });

  /* O texto pertence a UMA resposta: o pedido seguinte não herda o anterior. */
  it('some quando começa outro pedido', () => {
    publicarAtividade('escrevendo');
    publicarParcial('resposta antiga');

    publicarAtividade('preparando');

    expect(agenteAgora().parcial).toBe('');
  });

  /* Mas fica durante a acomodação: é o que se está lendo quando ela termina. */
  it('continua na tela enquanto a conclusão se acomoda', () => {
    publicarAtividade('escrevendo');
    publicarParcial('resposta inteira');

    publicarAtividade('concluido');
    expect(agenteAgora().parcial).toBe('resposta inteira');

    vi.advanceTimersByTime(ACOMODAR_MS + 10);
    expect(agenteAgora().parcial).toBe('');
  });

  it('falha descarta o que tinha chegado pela metade', () => {
    publicarAtividade('escrevendo');
    publicarParcial('metade de uma');

    publicarAtividade('falhou');

    expect(agenteAgora().parcial).toBe('');
  });
});
