// @vitest-environment node
/**
 * TESTE AO VIVO — a sincronização de ponta a ponta: o código REAL da extensão
 * (`sincronizar`, `restaurar`) falando por HTTP com o servidor REAL (`next
 * start`) sobre um Postgres REAL. Duas "máquinas" são dois storages que não se
 * tocam; as contas são `sub`s diferentes. O estado do banco é conferido por
 * `psql`, e não pelo que o servidor diz de si mesmo.
 *
 * Pulado por padrão. O que NÃO é real é o Google: um preload do Node (fora do
 * repo) responde ao `tokeninfo` para tokens de teste. A verificação de verdade
 * (aud, e-mail verificado, exp) continua rodando no servidor.
 *
 *   docker run -d --name taqciti-e2e-pg -e POSTGRES_PASSWORD=taqciti \
 *     -e POSTGRES_DB=taqciti -p 55432:5432 postgres:17-alpine
 *   (aplicar server/lib/conector/esquema.sql)
 *   (subir `next start -p 3101` com DATABASE_URL local, GOOGLE_OAUTH_WEB_CLIENT_ID
 *    = e2e-client.apps.googleusercontent.com e o preload do tokeninfo)
 *
 *   $env:TAQCITI_E2E_SERVER = 'http://localhost:3101'
 *   $env:VITE_DOCCITI_SERVER_URL = 'http://localhost:3101'
 *   $env:VITE_GOOGLE_OAUTH_WEB_CLIENT_ID = 'e2e-client.apps.googleusercontent.com'
 *   $env:TAQCITI_E2E_PG = 'taqciti-e2e-pg'      # nome do contêiner, para o psql
 *   npx vitest run src/features/sync/sync.e2e.live.test.ts
 *
 * NUNCA aponte isto para a produção: o teste escreve e apaga acervo.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { SERVER_BASE_URL } from '@/shared/config/serverConfig';
import { limparCacheDeIdentidadeLocal } from '@/shared/services/identidade';
import { esquecerSincronizado, sincronizar } from './sincronizacao';

const SERVIDOR = process.env.TAQCITI_E2E_SERVER;
const CONTEINER = process.env.TAQCITI_E2E_PG ?? 'taqciti-e2e-pg';
const CLIENT_ID = 'e2e-client.apps.googleusercontent.com';
/**
 * Os cenários de cota rodam contra um SEGUNDO servidor, com a cota por pessoa
 * pequena (`TAQCITI_COTA_MB=0.3`): o cliente fala com um servidor só por
 * execução, então eles têm a sua própria (`TAQCITI_E2E_COTA=1`).
 */
const MODO_COTA = process.env.TAQCITI_E2E_COTA === '1';
const rodar = SERVIDOR && !MODO_COTA ? describe : describe.skip;
const rodarCota = SERVIDOR && MODO_COTA ? describe : describe.skip;

// ------------------------------------------------------------- o banco

/** SQL direto no Postgres do teste: a fonte da verdade, independente da API. */
function sql(consulta: string): string[] {
  return execFileSync(
    'docker',
    ['exec', CONTEINER, 'psql', '-U', 'postgres', '-d', 'taqciti', '-At', '-c', consulta],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);
}

const contagem = (tabela: string, sub: string, filtro = ''): number =>
  Number(
    sql(
      `select count(*) from ${tabela} t join pessoa p on p.id = t.pessoa_id where p.google_sub = '${sub}' ${filtro}`,
    )[0],
  );

// ----------------------------------------------------------- as máquinas

const REDIRECT_URI = 'https://jalebpaefejnbacgncgkailhemkdpnhm.chromiumapp.org/';

