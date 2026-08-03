import { describe, expect, it } from 'vitest';
import { mergeVisible } from './mergeCaption';

describe('mergeVisible — a fala cresce', () => {
  it('adota o texto novo quando ele estende o que já temos', () => {
    expect(mergeVisible('bom dia', 'bom dia pessoal')).toEqual({
      text: 'bom dia pessoal',
      startNewSegment: false,
    });
  });

  it('é idempotente: reaplicar o mesmo visível não muda nada', () => {
    const primeira = mergeVisible('bom dia', 'bom dia pessoal');
    expect(mergeVisible(primeira.text, 'bom dia pessoal')).toEqual({
      text: 'bom dia pessoal',
      startNewSegment: false,
    });
  });

  it('ignora visível vazio (frame em que o Meet limpou a linha)', () => {
    expect(mergeVisible('bom dia pessoal', '')).toEqual({
      text: 'bom dia pessoal',
      startNewSegment: false,
    });
  });

  it('aceita o primeiro texto quando ainda não há nada capturado', () => {
    expect(mergeVisible('', 'bom dia')).toEqual({
      text: 'bom dia',
      startNewSegment: false,
    });
  });
});

describe('mergeVisible — o Meet reescreve o fim da fala', () => {
  it('adota a correção quando o começo continua o mesmo', () => {
    expect(
      mergeVisible('vamos falar sobre o orcamento do projeto', 'vamos falar sobre o orçamento do projeto.'),
    ).toEqual({
      text: 'vamos falar sobre o orçamento do projeto.',
      startNewSegment: false,
    });
  });

  it('mantém o texto maior quando a linha encolhe preservando o começo', () => {
    expect(mergeVisible('bom dia pessoal tudo bem', 'bom dia pessoal')).toEqual({
      text: 'bom dia pessoal tudo bem',
      startNewSegment: false,
    });
  });

  it('adota a versão corrigida quando o reconhecedor troca o fim da frase', () => {
    expect(
      mergeVisible('vamos falar sobre o orçamento total', 'vamos falar sobre o orçamento anual'),
    ).toEqual({
      text: 'vamos falar sobre o orçamento anual',
      startNewSegment: false,
    });
  });
});

describe('mergeVisible — a janela rolante corta o começo (o bug que apagava fala)', () => {
  it('cola só a parte nova em vez de encolher a transcrição', () => {
    const committed = 'bom dia pessoal vamos falar sobre a proposta';
    const visible = 'vamos falar sobre a proposta comercial de hoje';
    expect(mergeVisible(committed, visible)).toEqual({
      text: 'bom dia pessoal vamos falar sobre a proposta comercial de hoje',
      startNewSegment: false,
    });
  });

  it('não duplica quando o corte de cabeça não trouxe nada novo', () => {
    const committed = 'bom dia pessoal vamos falar sobre a proposta';
    const visible = 'vamos falar sobre a proposta';
    expect(mergeVisible(committed, visible)).toEqual({
      text: committed,
      startNewSegment: false,
    });
  });

  it('sobrevive a cortes sucessivos sem perder o começo da fala', () => {
    let texto = 'primeira parte da fala';
    texto = mergeVisible(texto, 'primeira parte da fala com mais contexto').text;
    texto = mergeVisible(texto, 'da fala com mais contexto e ainda mais coisa').text;
    texto = mergeVisible(texto, 'mais contexto e ainda mais coisa no final').text;
    expect(texto).toBe(
      'primeira parte da fala com mais contexto e ainda mais coisa no final',
    );
  });
});

describe('mergeVisible — o nó é reaproveitado para outra fala', () => {
  it('pede segmento novo quando não há nada em comum', () => {
    expect(
      mergeVisible('bom dia pessoal tudo certo', 'então sobre o orçamento'),
    ).toEqual({
      text: 'então sobre o orçamento',
      startNewSegment: true,
    });
  });

  it('não confunde coincidência curta com continuação da mesma fala', () => {
    // "de" aparece nos dois lados, mas é curto demais para ser sobreposição.
    const resultado = mergeVisible('preciso de uma resposta rapida', 'de acordo');
    expect(resultado.startNewSegment).toBe(true);
  });
});

describe('mergeVisible — teto de tamanho', () => {
  it('não deixa um segmento crescer sem limite', () => {
    const grande = 'palavra '.repeat(700).trim(); // ~5600 caracteres
    const resultado = mergeVisible('palavra', grande);
    expect(resultado.text.length).toBeLessThanOrEqual(4000);
    expect(resultado.text.endsWith(' ')).toBe(false);
  });
});
