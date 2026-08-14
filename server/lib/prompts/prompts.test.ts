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
    // Marcador opcional pode legitimamente render vazio; o que não pode é
    // ficar sem valor nenhum.
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

const MARCAS = ['claude', 'anthropic', 'gemini', 'google', 'grok', 'gpt', 'openai'];

describe('prompt do Pensante', () => {
  it('carrega do arquivo versionado', () => {
    clearPromptCache();
    expect(loadPromptTemplate('pensante', 'v2')).toContain('Citações');
  });

  it('erro claro quando a versão não existe', () => {
    expect(() => loadPromptTemplate('pensante', 'v99')).toThrow(/não encontrado/);
  });

  it('é neutro quanto ao provedor', () => {
    // Prompt que cita um fornecedor faz a comparação da Fase 8 medir
    // adequação ao prompt em vez de capacidade do modelo.
    const texto = renderPrompt('pensante', 'v2').toLowerCase();
    for (const marca of MARCAS) expect(texto).not.toContain(marca);
  });

  it('exige citação literal com acentuação preservada', () => {
    // É a instrução que sustenta a taxa de âncoras — e desde o corte da
    // compactação é o Pensante que produz `quote`.
    const texto = renderPrompt('pensante', 'v2');
    expect(texto).toMatch(/literal/i);
    expect(texto).toMatch(/acentua/i);
  });

  it('ensina a distinção entre proposta e decisão', () => {
    const texto = renderPrompt('pensante', 'v2');
    // `\s+` e não espaço literal: o texto é markdown com quebra de linha, e
    // um teste que depende de onde a linha quebra quebra junto.
    expect(texto).toMatch(/proposta\s+não\s+é\s+decisão/i);
    expect(texto).toMatch(/aceit/i);
  });

  it('avisa que concordância de outro assunto não fecha a proposta', () => {
    // É a armadilha de decisão. Sem esta instrução, o Pensante aponta a
    // primeira concordância que encontra depois da proposta.
    expect(renderPrompt('pensante', 'v2')).toMatch(/assunto seguinte|outra coisa/i);
  });

  it('NÃO tem marcador — o prompt de sistema precisa ser idêntico nas nove seções', () => {
    // Todo cache de prefixo casa desde o começo do prompt. Um sistema que
    // variasse por seção encerraria o prefixo comum antes da transcrição, e
    // o cache nunca daria hit — que é justamente o custo que o corte da
    // compactação foi feito para resolver.
    expect(() => renderPrompt('pensante', 'v2', {})).not.toThrow();
    expect(loadPromptTemplate('pensante', 'v2')).not.toMatch(/\{\{/);
  });

  it('não descreve o formato JSON em prosa — isso é papel do schema', () => {
    // Regra 4 do carregador: o prompt descreve a tarefa, o jsonSchema
    // descreve a forma. Descrever nos dois lugares faz os dois divergirem.
    expect(renderPrompt('pensante', 'v2')).not.toMatch(/responda (apenas |somente )?(com |em )?json/i);
  });
});

describe('prompt do Auditor', () => {
  it('é neutro quanto ao provedor', () => {
    const texto = renderPrompt('auditor', 'v2').toLowerCase();
    for (const marca of MARCAS) expect(texto).not.toContain(marca);
  });

  it('explica os delimitadores da citação', () => {
    // Sem isto o modelo vê ⟦ ⟧ como ruído e julga o trecho inteiro, que é
    // exatamente o comportamento que a marcação existe para corrigir.
    const texto = renderPrompt('auditor', 'v2');
    expect(texto).toContain('⟦');
    expect(texto).toContain('⟧');
    expect(texto).toMatch(/vizinhança/i);
  });

  it('traz o caso da concordância de outro assunto', () => {
    expect(renderPrompt('auditor', 'v2')).toMatch(/outro assunto/i);
  });
});
