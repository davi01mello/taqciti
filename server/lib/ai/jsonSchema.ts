/**
 * Validação de JSON Schema em código, e o protocolo de reparo em uma
 * tentativa. Vive aqui, fora dos adaptadores, porque os três precisam do
 * mesmo comportamento: `jsonSchema` sempre funciona, e quando o provedor
 * entrega algo fora da forma o adaptador marca `repaired: true`.
 *
 * O validador cobre de propósito só o subconjunto que os três provedores
 * aceitam na saída estruturada nativa (type, properties, required, items,
 * enum, additionalProperties). Não é um validador de JSON Schema completo
 * e não deve virar um — schema mais exótico que isso não passa igual nos
 * três, e aí a comparação perde o sentido.
 *
 * Preferi isto a instalar um validador (ajv e afins): a superfície usada é
 * pequena, o comportamento precisa ser idêntico nos três adaptadores, e
 * cada dependência nova no servidor é uma decisão do autor, não minha.
 */
import type { JsonSchema } from './types';

export interface ValidationResult {
  ok: boolean;
  value?: unknown;
  errors: string[];
}

/**
 * Extrai o primeiro objeto/array JSON de um texto. Modelos sem saída
 * estruturada nativa costumam embrulhar o JSON em cerca de markdown ou em
 * uma frase de cortesia; isso não é motivo pra gastar uma chamada de reparo.
 */
export function extractJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = (fenced ? fenced[1] : trimmed).trim();

  const start = candidate.search(/[[{]/);
  if (start === -1) return null;

  const open = candidate[start];
  const close = open === '{' ? '}' : ']';

  // Varredura com consciência de string, senão uma chave dentro de um
  // valor de texto ("ele disse: {agora}") desbalanceia a contagem.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i += 1) {
    const ch = candidate[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null;
}

export function validate(value: unknown, schema: JsonSchema, path = '$'): ValidationResult {
  const errors: string[] = [];
  walk(value, schema, path, errors);
  return errors.length === 0 ? { ok: true, value, errors: [] } : { ok: false, errors };
}

function walk(value: unknown, schema: JsonSchema, path: string, errors: string[]): void {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    if (!schema.enum.some((allowed) => allowed === value)) {
      errors.push(`${path}: valor "${String(value)}" fora do enum permitido.`);
      return;
    }
  }

  const expected = schema.type;
  if (!expected) return;

  switch (expected) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push(`${path}: esperava object, veio ${describe(value)}.`);
        return;
      }
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!(key in record)) errors.push(`${path}.${key}: campo obrigatório ausente.`);
      }
      const properties = schema.properties ?? {};
      for (const [key, subSchema] of Object.entries(properties)) {
        if (key in record) walk(record[key], subSchema, `${path}.${key}`, errors);
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(record)) {
          if (!(key in properties)) errors.push(`${path}.${key}: propriedade não prevista.`);
        }
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${path}: esperava array, veio ${describe(value)}.`);
        return;
      }
      if (schema.items) {
        value.forEach((item, index) => {
          walk(item, schema.items as JsonSchema, `${path}[${index}]`, errors);
        });
      }
      return;
    }
    case 'string':
      if (typeof value !== 'string') errors.push(`${path}: esperava string, veio ${describe(value)}.`);
      return;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push(`${path}: esperava number, veio ${describe(value)}.`);
      }
      return;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push(`${path}: esperava integer, veio ${describe(value)}.`);
      }
      return;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path}: esperava boolean, veio ${describe(value)}.`);
      return;
    case 'null':
      if (value !== null) errors.push(`${path}: esperava null, veio ${describe(value)}.`);
      return;
    default:
      // Tipo fora do subconjunto suportado: não invento validação.
      return;
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Parse + validação numa passada só, tolerante a cerca de markdown. */
export function parseAndValidate(text: string, schema: JsonSchema): ValidationResult {
  const json = extractJson(text);
  if (json === null) {
    return { ok: false, errors: ['Nenhum JSON encontrado na resposta.'] };
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    return { ok: false, errors: [`JSON inválido: ${(error as Error).message}`] };
  }
  return validate(value, schema);
}

/**
 * Instrução de schema injetada no system prompt quando o provedor não tem
 * saída estruturada nativa. Neutra quanto ao fornecedor de propósito — o
 * mesmo texto tem que rodar nos três, senão a comparação não significa nada.
 */
export function schemaInstruction(schema: JsonSchema): string {
  return [
    'Responda EXCLUSIVAMENTE com um documento JSON válido que satisfaça o schema abaixo.',
    'Sem texto antes, sem texto depois, sem cerca de markdown.',
    '',
    'JSON Schema:',
    JSON.stringify(schema, null, 2),
  ].join('\n');
}

/** Mensagem de reparo: devolve ao modelo a saída dele e o que quebrou. */
export function repairInstruction(previous: string, errors: string[]): string {
  return [
    'A resposta anterior não satisfaz o schema. Problemas encontrados:',
    ...errors.map((error) => `- ${error}`),
    '',
    'Reescreva a resposta inteira corrigindo esses problemas.',
    'Responda EXCLUSIVAMENTE com o JSON corrigido.',
    '',
    'Resposta anterior:',
    previous,
  ].join('\n');
}
