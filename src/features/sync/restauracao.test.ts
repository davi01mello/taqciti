/**
 * A volta da sincronização, de ponta a ponta no que a extensão controla:
 * duas "máquinas" (dois storages que não se tocam) falando com o mesmo
 * servidor, que aqui é um fake com o contrato real de `server/app/api/sync` —
 * cursor por `seq`, lápide para o apagado, páginas, contas isoladas e, de
 * propósito, o `jsonb` do Postgres reordenando as chaves de tudo que guarda.
 * O contrato do lado do servidor é verificado em `server/lib/conector/`.
 *
 * O que estes testes existem para pegar:
 *
 *  - a máquina nova que volta VAZIA (o motivo de a volta existir);
 *  - a conta errada recebendo dado de outra;
 *  - o laço silencioso: trazer um item, reenviá-lo, trazê-lo de novo;
 *  - o trabalho local que ainda não subiu sendo atropelado pelo remoto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { limparCacheDeIdentidadeLocal } from '@/shared/services/identidade';
import { aplicarPagina, canonico, decidir, type ItemRemoto } from './restauracao';
import { assinaturaDe, montarDesejado, sincronizar } from './sincronizacao';

// ------------------------------------------------------------ as máquinas

const REDIRECT_URI = 'https://jalebpaefejnbacgncgkailhemkdpnhm.chromiumapp.org/';

function jwt(payload: Record<string, unknown>): string {
  const parte = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${parte({ alg: 'none' })}.${parte(payload)}.assinatura-fake`;
}

const subDoCabecalho = (init: RequestInit | undefined): string | null => {
  const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
  const payload = auth?.split(' ')[1]?.split('.')[1];
  if (!payload) return null;
  return (JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { sub: string }).sub;
};

type Armazenamento = Record<string, unknown>;

/** Um computador: o seu storage, e a conta Google com que está logado. */
class Maquina {
  estado: Armazenamento = { [STORAGE_KEYS.sync]: { ligada: true } };
  pedidosDeIdentidade = 0;
  constructor(public sub: string) {}

