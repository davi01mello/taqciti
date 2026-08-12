import { describe, expect, it } from 'vitest';
import { clearPromptCache, interpolate, loadPromptTemplate, renderPrompt } from './index';

describe('interpolate', () => {
  it('substitui marcadores pelos valores', () => {
    expect(interpolate('antes {{alvo}} depois', { alvo: 'X' })).toBe('antes X depois');
  });

  it('aceita espaço dentro do marcador', () => {
    expect(interpolate('{{ alvo }}', { alvo: 'X' })).toBe('X');
  });

  it('substitui todas as ocorrências do mesmo marcador', () => {
    expect(interpolate('{{a}} e {{a}}', { a: 'X' })).toBe('X e X');
  });

  it('aceita valor vazio — é diferente de valor ausente', () => {
    // O `windowNote` do Analista é vazio em passada única. Isso é legítimo;
    // o que não pode é o marcador ficar sem valor nenhum.
    expect(interpolate('texto{{nota}}', { nota: '' })).toBe('texto');
  });

  it('FALHA quando sobra marcador sem valor', () => {
    // Deixar passar mandaria a string literal "{{sectionGuidance}}" para o
    // modelo, que responderia algo plausível sobre um texto que nunca
    // recebeu — defeito que só apareceria na revisão do documento final.
    expect(() => interpolate('{{faltando}}', {})).toThrow(/marcador sem valor/);
  });

  it('nomeia todos os marcadores faltantes de uma vez', () => {
    // `[\s\S]*` e não a flag `s`: o tsconfig alvo é ES2017, e `dotAll` só
    // existe a partir de ES2018.
    expect(() => interpolate('{{a}} {{b}}', {})).toThrow(/\{\{a\}\}[\s\S]*\{\{b\}\}/);
  });

  it('ignora chaves que não são marcadores', () => {
    expect(interpolate('{ isto } e {{ok}}', { ok: 'X' })).toBe('{ isto } e X');
  });
});

describe('prompt do Analista', () => {
  it('carrega do arquivo versionado', () => {
    clearPromptCache();
    expect(loadPromptTemplate('analista', 'v1')).toContain('Compactação semântica');
  });

  it('erro claro quando a versão não existe', () => {
    expect(() => loadPromptTemplate('analista', 'v99')).toThrow(/não encontrado/);
  });

  it('é neutro quanto ao provedor', () => {
    // Prompt que cita um fornecedor faz a comparação da Fase 8 medir
    // adequação ao prompt em vez de capacidade do modelo.
    const texto = renderPrompt('analista', 'v1', { windowNote: '' }).toLowerCase();
    for (const marca of ['claude', 'anthropic', 'gemini', 'google', 'grok', 'gpt', 'openai']) {
      expect(texto).not.toContain(marca);
    }
  });

  it('exige citação literal com acentuação preservada', () => {
    // É a instrução que sustenta a taxa de âncoras.
    const texto = renderPrompt('analista', 'v1', { windowNote: '' });
    expect(texto).toMatch(/literal/i);
    expect(texto).toMatch(/acentua/i);
  });

  it('ensina a distinção entre proposta e decisão', () => {
    const texto = renderPrompt('analista', 'v1', { windowNote: '' });
    // `\s+` e não espaço literal: o texto é markdown com quebra de linha, e
    // um teste que depende de onde a linha quebra quebra junto.
    expect(texto).toMatch(/não\s+são decisão/i);
    expect(texto).toMatch(/concord/i);
  });

  it('traz o exemplo de compactação da especificação', () => {
    const texto = renderPrompt('analista', 'v1', { windowNote: '' });
    expect(texto).toContain('pessoal do banco');
    expect(texto).toContain('alteração na arquitetura');
  });

  it('não descreve o formato JSON em prosa — isso é papel do schema', () => {
    // Regra 4 do carregador: o prompt descreve a tarefa, o jsonSchema
    // descreve a forma. Descrever nos dois lugares faz os dois divergirem.
    const texto = renderPrompt('analista', 'v1', { windowNote: '' });
    expect(texto).not.toMatch(/responda (apenas |somente )?(com |em )?json/i);
  });

  it('render exige o marcador de janela', () => {
    expect(() => renderPrompt('analista', 'v1', {})).toThrow(/windowNote/);
  });
});
