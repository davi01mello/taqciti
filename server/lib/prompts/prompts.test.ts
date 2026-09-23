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

describe('prompt do Leitor', () => {
  it('carrega do arquivo versionado', () => {
    clearPromptCache();
    expect(loadPromptTemplate('leitor', 'v1')).toContain('Citações');
  });

  it('erro claro quando a versão não existe', () => {
    expect(() => loadPromptTemplate('leitor', 'v99')).toThrow(/não encontrado/);
  });

  it('é neutro quanto ao provedor', () => {
    // Prompt que cita um fornecedor faz a comparação da Fase 8 medir
    // adequação ao prompt em vez de capacidade do modelo.
    const texto = renderPrompt('leitor', 'v1').toLowerCase();
    for (const marca of MARCAS) expect(texto).not.toContain(marca);
  });

  it('exige citação literal com acentuação preservada', () => {
    // É a instrução que sustenta a taxa de âncoras: é o Leitor que produz
    // `quote`.
    const texto = renderPrompt('leitor', 'v1');
    expect(texto).toMatch(/literal/i);
    expect(texto).toMatch(/acentua/i);
  });

  it('ensina a distinção entre proposta e decisão', () => {
    const texto = renderPrompt('leitor', 'v1');
    // `\s+` e não espaço literal: o texto é markdown com quebra de linha, e
    // um teste que depende de onde a linha quebra quebra junto.
    expect(texto).toMatch(/proposta\s+não\s+é\s+decisão/i);
    expect(texto).toMatch(/aceit/i);
  });

  it('avisa que concordância de outro assunto não fecha a proposta', () => {
    // É a armadilha de decisão. Sem esta instrução, o Leitor aponta a
    // primeira concordância que encontra depois da proposta.
    expect(renderPrompt('leitor', 'v1')).toMatch(/assunto seguinte|outra coisa/i);
  });

  it('NÃO tem marcador — o que varia por documento vai na mensagem de usuário', () => {
    // Regra 3 do carregador: o guidance de cada seção chega íntegro na
    // mensagem, nunca interpolado aqui.
    expect(() => renderPrompt('leitor', 'v1', {})).not.toThrow();
    expect(loadPromptTemplate('leitor', 'v1')).not.toMatch(/\{\{/);
  });

  it('avisa que não há etapa de redação depois — o texto é o final', () => {
    // O Escritor saiu. Se o prompt ainda dissesse que "outro agente escreve a
    // prosa", o modelo devolveria rascunho para um documento que o cliente lê.
    const texto = renderPrompt('leitor', 'v1');
    expect(texto).toMatch(/direto para o documento/i);
    expect(texto).not.toMatch(/outro agente/i);
  });

  it('não descreve o formato JSON em prosa — isso é papel do schema', () => {
    // Regra 4 do carregador: o prompt descreve a tarefa, o jsonSchema
    // descreve a forma. Descrever nos dois lugares faz os dois divergirem.
    expect(renderPrompt('leitor', 'v1')).not.toMatch(/responda (apenas |somente )?(com |em )?json/i);
  });
});

describe('prompt do Auditor', () => {
  it('é neutro quanto ao provedor', () => {
    const texto = renderPrompt('auditor', 'v3').toLowerCase();
    for (const marca of MARCAS) expect(texto).not.toContain(marca);
  });

  it('explica os delimitadores da citação', () => {
    // Sem isto o modelo vê ⟦ ⟧ como ruído e julga o trecho inteiro, que é
    // exatamente o comportamento que a marcação existe para corrigir.
    const texto = renderPrompt('auditor', 'v3');
    expect(texto).toContain('⟦');
    expect(texto).toContain('⟧');
    expect(texto).toMatch(/vizinhança/i);
  });

  it('traz o caso da concordância de outro assunto', () => {
    expect(renderPrompt('auditor', 'v3')).toMatch(/outro assunto/i);
  });

  it('proíbe usar o trecho de uma afirmação como evidência de outra', () => {
    // O preço de julgar todas numa chamada só. Sem esta regra, o cargo que
    // aparece no trecho da Maria "sustentaria" o cargo inventado do João.
    expect(renderPrompt('auditor', 'v3')).toMatch(/julgada\s+sozinha/i);
  });
});
