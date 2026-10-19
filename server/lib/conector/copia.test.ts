import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Consultador } from './banco';
import { apagarCopia, gravarCopia, lerCopias, validarCopia } from './copia';
import { apagarItem, gravarReuniao } from './escrita';
import { gravarHistorico, validarHistorico } from './historico';
import { garantirPessoa } from './pessoa';

const CORRIDA = `c${Date.now()}`;

const reuniaoFiel = (id: string, falas = 2) => ({
  id,
  title: `Reunião ${id}`,
  startedAt: 1_790_000_000_000,
  endedAt: 1_790_000_900_000,
  durationSeconds: 900,
  participants: [{ name: 'Ana', isHost: true, providerParticipantId: 'tile-9' }],
  // Campos que a projeção do conector joga fora, e que a cópia fiel TEM de levar.
  speakersObserved: [{ name: 'Ana', firstSeenAt: 1, lastSeenAt: 2, source: 'caption', confidence: 1, matchedParticipant: true }],
  segments: Array.from({ length: falas }, (_, i) => ({
    speaker: 'Ana',
    text: `fala ${i}`,
    startOffsetMs: i * 1000,
    endOffsetMs: i * 1000 + 900,
    captionId: `cap-${i}`,
  })),
  status: 'ready',
  metadata: { capturedCaptions: true, droppedSegments: 0, lastChunkAt: null },
});

const arvore = {
  revisao: 1,
  titulo: 'Proposta',
  lacunas: [],
  blocos: [{ tipo: 'capa', blockId: 'capa', titulo: 'Proposta' }],
};
const historicoValido = (id: string) => {
  const r = validarHistorico({
    id,
    fontesIds: [],
    versoes: [{ revisao: 1, arvore, criadaEm: 1, origem: 'geracao', problemas: 0 }],
  });
  if (!r.ok) throw new Error(r.motivo);
  return r.item;
};

