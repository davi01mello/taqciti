/**
 * Conversão do nosso JSON Schema para o `Schema` do Gemini — o subconjunto
 * do OpenAPI que os modelos da família 2.5 exigem em `responseSchema`.
 *
 * A família 3.x aceita `responseJsonSchema`, que é JSON Schema de verdade e
 * não precisa de conversão nenhuma. Os dois campos são mutuamente
 * exclusivos: a própria tipagem do SDK diz que, se `responseJsonSchema`
 * estiver setado, `responseSchema` tem que ser omitido.
 *
 * Três diferenças reais, todas verificadas no `.d.ts` do @google/genai
 * instalado (v2.16.0, `export declare interface Schema`), não na
 * documentação pública:
 *
 * 1. `type` é um enum MAIÚSCULO (`STRING`, `OBJECT`, `INTEGER`, ...), não a
 *    string minúscula do JSON Schema.
 * 2. `enum` é `string[]`. Valor numérico ou booleano em enum precisa virar
 *    string — a documentação do próprio campo mostra
 *    `{type:INTEGER, format:enum, enum:["101","201"]}`.
 * 3. **Não existe `additionalProperties`.** O campo simplesmente não está no
 *    tipo. Ele é descartado aqui, e isso tem consequência: a garantia de
 *    "nenhuma propriedade extra" deixa de ser do provedor e passa a ser do
 *    nosso validador, que roda depois de qualquer jeito. O resultado
 *    continua correto — o que muda é que pode custar uma chamada de reparo
 *    onde a 3.x não custaria, e é isso que `repaired` vai mostrar.
 */
import { Type, type Schema } from '@google/genai';
import type { JsonSchema } from '../types';

const TYPE_BY_JSON_SCHEMA: Record<string, Type> = {
  string: Type.STRING,
  number: Type.NUMBER,
  integer: Type.INTEGER,
  boolean: Type.BOOLEAN,
  array: Type.ARRAY,
  object: Type.OBJECT,
};

/** Campos do nosso JsonSchema que a forma OpenAPI não tem. Descartados
 *  explicitamente, para o descarte ser uma decisão e não um acidente. */
const DROPPED_FIELDS = new Set(['additionalProperties', '$schema', '$defs', '$ref']);

export interface ConversionResult {
  schema: Schema;
  /** O que foi descartado, com caminho. Vai para log — silêncio aqui vira
   *  "por que o Gemini 2.5 aceitou um campo que eu proibi?" meses depois. */
  dropped: string[];
}

export function toGeminiSchema(input: JsonSchema): ConversionResult {
  const dropped: string[] = [];
  const schema = convert(input, '$', dropped);
  return { schema, dropped };
}

function convert(input: JsonSchema, path: string, dropped: string[]): Schema {
  const output: Schema = {};

  if (typeof input.type === 'string') {
    const mapped = TYPE_BY_JSON_SCHEMA[input.type];
    if (mapped) output.type = mapped;
    else dropped.push(`${path}.type=${input.type} (tipo sem equivalente OpenAPI)`);
  }

  if (typeof input.description === 'string') output.description = input.description;

  if (Array.isArray(input.enum) && input.enum.length > 0) {
    // `enum` do Gemini é string[]; número e booleano viram string.
    output.enum = input.enum.map((value) => String(value));
    // O SDK documenta que enum exige `format: 'enum'`.
    output.format = 'enum';
  }

  if (input.properties) {
    const properties: Record<string, Schema> = {};
    for (const [key, value] of Object.entries(input.properties)) {
      properties[key] = convert(value, `${path}.${key}`, dropped);
    }
    output.properties = properties;
  }

  if (Array.isArray(input.required) && input.required.length > 0) {
    output.required = [...input.required];
  }

  if (input.items) output.items = convert(input.items, `${path}[]`, dropped);

  for (const key of Object.keys(input)) {
    if (DROPPED_FIELDS.has(key)) dropped.push(`${path}.${key}`);
  }

  return output;
}
