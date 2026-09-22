/**
 * A gravação do acervo. É por aqui que a sincronização da extensão entra.
 *
 * ── Tudo é upsert, e isso não é preguiça ──────────────────────────────────
 *
 * A extensão não tem como saber o que o servidor já viu: ela reabre, o
 * navegador reinicia, a sincronização cai no meio. Se a gravação fosse
 * `insert`, cada uma dessas situações viraria um erro de chave duplicada que
 * o cliente teria que interpretar — e a interpretação certa seria "tente de
 * novo como update", que é o que o upsert já faz.
 *
 * O efeito prático é que sincronizar é IDEMPOTENTE: mandar a mesma reunião
 * dez vezes dá o mesmo resultado que mandar uma. É o que permite ao cliente
 * ser burro e simplesmente reenviar o que mudou desde a última vez, sem
 * levar em conta o que chegou.
 *
 * ── `texto_busca` é gravado, não calculado pelo banco ─────────────────────
 *
 * Ver o cabeçalho de `esquema.sql`: quem dobra o acento é `dobrar()`, a
 * mesma função do ranqueamento. Por isso toda escrita passa por
 * `textoDeBusca` — se alguém gravar por fora, a linha existe mas não é
 * encontrável, que é a pior falha possível aqui porque é silenciosa.
 *
 * ── Toda escrita invalida o cache da pessoa ───────────────────────────────
 *
 * `AcervoPostgres` (ver `cache.ts`) cacheia leitura por até 30s. Sem
 * invalidar aqui, sincronizar uma reunião editada devolveria a versão velha
 * para a Claude até o TTL vencer — silenciosamente, que é o pior jeito de
 * falhar. Por isso toda função abaixo, inclusive `apagarItem`, chama
 * `invalidarPessoa` depois de escrever.
 */
import { type Consultador, banco } from './banco';
import { textoDeBusca } from './acervoPostgres';
import { invalidarPessoa } from './cache';
import type {
  ConversaDoAcervo,
  DocumentoDoAcervo,
  ItemPorTipo,
  NotaDoAcervo,
  ReuniaoDoAcervo,
  TipoDeItem,
} from './tipos';

export async function gravarReuniao(
  pessoaId: string,
  r: ReuniaoDoAcervo,
  pool: Consultador = banco(),
): Promise<void> {
  await pool.query(
    `insert into reuniao
       (pessoa_id, id, titulo, inicio_ms, duracao_s, participantes, falas, texto_busca, atualizada_em)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, now())
     on conflict (pessoa_id, id) do update set
       titulo = excluded.titulo,
       inicio_ms = excluded.inicio_ms,
       duracao_s = excluded.duracao_s,
       participantes = excluded.participantes,
       falas = excluded.falas,
       texto_busca = excluded.texto_busca,
       atualizada_em = now()`,
    [
      pessoaId,
      r.id,
      r.titulo,
      r.inicioMs,
      r.duracaoSegundos,
      JSON.stringify(r.participantes),
      JSON.stringify(r.falas),
      textoDeBusca(r),
    ],
  );
  invalidarPessoa(pessoaId);
}

export async function gravarDocumento(
  pessoaId: string,
  d: DocumentoDoAcervo,
  pool: Consultador = banco(),
): Promise<void> {
  await pool.query(
    `insert into documento
       (pessoa_id, id, titulo, texto, criado_ms, atualizado_ms, tipo_gerado, reuniao_id, texto_busca, atualizado_em)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     on conflict (pessoa_id, id) do update set
       titulo = excluded.titulo,
       texto = excluded.texto,
       criado_ms = excluded.criado_ms,
       atualizado_ms = excluded.atualizado_ms,
       tipo_gerado = excluded.tipo_gerado,
       reuniao_id = excluded.reuniao_id,
       texto_busca = excluded.texto_busca,
       atualizado_em = now()`,
    [
      pessoaId,
      d.id,
      d.titulo,
      d.texto,
      d.criadoMs,
      d.atualizadoMs,
      d.tipoGerado ?? null,
      d.reuniaoId ?? null,
      textoDeBusca(d),
    ],
  );
  invalidarPessoa(pessoaId);
}

export async function gravarConversa(
  pessoaId: string,
  c: ConversaDoAcervo,
  pool: Consultador = banco(),
): Promise<void> {
  await pool.query(
    `insert into conversa
       (pessoa_id, id, titulo, criada_ms, atualizada_ms, mensagens, reuniao_id, texto_busca, atualizada_em)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, now())
     on conflict (pessoa_id, id) do update set
       titulo = excluded.titulo,
       criada_ms = excluded.criada_ms,
       atualizada_ms = excluded.atualizada_ms,
       mensagens = excluded.mensagens,
       reuniao_id = excluded.reuniao_id,
       texto_busca = excluded.texto_busca,
       atualizada_em = now()`,
    [
      pessoaId,
      c.id,
      c.titulo,
      c.criadaMs,
      c.atualizadaMs,
      JSON.stringify(c.mensagens),
      c.reuniaoId ?? null,
      textoDeBusca(c),
    ],
  );
  invalidarPessoa(pessoaId);
}

export async function gravarNota(
  pessoaId: string,
  n: NotaDoAcervo,
  pool: Consultador = banco(),
): Promise<void> {
  await pool.query(
    `insert into nota
       (pessoa_id, id, reuniao_id, reuniao_titulo, texto, atualizada_ms, marcacoes, prints, texto_busca, atualizada_em)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, now())
     on conflict (pessoa_id, id) do update set
       reuniao_id = excluded.reuniao_id,
       reuniao_titulo = excluded.reuniao_titulo,
       texto = excluded.texto,
       atualizada_ms = excluded.atualizada_ms,
       marcacoes = excluded.marcacoes,
       prints = excluded.prints,
       texto_busca = excluded.texto_busca,
       atualizada_em = now()`,
    [
      pessoaId,
      n.id,
      n.reuniaoId,
      n.reuniaoTitulo,
      n.texto,
      n.atualizadaMs,
      JSON.stringify(n.marcacoes),
      n.prints,
      textoDeBusca(n),
    ],
  );
  invalidarPessoa(pessoaId);
}

/** Despacha pelo tipo. É o que a rota de sincronização vai chamar. */
export async function gravarItem<T extends TipoDeItem>(
  pessoaId: string,
  tipo: T,
  item: ItemPorTipo[T],
  pool: Consultador = banco(),
): Promise<void> {
  switch (tipo) {
    case 'reuniao':
      return gravarReuniao(pessoaId, item as ReuniaoDoAcervo, pool);
    case 'documento':
      return gravarDocumento(pessoaId, item as DocumentoDoAcervo, pool);
    case 'conversa':
      return gravarConversa(pessoaId, item as ConversaDoAcervo, pool);
    default:
      return gravarNota(pessoaId, item as NotaDoAcervo, pool);
  }
}

/**
 * Apaga um item. A extensão chama isto quando a pessoa apaga uma reunião —
 * apagar localmente e deixar a cópia no servidor faria o conector responder
 * sobre uma reunião que não existe mais.
 */
export async function apagarItem(
  pessoaId: string,
  tipo: TipoDeItem,
  id: string,
  pool: Consultador = banco(),
): Promise<void> {
  // O nome da tabela vem de `TipoDeItem`, que é uma união fechada de
  // literais — não há string de fora chegando aqui.
  await pool.query(`delete from ${tipo} where pessoa_id = $1 and id = $2`, [pessoaId, id]);
  invalidarPessoa(pessoaId);
}