describe('a cópia fiel no servidor', () => {
  let pglite: PGlite;
  let pool: Consultador;
  let ana: string;
  let bia: string;

  beforeAll(async () => {
    pglite = new PGlite();
    pool = pglite as unknown as Consultador;
    const esquema = readFileSync(join(process.cwd(), 'lib', 'conector', 'esquema.sql'), 'utf8');
    await pglite.exec(esquema);
    // Por cima de si mesmo, com dados já gravados: é o que acontece no deploy.
    await pglite.exec(esquema);
    ana = await garantirPessoa({ googleSub: `${CORRIDA}-a`, email: 'ana@citi.org.br' }, pool);
    bia = await garantirPessoa({ googleSub: `${CORRIDA}-b`, email: 'bia@citi.org.br' }, pool);
  });

  afterAll(async () => {
    await pglite.close();
  });

  it('devolve o registro INTEIRO, sem perder o que a projeção descarta', async () => {
    const corpo = reuniaoFiel('r-fiel');
    await gravarCopia(ana, { id: 'r-fiel', colecao: 'reuniao', corpo }, pool);

    const pagina = await lerCopias(ana, 0, {}, pool);
    const item = pagina.itens.find((i) => i.id === 'r-fiel');
    expect(item).toMatchObject({ colecao: 'reuniao', apagado: false });
    // Nulo aninhado e captionId sobrevivem à ida e volta pelo jsonb.
    expect(item?.corpo).toEqual(corpo);
  });

  it('isolamento: uma conta nunca recebe a cópia da outra', async () => {
    await gravarCopia(ana, { id: 'so-da-ana', colecao: 'documento', corpo: { id: 'so-da-ana' } }, pool);
    await gravarCopia(bia, { id: 'so-da-bia', colecao: 'documento', corpo: { id: 'so-da-bia' } }, pool);

    const deAna = (await lerCopias(ana, 0, {}, pool)).itens.map((i) => i.id);
    const deBia = (await lerCopias(bia, 0, {}, pool)).itens.map((i) => i.id);
    expect(deAna).toContain('so-da-ana');
    expect(deAna).not.toContain('so-da-bia');
    expect(deBia).toContain('so-da-bia');
    expect(deBia).not.toContain('so-da-ana');
  });

  it('o mesmo id em duas contas são dois registros', async () => {
    await gravarCopia(ana, { id: 'mesmo', colecao: 'conversa', corpo: { dono: 'ana' } }, pool);
    await gravarCopia(bia, { id: 'mesmo', colecao: 'conversa', corpo: { dono: 'bia' } }, pool);
    const a = (await lerCopias(ana, 0, {}, pool)).itens.find((i) => i.id === 'mesmo');
    const b = (await lerCopias(bia, 0, {}, pool)).itens.find((i) => i.id === 'mesmo');
    expect(a?.corpo).toEqual({ dono: 'ana' });
    expect(b?.corpo).toEqual({ dono: 'bia' });
  });

  it('apagar deixa uma lápide que chega a quem pergunta depois', async () => {
    await gravarCopia(ana, { id: 'vai-sumir', colecao: 'nota', corpo: { nota: { texto: 'x' } } }, pool);
    const antes = await lerCopias(ana, 0, {}, pool);
    const cursor = antes.proximo;

    await apagarCopia(ana, 'nota', 'vai-sumir', pool);

    const depois = await lerCopias(ana, cursor, {}, pool);
    expect(depois.itens).toEqual([
      expect.objectContaining({ colecao: 'nota', id: 'vai-sumir', apagado: true, corpo: null }),
    ]);
  });

  it('gravar de novo depois de apagar desfaz a lápide', async () => {
    await gravarCopia(ana, { id: 'volta', colecao: 'documento', corpo: { v: 1 } }, pool);
    await apagarCopia(ana, 'documento', 'volta', pool);
    await gravarCopia(ana, { id: 'volta', colecao: 'documento', corpo: { v: 2 } }, pool);
    const item = (await lerCopias(ana, 0, {}, pool)).itens.find((i) => i.id === 'volta');
    expect(item).toMatchObject({ apagado: false, corpo: { v: 2 } });
  });

  it('apagarItem (a rota de sync) apaga a projeção E deixa a lápide da cópia', async () => {
    await gravarReuniao(
      ana,
      { id: 'r-apaga', titulo: 'x', inicioMs: 1, duracaoSegundos: 1, participantes: [], falas: [] },
      pool,
    );
    await gravarCopia(ana, { id: 'r-apaga', colecao: 'reuniao', corpo: reuniaoFiel('r-apaga') }, pool);

    await apagarItem(ana, 'reuniao', 'r-apaga', pool);

    const projecao = await pool.query('select 1 from reuniao where pessoa_id = $1 and id = $2', [ana, 'r-apaga']);
    expect(projecao.rows).toHaveLength(0);
    const item = (await lerCopias(ana, 0, {}, pool)).itens.find((i) => i.id === 'r-apaga');
    expect(item).toMatchObject({ apagado: true, corpo: null });
  });

  it('o histórico de versões sai na mesma leitura, e uma nova revisão aparece de novo', async () => {
    await gravarHistorico(ana, historicoValido('doc-h'), pool);
    const primeira = await lerCopias(ana, 0, {}, pool);
    const h = primeira.itens.find((i) => i.colecao === 'historico' && i.id === 'doc-h');
    expect(h).toBeDefined();
    // Sem `variante`, o campo some — não vira `null`, que a extensão recusaria.
    expect(h?.corpo).toEqual({
      id: 'doc-h',
      fontesIds: [],
      versoes: [expect.objectContaining({ revisao: 1, origem: 'geracao' })],
    });

    // Reescrever o histórico ganha um seq novo: o cursor antigo o enxerga.
    const cursor = primeira.proximo;
    await gravarHistorico(ana, historicoValido('doc-h'), pool);
    const segunda = await lerCopias(ana, cursor, {}, pool);
    expect(segunda.itens.map((i) => i.id)).toEqual(['doc-h']);
  });

  it('o cursor só anda para frente e nada se repete nem se perde', async () => {
    const dona = await garantirPessoa({ googleSub: `${CORRIDA}-cursor`, email: 'c@citi.org.br' }, pool);
    for (let i = 0; i < 7; i++) {
      await gravarCopia(dona, { id: `n${i}`, colecao: 'conversa', corpo: { i } }, pool);
    }
    const vistos: string[] = [];
    let cursor = 0;
    for (let guarda = 0; guarda < 10; guarda++) {
      const p = await lerCopias(dona, cursor, { maxItens: 3 }, pool);
      vistos.push(...p.itens.map((i) => i.id));
      cursor = p.proximo;
      if (p.fim) break;
    }
    expect(vistos).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
    // Sem novidade, a leitura devolve vazio e mantém o cursor.
    const vazia = await lerCopias(dona, cursor, {}, pool);
    expect(vazia).toEqual({ itens: [], proximo: cursor, fim: true });
  });

  it('a página é cortada por bytes, mas um registro enorme ainda sai sozinho', async () => {
    const dona = await garantirPessoa({ googleSub: `${CORRIDA}-bytes`, email: 'b@citi.org.br' }, pool);
    const grande = 'x'.repeat(2_000);
    for (let i = 0; i < 4; i++) {
      await gravarCopia(dona, { id: `g${i}`, colecao: 'documento', corpo: { texto: grande } }, pool);
    }
    // Teto de 5 mil bytes: cabem dois registros de ~2 mil por página.
    const vistos: string[] = [];
    let cursor = 0;
    for (let guarda = 0; guarda < 10; guarda++) {
      const p = await lerCopias(dona, cursor, { maxBytes: 5_000 }, pool);
      expect(p.itens.length).toBeLessThanOrEqual(2);
      vistos.push(...p.itens.map((i) => i.id));
      cursor = p.proximo;
      if (p.fim) break;
    }
    expect(vistos).toEqual(['g0', 'g1', 'g2', 'g3']);

    // Teto menor que UM registro: leva um por vez, em vez de travar.
    const sozinho = await lerCopias(dona, 0, { maxBytes: 10 }, pool);
    expect(sozinho.itens).toHaveLength(1);
    expect(sozinho.fim).toBe(false);
  });

  describe('validarCopia', () => {
    it('aceita um registro bem formado', () => {
      expect(validarCopia({ id: 'a', colecao: 'reuniao', corpo: { x: 1 } })).toMatchObject({ ok: true });
    });
    it.each([
      ['coleção desconhecida', { id: 'a', colecao: 'prints', corpo: {} }],
      ['sem corpo', { id: 'a', colecao: 'reuniao' }],
      ['corpo que não é objeto', { id: 'a', colecao: 'reuniao', corpo: 'texto' }],
      ['corpo que é lista', { id: 'a', colecao: 'reuniao', corpo: [1] }],
      ['id vazio', { id: '', colecao: 'reuniao', corpo: {} }],
    ])('recusa %s', (_nome, bruto) => {
      expect(validarCopia(bruto)).toMatchObject({ ok: false });
    });
    it('recusa um corpo acima do teto', () => {
      const r = validarCopia({ id: 'a', colecao: 'documento', corpo: { t: 'x'.repeat(6 * 1024 * 1024 + 1) } });
      expect(r).toMatchObject({ ok: false });
    });
  });
});
