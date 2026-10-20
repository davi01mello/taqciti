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
 * O histórico de versões dos documentos (`historico.ts`) e os prints (`prints.ts`)
 * entram na mesma leitura, como coleções `historico` e `print`, para a máquina
 * nova receber tudo por um cursor só.
 */
import { z } from 'zod';
import { banco, type Consultador } from './banco';
import { geracaoDe, invalidarCabeca, lembrarCabeca, semNovidade } from './cabeca';
import { lerPrintsPorSeq } from './prints';

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

/** O tamanho lógico de uma cópia, em bytes de JSON: o que conta para a cota. */
export function tamanhoDaCopia(c: CopiaRecebida): number {
  return JSON.stringify(c.corpo).length;
}

/** Upsert: reenviar a mesma cópia é inofensivo — e desfaz uma lápide anterior. */
export async function gravarCopia(
  pessoaId: string,
  c: CopiaRecebida,
  pool: Consultador = banco(),
): Promise<void> {
  await pool.query(
    `insert into copia_local (pessoa_id, colecao, id, corpo, tamanho, apagado, seq, atualizado_em)
     values ($1, $2, $3, $4::jsonb, $5, false, nextval('copia_seq'), now())
     on conflict (pessoa_id, colecao, id) do update set
       corpo = excluded.corpo,
       tamanho = excluded.tamanho,
       apagado = false,
       seq = nextval('copia_seq'),
       atualizado_em = now()`,
    [pessoaId, c.colecao, c.id, JSON.stringify(c.corpo), tamanhoDaCopia(c)],
  );
  invalidarCabeca(pessoaId);
}

/** Deixa a lápide: o corpo sai, e a exclusão chega às outras máquinas. */
export async function apagarCopia(
  pessoaId: string,
  colecao: ColecaoDaCopia,
  id: string,
  pool: Consultador = banco(),
): Promise<void> {
  await pool.query(
    `insert into copia_local (pessoa_id, colecao, id, corpo, tamanho, apagado, seq, atualizado_em)
     values ($1, $2, $3, null, 0, true, nextval('copia_seq'), now())
     on conflict (pessoa_id, colecao, id) do update set
       corpo = null,
       tamanho = 0,
       apagado = true,
       seq = nextval('copia_seq'),
       atualizado_em = now()`,
    [pessoaId, colecao, id],
  );
  invalidarCabeca(pessoaId);
}

