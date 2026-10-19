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
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { SERVER_BASE_URL } from '@/shared/config/serverConfig';
import { limparCacheDeIdentidadeLocal } from '@/shared/services/identidade';
import { esquecerSincronizado, sincronizar } from './sincronizacao';

const SERVIDOR = process.env.TAQCITI_E2E_SERVER;
const CONTEINER = process.env.TAQCITI_E2E_PG ?? 'taqciti-e2e-pg';
const CLIENT_ID = 'e2e-client.apps.googleusercontent.com';
const rodar = SERVIDOR ? describe : describe.skip;

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

  it('trabalho que ainda não subiu não é atropelado (vale a última a sincronizar)', async () => {
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
      await sincronizar(FORCAR);
    });
    expect((b.lido(STORAGE_KEYS.documents) as { content: string }[])[0]!.content).toBe('Versão da B');
    expect(
      sql(`select t.corpo->>'content' from copia_local t join pessoa p on p.id=t.pessoa_id where p.google_sub='${sub}' and t.colecao='documento'`)[0],
    ).toBe('Versão da B');
    await a.em(() => sincronizar(FORCAR));
    expect((a.lido(STORAGE_KEYS.documents) as { content: string }[])[0]!.content).toBe('Versão da B');
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
