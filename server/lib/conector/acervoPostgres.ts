/**
 * `Acervo` sobre Postgres. A mesma interface que `acervoDeMemoria`, e
 * nenhuma ferramenta sabe a diferença.
 *
 * ── A regra que não pode ser quebrada em lugar nenhum deste arquivo ──────
 *
 * TODA consulta filtra por `pessoa_id`. É a única coisa que separa o acervo
 * de uma pessoa do de outra; um WHERE esquecido não dá erro, não quebra
 * teste de forma óbvia e vaza a reunião de alguém para o conector de outro.
 * Por isso o `pessoaId` entra no construtor e é sempre `$1` — nunca
 * interpolado, nunca opcional, nunca derivado de argumento de ferramenta.
 *
 * ── Por que `procurar` devolve linhas inteiras ────────────────────────────
 *
 * Porque o ranqueamento fino e a POSIÇÃO do acerto são calculados em
 * TypeScript (ver `busca.ts`), e para isso é preciso o texto. O `@@` aqui é
 * peneira: joga fora o que não tem chance, usando índice, e materializa o
 * JSONB só do que passou. Num acervo com trezentas reuniões, é a diferença
 * entre carregar trezentas transcrições e carregar três.
 */
import { type Consultador, banco } from './banco';
import { dobrar } from './busca';
import type {
  Acervo,
  ConversaDoAcervo,
  DocumentoDoAcervo,
  Fala,
  IndicePorTipo,
  ItemPorTipo,
  MensagemDaConversa,
  NotaDoAcervo,
  ReuniaoDoAcervo,
  TipoDeItem,
} from './tipos';

/**
 * `bigint` para número, aceitando as duas formas em que ele chega.
 *
 * Não é defensividade solta: o `pg` devolve `bigint` como **string** (para
 * não perder precisão acima de 2^53) e o PGlite devolve como **number**. Os
 * testes rodam no segundo e a produção no primeiro, então uma conversão que
 * só trate um dos dois passa verde e quebra no deploy. Todos os nossos
 * valores são epoch-ms, que cabem em number com folga.
 */
function ms(v: unknown): number {
  return typeof v === 'string' ? Number.parseInt(v, 10) : Number(v ?? 0);
}

// ------------------------------------------------------- linhas → domínio

function paraReuniao(l: Record<string, unknown>): ReuniaoDoAcervo {
  return {
    id: String(l.id),
    titulo: String(l.titulo),
    inicioMs: ms(l.inicio_ms),
    duracaoSegundos: Number(l.duracao_s ?? 0),
    participantes: (l.participantes as string[] | null) ?? [],
    falas: (l.falas as Fala[] | null) ?? [],
  };
}

function paraDocumento(l: Record<string, unknown>): DocumentoDoAcervo {
  return {
    id: String(l.id),
    titulo: String(l.titulo),
    texto: String(l.texto ?? ''),
    criadoMs: ms(l.criado_ms),
    atualizadoMs: ms(l.atualizado_ms),
    ...(l.tipo_gerado ? { tipoGerado: String(l.tipo_gerado) } : {}),
    ...(l.reuniao_id ? { reuniaoId: String(l.reuniao_id) } : {}),
  };
}

function paraConversa(l: Record<string, unknown>): ConversaDoAcervo {
  return {
    id: String(l.id),
    titulo: String(l.titulo),
    criadaMs: ms(l.criada_ms),
    atualizadaMs: ms(l.atualizada_ms),
    mensagens: (l.mensagens as MensagemDaConversa[] | null) ?? [],
    ...(l.reuniao_id ? { reuniaoId: String(l.reuniao_id) } : {}),
  };
}

function paraNota(l: Record<string, unknown>): NotaDoAcervo {
  return {
    id: String(l.id),
    reuniaoId: String(l.reuniao_id),
    reuniaoTitulo: String(l.reuniao_titulo),
    texto: String(l.texto ?? ''),
    atualizadaMs: ms(l.atualizada_ms),
    marcacoes: (l.marcacoes as NotaDoAcervo['marcacoes'] | null) ?? {},
    prints: Number(l.prints ?? 0),
  };
}

// ------------------------------------------------------------- as consultas

/**
 * O SQL de cada tipo, num lugar só.
 *
 * `indice` seleciona contadores calculados no banco
 * (`jsonb_array_length`, `length`) em vez de trazer o conteúdo para contar em
 * JavaScript: é exatamente por isso que `IndicePorTipo` existe. Um
 * `select *` aqui traria megabytes de JSONB para imprimir vinte e cinco
 * títulos.
 */
interface Consultas<T extends TipoDeItem> {
  tabela: string;
  indice: string;
  colunas: string;
  paraDominio: (linha: Record<string, unknown>) => ItemPorTipo[T];
  paraIndice: (linha: Record<string, unknown>) => IndicePorTipo[T];
}

