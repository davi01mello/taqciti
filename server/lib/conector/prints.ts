/**
 * Os prints da reunião no servidor — binário, imutável, com lápide.
 *
 * Um print é um `data:image/jpeg;base64,…` na extensão. Aqui vira `bytea`: o
 * base64 é um terço maior, e uma imagem já comprimida não encolhe por ser
 * texto. Quem decide se cabe é `cota.ts`; este arquivo valida e grava.
 *
 * Validado pelo CONTEÚDO, não pelo prefixo: um `data:image/jpeg` que não
 * começa com os bytes de um JPEG é lixo (ou outra coisa) e não entra — o
 * servidor devolve estes bytes para outras máquinas, e devolver o que não se
 * conferiu é repassar o problema.
 */
import { z } from 'zod';
import { banco, type Consultador } from './banco';
import { invalidarCabeca } from './cabeca';

/** O `tipo` com que a extensão manda estes itens para `/api/sync`. */
export const TIPO_PRINT = 'print';

/** Teto de UM print, decodificado. `captureVisibleTab` em JPEG fica bem abaixo. */
export const MAX_BYTES_DO_PRINT = 1_500_000;

const printSchema = z.object({
  id: z.string().min(1).max(200),
  meetingId: z.string().min(1).max(200),
  // O teto do base64 acompanha o do binário (4/3) com folga para o prefixo.
  dataUrl: z.string().max(Math.ceil((MAX_BYTES_DO_PRINT * 4) / 3) + 100),
  at: z.number().int().min(0),
  largura: z.number().int().min(0).max(20_000),
  altura: z.number().int().min(0).max(20_000),
});

export interface PrintRecebido {
  id: string;
  reuniaoId: string;
  mime: string;
  bytes: Buffer;
  emMs: number;
  largura: number;
  altura: number;
}

export type ResultadoDoPrint = { ok: true; item: PrintRecebido } | { ok: false; motivo: string };

const ASSINATURAS: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/** Valida o print vindo da rede. Nunca lança. */
export function validarPrint(bruto: unknown): ResultadoDoPrint {
  const r = printSchema.safeParse(bruto);
  if (!r.success) {
    const p = r.error.issues[0];
    return { ok: false, motivo: `Print inválido (${p?.path.join('.') || 'formato'}: ${p?.message ?? ''}).` };
  }
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(r.data.dataUrl);
  if (!m) return { ok: false, motivo: 'Print inválido (dataUrl não é uma imagem jpeg, png ou webp em base64).' };
  const mime = m[1]!;
  const bytes = Buffer.from(m[2]!, 'base64');
  if (bytes.length === 0) return { ok: false, motivo: 'Print inválido (imagem vazia).' };
  if (bytes.length > MAX_BYTES_DO_PRINT) {
    return { ok: false, motivo: `Print acima de ${MAX_BYTES_DO_PRINT} bytes.` };
  }
  if (!ASSINATURAS[mime]!(bytes)) {
    return { ok: false, motivo: `Print inválido (os bytes não são ${mime}).` };
  }
  return {
    ok: true,
    item: {
      id: r.data.id,
      reuniaoId: r.data.meetingId,
      mime,
      bytes,
      emMs: r.data.at,
      largura: r.data.largura,
      altura: r.data.altura,
    },
  };
}

/** Upsert: reenviar o mesmo print é inofensivo — e desfaz uma lápide anterior. */
export async function gravarPrint(
  pessoaId: string,
  p: PrintRecebido,
  pool: Consultador = banco(),
): Promise<void> {
  await pool.query(
    `insert into print_local
       (pessoa_id, id, reuniao_id, mime, bytes, tamanho, largura, altura, em_ms, apagado, seq, atualizado_em)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, nextval('copia_seq'), now())
     on conflict (pessoa_id, id) do update set
       reuniao_id = excluded.reuniao_id,
       mime = excluded.mime,
       bytes = excluded.bytes,
       tamanho = excluded.tamanho,
       largura = excluded.largura,
       altura = excluded.altura,
       em_ms = excluded.em_ms,
       apagado = false,
       seq = nextval('copia_seq'),
       atualizado_em = now()`,
    [pessoaId, p.id, p.reuniaoId, p.mime, p.bytes, p.bytes.length, p.largura, p.altura, p.emMs],
  );
  invalidarCabeca(pessoaId);
}

/** Deixa a lápide: a imagem sai (é o que ocupa espaço), a exclusão chega às outras máquinas. */
export async function apagarPrint(
  pessoaId: string,
  id: string,
  pool: Consultador = banco(),
): Promise<void> {
  await pool.query(
    `insert into print_local (pessoa_id, id, bytes, tamanho, apagado, seq, atualizado_em)
     values ($1, $2, null, 0, true, nextval('copia_seq'), now())
     on conflict (pessoa_id, id) do update set
       bytes = null, tamanho = 0, apagado = true,
       seq = nextval('copia_seq'), atualizado_em = now()`,
    [pessoaId, id],
  );
  invalidarCabeca(pessoaId);
}

export interface PrintRestaurado {
  id: string;
  meetingId: string;
  dataUrl: string;
  at: number;
  largura: number;
  altura: number;
}

/** Lê os prints pelos `seq` já escolhidos para a página da volta. */
export async function lerPrintsPorSeq(
  pessoaId: string,
  seqs: readonly number[],
  pool: Consultador = banco(),
): Promise<Map<number, PrintRestaurado>> {
  const saida = new Map<number, PrintRestaurado>();
  if (seqs.length === 0) return saida;
  const r = await pool.query(
    `select seq, id, reuniao_id, mime, em_ms, largura, altura,
            replace(encode(bytes, 'base64'), E'\\n', '') as b64
       from print_local
      where pessoa_id = $1 and seq = any($2::bigint[]) and not apagado`,
    [pessoaId, seqs.map(String)],
  );
  for (const l of r.rows) {
    saida.set(Number(l.seq), {
      id: String(l.id),
      meetingId: String(l.reuniao_id),
      dataUrl: `data:${String(l.mime)};base64,${String(l.b64)}`,
      at: Number(l.em_ms),
      largura: Number(l.largura),
      altura: Number(l.altura),
    });
  }
  return saida;
}
