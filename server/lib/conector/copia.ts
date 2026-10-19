/**
 * A cópia fiel do acervo — o que permite a uma máquina nova trazer tudo de volta.
 *
 * ── Por que não basta o acervo do conector ────────────────────────────────
 *
 * `reuniao`, `documento`, `conversa` e `nota` guardam a PROJEÇÃO magra que a IA
 * lê (ver `tipos.ts`): sem prints, sem o `captionId` das marcações, sem o
 * `html` e o `formato` do documento, sem o id das mensagens. Reconstruir o
 * storage da extensão a partir disso perderia coisa em silêncio. Então a
 * extensão manda, ao lado da projeção, o registro INTEIRO, e ele mora aqui.
 * O servidor não interpreta o corpo: guarda e devolve. Quem sabe o formato é a
 * extensão, e é ela quem valida na volta.
 *
 * ── Leitura incremental, com lápide ───────────────────────────────────────
 *
 * Outra máquina pergunta "o que mudou desde o `seq` N?". Cada escrita —
 * inclusive uma exclusão, que vira lápide (`apagado`) — ganha um `seq` maior,
 * então nada que aconteceu depois de N escapa, e nada some sem avisar.
 *
 * O histórico de versões dos documentos (`historico.ts`) entra na mesma
 * leitura, como coleção `historico`, para a máquina nova receber tudo por um
 * cursor só.
 */
import { z } from 'zod';
import { banco, type Consultador } from './banco';

/** O `tipo` com que a extensão manda estes itens para `/api/sync`. */
export const TIPO_COPIA = 'copia';

/** As coleções cuja cópia fiel é guardada aqui. `historico` tem tabela própria. */
export const COLECOES_DA_COPIA = ['reuniao', 'documento', 'conversa', 'nota'] as const;
export type ColecaoDaCopia = (typeof COLECOES_DA_COPIA)[number];

/** Teto de UM registro, em bytes de JSON. Uma reunião de seis horas cabe com folga. */
export const MAX_BYTES_DA_COPIA = 6 * 1024 * 1024;

const copiaSchema = z.object({
  id: z.string().min(1).max(200),
  colecao: z.enum(COLECOES_DA_COPIA),
  corpo: z.record(z.string(), z.unknown()),
});

export interface CopiaRecebida {
  id: string;
  colecao: ColecaoDaCopia;
  corpo: Record<string, unknown>;
}

export type ResultadoDaCopia = { ok: true; item: CopiaRecebida } | { ok: false; motivo: string };

/** Valida o item vindo da rede. Nunca lança. */
export function validarCopia(bruto: unknown): ResultadoDaCopia {
  const r = copiaSchema.safeParse(bruto);
  if (!r.success) {
    const primeiro = r.error.issues[0];
    const onde = primeiro?.path.length ? `${primeiro.path.join('.')}: ` : '';
    return { ok: false, motivo: `Cópia inválida (${onde}${primeiro?.message ?? 'formato'}).` };
  }
  if (JSON.stringify(r.data.corpo).length > MAX_BYTES_DA_COPIA) {
    return { ok: false, motivo: `Cópia acima de ${MAX_BYTES_DA_COPIA} bytes.` };
  }
  return { ok: true, item: r.data };
}

/** Upsert: reenviar a mesma cópia é inofensivo — e desfaz uma lápide anterior. */
export async function gravarCopia(
  pessoaId: string,
  c: CopiaRecebida,
  pool: Consultador = banco(),
): Promise<void> {
  await pool.query(
    `insert into copia_local (pessoa_id, colecao, id, corpo, apagado, seq, atualizado_em)
     values ($1, $2, $3, $4::jsonb, false, nextval('copia_seq'), now())
     on conflict (pessoa_id, colecao, id) do update set
       corpo = excluded.corpo,
       apagado = false,
       seq = nextval('copia_seq'),
       atualizado_em = now()`,
    [pessoaId, c.colecao, c.id, JSON.stringify(c.corpo)],
  );
}

