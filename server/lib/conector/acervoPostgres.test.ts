/**
 * O acervo contra um Postgres DE VERDADE — rodando dentro do processo.
 *
 * ── Por que isto não pode ser testado com mock ────────────────────────────
 *
 * Porque o que pode dar errado aqui é o SQL, e um dublê de driver concorda
 * com qualquer SQL. Coluna gerada que o Postgres recusa por não ser
 * imutável, `jsonb_array_length` sobre coluna nula, `bigint` voltando como
 * string, `tsquery` com sintaxe inválida: nada disso aparece contra um mock.
 * Teste verde sem banco não prova SQL nenhum.
 *
 * ── Por que PGlite, e não um contêiner ────────────────────────────────────
 *
 * PGlite é o PostgreSQL de verdade compilado para WASM: mesmo parser, mesmo
 * planejador, mesma busca textual. Roda dentro do Node, sem daemon, sem
 * porta, sem imagem para baixar. A alternativa era um `docker run` que todo
 * mundo precisa lembrar de dar — e teste que depende de alguém lembrar é
 * teste que não roda. Este roda no `npm test` de sempre.
 *
 * O que ele NÃO cobre é o que difere entre um Postgres embutido e o
 * gerenciado do Railway: TLS, permissões, e o `bigint` que o driver `pg`
 * devolve como string (o PGlite devolve como number). O último está tratado
 * em `ms()`, e é justamente o tipo de divergência que valeu documentar.
 *
 * ── O teste que mais importa ──────────────────────────────────────────────
 *
 * `isolamento entre pessoas`. Um `where pessoa_id` esquecido não lança, não
 * quebra nada visível e entrega a reunião de alguém para o conector de
 * outro. É a única falha aqui que é um incidente, e não um bug.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AcervoPostgres } from './acervoPostgres';
import { acervoDeMemoria } from './acervoDeMemoria';
import type { Consultador } from './banco';
import { apagarItem, gravarConversa, gravarDocumento, gravarNota, gravarReuniao } from './escrita';
import { garantirPessoa } from './pessoa';
import { ferramentaBuscar, ferramentaListar } from './ferramentas';
import type { ConversaDoAcervo, DocumentoDoAcervo, NotaDoAcervo, ReuniaoDoAcervo } from './tipos';

const BASE = Date.UTC(2026, 8, 1);
const CORRIDA = `t${Date.now()}`;

const reuniaoExemplo: ReuniaoDoAcervo = {
  id: 'r1',
  titulo: 'Reunião de integração',
  inicioMs: BASE,
  duracaoSegundos: 3600,
  participantes: ['Ana Souza', 'Beatriz Lima'],
  falas: [
    { falante: 'Ana Souza', texto: 'Precisamos fechar o orçamento.', offsetMs: 0 },
    { falante: 'Beatriz Lima', texto: 'Eu assumo o deploy na sexta.', offsetMs: 5000 },
    { falante: null, texto: 'Alguém sem atribuição falando.', offsetMs: 9000 },
  ],
};

const documentoExemplo: DocumentoDoAcervo = {
  id: 'd1',
  titulo: 'Ata da integração',
  texto: 'A decisão foi manter o cronograma.',
  criadoMs: BASE + 1000,
  atualizadoMs: BASE + 2000,
  tipoGerado: 'ata',
  reuniaoId: 'r1',
};

const conversaExemplo: ConversaDoAcervo = {
  id: 'c1',
  titulo: 'Dúvida sobre orçamento',
  criadaMs: BASE + 3000,
  atualizadaMs: BASE + 4000,
  mensagens: [
    { autor: 'pessoa', texto: 'Quanto ficou o orçamento?', emMs: BASE },
    { autor: 'assistente', texto: 'Ficou dentro do previsto.', emMs: BASE + 1 },
  ],
  reuniaoId: 'r1',
};

const notaExemplo: NotaDoAcervo = {
  id: 'r1',
  reuniaoId: 'r1',
  reuniaoTitulo: 'Reunião de integração',
  texto: 'Cobrar o deploy na segunda.',
  atualizadaMs: BASE + 5000,
  marcacoes: { decisao: 2, acao: 3 },
  prints: 4,
};

describe('AcervoPostgres', () => {
  let pglite: PGlite;
  let pool: Consultador;
  let pessoaA: string;
  let pessoaB: string;

  beforeAll(async () => {
    pglite = new PGlite();
    pool = pglite as unknown as Consultador;

    const esquema = readFileSync(join(process.cwd(), 'lib', 'conector', 'esquema.sql'), 'utf8');
    await pglite.exec(esquema);
    // Idempotência não é detalhe: o esquema é reaplicado a cada deploy.
    await pglite.exec(esquema);

    pessoaA = await garantirPessoa(
      { googleSub: `${CORRIDA}-a`, email: 'ana@citi.org.br', nome: 'Ana' },
      pool,
    );
    pessoaB = await garantirPessoa({ googleSub: `${CORRIDA}-b`, email: 'bia@citi.org.br' }, pool);

    await gravarReuniao(pessoaA, reuniaoExemplo, pool);
    await gravarDocumento(pessoaA, documentoExemplo, pool);
    await gravarConversa(pessoaA, conversaExemplo, pool);
    await gravarNota(pessoaA, notaExemplo, pool);
  });

  afterAll(async () => {
    await pglite.close();
  });

  it('garantirPessoa é idempotente e atualiza o e-mail', async () => {
    const denovo = await garantirPessoa(
      { googleSub: `${CORRIDA}-a`, email: 'ana.souza@citi.org.br' },
      pool,
    );
    expect(denovo).toBe(pessoaA);
    const { rows } = await pool.query('select email, nome from pessoa where id = $1', [pessoaA]);
    expect(rows[0].email).toBe('ana.souza@citi.org.br');
    // Nome ausente na segunda chamada não pode apagar o que já havia.
    expect(rows[0].nome).toBe('Ana');
  });

  it('a reunião volta igual à que entrou', async () => {
    const acervo = new AcervoPostgres(pessoaA, pool);
    expect(await acervo.obter('reuniao', 'r1')).toEqual(reuniaoExemplo);
  });

  it('documento, conversa e nota voltam iguais', async () => {
    const acervo = new AcervoPostgres(pessoaA, pool);
    expect(await acervo.obter('documento', 'd1')).toEqual(documentoExemplo);
    expect(await acervo.obter('conversa', 'c1')).toEqual(conversaExemplo);
    expect(await acervo.obter('nota', 'r1')).toEqual(notaExemplo);
  });

  it('id inexistente devolve null, não erro', async () => {
    const acervo = new AcervoPostgres(pessoaA, pool);
    expect(await acervo.obter('reuniao', 'naoexiste')).toBeNull();
  });

  it('o índice traz contadores calculados no banco, sem o conteúdo', async () => {
    const acervo = new AcervoPostgres(pessoaA, pool);

    const [r] = await acervo.indice('reuniao');
    expect(r).toEqual({
      id: 'r1',
      titulo: 'Reunião de integração',
      inicioMs: BASE,
      duracaoSegundos: 3600,
      participantes: 2,
      falas: 3,
    });
    // O conteúdo não pode ter vindo junto.
    expect(JSON.stringify(r)).not.toContain('deploy');

    const [d] = await acervo.indice('documento');
    expect(d?.caracteres).toBe(documentoExemplo.texto.length);

    const [c] = await acervo.indice('conversa');
    expect(c?.mensagens).toBe(2);

    const [n] = await acervo.indice('nota');
    // 2 decisões + 3 ações, somadas em SQL.
    expect(n?.marcacoes).toBe(5);
    expect(n?.prints).toBe(4);
  });

  it('procurar acha ignorando acento — os dois lados dobram igual', async () => {
    const acervo = new AcervoPostgres(pessoaA, pool);
    // Gravado como "orçamento"; procurado sem cedilha.
    expect(await acervo.procurar('reuniao', ['orcamento'])).toHaveLength(1);
    expect(await acervo.procurar('reuniao', ['deploy'])).toHaveLength(1);
    expect(await acervo.procurar('reuniao', ['zzznada'])).toHaveLength(0);
  });

  it('procurar é prefixo de palavra, não pedaço de palavra', async () => {
    const acervo = new AcervoPostgres(pessoaA, pool);
    // "amento" está dentro de "orçamento", mas não começa palavra nenhuma.
    expect(await acervo.procurar('reuniao', ['amento'])).toHaveLength(0);
    expect(await acervo.procurar('reuniao', ['orcam'])).toHaveLength(1);
  });

  it('a peneira do banco é mais LARGA que o ranqueamento, nunca mais estreita', async () => {
    // Dois termos em falas diferentes: com `&` no tsquery isto sumiria, e o
    // ranqueamento em TypeScript teria achado. Por isso a peneira usa `|`.
    const acervo = new AcervoPostgres(pessoaA, pool);
    expect(await acervo.procurar('reuniao', ['orcamento', 'deploy'])).toHaveLength(1);
  });

  it('o resultado é idêntico ao do acervo de memória', async () => {
    // O teste que amarra as duas implementações: mesma entrada, mesma saída.
    // Se divergirem, a disciplina de contexto verificada em memória deixa de
    // valer em produção.
    const emMemoria = acervoDeMemoria({
      reuniao: [reuniaoExemplo],
      documento: [documentoExemplo],
      conversa: [conversaExemplo],
      nota: [notaExemplo],
    });
    const noBanco = new AcervoPostgres(pessoaA, pool);

    for (const consulta of ['deploy', 'orcamento', 'cronograma', 'ana']) {
      const a = await ferramentaBuscar(emMemoria, { consulta });
      const b = await ferramentaBuscar(noBanco, { consulta });
      expect(b.itens, consulta).toEqual(a.itens);
    }

    for (const tipo of ['reuniao', 'documento', 'conversa', 'nota']) {
      const a = await ferramentaListar(emMemoria, { tipo });
      const b = await ferramentaListar(noBanco, { tipo });
      expect(b.itens, tipo).toEqual(a.itens);
    }
  });

  it('isolamento entre pessoas', async () => {
    // A falha que este teste existe para pegar não lança exceção nenhuma:
    // é um `where pessoa_id` esquecido, e ele só aparece como o acervo de
    // alguém no conector de outro.
    const deB = new AcervoPostgres(pessoaB, pool);

    expect(await deB.indice('reuniao')).toEqual([]);
    expect(await deB.indice('documento')).toEqual([]);
    expect(await deB.indice('conversa')).toEqual([]);
    expect(await deB.indice('nota')).toEqual([]);
    expect(await deB.obter('reuniao', 'r1')).toBeNull();
    expect(await deB.procurar('reuniao', ['deploy'])).toEqual([]);

    // E o mesmo id na outra pessoa é outro item, não o mesmo.
    await gravarReuniao(pessoaB, { ...reuniaoExemplo, titulo: 'Outra reunião' }, pool);
    expect((await deB.obter('reuniao', 'r1'))?.titulo).toBe('Outra reunião');
    expect((await new AcervoPostgres(pessoaA, pool).obter('reuniao', 'r1'))?.titulo).toBe(
      'Reunião de integração',
    );
  });

  it('gravar de novo atualiza em vez de duplicar', async () => {
    const acervo = new AcervoPostgres(pessoaA, pool);
    await gravarReuniao(pessoaA, { ...reuniaoExemplo, titulo: 'Título novo' }, pool);
    await gravarReuniao(pessoaA, { ...reuniaoExemplo, titulo: 'Título novo' }, pool);

    const linhas = await acervo.indice('reuniao');
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.titulo).toBe('Título novo');

    // Volta como estava, para não contaminar os outros testes.
    await gravarReuniao(pessoaA, reuniaoExemplo, pool);
  });

  it('o texto de busca acompanha a atualização', async () => {
    const acervo = new AcervoPostgres(pessoaA, pool);
    await gravarDocumento(pessoaA, { ...documentoExemplo, texto: 'Assunto totalmente novo' }, pool);
    expect(await acervo.procurar('documento', ['cronograma'])).toHaveLength(0);
    expect(await acervo.procurar('documento', ['totalmente'])).toHaveLength(1);
    await gravarDocumento(pessoaA, documentoExemplo, pool);
  });

  it('apagar tira do acervo', async () => {
    const acervo = new AcervoPostgres(pessoaA, pool);
    await gravarDocumento(pessoaA, { ...documentoExemplo, id: 'efemero' }, pool);
    expect(await acervo.obter('documento', 'efemero')).not.toBeNull();
    await apagarItem(pessoaA, 'documento', 'efemero', pool);
    expect(await acervo.obter('documento', 'efemero')).toBeNull();
  });

  it('apagar a pessoa leva o acervo junto', async () => {
    const sub = `${CORRIDA}-descartavel`;
    const id = await garantirPessoa({ googleSub: sub, email: 'x@citi.org.br' }, pool);
    await gravarReuniao(id, reuniaoExemplo, pool);
    await pool.query('delete from pessoa where id = $1', [id]);
    const { rows } = await pool.query('select count(*)::int as n from reuniao where pessoa_id = $1', [
      id,
    ]);
    expect(rows[0].n).toBe(0);
  });
});
