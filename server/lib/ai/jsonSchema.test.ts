import { describe, expect, it } from 'vitest';
import { extractJson, parseAndValidate, repairInstruction, schemaInstruction } from './jsonSchema';
import type { JsonSchema } from './types';

const schema: JsonSchema = {
  type: 'object',
  properties: {
    saudacao: { type: 'string' },
    idioma: { type: 'string', enum: ['pt', 'en'] },
    itens: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    },
  },
  required: ['saudacao', 'idioma'],
  additionalProperties: false,
};

describe('validate', () => {
  it('aceita objeto que satisfaz o schema', () => {
    expect(parseAndValidate('{"saudacao":"ok","idioma":"pt"}', schema).ok).toBe(true);
  });

  it('reprova campo obrigatório ausente', () => {
    const result = parseAndValidate('{"idioma":"pt"}', schema);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain('saudacao');
  });

  it('reprova valor fora do enum', () => {
    const result = parseAndValidate('{"saudacao":"ok","idioma":"fr"}', schema);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain('enum');
  });

  it('reprova tipo errado', () => {
    expect(parseAndValidate('{"saudacao":1,"idioma":"pt"}', schema).ok).toBe(false);
  });

  it('reprova propriedade extra quando additionalProperties é false', () => {
    const result = parseAndValidate('{"saudacao":"ok","idioma":"pt","x":1}', schema);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain('não prevista');
  });

  it('valida dentro de array aninhado', () => {
    expect(parseAndValidate('{"saudacao":"ok","idioma":"pt","itens":[{"id":3}]}', schema).ok).toBe(true);
    expect(parseAndValidate('{"saudacao":"ok","idioma":"pt","itens":[{"id":"a"}]}', schema).ok).toBe(false);
  });

  it('aponta o caminho do erro, não só que houve erro', () => {
    // Sem o caminho, a instrução de reparo vira "algo está errado" e o
    // modelo não tem como saber onde mexer.
    const result = parseAndValidate('{"saudacao":"ok","idioma":"pt","itens":[{"id":"a"}]}', schema);
    expect(result.errors.join()).toContain('$.itens[0].id');
  });

  it('trata integer como distinto de number', () => {
    expect(parseAndValidate('{"saudacao":"ok","idioma":"pt","itens":[{"id":1.5}]}', schema).ok).toBe(false);
  });
});

describe('extractJson', () => {
  it('atravessa cerca de markdown', () => {
    expect(parseAndValidate('```json\n{"saudacao":"ok","idioma":"pt"}\n```', schema).ok).toBe(true);
  });

  it('atravessa frase de cortesia antes do JSON', () => {
    expect(parseAndValidate('Claro! Segue:\n{"saudacao":"ok","idioma":"pt"}', schema).ok).toBe(true);
  });

  it('não desbalanceia com chave dentro de string', () => {
    // Contagem ingênua de chaves cortaria no `}` de dentro do texto e
    // produziria JSON truncado — que viraria um reparo desnecessário.
    expect(extractJson('texto {"a":"chave } dentro","b":1} fim')).toBe('{"a":"chave } dentro","b":1}');
  });

  it('não se confunde com chave escapada', () => {
    expect(extractJson('{"a":"aspas \\" e chave }","b":2}')).toBe('{"a":"aspas \\" e chave }","b":2}');
  });

  it('reconhece array no topo', () => {
    expect(extractJson('resposta: [1, 2, 3] fim')).toBe('[1, 2, 3]');
  });

  it('devolve null quando não há JSON', () => {
    expect(extractJson('nada aqui')).toBeNull();
    expect(extractJson('')).toBeNull();
  });

  it('reprova JSON sintaticamente inválido em vez de estourar', () => {
    const result = parseAndValidate('{"saudacao": }', schema);
    expect(result.ok).toBe(false);
  });
});

describe('instruções', () => {
  it('a instrução de schema é neutra quanto ao provedor', () => {
    // O mesmo texto tem que rodar nos três; se ele citar convenção de um
    // fornecedor, a comparação deixa de significar alguma coisa.
    const text = schemaInstruction(schema).toLowerCase();
    for (const marca of ['claude', 'anthropic', 'gemini', 'google', 'grok', 'openai', 'gpt']) {
      expect(text).not.toContain(marca);
    }
  });

  it('a instrução de reparo carrega os erros e a resposta anterior', () => {
    const text = repairInstruction('{"idioma":"fr"}', ['$.saudacao: campo obrigatório ausente.']);
    expect(text).toContain('$.saudacao');
    expect(text).toContain('{"idioma":"fr"}');
  });
});