/** Deixa a lápide: o corpo sai, e a exclusão chega às outras máquinas. */
export async function apagarCopia(
  pessoaId: string,
  colecao: ColecaoDaCopia,
  id: string,
  pool: Consultador = banco(),
): Promise<void> {
  await pool.query(
    `insert into copia_local (pessoa_id, colecao, id, corpo, apagado, seq, atualizado_em)
     values ($1, $2, $3, null, true, nextval('copia_seq'), now())
     on conflict (pessoa_id, colecao, id) do update set
       corpo = null,
       apagado = true,
       seq = nextval('copia_seq'),
       atualizado_em = now()`,
    [pessoaId, colecao, id],
  );
}

export interface ItemRestaurado {
  colecao: ColecaoDaCopia | 'historico';
  id: string;
  /** `null` quando `apagado`. */
  corpo: unknown;
  apagado: boolean;
  seq: number;
}

export interface PaginaDaCopia {
  itens: ItemRestaurado[];
  /** Passe como `desde` na próxima chamada. */
  proximo: number;
  /** `true` quando não há mais nada depois de `proximo`. */
  fim: boolean;
}

/** Itens por página. A página também é cortada por bytes — ver `lerCopias`. */
export const MAX_ITENS_POR_PAGINA = 25;
/** Teto de bytes por página: uma resposta de dezenas de megabytes estoura a função. */
export const MAX_BYTES_DA_PAGINA = 3 * 1024 * 1024;

/**
 * O que mudou para esta pessoa depois de `desde`, em ordem de `seq`.
 *
 * A página para ANTES de passar de `maxBytes`, mas sempre leva pelo menos um
 * item: um registro maior que o teto precisa conseguir sair, sozinho, em vez de
 * travar a leitura para sempre no mesmo lugar.
 */
export async function lerCopias(
  pessoaId: string,
  desde: number,
  opcoes: { maxItens?: number; maxBytes?: number } = {},
  pool: Consultador = banco(),
): Promise<PaginaDaCopia> {
  const maxItens = opcoes.maxItens ?? MAX_ITENS_POR_PAGINA;
  const maxBytes = opcoes.maxBytes ?? MAX_BYTES_DA_PAGINA;

  const r = await pool.query(
    `select colecao, id, corpo, apagado, seq from (
       select colecao, id, corpo, apagado, seq
         from copia_local where pessoa_id = $1 and seq > $2
       union all
       select 'historico' as colecao, id,
              jsonb_build_object('id', id, 'variante', variante,
                                 'fontesIds', fontes_ids, 'versoes', versoes) as corpo,
              false as apagado, seq
         from historico_do_documento where pessoa_id = $1 and seq > $2
     ) t order by seq limit $3`,
    [pessoaId, desde, maxItens],
  );

  const itens: ItemRestaurado[] = [];
  let bytes = 0;
  let cortou = false;
  for (const linha of r.rows) {
    // Só o histórico passa pelo `jsonb_build_object`; o corpo das demais
    // coleções volta exatamente como foi gravado, nulos incluídos.
    const corpo = linha.apagado
      ? null
      : linha.colecao === 'historico'
        ? limparNulos(linha.corpo)
        : linha.corpo;
    const tamanho = corpo === null ? 0 : JSON.stringify(corpo).length;
    if (itens.length > 0 && bytes + tamanho > maxBytes) {
      cortou = true;
      break;
    }
    bytes += tamanho;
    itens.push({
      colecao: linha.colecao as ItemRestaurado['colecao'],
      id: String(linha.id),
      corpo,
      apagado: Boolean(linha.apagado),
      seq: Number(linha.seq),
    });
  }

  const ultimo = itens[itens.length - 1];
  return {
    itens,
    proximo: ultimo ? ultimo.seq : desde,
    // Uma página cheia pode ter mais atrás; só uma página curta garante o fim.
    fim: !cortou && r.rows.length < maxItens,
  };
}

/** `jsonb_build_object` põe `null` onde o campo opcional faltava: tira. */
function limparNulos(valor: unknown): unknown {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return valor;
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    if (v !== null) saida[k] = v;
  }
  return saida;
}