function jwt(payload: Record<string, unknown>): string {
  const parte = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${parte({ alg: 'none' })}.${parte(payload)}.assinatura-fake`;
}

type Armazenamento = Record<string, unknown>;

class Maquina {
  estado: Armazenamento = { [STORAGE_KEYS.sync]: { ligada: true } };
  /** `aud` e validade do token que ESTA máquina apresenta (para os casos de recusa). */
  aud = CLIENT_ID;
  expiraEmSegundos = 3600;
  constructor(public sub: string) {}

  usar(): void {
    limparCacheDeIdentidadeLocal();
    installChromeStorageMock({
      local: structuredClone(this.estado),
      extra: {
        runtime: { lastError: undefined },
        identity: {
          getRedirectURL: () => REDIRECT_URI,
          launchWebAuthFlow: (d: { url: string }, cb: (url?: string) => void) => {
            const nonce = new URL(d.url).searchParams.get('nonce');
            cb(
              `${REDIRECT_URI}#id_token=${jwt({
                aud: this.aud,
                sub: this.sub,
                email: `${this.sub}@citi.org.br`,
                email_verified: true,
                nonce,
                exp: Math.floor(Date.now() / 1000) + this.expiraEmSegundos,
              })}`,
            );
          },
        },
      },
    });
  }

  async guardar(): Promise<void> {
    this.estado = structuredClone(await chrome.storage.local.get(null));
  }

  async em<T>(fn: () => Promise<T>): Promise<T> {
    this.usar();
    try {
      return await fn();
    } finally {
      await this.guardar();
    }
  }

  semear(valores: Armazenamento): this {
    this.estado = { ...this.estado, ...valores };
    return this;
  }

  lido(chave: string): unknown {
    return this.estado[chave];
  }
}

/** Uma conta nova por teste: o banco é compartilhado, o estado não. */
const CORRIDA = Date.now().toString(36);
let n = 0;
const conta = (nome: string) => `e2e-${CORRIDA}-${nome}-${++n}`;

// --------------------------------------------------------------- fixtures

const reuniao = (id = 'r1', falas = 2, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Reunião ${id}`,
  startedAt: 1_790_000_000_000,
  endedAt: 1_790_003_600_000,
  durationSeconds: 3600,
  participants: [{ name: 'Ana Souza', isHost: true }],
  segments: Array.from({ length: falas }, (_, i) => ({
    speaker: i % 2 ? 'Beto' : 'Ana Souza',
    text: `Fala número ${i}: precisamos fechar o deploy e avisar o cliente com antecedência.`,
    startOffsetMs: i * 1000,
    endOffsetMs: i * 1000 + 900,
    captionId: `cap-${i}`,
  })),
  status: 'ready',
  metadata: { capturedCaptions: true, droppedSegments: 0, wasDiscardedAndRestarted: false, lastChunkAt: null },
  ...extra,
});

const documento = (id = 'd1', extra: Record<string, unknown> = {}) => ({
  id,
  title: `Ata ${id}`,
  content: '# Ata\n\nDecidimos fechar o deploy.',
  formato: 'markdown',
  html: '<h1>Ata</h1><p>Decidimos fechar o deploy.</p>',
  createdAt: 1_790_000_100_000,
  updatedAt: 1_790_000_200_000,
  meetingId: 'r1',
  tipo: 'ata',
  origem: 'gerado',
  ...extra,
});

const conversa = (id = 'c1', extra: Record<string, unknown> = {}) => ({
  id,
  title: `Conversa ${id}`,
  createdAt: 1_790_000_300_000,
  updatedAt: 1_790_000_400_000,
  messages: [
    { id: `${id}-m1`, role: 'user', text: 'Como foi o deploy?', at: 1_790_000_300_000 },
    { id: `${id}-m2`, role: 'assistant', text: 'Foi fechado.', at: 1_790_000_400_000 },
  ],
  ...extra,
});

// Como o servidor devolve uma árvore: com os valores padrão do schema já preenchidos
// (ontes, origem, ariante). Uma árvore sem eles é normalizada na ida, e a
// extensão a reaplicaria uma vez — correto, mas não é o caso de uso real.
const BLOCO_DA_CAPA = { tipo: 'capa', blockId: 'capa', titulo: 'Proposta', fontes: [], origem: 'agente', variante: 'padrao' };

const historico = (documentoId = 'd1') => ({
  documentoId,
  variante: 'editorial',
  fontesIds: ['r1'],
  versoes: [
    { revisao: 1, arvore: { revisao: 1, titulo: 'Proposta', lacunas: [], blocos: [BLOCO_DA_CAPA] }, criadaEm: 1, origem: 'geracao', problemas: 0 },
    { revisao: 2, arvore: { revisao: 2, titulo: 'Proposta', lacunas: [], blocos: [BLOCO_DA_CAPA] }, criadaEm: 2, origem: 'edicao', pedido: 'mais curto', problemas: 0 },
  ],
});

const nota = { meetingId: 'r1', texto: 'Lembrar de avisar o cliente.', updatedAt: 1_790_000_500_000 };
const marcas = { 'cap-0': 'decisao', 'cap-1': 'acao' };