const CONSULTAS: { [T in TipoDeItem]: Consultas<T> } = {
  reuniao: {
    tabela: 'reuniao',
    colunas: 'id, titulo, inicio_ms, duracao_s, participantes, falas',
    indice: `id, titulo, inicio_ms, duracao_s,
             jsonb_array_length(participantes) as participantes,
             jsonb_array_length(falas) as falas`,
    paraDominio: paraReuniao,
    paraIndice: (l) => ({
      id: String(l.id),
      titulo: String(l.titulo),
      inicioMs: ms(l.inicio_ms),
      duracaoSegundos: Number(l.duracao_s ?? 0),
      participantes: Number(l.participantes ?? 0),
      falas: Number(l.falas ?? 0),
    }),
  },
  documento: {
    tabela: 'documento',
    colunas: 'id, titulo, texto, criado_ms, atualizado_ms, tipo_gerado, reuniao_id',
    indice: 'id, titulo, criado_ms, tipo_gerado, length(texto) as caracteres',
    paraDominio: paraDocumento,
    paraIndice: (l) => ({
      id: String(l.id),
      titulo: String(l.titulo),
      criadoMs: ms(l.criado_ms),
      ...(l.tipo_gerado ? { tipoGerado: String(l.tipo_gerado) } : {}),
      caracteres: Number(l.caracteres ?? 0),
    }),
  },
  conversa: {
    tabela: 'conversa',
    colunas: 'id, titulo, criada_ms, atualizada_ms, mensagens, reuniao_id',
    indice: 'id, titulo, criada_ms, jsonb_array_length(mensagens) as mensagens',
    paraDominio: paraConversa,
    paraIndice: (l) => ({
      id: String(l.id),
      titulo: String(l.titulo),
      criadaMs: ms(l.criada_ms),
      mensagens: Number(l.mensagens ?? 0),
    }),
  },
  nota: {
    tabela: 'nota',
    colunas: 'id, reuniao_id, reuniao_titulo, texto, atualizada_ms, marcacoes, prints',
    indice: `id, reuniao_titulo, atualizada_ms, prints,
             length(texto) as caracteres,
             (select coalesce(sum((v)::int), 0) from jsonb_each_text(marcacoes) as e(k, v)) as marcacoes`,
    paraDominio: paraNota,
    paraIndice: (l) => ({
      id: String(l.id),
      reuniaoTitulo: String(l.reuniao_titulo),
      atualizadaMs: ms(l.atualizada_ms),
      caracteres: Number(l.caracteres ?? 0),
      marcacoes: Number(l.marcacoes ?? 0),
      prints: Number(l.prints ?? 0),
    }),
  },
};

/**
 * Os termos viram um `tsquery` de prefixos, ligados por OU.
 *
 * OU e não E: a peneira tem que ser mais LARGA que o ranqueamento, nunca
 * mais estreita. Com E, procurar "deploy sexta" descartaria a reunião em que
 * as duas palavras estão presentes mas em falas diferentes — e o
 * ranqueamento em TypeScript, que soma acertos por pedaço, teria achado.
 *
 * `plainto_tsquery` não serve porque não faz prefixo. Montar o `tsquery` à
 * mão é seguro aqui porque os termos já passaram por `termosDe`, que só
 * deixa sair `[a-z0-9]` — mas ele vai como PARÂMETRO mesmo assim, para que a
 * segurança não dependa de um invariante de outro arquivo.
 */
function tsqueryDe(termos: readonly string[]): string {
  return termos.map((t) => `${t}:*`).join(' | ');
}

export class AcervoPostgres implements Acervo {
  constructor(
    private readonly pessoaId: string,
    private readonly pool: Consultador = banco(),
  ) {}

  async indice<T extends TipoDeItem>(tipo: T): Promise<readonly IndicePorTipo[T][]> {
    const c = CONSULTAS[tipo] as Consultas<T>;
    const { rows } = await this.pool.query(
      `select ${c.indice} from ${c.tabela} where pessoa_id = $1`,
      [this.pessoaId],
    );
    return rows.map(c.paraIndice);
  }

  async obter<T extends TipoDeItem>(tipo: T, id: string): Promise<ItemPorTipo[T] | null> {
    const c = CONSULTAS[tipo] as Consultas<T>;
    const { rows } = await this.pool.query(
      `select ${c.colunas} from ${c.tabela} where pessoa_id = $1 and id = $2`,
      [this.pessoaId, id],
    );
    return rows[0] ? c.paraDominio(rows[0]) : null;
  }

  async procurar<T extends TipoDeItem>(
    tipo: T,
    termos: readonly string[],
  ): Promise<readonly ItemPorTipo[T][]> {
    const c = CONSULTAS[tipo] as Consultas<T>;
    if (termos.length === 0) return [];
    const { rows } = await this.pool.query(
      `select ${c.colunas} from ${c.tabela}
        where pessoa_id = $1 and busca @@ to_tsquery('simple', $2)`,
      [this.pessoaId, tsqueryDe(termos)],
    );
    return rows.map(c.paraDominio);
  }
}

// --------------------------------------------------------------- escrita

/**
 * O texto que alimenta a peneira.
 *
 * Dobrado AQUI, pela mesma função que o ranqueamento usa. É o ponto inteiro
 * da decisão explicada em `esquema.sql`: uma implementação só de "tirar
 * acento", usada nos dois lados, em vez de duas que precisariam concordar
 * para sempre.
 */
export function textoDeBusca(item: ItemPorTipo[TipoDeItem]): string {
  const partes: string[] = [];
  if ('titulo' in item) partes.push(item.titulo);
  if ('falas' in item) {
    for (const f of item.falas) partes.push(f.falante ?? '', f.texto);
  }
  if ('mensagens' in item) {
    for (const m of item.mensagens) partes.push(m.texto);
  }
  if ('texto' in item) partes.push(item.texto);
  if ('reuniaoTitulo' in item) partes.push(item.reuniaoTitulo);
  return dobrar(partes.join(' '));
}
