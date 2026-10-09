/**
 * Histórico de versões dos documentos personalizados, espelhado no servidor.
 *
 * É BACKUP, não fonte: a árvore de cada revisão mora na extensão
 * (`taq:documentVersions`) e sobe pela mesma sincronização do resto do
 * acervo. Sem leitura de volta e sem exposição ao conector MCP — por isso não
 * entra em `TipoDeItem` (que o conector enumera) e tem funções próprias.
 *
 * O que chega é VALIDADO antes de tocar o banco. A rota de sincronização
 * valida só `tipo` e `id` dos demais itens; aqui o corpo é uma árvore de
 * documento aninhada, e um valor torto viraria erro 500 do Postgres no lote
 * inteiro. Recusar cedo, com motivo, é o que deixa o resto do lote passar.
 */
import { z } from 'zod';
import { contentTreeSchema } from '../documentos/contentTree';
import { banco, type Consultador } from './banco';
import { invalidarPessoa } from './cache';

/** O `tipo` com que a extensão manda estes itens para `/api/sync`. */
export const TIPO_HISTORICO = 'historico';

/** Versões por documento — o mesmo teto da extensão. */
export const MAX_VERSOES = 30;
/** Teto do histórico de UM documento, em bytes de JSON. */
export const MAX_BYTES_DO_HISTORICO = 3 * 1024 * 1024;

const versaoSchema = z.object({
  revisao: z.number().int().min(0),
  arvore: contentTreeSchema,
  criadaEm: z.number().int().min(0),
  origem: z.enum(['geracao', 'edicao', 'restauracao']),
  pedido: z.string().max(4000).optional(),
  manifesto: z.record(z.string(), z.unknown()).optional(),
  problemas: z.number().int().min(0),
});

export const historicoSchema = z.object({
  id: z.string().min(1).max(200),
  variante: z.string().min(1).max(60).optional(),
  fontesIds: z.array(z.string().max(200)).max(50),
  versoes: z.array(versaoSchema).min(1).max(MAX_VERSOES),
});

export type HistoricoDoDocumento = z.infer<typeof historicoSchema>;

export type ResultadoDaValidacao =
  | { ok: true; item: HistoricoDoDocumento }
  | { ok: false; motivo: string };

/** Valida o item vindo da rede. Nunca lança. */
export function validarHistorico(bruto: unknown): ResultadoDaValidacao {
  const r = historicoSchema.safeParse(bruto);
  if (!r.success) {
    const primeiro = r.error.issues[0];
    const onde = primeiro?.path.length ? `${primeiro.path.join('.')}: ` : '';
    return { ok: false, motivo: `Histórico inválido (${onde}${primeiro?.message ?? 'formato'}).` };
  }
  const { versoes } = r.data;
  // Revisões estritamente crescentes, da mais antiga para a atual.
  for (let i = 1; i < versoes.length; i++) {
    if (versoes[i]!.revisao <= versoes[i - 1]!.revisao) {
      return { ok: false, motivo: 'Histórico inválido: as revisões precisam crescer.' };
    }
  }
  if (JSON.stringify(r.data).length > MAX_BYTES_DO_HISTORICO) {
    return { ok: false, motivo: `Histórico acima de ${MAX_BYTES_DO_HISTORICO} bytes.` };
  }
  return { ok: true, item: r.data };
}

/** Upsert: reenviar o mesmo histórico é inofensivo. */
export async function gravarHistorico(
  pessoaId: string,
  item: HistoricoDoDocumento,
  pool: Consultador = banco(),
): Promise<void> {
  const atual = item.versoes[item.versoes.length - 1]!;
  await pool.query(
    `insert into historico_do_documento
       (pessoa_id, id, variante, fontes_ids, versoes, revisao_atual, atualizado_ms, atualizado_em)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, now())
     on conflict (pessoa_id, id) do update set
       variante = excluded.variante,
       fontes_ids = excluded.fontes_ids,
       versoes = excluded.versoes,
       revisao_atual = excluded.revisao_atual,
       atualizado_ms = excluded.atualizado_ms,
       atualizado_em = now()`,
    [
      pessoaId,
      item.id,
      item.variante ?? null,
      JSON.stringify(item.fontesIds),
      JSON.stringify(item.versoes),
      atual.revisao,
      atual.criadaEm,
    ],
  );
  invalidarPessoa(pessoaId);
}

export async function apagarHistorico(
  pessoaId: string,
  id: string,
  pool: Consultador = banco(),
): Promise<void> {
  await pool.query('delete from historico_do_documento where pessoa_id = $1 and id = $2', [pessoaId, id]);
  invalidarPessoa(pessoaId);
}

/** Leitura para teste e para um futuro "restaurar do servidor". */
export async function lerHistorico(
  pessoaId: string,
  id: string,
  pool: Consultador = banco(),
): Promise<(HistoricoDoDocumento & { revisaoAtual: number }) | null> {
  const r = await pool.query(
    `select id, variante, fontes_ids, versoes, revisao_atual
       from historico_do_documento where pessoa_id = $1 and id = $2`,
    [pessoaId, id],
  );
  const linha = r.rows[0] as
    | { id: string; variante: string | null; fontes_ids: string[]; versoes: HistoricoDoDocumento['versoes']; revisao_atual: number }
    | undefined;
  if (!linha) return null;
  return {
    id: linha.id,
    ...(linha.variante ? { variante: linha.variante } : {}),
    fontesIds: linha.fontes_ids,
    versoes: linha.versoes,
    revisaoAtual: Number(linha.revisao_atual),
  };
}
