import { describe, expect, it } from 'vitest';
import { readWideViewRequest } from './route';

describe('readWideViewRequest', () => {
  /*
   * O caminho de abertura que não pede nada: o ícone da extensão e o menu de
   * painel lateral do Chrome. Ali a tela tem mesmo que vir da fase da reunião.
   */
  it('sem query, não força tela nenhuma', () => {
    expect(readWideViewRequest('')).toEqual({ history: false, recordId: null });
    expect(readWideViewRequest('?')).toEqual({ history: false, recordId: null });
  });

  /*
   * O botão do rodapé do histórico, que era o defeito: com uma reunião em curso
   * a aba abria na transcrição ao vivo e a lista ficava inalcançável.
   */
  it('view=history pede o histórico, sem reunião alvo', () => {
    expect(readWideViewRequest('?view=history')).toEqual({
      history: true,
      recordId: null,
    });
  });

  it('uma reunião alvo já implica o histórico', () => {
    expect(readWideViewRequest('?record=abc-123')).toEqual({
      history: true,
      recordId: 'abc-123',
    });
    expect(readWideViewRequest('?view=history&record=abc-123')).toEqual({
      history: true,
      recordId: 'abc-123',
    });
  });

  /* `?record=` sozinho não é um pedido de reunião — é uma URL truncada. */
  it('record vazio ou só espaços não vale como alvo', () => {
    expect(readWideViewRequest('?record=')).toEqual({ history: false, recordId: null });
    expect(readWideViewRequest('?record=%20%20')).toEqual({
      history: false,
      recordId: null,
    });
  });

  it('ignora parâmetros que não são dele', () => {
    expect(readWideViewRequest('?utm_source=x&view=summary')).toEqual({
      history: false,
      recordId: null,
    });
  });
});