  /** Liga o "chrome" global desta máquina. */
  usar(): void {
    limparCacheDeIdentidadeLocal();
    installChromeStorageMock({
      local: structuredClone(this.estado),
      extra: {
        runtime: { lastError: undefined },
        identity: {
          getRedirectURL: () => REDIRECT_URI,
          launchWebAuthFlow: (d: { url: string }, cb: (url?: string) => void) => {
            this.pedidosDeIdentidade += 1;
            const nonce = new URL(d.url).searchParams.get('nonce');
            cb(
              `${REDIRECT_URI}#id_token=${jwt({
                sub: this.sub,
                email: `${this.sub}@citi.org.br`,
                nonce,
                exp: Math.floor(Date.now() / 1000) + 3600,
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

  /** Roda `fn` COM o storage desta máquina e guarda o que ela deixou. */
  async em<T>(fn: () => Promise<T>): Promise<T> {
    this.usar();
    try {
      return await fn();
    } finally {
      await this.guardar();
    }
  }

  /** Semeia o storage desta máquina (como se a pessoa já usasse o produto). */
  semear(valores: Armazenamento): this {
    this.estado = { ...this.estado, ...valores };
    return this;
  }

  lido(chave: string): unknown {
    return this.estado[chave];
  }

  sincronizacao(): { assinaturas: Record<string, string>; conta?: string; cursor?: number } {
    return this.estado[STORAGE_KEYS.syncEstado] as never;
  }
}

// ------------------------------------------------------------ o servidor

interface Linha {
  colecao: string;
  id: string;
  corpo: unknown;
  apagado: boolean;
  seq: number;
}

/** O `jsonb` do Postgres não preserva a ordem das chaves: curtas antes, depois alfabética. */
function comoJsonb(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(comoJsonb);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => a.length - b.length || (a < b ? -1 : 1))
        .map(([k, x]) => [k, comoJsonb(x)]),
    );
  }
  return v;
}

function criarServidor(opcoes: { porPagina?: number } = {}) {
  const porPagina = opcoes.porPagina ?? 25;
  const contas = new Map<string, Map<string, Linha>>();
  let seq = 0;
  const posts: { sub: string; corpo: { itens: { tipo: string; item: { id: string } }[]; apagados: { tipo: string; id: string }[] } }[] = [];
  const gets: { sub: string; desde: number }[] = [];
  const modo = { get: 'normal' as 'normal' | '405' | '401' | 'torto', itensExtras: [] as unknown[] };

  const acervoDe = (sub: string) => {
    if (!contas.has(sub)) contas.set(sub, new Map());
    return contas.get(sub)!;
  };
  const gravar = (sub: string, l: Omit<Linha, 'seq'>) => {
    seq += 1;
    acervoDe(sub).set(`${l.colecao}:${l.id}`, { ...l, seq });
  };

  const rede = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const sub = subDoCabecalho(init);
    if (!sub) return new Response('sem token', { status: 401 });

    if (init?.method === 'POST') {
      const corpo = JSON.parse(init.body as string) as (typeof posts)[number]['corpo'];
      posts.push({ sub, corpo });
      for (const { tipo, item } of corpo.itens) {
        if (tipo === 'copia') {
          const c = item as unknown as { colecao: string; id: string; corpo: unknown };
          gravar(sub, { colecao: c.colecao, id: c.id, corpo: comoJsonb(c.corpo), apagado: false });
        } else if (tipo === 'historico') {
          gravar(sub, { colecao: 'historico', id: item.id, corpo: comoJsonb(item), apagado: false });
        }
      }
      for (const { tipo, id } of corpo.apagados) {
        if (tipo === 'historico') acervoDe(sub).delete(`historico:${id}`);
        else gravar(sub, { colecao: tipo, id, corpo: null, apagado: true });
      }
      return new Response(JSON.stringify({ gravados: corpo.itens.length, apagados: corpo.apagados.length }));
    }

    // GET
    const desde = Number(new URL(String(url)).searchParams.get('desde'));
    gets.push({ sub, desde });
    if (modo.get === '405') return new Response('no', { status: 405 });
    if (modo.get === '401') return new Response('no', { status: 401 });
    if (modo.get === 'torto') return new Response(JSON.stringify({ gravados: 1 }));
    const linhas = [...acervoDe(sub).values()].filter((l) => l.seq > desde).sort((a, b) => a.seq - b.seq);
    const pagina = linhas.slice(0, porPagina);
    const itens = [...pagina, ...(desde === 0 ? modo.itensExtras : [])];
    return new Response(
      JSON.stringify({
        itens,
        proximo: pagina.length ? pagina[pagina.length - 1]!.seq : desde,
        fim: linhas.length <= porPagina,
      }),
    );
  });

  return {
    rede,
    posts,
    gets,
    modo,
    acervoDe,
    /** Só o que NÃO é da conta `sub`: usado para provar isolamento. */
    ids: (sub: string) => [...acervoDe(sub).keys()].sort(),
    plantar: (sub: string, l: Omit<Linha, 'seq'>) => gravar(sub, l),
  };
}

// --------------------------------------------------------------- fixtures

const reuniao = (id = 'r1', extra: Record<string, unknown> = {}) => ({
  id,
  title: `Reunião ${id}`,
  startedAt: 1_790_000_000_000,
  endedAt: 1_790_003_600_000,
  durationSeconds: 3600,
  participants: [{ name: 'Ana Souza', isHost: true }],
  segments: [
    { speaker: 'Ana Souza', text: 'Vamos fechar o deploy.', startOffsetMs: 0, endOffsetMs: 900, captionId: 'cap-0' },
    { speaker: 'Beto', text: 'Fechado.', startOffsetMs: 1000, endOffsetMs: 1500, captionId: 'cap-1' },
  ],
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
  title: 'Como foi o deploy?',
  createdAt: 1_790_000_300_000,
  updatedAt: 1_790_000_400_000,
  messages: [
    { id: 'm1', role: 'user', text: 'Como foi o deploy?', at: 1_790_000_300_000 },
    { id: 'm2', role: 'assistant', text: 'Foi fechado.', at: 1_790_000_400_000 },
  ],
  ...extra,
});

const historico = (documentoId = 'd1') => ({
  documentoId,
  variante: 'editorial',
  fontesIds: ['r1'],
  versoes: [
    { revisao: 1, arvore: { revisao: 1, titulo: 'Proposta', lacunas: [], blocos: [] }, criadaEm: 1, origem: 'geracao', problemas: 0 },
    { revisao: 2, arvore: { revisao: 2, titulo: 'Proposta', lacunas: [], blocos: [] }, criadaEm: 2, origem: 'edicao', pedido: 'mais curto', problemas: 0 },
  ],
});

const nota = { meetingId: 'r1', texto: 'Lembrar de avisar o cliente.', updatedAt: 1_790_000_500_000 };
const marcas = { 'cap-0': 'decisao', 'cap-1': 'acao' };

/** O acervo completo de uma pessoa: um de cada coisa que a volta restaura. */
function acervoCompleto(): Armazenamento {
  return {
    [STORAGE_KEYS.history]: [reuniao()],
    [STORAGE_KEYS.documents]: [documento()],
    [STORAGE_KEYS.conversations]: [conversa()],
    [STORAGE_KEYS.documentVersions]: [historico()],
    [STORAGE_KEYS.notes]: { r1: nota },
    [STORAGE_KEYS.marks]: { r1: marcas },
  };
}

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_OAUTH_WEB_CLIENT_ID', '123456-web.apps.googleusercontent.com');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ------------------------------------------------------------ o essencial

describe('uma máquina nova da mesma conta', () => {
  it('traz TUDO que a outra tinha — registros inteiros, não a projeção magra', async () => {
    const srv = criarServidor();
    const antiga = new Maquina('sub-ana').semear(acervoCompleto());
    const nova = new Maquina('sub-ana');

    // Quem ENVIA não reaplica o que acabou de enviar: o servidor devolve os itens
    // com as chaves reordenadas (jsonb), e tratar isso como diferença reescreveria
    // o storage inteiro a cada passada.
    expect(await antiga.em(() => sincronizar())).toEqual({ estado: 'ok', enviados: 5, apagados: 0 });
    const r = await nova.em(() => sincronizar());
    expect(r).toEqual({ estado: 'ok', enviados: 0, apagados: 0, restaurados: 5 });

    expect(nova.lido(STORAGE_KEYS.history)).toEqual([reuniao()]);
    // O que a projeção do conector perde — html, formato, origem — volta.
    expect(nova.lido(STORAGE_KEYS.documents)).toEqual([documento()]);
    expect(nova.lido(STORAGE_KEYS.conversations)).toEqual([conversa()]);
    expect(nova.lido(STORAGE_KEYS.documentVersions)).toEqual([historico()]);
    expect(nova.lido(STORAGE_KEYS.notes)).toEqual({ r1: nota });
    // As marcações voltam presas ao captionId, e não como contagem.
    expect(nova.lido(STORAGE_KEYS.marks)).toEqual({ r1: marcas });
    expect(srv.posts.filter((p) => p.sub === 'sub-ana')).toHaveLength(1);
  });

  it('não devolve ao servidor o que acabou de trazer (sem laço de eco)', async () => {
    const srv = criarServidor();
    const antiga = new Maquina('sub-ana').semear(acervoCompleto());
    const nova = new Maquina('sub-ana');
    await antiga.em(() => sincronizar());
    await nova.em(() => sincronizar());
    const subidasAntes = srv.posts.length;

    // Mesmo com o `jsonb` do servidor reordenando todas as chaves, nada difere.
    expect(await nova.em(() => sincronizar({ forcarRestauracao: true }))).toEqual({ estado: 'nada-a-fazer' });
    expect(await antiga.em(() => sincronizar({ forcarRestauracao: true }))).toEqual({ estado: 'nada-a-fazer' });
    expect(srv.posts).toHaveLength(subidasAntes);
  });

  it('não leva telemetria do parser nem id de tile ao servidor', async () => {
    const srv = criarServidor();
    const antiga = new Maquina('sub-ana').semear({
      [STORAGE_KEYS.history]: [
        reuniao('r1', {
          participants: [{ name: 'Ana', isHost: true, providerParticipantId: 'tile-xyz' }],
          speakersObserved: [{ name: 'Ana', firstSeenAt: 1, lastSeenAt: 2, source: 'caption', confidence: 1, matchedParticipant: true }],
        }),
      ],
    });
    await antiga.em(() => sincronizar());
    const guardado = JSON.stringify([...srv.acervoDe('sub-ana').values()]);
    expect(guardado).not.toContain('tile-xyz');
    expect(guardado).not.toContain('speakersObserved');
  });

  it('uma reunião que estava gravando na outra chega como encerrada', async () => {
    criarServidor();
    const antiga = new Maquina('sub-ana').semear({ [STORAGE_KEYS.history]: [reuniao('r1', { status: 'recording' })] });
    const nova = new Maquina('sub-ana');
    await antiga.em(() => sincronizar());
    await nova.em(() => sincronizar());
    expect((nova.lido(STORAGE_KEYS.history) as { status: string }[])[0]!.status).toBe('ready');
  });
});

describe('contas diferentes', () => {
  it('a outra conta não recebe nada, e nada dela sobe para a primeira', async () => {
    const srv = criarServidor();
    const ana = new Maquina('sub-ana').semear(acervoCompleto());
    const bia = new Maquina('sub-bia');
    await ana.em(() => sincronizar());

    expect(await bia.em(() => sincronizar())).toEqual({ estado: 'nada-a-fazer' });
    expect(bia.lido(STORAGE_KEYS.history)).toBeUndefined();
    expect(srv.ids('sub-bia')).toEqual([]);
  });

  it('trocar a conta Google na MESMA máquina não entrega o acervo local à conta nova', async () => {
    const srv = criarServidor();
    // O acervo da Bia, que ela fez noutro computador.
    const outro = new Maquina('sub-bia').semear({ [STORAGE_KEYS.documents]: [documento('d-da-bia', { title: 'Da Bia' })] });
    await outro.em(() => sincronizar());

    // Uma máquina que era da Ana…
    const maquina = new Maquina('sub-ana').semear(acervoCompleto());
    await maquina.em(() => sincronizar());
    expect(maquina.sincronizacao().conta).toBe('sub-ana');

    // …e agora a Bia loga nela.
    maquina.sub = 'sub-bia';
    const r = await maquina.em(() => sincronizar());

    // O que era da Ana NÃO foi para o acervo da Bia.
    expect(srv.ids('sub-bia')).toEqual(['documento:d-da-bia']);
    expect(r).toMatchObject({ estado: 'ok', restaurados: 1 });
    // E o da Bia chegou, com o cursor da conta nova (e não o da Ana).
    const titulos = (maquina.lido(STORAGE_KEYS.documents) as { title: string }[]).map((d) => d.title);
    expect(titulos).toContain('Da Bia');
    expect(maquina.sincronizacao().conta).toBe('sub-bia');
  });
});

describe('o que muda depois', () => {
  async function duasMaquinasEmDia() {
    const srv = criarServidor();
    const a = new Maquina('sub-ana').semear(acervoCompleto());
    const b = new Maquina('sub-ana');
    await a.em(() => sincronizar());
    await b.em(() => sincronizar());
    return { srv, a, b };
  }

  it('apagar numa máquina apaga na outra', async () => {
    const { a, b } = await duasMaquinasEmDia();
    await a.em(async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.history]: [] });
      await sincronizar();
    });
    expect(await b.em(() => sincronizar({ forcarRestauracao: true }))).toMatchObject({ estado: 'ok', restaurados: 1 });
    expect(b.lido(STORAGE_KEYS.history)).toEqual([]);
    // O resto não foi junto.
    expect(b.lido(STORAGE_KEYS.documents)).toEqual([documento()]);
  });

  it('apagar um documento leva o histórico de versões dele junto', async () => {
    const { a, b } = await duasMaquinasEmDia();
    await a.em(async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.documents]: [], [STORAGE_KEYS.documentVersions]: [] });
      await sincronizar();
    });
    await b.em(() => sincronizar({ forcarRestauracao: true }));
    expect(b.lido(STORAGE_KEYS.documents)).toEqual([]);
    expect(b.lido(STORAGE_KEYS.documentVersions)).toEqual([]);
  });

  it('uma edição feita na outra máquina chega', async () => {
    const { a, b } = await duasMaquinasEmDia();
    await a.em(async () => {
      await chrome.storage.local.set({
        [STORAGE_KEYS.documents]: [documento('d1', { content: 'Texto novo', updatedAt: 1_790_000_900_000 })],
        [STORAGE_KEYS.notes]: { r1: { ...nota, texto: 'Nota nova', updatedAt: 1_790_000_900_000 } },
      });
      await sincronizar();
    });
    await b.em(() => sincronizar({ forcarRestauracao: true }));
    expect((b.lido(STORAGE_KEYS.documents) as { content: string }[])[0]!.content).toBe('Texto novo');
    expect((b.lido(STORAGE_KEYS.notes) as Record<string, { texto: string }>).r1!.texto).toBe('Nota nova');
  });

  it('uma marcação nova na outra máquina chega (a projeção do conector não a veria)', async () => {
    const { a, b } = await duasMaquinasEmDia();
    await a.em(async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.marks]: { r1: { ...marcas, 'cap-0': 'duvida' } } });
      await sincronizar();
    });
    await b.em(() => sincronizar({ forcarRestauracao: true }));
    expect(b.lido(STORAGE_KEYS.marks)).toEqual({ r1: { ...marcas, 'cap-0': 'duvida' } });
  });

  it('uma mudança que só a cópia fiel enxerga também sobe e chega (ex.: o html do documento)', async () => {
    const { srv, a, b } = await duasMaquinasEmDia();
    const subidasAntes = srv.posts.length;
    // O texto, o título e a data não mudam: a projeção do conector é idêntica.
    await a.em(async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.documents]: [documento('d1', { html: '<p>só o html mudou</p>' })] });
      await sincronizar();
    });
    expect(srv.posts).toHaveLength(subidasAntes + 1);
    await b.em(() => sincronizar({ forcarRestauracao: true }));
    expect((b.lido(STORAGE_KEYS.documents) as { html: string }[])[0]!.html).toBe('<p>só o html mudou</p>');
  });

  it('trabalho que ainda NÃO subiu não é atropelado pelo remoto', async () => {
    const { srv, a, b } = await duasMaquinasEmDia();
    // A edita e sobe.
    await a.em(async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.documents]: [documento('d1', { content: 'Versão da A', updatedAt: 1_790_001_000_000 })] });
      await sincronizar();
    });
    // B edita o MESMO documento, sem ter sincronizado depois.
    await b.em(async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.documents]: [documento('d1', { content: 'Versão da B', updatedAt: 1_790_002_000_000 })] });
      await sincronizar({ forcarRestauracao: true });
    });
    // O que B escreveu continua em B, e foi para o servidor...
    expect((b.lido(STORAGE_KEYS.documents) as { content: string }[])[0]!.content).toBe('Versão da B');
    const noServidor = srv.acervoDe('sub-ana').get('documento:d1')!.corpo as { content: string };
    expect(noServidor.content).toBe('Versão da B');
    // ...e a A, que não mexeu depois, recebe a da B (vale a última a sincronizar).
    await a.em(() => sincronizar({ forcarRestauracao: true }));
    expect((a.lido(STORAGE_KEYS.documents) as { content: string }[])[0]!.content).toBe('Versão da B');
  });

  it('o cursor persiste e a volta seguinte só pede o que é novo', async () => {
    const srv = criarServidor({ porPagina: 2 });
    const a = new Maquina('sub-ana').semear({
      [STORAGE_KEYS.conversations]: ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => conversa(id)),
    });
    const b = new Maquina('sub-ana');
    await a.em(() => sincronizar());

    const r = await b.em(() => sincronizar());
    expect(r).toMatchObject({ estado: 'ok', restaurados: 5 });
    expect((b.lido(STORAGE_KEYS.conversations) as unknown[]).length).toBe(5);
    // 5 itens em páginas de 2: três pedidos (a terceira, curta, fecha).
    expect(srv.gets.filter((g) => g.sub === 'sub-ana').length).toBeGreaterThanOrEqual(3);
    const cursor = b.sincronizacao().cursor!;
    expect(cursor).toBeGreaterThan(0);

    await a.em(async () => {
      const atuais = (await chrome.storage.local.get(STORAGE_KEYS.conversations))[STORAGE_KEYS.conversations] as unknown[];
      await chrome.storage.local.set({ [STORAGE_KEYS.conversations]: [conversa('c6', { updatedAt: 1_790_999_000_000 }), ...atuais] });
      await sincronizar();
    });
    srv.gets.length = 0;
    const r2 = await b.em(() => sincronizar({ forcarRestauracao: true }));
    expect(r2).toMatchObject({ restaurados: 1 });
    expect(srv.gets[0]!.desde).toBe(cursor);
    expect((b.lido(STORAGE_KEYS.conversations) as unknown[]).length).toBe(6);
  });

  it('não pergunta ao servidor a cada tecla: respeita o intervalo, salvo se for pedido', async () => {
    const srv = criarServidor();
    const a = new Maquina('sub-ana').semear(acervoCompleto());
    await a.em(() => sincronizar());
    const antes = srv.gets.length;
    await a.em(() => sincronizar());
    expect(srv.gets).toHaveLength(antes); // dentro do intervalo
    await a.em(() => sincronizar({ forcarRestauracao: true }));
    expect(srv.gets).toHaveLength(antes + 1);
  });
});

describe('quando o servidor não ajuda', () => {
  it('um servidor sem o GET não derruba a subida', async () => {
    const srv = criarServidor();
    srv.modo.get = '405';
    const a = new Maquina('sub-ana').semear(acervoCompleto());
    expect(await a.em(() => sincronizar())).toMatchObject({ estado: 'ok', enviados: 5 });
    expect(srv.ids('sub-ana').length).toBe(5);
  });

  it('uma resposta que não é uma página é "nada a restaurar", não erro', async () => {
    const srv = criarServidor();
    srv.modo.get = 'torto';
    const a = new Maquina('sub-ana');
    expect(await a.em(() => sincronizar())).toEqual({ estado: 'nada-a-fazer' });
  });

  it('401 na volta descarta a identidade para a próxima passada pedir outra', async () => {
    const srv = criarServidor();
    srv.modo.get = '401';
    const a = new Maquina('sub-ana');
    await a.em(() => sincronizar());
    expect(a.pedidosDeIdentidade).toBe(1);
    await a.em(() => sincronizar());
    expect(a.pedidosDeIdentidade).toBe(2);
  });

  it('um registro torto vindo do servidor é ignorado, e o bom ao lado entra', async () => {
    const srv = criarServidor();
    srv.modo.itensExtras = [
      { colecao: 'reuniao', id: 'torta', corpo: { id: 'torta' }, apagado: false, seq: 9998 },
      { colecao: 'documento', id: 'dok', corpo: documento('dok'), apagado: false, seq: 9999 },
      { colecao: 'nota', id: 'x', corpo: { nota: { meetingId: 'x', texto: 1 }, marcas: {} }, apagado: false, seq: 10000 },
    ];
    const b = new Maquina('sub-ana');
    const r = await b.em(() => sincronizar());
    expect(r).toMatchObject({ estado: 'ok', restaurados: 1 });
    expect(b.lido(STORAGE_KEYS.history)).toBeUndefined();
    expect((b.lido(STORAGE_KEYS.documents) as { id: string }[]).map((d) => d.id)).toEqual(['dok']);
  });

  it('o que o servidor devolve de uma coleção que a extensão não conhece é descartado', async () => {
    const srv = criarServidor();
    srv.modo.itensExtras = [{ colecao: 'prints', id: 'p', corpo: {}, apagado: false, seq: 1 }];
    const b = new Maquina('sub-ana');
    expect(await b.em(() => sincronizar())).toEqual({ estado: 'nada-a-fazer' });
  });
});

// ------------------------------------------------------- as regras, puras

describe('decidir', () => {
  const entrada = (corpo: unknown) => ({ tipo: 'reuniao', item: {}, copia: { colecao: 'reuniao', id: 'r', corpo } }) as never;

  it.each([
    ['não existe aqui e nunca foi enviado', { apagado: false }, undefined, undefined, undefined, 'por'],
    ['não existe aqui mas consta como enviado: foi apagado aqui', { apagado: false }, undefined, 'a', undefined, 'nada'],
    ['existe, não mudou e é igual', { apagado: false }, entrada({ a: 1 }), 'a', 'a', 'nada'],
    ['existe, não mudou e difere: o remoto é de outra máquina', { apagado: false }, entrada({ a: 2 }), 'a', 'a', 'por'],
    ['existe e MUDOU desde o último envio: o local vence', { apagado: false }, entrada({ a: 2 }), 'a', 'b', 'nada'],
    ['existe e nunca foi enviado: o local vence', { apagado: false }, entrada({ a: 2 }), undefined, 'b', 'nada'],
    ['lápide, item não mexido: apaga', { apagado: true }, entrada({ a: 1 }), 'a', 'a', 'tirar'],
    ['lápide, item que mudou: o trabalho local não se perde', { apagado: true }, entrada({ a: 1 }), 'a', 'b', 'nada'],
    ['lápide, item que nunca subiu: não se perde', { apagado: true }, entrada({ a: 1 }), undefined, 'b', 'nada'],
    ['lápide, item que já não existe aqui', { apagado: true }, undefined, undefined, undefined, 'nada'],
  ])('%s', (_nome, remoto, local, guardada, atual, esperado) => {
    expect(decidir({ colecao: 'reuniao', corpo: { a: 1 }, ...remoto }, local, guardada, atual)).toBe(esperado);
  });
});

describe('canonico', () => {
  it('ignora a ordem das chaves, em qualquer profundidade', () => {
    expect(canonico({ a: 1, b: { c: [1, { y: 1, x: 2 }], d: 2 } })).toBe(
      canonico({ b: { d: 2, c: [1, { x: 2, y: 1 }] }, a: 1 }),
    );
  });
  it('mas não ignora a ordem dos itens de uma lista', () => {
    expect(canonico({ a: [1, 2] })).not.toBe(canonico({ a: [2, 1] }));
  });
  it('trata undefined como ausente, como o jsonb faz', () => {
    expect(canonico({ a: 1, b: undefined })).toBe(canonico({ a: 1 }));
  });
});

describe('aplicarPagina', () => {
  beforeEach(() => {
    new Maquina('sub-ana').usar();
  });

  const contexto = (assinaturas: Record<string, string>) => ({
    assinaturas,
    lerDesejado: montarDesejado,
    assinaturaDe,
  });
  const remoto = (corpo: unknown): ItemRemoto => ({ colecao: 'reuniao', id: 'r1', corpo, apagado: false, seq: 1 });

  it('nunca toca na reunião que está gravando AGORA nesta máquina', async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [reuniao('r1', { status: 'recording', title: 'Ao vivo' })] });
    const desejado = await montarDesejado();
    const assinaturas = { 'reuniao:r1': assinaturaDe(desejado.get('reuniao:r1')!) };

    // Sem a proteção, "não mexida + difere" substituiria a gravação em curso.
    await aplicarPagina([remoto(reuniao('r1', { title: 'Outra' }))], contexto(assinaturas));
    const [r] = (await chrome.storage.local.get(STORAGE_KEYS.history))[STORAGE_KEYS.history] as { title: string; status: string }[];
    expect(r).toMatchObject({ title: 'Ao vivo', status: 'recording' });
  });

  it('preserva o que não entende: um registro de outra versão não some', async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.documents]: [{ forma: 'futura' }, documento('d9')] });
    await aplicarPagina(
      [{ colecao: 'documento', id: 'dnovo', corpo: documento('dnovo'), apagado: false, seq: 1 }],
      contexto({}),
    );
    const lista = (await chrome.storage.local.get(STORAGE_KEYS.documents))[STORAGE_KEYS.documents] as Record<string, unknown>[];
    expect(lista).toContainEqual({ forma: 'futura' });
    expect(lista.map((d) => d.id).filter(Boolean).sort()).toEqual(['d9', 'dnovo']);
  });

  it('respeita o teto de conversas da escrita local', async () => {
    const { MAX_CONVERSAS } = await import('@/home/conversations');
    const itens: ItemRemoto[] = Array.from({ length: MAX_CONVERSAS + 5 }, (_, i) => ({
      colecao: 'conversa' as const,
      id: `c${i}`,
      corpo: conversa(`c${i}`, { updatedAt: i }),
      apagado: false,
      seq: i + 1,
    }));
    await aplicarPagina(itens, contexto({}));
    const lista = (await chrome.storage.local.get(STORAGE_KEYS.conversations))[STORAGE_KEYS.conversations] as { id: string }[];
    expect(lista).toHaveLength(MAX_CONVERSAS);
    // Ficam as mais recentes.
    expect(lista[0]!.id).toBe(`c${MAX_CONVERSAS + 4}`);
  });

  it('uma nota só com marcações não vira nota em branco', async () => {
    await aplicarPagina(
      [{ colecao: 'nota', id: 'r1', corpo: { nota: { ...nota, texto: '' }, marcas }, apagado: false, seq: 1 }],
      contexto({}),
    );
    const lido = await chrome.storage.local.get([STORAGE_KEYS.notes, STORAGE_KEYS.marks]);
    expect(lido[STORAGE_KEYS.notes]).toEqual({});
    expect(lido[STORAGE_KEYS.marks]).toEqual({ r1: marcas });
  });
});
