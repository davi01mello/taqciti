import { describe, expect, it } from 'vitest';
import { lerPedidoDaHome } from './rota';

describe('lerPedidoDaHome', () => {
  it('sem query, abre no Assistente', () => {
    expect(lerPedidoDaHome('')).toEqual({ secao: 'assistente', recordId: null });
  });

  it('respeita a seção pedida', () => {
    expect(lerPedidoDaHome('?secao=documentos')).toEqual({
      secao: 'documentos',
      recordId: null,
    });
  });

  it('seção desconhecida cai no Assistente em vez de tela vazia', () => {
    expect(lerPedidoDaHome('?secao=marte')).toEqual({
      secao: 'assistente',
      recordId: null,
    });
  });

  /* O caso do "Abrir no TaqCiti" de dentro de uma reunião encerrada. */
  it('um registro implica a seção que o mostra', () => {
    expect(lerPedidoDaHome('?record=abc-123')).toEqual({
      secao: 'reunioes',
      recordId: 'abc-123',
    });
  });

  it('o registro vence uma seção que não o mostraria', () => {
    expect(lerPedidoDaHome('?secao=conexoes&record=abc-123')).toEqual({
      secao: 'reunioes',
      recordId: 'abc-123',
    });
  });
});
