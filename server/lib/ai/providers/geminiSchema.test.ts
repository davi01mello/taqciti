import { describe, expect, it } from 'vitest';
import { Type } from '@google/genai';
import { toGeminiSchema } from './geminiSchema';
import type { JsonSchema } from '../types';

const schema: JsonSchema = {
  type: 'object',
  properties: {
    saudacao: { type: 'string', description: 'A palavra exata "ok".' },
    idioma: { type: 'string', enum: ['pt', 'en'] },
    quantidade: { type: 'integer' },
    itens: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    },
  },
  required: ['saudacao', 'idioma'],
  additionalProperties: false,
};

describe('toGeminiSchema', () => {
  it('converte tipos para o enum maiúsculo do OpenAPI', () => {
    const { schema: out } = toGeminiSchema(schema);
    expect(out.type).toBe(Type.OBJECT);
    expect(out.properties!.saudacao!.type).toBe(Type.STRING);
    expect(out.properties!.quantidade!.type).toBe(Type.INTEGER);
    expect(out.properties!.itens!.type).toBe(Type.ARRAY);
  });

  it('preserva required, description e items aninhados', () => {
    const { schema: out } = toGeminiSchema(schema);
    expect(out.required).toEqual(['saudacao', 'idioma']);
    expect(out.properties!.saudacao!.description).toBe('A palavra exata "ok".');
    expect(out.properties!.itens!.items!.type).toBe(Type.OBJECT);
    expect(out.properties!.itens!.items!.required).toEqual(['id']);
  });

  it('marca enum com format e mantém os valores', () => {
    const { schema: out } = toGeminiSchema(schema);
    expect(out.properties!.idioma!.enum).toEqual(['pt', 'en']);
    expect(out.properties!.idioma!.format).toBe('enum');
  });

  it('converte enum não-string para string', () => {
    // `enum` do Gemini é string[]; a própria documentação do campo mostra
    // inteiro representado como ["101","201"].
    const { schema: out } = toGeminiSchema({ type: 'integer', enum: [101, 201] });
    expect(out.enum).toEqual(['101', '201']);
  });

  it('descarta additionalProperties e registra o descarte', () => {
    // A forma OpenAPI não tem o campo. O descarte precisa ser visível: sem
    // isso, "por que o 2.5 aceitou uma propriedade que eu proibi?" vira uma
    // investigação meses depois.
    const { schema: out, dropped } = toGeminiSchema(schema);
    expect(out).not.toHaveProperty('additionalProperties');
    expect(dropped).toContain('$.additionalProperties');
  });

  it('não inventa campos que o JsonSchema de origem não tinha', () => {
    const { schema: out } = toGeminiSchema({ type: 'string' });
    expect(Object.keys(out)).toEqual(['type']);
  });

  it('registra tipo sem equivalente em vez de emitir lixo', () => {
    const { schema: out, dropped } = toGeminiSchema({ type: 'null' });
    expect(out.type).toBeUndefined();
    expect(dropped.join()).toContain('null');
  });

  it('reporta o caminho do campo descartado, não só o nome', () => {
    const { dropped } = toGeminiSchema({
      type: 'object',
      properties: { interno: { type: 'object', additionalProperties: false } },
    });
    expect(dropped).toContain('$.interno.additionalProperties');
  });
});