const acervoCompleto = (): Armazenamento => ({
  [STORAGE_KEYS.history]: [reuniao()],
  [STORAGE_KEYS.documents]: [documento()],
  [STORAGE_KEYS.conversations]: [conversa()],
  [STORAGE_KEYS.documentVersions]: [historico()],
  [STORAGE_KEYS.notes]: { r1: nota },
  [STORAGE_KEYS.marks]: { r1: marcas },
});

const FORCAR = { forcarRestauracao: true } as const;

/** Um JPEG "de verdade" para o servidor: começa com os bytes de um JPEG, com miolo aleatório. */
const jpegBytes = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(n)]);
const printReal = (id: string, n: number, extra: Record<string, unknown> = {}) => ({
  id,
  meetingId: 'r1',
  dataUrl: `data:image/jpeg;base64,${jpegBytes(n).toString('base64')}`,
  at: 1_790_000_000_000,
  largura: 1440,
  altura: 900,
  ...extra,
});

beforeAll(() => {
  if (!SERVIDOR) return;
  // A trava que impede isto de escrever no servidor errado.
  if (SERVER_BASE_URL !== SERVIDOR) {
    throw new Error(
      `SERVER_BASE_URL (${SERVER_BASE_URL}) difere de TAQCITI_E2E_SERVER (${SERVIDOR}). ` +
        'Defina VITE_DOCCITI_SERVER_URL com o mesmo valor.',
    );
  }
  if (/vercel\.app|supabase/i.test(SERVER_BASE_URL)) throw new Error('Isto não roda contra produção.');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ------------------------------------------------------------------ cenários

rodar('sincronização de ponta a ponta (servidor e Postgres reais)', () => {
  it('máquina nova da mesma conta traz TUDO, e o banco guarda a cópia fiel', async () => {
    const sub = conta('ana');
    const antiga = new Maquina(sub).semear(acervoCompleto());
    const nova = new Maquina(sub);

    expect(await antiga.em(() => sincronizar())).toEqual({ estado: 'ok', enviados: 5, apagados: 0 });

    // O banco, direto: 4 cópias vivas + 1 histórico + as 4 projeções do conector.
    expect(contagem('copia_local', sub, 'and not t.apagado')).toBe(4);
    expect(contagem('historico_do_documento', sub)).toBe(1);
    expect(contagem('reuniao', sub)).toBe(1);
    expect(contagem('documento', sub)).toBe(1);
    expect(contagem('conversa', sub)).toBe(1);
    expect(contagem('nota', sub)).toBe(1);
    // E o que a projeção descarta está na cópia.
    expect(
      sql(
        `select t.corpo->>'html' from copia_local t join pessoa p on p.id=t.pessoa_id where p.google_sub='${sub}' and t.colecao='documento'`,
      )[0],
    ).toBe('<h1>Ata</h1><p>Decidimos fechar o deploy.</p>');

    expect(await nova.em(() => sincronizar())).toEqual({ estado: 'ok', enviados: 0, apagados: 0, restaurados: 5 });
    expect(nova.lido(STORAGE_KEYS.history)).toEqual([reuniao()]);
    expect(nova.lido(STORAGE_KEYS.documents)).toEqual([documento()]);
    expect(nova.lido(STORAGE_KEYS.conversations)).toEqual([conversa()]);
    expect(nova.lido(STORAGE_KEYS.documentVersions)).toEqual([historico()]);
    expect(nova.lido(STORAGE_KEYS.notes)).toEqual({ r1: nota });
    expect(nova.lido(STORAGE_KEYS.marks)).toEqual({ r1: marcas });
  });

  it('não há eco: nem a máquina que enviou nem a que recebeu reescrevem o servidor', async () => {
    const sub = conta('ana');
    const antiga = new Maquina(sub).semear(acervoCompleto());
    const nova = new Maquina(sub);
    await antiga.em(() => sincronizar());
    await nova.em(() => sincronizar());

    const seqAntes = sql(`select max(seq) from copia_local t join pessoa p on p.id=t.pessoa_id where p.google_sub='${sub}'`)[0];
    expect(await nova.em(() => sincronizar(FORCAR))).toEqual({ estado: 'nada-a-fazer' });
    expect(await antiga.em(() => sincronizar(FORCAR))).toEqual({ estado: 'nada-a-fazer' });
    expect(sql(`select max(seq) from copia_local t join pessoa p on p.id=t.pessoa_id where p.google_sub='${sub}'`)[0]).toBe(seqAntes);
  });

  it('isolamento: outra conta não recebe nada, e o banco não mistura', async () => {
    const ana = conta('ana');
    const bia = conta('bia');
    await new Maquina(ana).semear(acervoCompleto()).em(() => sincronizar());

    const deBia = new Maquina(bia);
    expect(await deBia.em(() => sincronizar())).toEqual({ estado: 'nada-a-fazer' });
    expect(deBia.lido(STORAGE_KEYS.history)).toBeUndefined();
    expect(contagem('copia_local', bia)).toBe(0);
    expect(contagem('reuniao', bia)).toBe(0);

    // Mesmo id nas duas contas: dois registros, cada um no seu dono.
    await deBia.semear({ [STORAGE_KEYS.documents]: [documento('d1', { title: 'Da Bia' })] }).em(() => sincronizar());
    const novaAna = new Maquina(ana);
    await novaAna.em(() => sincronizar());
    expect((novaAna.lido(STORAGE_KEYS.documents) as { title: string }[])[0]!.title).toBe('Ata d1');
    const novaBia = new Maquina(bia);
    await novaBia.em(() => sincronizar());
    expect((novaBia.lido(STORAGE_KEYS.documents) as { title: string }[])[0]!.title).toBe('Da Bia');
  });

  it('apagar numa máquina apaga na outra: lápide no banco, projeção removida', async () => {
    const sub = conta('ana');
    const a = new Maquina(sub).semear(acervoCompleto());
    const b = new Maquina(sub);
    await a.em(() => sincronizar());
    await b.em(() => sincronizar());

    await a.em(async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.history]: [] });
      await sincronizar();
    });
    expect(contagem('reuniao', sub)).toBe(0);
    expect(contagem('copia_local', sub, "and t.colecao='reuniao' and t.apagado and t.corpo is null")).toBe(1);

    expect(await b.em(() => sincronizar(FORCAR))).toMatchObject({ estado: 'ok', restaurados: 1 });
    expect(b.lido(STORAGE_KEYS.history)).toEqual([]);
    expect(b.lido(STORAGE_KEYS.documents)).toEqual([documento()]);
  });

  it('a exclusão vale nos dois sentidos, e uma máquina NOVA não ressuscita o apagado', async () => {
    const sub = conta('ana');
    const a = new Maquina(sub).semear(acervoCompleto());
    const b = new Maquina(sub);
    await a.em(() => sincronizar());
    await b.em(() => sincronizar());

    await b.em(async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.documents]: [], [STORAGE_KEYS.documentVersions]: [] });
      await sincronizar();
    });
    await a.em(() => sincronizar(FORCAR));
    expect(a.lido(STORAGE_KEYS.documents)).toEqual([]);
    expect(a.lido(STORAGE_KEYS.documentVersions)).toEqual([]);

    const c = new Maquina(sub);
    await c.em(() => sincronizar());
    expect(c.lido(STORAGE_KEYS.documents)).toBeUndefined();
    expect(c.lido(STORAGE_KEYS.history)).toEqual([reuniao()]);
  });

  it('uma edição só da cópia fiel (html) e uma marcação nova atravessam as máquinas', async () => {
    const sub = conta('ana');
    const a = new Maquina(sub).semear(acervoCompleto());
    const b = new Maquina(sub);
    await a.em(() => sincronizar());
    await b.em(() => sincronizar());

    await a.em(async () => {
      await chrome.storage.local.set({
        [STORAGE_KEYS.documents]: [documento('d1', { html: '<p>só o html mudou</p>' })],
        [STORAGE_KEYS.marks]: { r1: { ...marcas, 'cap-0': 'duvida' } },
      });
      await sincronizar();
    });
    await b.em(() => sincronizar(FORCAR));
    expect((b.lido(STORAGE_KEYS.documents) as { html: string }[])[0]!.html).toBe('<p>só o html mudou</p>');
    expect(b.lido(STORAGE_KEYS.marks)).toEqual({ r1: { ...marcas, 'cap-0': 'duvida' } });
  });

  it('trabalho que ainda não subiu não é atropelado: vale a última, e a outra versão não se perde', async () => {
    const sub = conta('ana');
    const a = new Maquina(sub).semear(acervoCompleto());
    const b = new Maquina(sub);
    await a.em(() => sincronizar());
    await b.em(() => sincronizar());
    const conteudo = (m: Maquina, id: string) =>
      (m.lido(STORAGE_KEYS.documents) as { id: string; content: string }[]).find((d) => d.id === id)?.content;

    await a.em(async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.documents]: [documento('d1', { content: 'Versão da A' })] });
      await sincronizar();
    });
    await b.em(async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.documents]: [documento('d1', { content: 'Versão da B' })] });
      await sincronizar(FORCAR);
    });
    expect(conteudo(b, 'd1')).toBe('Versão da B');
    expect(
      sql(`select t.corpo->>'content' from copia_local t join pessoa p on p.id=t.pessoa_id where p.google_sub='${sub}' and t.colecao='documento' and t.id='d1'`)[0],
    ).toBe('Versão da B');
    await a.em(() => sincronizar(FORCAR));
    expect(conteudo(a, 'd1')).toBe('Versão da B');
  });
  it('trocar a conta Google na mesma máquina não entrega o acervo local à conta nova', async () => {
    const ana = conta('ana');
    const bia = conta('bia');
    await new Maquina(bia).semear({ [STORAGE_KEYS.documents]: [documento('d-bia', { title: 'Da Bia' })] }).em(() => sincronizar());

    const maquina = new Maquina(ana).semear(acervoCompleto());
    await maquina.em(() => sincronizar());
    maquina.sub = bia;
    expect(await maquina.em(() => sincronizar())).toMatchObject({ estado: 'ok', restaurados: 1 });

    // No banco da Bia há SÓ o que é dela.
    expect(contagem('reuniao', bia)).toBe(0);
    expect(contagem('copia_local', bia, "and t.colecao <> 'documento'")).toBe(0);
    expect(contagem('copia_local', bia)).toBe(1);
    expect((maquina.lido(STORAGE_KEYS.documents) as { title: string }[]).map((d) => d.title)).toContain('Da Bia');
  });

  it('muita coisa: lotes e páginas de verdade (55 conversas, várias páginas)', async () => {
    const sub = conta('ana');
    const ids = Array.from({ length: 55 }, (_, i) => `c${String(i).padStart(2, '0')}`);
    const a = new Maquina(sub).semear({
      [STORAGE_KEYS.conversations]: ids.map((id, i) => conversa(id, { updatedAt: 1_790_000_000_000 + i })).reverse(),
    });
    const b = new Maquina(sub);

    const rede = vi.spyOn(globalThis, 'fetch');
    expect(await a.em(() => sincronizar())).toMatchObject({ estado: 'ok', enviados: 55 });
    // 110 itens no fio: dois lotes (o teto do servidor é 100).
    expect(rede.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === 'POST')).toHaveLength(2);
    expect(contagem('copia_local', sub, "and t.colecao='conversa'")).toBe(55);

    rede.mockClear();
    expect(await b.em(() => sincronizar())).toMatchObject({ estado: 'ok', restaurados: 55 });
    expect(rede.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === 'GET').length).toBeGreaterThanOrEqual(3);
    const lista = b.lido(STORAGE_KEYS.conversations) as { id: string }[];
    expect(lista).toHaveLength(55);
    expect(new Set(lista.map((c) => c.id))).toEqual(new Set(ids));
  }, 90_000);

  it('registros grandes: reunião de 3 mil falas e três documentos de 1,8 MB atravessam inteiros', async () => {
    const sub = conta('ana');
    const grande = (c: string) => c.repeat(1_800_000);
    const a = new Maquina(sub).semear({
      [STORAGE_KEYS.history]: [reuniao('rgrande', 3000)],
      [STORAGE_KEYS.documents]: ['x', 'y', 'z'].map((c, i) => documento(`dg${i}`, { content: grande(c), html: undefined })),
    });
    const b = new Maquina(sub);

    const rede = vi.spyOn(globalThis, 'fetch');
    expect(await a.em(() => sincronizar())).toMatchObject({ estado: 'ok', enviados: 4 });
    // Documento de 1,8 MB + a cópia dele passam do teto de 4 MiB por lote com outro: vão separados.
    expect(rede.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === 'POST').length).toBeGreaterThanOrEqual(3);

    rede.mockClear();
    expect(await b.em(() => sincronizar())).toMatchObject({ estado: 'ok', restaurados: 4 });
    // A página é cortada por bytes (3 MB): três documentos de 1,8 MB não cabem numa só.
    expect(rede.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === 'GET').length).toBeGreaterThanOrEqual(3);
    const docs = b.lido(STORAGE_KEYS.documents) as { id: string; content: string }[];
    expect(docs.map((d) => d.id).sort()).toEqual(['dg0', 'dg1', 'dg2']);
    expect(docs.every((d) => d.content.length === 1_800_000)).toBe(true);
    const [r] = b.lido(STORAGE_KEYS.history) as { segments: unknown[] }[];
    expect(r!.segments).toHaveLength(3000);
  }, 120_000);

  it('reenviar tudo é idempotente: o banco não duplica', async () => {
    const sub = conta('ana');
    const a = new Maquina(sub).semear(acervoCompleto());
    await a.em(() => sincronizar());
    const antes = contagem('copia_local', sub) + contagem('reuniao', sub) + contagem('historico_do_documento', sub);

    await a.em(async () => {
      await esquecerSincronizado();
      return sincronizar();
    });
    expect(contagem('copia_local', sub) + contagem('reuniao', sub) + contagem('historico_do_documento', sub)).toBe(antes);
  });

  it('o servidor recusa o que deve: token de outro app e token vencido não passam', async () => {
    const sub = conta('ana');
    const outroApp = new Maquina(sub).semear(acervoCompleto());
    outroApp.aud = 'outro-app.apps.googleusercontent.com';
    expect(await outroApp.em(() => sincronizar())).toMatchObject({ estado: 'falhou', motivo: 'credencial recusada' });

    const vencido = new Maquina(sub).semear(acervoCompleto());
    vencido.expiraEmSegundos = -60;
    expect(await vencido.em(() => sincronizar())).toMatchObject({ estado: 'falhou', motivo: 'credencial recusada' });

    // Nada entrou, nem criou a pessoa.
    expect(sql(`select count(*) from pessoa where google_sub='${sub}'`)[0]).toBe('0');
  });

  it('prints: a imagem sobe como binário, volta byte a byte, e apagar libera o espaço', async () => {
    const sub = conta('ana');
    const [p1, p2, p3] = [printReal('p1', 120_000, { at: 3000 }), printReal('p2', 60_000, { at: 2000 }), printReal('p3', 30_000, { at: 1000 })];
    const a = new Maquina(sub).semear({ ...acervoCompleto(), [STORAGE_KEYS.shots]: [p1, p2, p3] });
    const b = new Maquina(sub);

    expect(await a.em(() => sincronizar())).toMatchObject({ estado: 'ok', enviados: 8 });
    // No banco é imagem de verdade (bytea), do tamanho da imagem — não base64.
    const tamanhos = sql(`select octet_length(t.bytes) from print_local t join pessoa p on p.id=t.pessoa_id where p.google_sub='${sub}' order by t.em_ms desc`);
    expect(tamanhos).toEqual(['120004', '60004', '30004']);

    expect(await b.em(() => sincronizar())).toMatchObject({ estado: 'ok', restaurados: 8 });
    expect(b.lido(STORAGE_KEYS.shots)).toEqual([p1, p2, p3]);

    // Apagar numa máquina: a imagem sai do banco (é o que ocupa), a lápide fica, e a outra apaga.
    await a.em(async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.shots]: [p2, p3] });
      await sincronizar();
    });
    expect(sql(`select count(*) filter (where t.apagado and t.bytes is null and t.tamanho = 0) from print_local t join pessoa p on p.id=t.pessoa_id where p.google_sub='${sub}'`)[0]).toBe('1');
    await b.em(() => sincronizar(FORCAR));
    expect((b.lido(STORAGE_KEYS.shots) as { id: string }[]).map((p) => p.id)).toEqual(['p2', 'p3']);
  });

  it('prints não vazam: nem para a outra conta, nem para o conector (a IA)', async () => {
    const ana = conta('ana');
    const bia = conta('bia');
    await new Maquina(ana).semear({ ...acervoCompleto(), [STORAGE_KEYS.shots]: [printReal('secreto', 5000)] }).em(() => sincronizar());
    const deBia = new Maquina(bia);
    await deBia.em(() => sincronizar());
    expect(deBia.lido(STORAGE_KEYS.shots)).toBeUndefined();
    expect(contagem('print_local', bia)).toBe(0);
    // A projeção que a IA lê só tem a CONTAGEM de prints.
    expect(sql(`select t.prints from nota t join pessoa p on p.id=t.pessoa_id where p.google_sub='${ana}'`)[0]).toBe('1');
  });

  it('conflito: duas máquinas editam o mesmo documento — vale a última, e a outra versão é guardada', async () => {
    const sub = conta('ana');
    const a = new Maquina(sub).semear(acervoCompleto());
    const b = new Maquina(sub);
    await a.em(() => sincronizar());
    await b.em(() => sincronizar());

    await a.em(async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.documents]: [documento('d1', { content: 'Versão da A' })] });
      await sincronizar();
    });
    await b.em(async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.documents]: [documento('d1', { content: 'Versão da B' })] });
      await sincronizar();
    });

    // No servidor, a da B — e a da A sobrevive como documento recuperável, que também subiu.
    const noBanco = sql(`select t.corpo->>'content' from copia_local t join pessoa p on p.id=t.pessoa_id where p.google_sub='${sub}' and t.colecao='documento' order by 1`);
    expect(noBanco).toEqual(['Versão da A', 'Versão da B']);

    await a.em(() => sincronizar(FORCAR));
    const docs = a.lido(STORAGE_KEYS.documents) as { id: string; content: string; title: string }[];
    expect(docs.map((d) => d.content).sort()).toEqual(['Versão da A', 'Versão da B']);
    expect(docs.find((d) => d.id !== 'd1')!.title).toBe('Ata d1 (versão de outra máquina)');
    // Sem laço: nada mais a fazer em nenhuma das duas.
    expect(await a.em(() => sincronizar(FORCAR))).toEqual({ estado: 'nada-a-fazer' });
    expect(await b.em(() => sincronizar(FORCAR))).toEqual({ estado: 'nada-a-fazer' });
  });

  it('editar várias vezes na mesma máquina nunca gera conflito consigo mesma', async () => {
    const sub = conta('ana');
    const a = new Maquina(sub).semear(acervoCompleto());
    await a.em(() => sincronizar());
    for (const v of ['2', '3', '4']) {
      await a.em(async () => {
        await chrome.storage.local.set({ [STORAGE_KEYS.documents]: [documento('d1', { content: `v${v}` })] });
        await sincronizar();
      });
    }
    expect(a.lido(STORAGE_KEYS.documents)).toHaveLength(1);
  });

  it('o polling sem novidade é barato e uma escrita de outra máquina aparece', async () => {
    const sub = conta('ana');
    const a = new Maquina(sub).semear(acervoCompleto());
    const b = new Maquina(sub);
    await a.em(() => sincronizar());
    await b.em(() => sincronizar());
    // Vários polls vazios (o que o alarme faz a cada 5 min).
    for (let i = 0; i < 5; i++) expect(await b.em(() => sincronizar(FORCAR))).toEqual({ estado: 'nada-a-fazer' });
    await a.em(async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.conversations]: [conversa('c1'), conversa('c-nova')] });
      await sincronizar();
    });
    expect(await b.em(() => sincronizar(FORCAR))).toMatchObject({ restaurados: 1 });
  });

  it('um cliente que manda lixo para a rota real é recusado sem derrubar o servidor', async () => {
    const sub = conta('ana');
    const m = new Maquina(sub);
    m.usar();
    // O mesmo token que a extensão usaria.
    const { tokenDeIdentidade } = await import('@/shared/services/identidade');
    const token = (await tokenDeIdentidade(false))!;
    const post = (corpo: unknown) =>
      fetch(`${SERVER_BASE_URL}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
      });

    expect((await post('{não é json')).status).toBe(400);
    expect((await post({ itens: [{ tipo: 'prints', item: { id: 'x' } }] })).status).toBe(400);
    expect((await post({ itens: Array.from({ length: 101 }, (_, i) => ({ tipo: 'copia', item: { id: `i${i}`, colecao: 'nota', corpo: {} } })) })).status).toBe(413);

    // Cópia torta é recusada com motivo; a boa ao lado entra.
    const r = await post({
      itens: [
        { tipo: 'copia', item: { id: 'ruim', colecao: 'prints', corpo: {} } },
        { tipo: 'copia', item: { id: 'boa', colecao: 'documento', corpo: { id: 'boa' } } },
      ],
      apagados: [],
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ gravados: 1, recusados: [{ id: 'ruim' }] });
    expect(contagem('copia_local', sub)).toBe(1);

    // O servidor continua de pé.
    const get = await fetch(`${SERVER_BASE_URL}/api/sync?desde=0`, { headers: { Authorization: `Bearer ${token}` } });
    expect(get.status).toBe(200);
  });
});


rodarCota('cota por pessoa (servidor com TAQCITI_COTA_MB=0.3)', () => {
  it('recusa o que passa do teto, mantém o resto, e retoma quando há espaço', async () => {
    const sub = conta('ana');
    const [grande1, grande2] = [printReal('g1', 170_000, { at: 2000 }), printReal('g2', 170_000, { at: 1000 })];
    const a = new Maquina(sub).semear({ [STORAGE_KEYS.history]: [reuniao()], [STORAGE_KEYS.shots]: [grande1, grande2] });

    // 2 × 170 KB = 340 KB: o segundo passa dos 0,3 MB (314 572 B); o primeiro cabe.
    const r = await a.em(() => sincronizar());
    expect(r).toMatchObject({ estado: 'ok', recusadosPorCota: 1 });
    expect(contagem('print_local', sub, 'and not t.apagado')).toBe(1);
    // A cota é mesmo respeitada no banco.
    const uso = Number(
      sql(`select coalesce(sum(t.tamanho),0) from print_local t join pessoa p on p.id=t.pessoa_id where p.google_sub='${sub}'`)[0],
    );
    expect(uso).toBeLessThanOrEqual(0.3 * 1024 * 1024);

    const est = a.estado[STORAGE_KEYS.syncEstado] as { assinaturas: Record<string, string>; pausados: Record<string, number>; uso: { bytes: number; cota: number } };
    expect(est.uso.cota).toBe(Math.floor(0.3 * 1024 * 1024));
    const recusado = Object.keys(est.pausados);
    expect(recusado).toHaveLength(1);
    expect(est.assinaturas[recusado[0]!]).toBeUndefined();

    // Apaga o que cabia: libera espaço. O recusado está em pausa — passada a pausa, entra.
    const aceito = recusado[0] === 'print:g2' ? 'g1' : 'g2';
    await a.em(async () => {
      const guardado = (await chrome.storage.local.get(STORAGE_KEYS.syncEstado))[STORAGE_KEYS.syncEstado] as { pausados: Record<string, number> };
      await chrome.storage.local.set({
        [STORAGE_KEYS.shots]: [aceito === 'g1' ? grande2 : grande1],
        [STORAGE_KEYS.syncEstado]: { ...guardado, pausados: {} }, // "passaram 30 minutos"
      });
      // O print recusado entra, junto com a nota da reunião (a contagem de prints dela mudou).
      expect(await sincronizar()).toMatchObject({ estado: 'ok', enviados: 2 });
    });
    expect(contagem('print_local', sub, 'and not t.apagado')).toBe(1);
    expect(a.estado[STORAGE_KEYS.syncEstado]).toMatchObject({ recusadosPorCota: 0 });
  });

  it('a cota é por conta: a cheia de uma não barra a outra', async () => {
    const [ana, bia] = [conta('ana'), conta('bia')];
    const enche = (sub: string) =>
      new Maquina(sub).semear({ [STORAGE_KEYS.history]: [reuniao()], [STORAGE_KEYS.shots]: [printReal('x', 200_000)] }).em(() => sincronizar());
    expect(await enche(ana)).toMatchObject({ estado: 'ok' });
    expect(await enche(bia)).toMatchObject({ estado: 'ok' });
    expect(contagem('print_local', ana)).toBe(1);
    expect(contagem('print_local', bia)).toBe(1);
  });

  it('um print acima do teto de 1,5 MB é recusado de vez (e não fica tentando para sempre)', async () => {
    const sub = conta('ana');
    const enorme = printReal('enorme', 1_600_000);
    const a = new Maquina(sub).semear({ [STORAGE_KEYS.history]: [reuniao()], [STORAGE_KEYS.shots]: [enorme] });
    expect(await a.em(() => sincronizar())).toMatchObject({ estado: 'ok' });
    expect(contagem('print_local', sub)).toBe(0);
    // Recusa por formato é definitiva: registrado como tratado, e a passada seguinte não reenvia.
    expect(await a.em(() => sincronizar(FORCAR))).toEqual({ estado: 'nada-a-fazer' });
  });
});