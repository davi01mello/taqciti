/**
 * A validação das PROJEÇÕES que a sincronização grava (reunião, documento,
 * conversa, nota — os tipos de `tipos.ts`).
 *
 * Cópia, print e histórico sempre tiveram validação e cota (`copia.ts`,
 * `prints.ts`, `historico.ts`). As projeções entravam com um `as` e nada mais:
 * o único teto era o corpo da requisição, elas não contavam para a cota e o
 * disjuntor global não as via. Uma conta — ou uma extensão com bug — em laço,
 * com ids novos, enchia os 500 MB da Supabase e deixava o banco somente
 * leitura para todo mundo.
 *
 * Os tetos são largos: uma reunião de quatro horas fica muito abaixo de todos.
 * O que eles barram é o que não é reunião nenhuma.
 */
import { z } from 'zod';
import type { ItemPorTipo, TipoDeItem } from './tipos';

/** Ids de item vêm da extensão; nenhum legítimo passa perto disto. */
export const MAX_ID = 200;
/** Teto de UMA projeção serializada. */
export const MAX_PROJECAO_BYTES = 3 * 1024 * 1024;

const id = z.string().min(1).max(MAX_ID);
const titulo = z.string().max(1_000);
const instante = z.number().finite();
const opcional = (s: z.ZodString) =>
  s
    .nullish()
    .transform((v) => v ?? undefined);

const reuniao = z.object({
  id,
  titulo,
  inicioMs: instante,
  duracaoSegundos: z.number().finite().min(0).max(7 * 24 * 3600),
  participantes: z.array(z.string().max(300)).max(1_000),
  falas: z
    .array(
      z.object({
        falante: z.string().max(300).nullable(),
        texto: z.string().max(20_000),
        offsetMs: z.number().finite(),
      }),
    )
    .max(50_000),
});

const documento = z.object({
  id,
  titulo,
  texto: z.string().max(2_000_000),
  criadoMs: instante,
  atualizadoMs: instante,
  tipoGerado: opcional(z.string().max(100)),
  reuniaoId: opcional(z.string().max(MAX_ID)),
});

const conversa = z.object({
  id,
  titulo,
  criadaMs: instante,
  atualizadaMs: instante,
  mensagens: z
    .array(
      z.object({
        autor: z.enum(['pessoa', 'assistente']),
        texto: z.string().max(200_000),
        emMs: instante,
      }),
    )
    .max(5_000),
  reuniaoId: opcional(z.string().max(MAX_ID)),
});

const nota = z.object({
  id,
  reuniaoId: z.string().max(MAX_ID),
  reuniaoTitulo: titulo,
  texto: z.string().max(500_000),
  atualizadaMs: instante,
  marcacoes: z.record(z.enum(['destaque', 'duvida', 'decisao', 'acao']), z.number().finite()),
  prints: z.number().int().min(0).max(10_000),
});

const SCHEMAS: { [T in TipoDeItem]: z.ZodType<ItemPorTipo[T], z.ZodTypeDef, unknown> } = {
  reuniao,
  documento,
  conversa,
  nota,
};

export type ProjecaoValidada<T extends TipoDeItem> =
  | { ok: true; item: ItemPorTipo[T] }
  | { ok: false; motivo: string };

export function validarProjecao<T extends TipoDeItem>(tipo: T, bruto: unknown): ProjecaoValidada<T> {
  const r = SCHEMAS[tipo].safeParse(bruto);
  if (!r.success) {
    const primeiro = r.error.issues[0];
    return { ok: false, motivo: `formato: ${primeiro?.path.join('.') || tipo} — ${primeiro?.message ?? 'inválido'}` };
  }
  if (Buffer.byteLength(JSON.stringify(r.data), 'utf8') > MAX_PROJECAO_BYTES) {
    return { ok: false, motivo: `tamanho: a projeção passa de ${MAX_PROJECAO_BYTES} bytes.` };
  }
  return { ok: true, item: r.data };
}

/** Quantas linhas de UM tipo uma pessoa pode ter. Muito acima de qualquer uso real. */
export function maxItensPorTipo(): number {
  const v = Number(process.env.TAQCITI_MAX_ITENS_POR_TIPO);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 5_000;
}