export interface ItemRestaurado {
  colecao: ColecaoDaCopia | 'historico' | 'print';
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
/**
 * Teto de bytes por página. Abaixo dos 4,5 MB que a Vercel aceita numa resposta
 * de função, com folga para o JSON em volta e o base64 dos prints.
 */
export const MAX_BYTES_DA_PAGINA = 3 * 1024 * 1024;

/**
 * O que mudou para esta pessoa depois de `desde`, em ordem de `seq`.
 *
 * ── Duas fases, para não carregar o que não vai caber ─────────────────────
 *
 * A primeira consulta traz só METADADOS (coleção, id, `seq`, tamanho lógico) —
 * barata, sem tocar em transcrições nem em imagens. Com os tamanhos, a página
 * é cortada AQUI, e só então os corpos dos itens escolhidos são buscados. A
 * versão anterior trazia o corpo de todos e descartava o que passava do teto:
 * com prints, 25 imagens lidas do banco para devolver duas.
 *
 * A página para ANTES de passar de `maxBytes`, mas sempre leva pelo menos um
 * item: um registro maior que o teto precisa conseguir sair, sozinho, em vez de
 * travar a leitura para sempre no mesmo lugar.
 *
 * Se um item mudar ENTRE as duas fases ele ganhou um `seq` novo e a segunda
 * consulta não o acha pelo `seq` antigo: é pulado, e volta na página seguinte
 * com o `seq` novo. Nada se perde — só chega um pouco depois.
 */
export async function lerCopias(
  pessoaId: string,
  desde: number,
  opcoes: { maxItens?: number; maxBytes?: number } = {},
  pool: Consultador = banco(),
): Promise<PaginaDaCopia> {
  // Polling automático: na maioria das vezes não há nada, e saber disso não
  // precisa de banco. Ver `cabeca.ts`.
  if (semNovidade(pessoaId, desde)) return { itens: [], proximo: desde, fim: true };
  const geracao = geracaoDe(pessoaId);

  const maxItens = opcoes.maxItens ?? MAX_ITENS_POR_PAGINA;
  const maxBytes = opcoes.maxBytes ?? MAX_BYTES_DA_PAGINA;

  const leve = await pool.query(
    `select colecao, id, apagado, seq, tamanho from (
       select colecao, id, apagado, seq, tamanho
         from copia_local where pessoa_id = $1 and seq > $2
       union all
       select 'historico' as colecao, id, false as apagado, seq, tamanho
         from historico_do_documento where pessoa_id = $1 and seq > $2
       union all
       select 'print' as colecao, id, apagado, seq, tamanho
         from print_local where pessoa_id = $1 and seq > $2
     ) t order by seq limit $3`,
    [pessoaId, desde, maxItens],
  );

  const escolhidas: { colecao: ItemRestaurado['colecao']; id: string; apagado: boolean; seq: number }[] = [];
  let bytes = 0;
  let cortou = false;
  for (const l of leve.rows) {
    const tamanho = l.apagado ? 0 : Number(l.tamanho);
    if (escolhidas.length > 0 && bytes + tamanho > maxBytes) {
      cortou = true;
      break;
    }
    bytes += tamanho;
    escolhidas.push({
      colecao: l.colecao as ItemRestaurado['colecao'],
      id: String(l.id),
      apagado: Boolean(l.apagado),
      seq: Number(l.seq),
    });
  }

  const vivas = (colecoes: (ItemRestaurado['colecao'] | 'copia')[]) =>
    escolhidas
      .filter((e) => !e.apagado && colecoes.includes(e.colecao === 'historico' || e.colecao === 'print' ? e.colecao : 'copia'))
      .map((e) => String(e.seq));

  const corposDaCopia = new Map<number, unknown>();
  const seqsCopia = vivas(['copia']);
  if (seqsCopia.length > 0) {
    const r = await pool.query(
      'select seq, corpo from copia_local where pessoa_id = $1 and seq = any($2::bigint[]) and not apagado',
      [pessoaId, seqsCopia],
    );
    for (const l of r.rows) corposDaCopia.set(Number(l.seq), l.corpo);
  }

  const corposDoHistorico = new Map<number, unknown>();
  const seqsHistorico = vivas(['historico']);
  if (seqsHistorico.length > 0) {
    const r = await pool.query(
      `select seq, jsonb_build_object('id', id, 'variante', variante,
                                      'fontesIds', fontes_ids, 'versoes', versoes) as corpo
         from historico_do_documento where pessoa_id = $1 and seq = any($2::bigint[])`,
      [pessoaId, seqsHistorico],
    );
    for (const l of r.rows) corposDoHistorico.set(Number(l.seq), limparNulos(l.corpo));
  }

  const prints = await lerPrintsPorSeq(pessoaId, vivas(['print']).map(Number), pool);

  const itens: ItemRestaurado[] = [];
  for (const e of escolhidas) {
    if (e.apagado) {
      itens.push({ ...e, corpo: null });
      continue;
    }
    const corpo =
      e.colecao === 'historico' ? corposDoHistorico.get(e.seq) : e.colecao === 'print' ? prints.get(e.seq) : corposDaCopia.get(e.seq);
    // Mudou entre as duas fases: volta na próxima página com o `seq` novo.
    if (corpo === undefined) continue;
    itens.push({ ...e, corpo });
  }

  const ultimo = escolhidas[escolhidas.length - 1];
  const fim = !cortou && leve.rows.length < maxItens;
  // `proximo` é o último `seq` ESCOLHIDO, não o último devolvido: um item pulado
  // reaparece depois com `seq` maior, então passar por cima dele é seguro.
  const proximo = ultimo ? ultimo.seq : desde;
  // Página vazia e sem mais nada: a instância passa a saber que não há novidade.
  if (fim && escolhidas.length === 0) lembrarCabeca(pessoaId, desde, geracao);
  return { itens, proximo, fim };
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