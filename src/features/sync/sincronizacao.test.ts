/**
 * O diff e o envio.
 *
 * O que estes testes existem para pegar é a classe de erro que não faz
 * barulho: sincronizar demais (reenviar tudo a cada passada, que só aparece
 * como lentidão e consumo) e sincronizar de menos (uma renomeação que nunca
 * chega, e o assistente responde sobre um título que não existe mais).
 *
 * Por isso o teste central é `o que mudou PARA TRÁS também vai`. Um marcador
 * temporal — o desenho ingênuo — passaria em tudo aqui menos nele.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import type { MeetingRecord } from '@/shared/types/domain';
import { limparCacheDeIdentidadeLocal } from '@/shared/services/identidade';
import {
  assinar,
  assinaturaDe,
  esquecerSincronizado,
  NOME_DO_ALARME,
  PERIODO_DO_ALARME_MIN,
  fatiar,
  ligarSincronizacaoAutomatica,
  montarDesejado,
  planejar,
  resumoDaCota,
  sincronizar,
  situacaoDoSync,
} from './sincronizacao';
import { reuniaoParaOAcervo } from './paraOAcervo';

// ------------------------------------------------------------- fixtures

function reuniao(over: Partial<MeetingRecord> = {}): MeetingRecord {
  return {
    id: 'r1',
    title: 'Planejamento',
    startedAt: Date.UTC(2026, 8, 1),
    endedAt: Date.UTC(2026, 8, 1) + 3_600_000,
    durationSeconds: 3600,
    participants: [{ name: 'Ana Souza', isHost: true }],
    segments: [
      { speaker: 'Ana Souza', text: 'Vamos fechar o deploy.', startOffsetMs: 0, endOffsetMs: 900 },
    ],
    status: 'ready',
    metadata: { capturedCaptions: true, droppedSegments: 0 },
    ...over,
  } as MeetingRecord;
}

const REDIRECT_URI = 'https://jalebpaefejnbacgncgkailhemkdpnhm.chromiumapp.org/';

/** Um JWT que basta para `identidade.ts` ler: só o PAYLOAD importa (nonce,
 *  exp) — a assinatura é verificada pelo servidor, nunca aqui. */
function jwtDeMentira(payload: Record<string, unknown>): string {
  const parte = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${parte({ alg: 'none' })}.${parte(payload)}.assinatura-fake`;
}

/**
 * Liga o "sim" e finge uma identidade válida.
 *
 * `idToken: null` finge que o Google não devolveu nada — sessão caducada, ou
 * a pessoa fechou o popup. Devolve quantas vezes `launchWebAuthFlow` foi
 * chamado, para os testes de cache/401 poderem afirmar sobre isso sem
 * depender de uma API do Chrome que não existe mais neste mecanismo.
 */
function montarChromeComToken(idToken: string | null = 'presente') {
  const chamadas = { total: 0 };
  const g = globalThis as unknown as { chrome: Record<string, unknown> };
  g.chrome = {
    ...(g.chrome ?? {}),
    runtime: {
      ...((g.chrome?.runtime as object) ?? {}),
      lastError: undefined,
    },
    identity: {
      getRedirectURL: () => REDIRECT_URI,
      launchWebAuthFlow: (detalhes: { url: string }, cb: (url?: string) => void) => {
        chamadas.total += 1;
        if (idToken === null) {
          cb(undefined);
          return;
        }
        const nonce = new URL(detalhes.url).searchParams.get('nonce');
        const token = jwtDeMentira({
          sub: 'sub-ana',
          email: 'ana@citi.org.br',
          nonce,
          exp: Math.floor(Date.now() / 1000) + 3600,
        });
        cb(`${REDIRECT_URI}#id_token=${token}`);
      },
    },
  };
  return chamadas;
}

/**
 * O servidor, do ponto de vista destes testes: responde ao POST de subida e ao
 * GET da volta (aqui sempre vazio — a volta tem os seus próprios testes em
 * `restauracao.test.ts`). Troca `fetch`, para nenhum teste sair para a rede.
 */
function servidor(resposta: (init: RequestInit) => Response = () => new Response(JSON.stringify({ gravados: 1, apagados: 0 }))) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) =>
    init?.method === 'GET'
      ? new Response(JSON.stringify({ itens: [], proximo: 0, fim: true }))
      : resposta(init ?? {}),
  );
}

/** Só as subidas: a volta (GET) não conta para o que estes testes afirmam. */
const subidas = (rede: ReturnType<typeof servidor>) =>
  rede.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');

async function ligar() {
  await chrome.storage.local.set({ [STORAGE_KEYS.sync]: { ligada: true } });
}

beforeEach(() => {
  installChromeStorageMock();
  vi.stubEnv('VITE_GOOGLE_OAUTH_WEB_CLIENT_ID', '123456-web.apps.googleusercontent.com');
  limparCacheDeIdentidadeLocal();
  montarChromeComToken();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ------------------------------------------------------------- assinatura

describe('assinar', () => {
  it('o mesmo conteúdo dá a mesma assinatura', () => {
    expect(assinar({ a: 1, b: [2, 3] })).toBe(assinar({ a: 1, b: [2, 3] }));
  });

  it('qualquer mudança muda a assinatura', () => {
    const base = reuniaoParaOAcervo(reuniao());
    expect(assinar({ ...base, titulo: 'Outro' })).not.toBe(assinar(base));
    expect(assinar({ ...base, falas: [] })).not.toBe(assinar(base));
  });

  it('carrega o tamanho, para uma colisão de hash não bastar', () => {
    expect(assinar({ a: 1 }).split('.')[0]).toBe(String(JSON.stringify({ a: 1 }).length));
  });
});

// ------------------------------------------------------------- montar

describe('montarDesejado', () => {
  it('storage vazio não gera item nenhum', async () => {
    expect((await montarDesejado()).size).toBe(0);
  });

  it('junta as coleções com id composto (e cada print como item próprio)', async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.history]: [reuniao()],
      [STORAGE_KEYS.documents]: [
        { id: 'd1', title: 'Ata', content: 'texto', createdAt: 1, updatedAt: 2 },
      ],
      [STORAGE_KEYS.conversations]: [
        {
          id: 'c1',
          title: 'Conversa',
          createdAt: 1,
          updatedAt: 2,
          messages: [{ id: 'm', role: 'user', text: 'oi', at: 1 }],
        },
      ],
      [STORAGE_KEYS.notes]: { r1: { meetingId: 'r1', texto: 'nota', updatedAt: 3 } },
      [STORAGE_KEYS.marks]: { r1: { cap1: 'decisao', cap2: 'decisao', cap3: 'acao' } },
      [STORAGE_KEYS.shots]: [{ id: 's1', meetingId: 'r1', dataUrl: 'data:image/jpeg;base64,AAA' }],
    });

    const d = await montarDesejado();
    expect([...d.keys()].sort()).toEqual([
      'conversa:c1',
      'documento:d1',
      'nota:r1',
      'print:s1',
      'reuniao:r1',
    ]);
  });

  it('a nota leva contagem de marcações e de prints — nunca a imagem', async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.history]: [reuniao()],
      [STORAGE_KEYS.notes]: { r1: { meetingId: 'r1', texto: 'nota', updatedAt: 3 } },
      [STORAGE_KEYS.marks]: { r1: { a: 'decisao', b: 'decisao', c: 'acao' } },
      [STORAGE_KEYS.shots]: [
        { id: 's1', meetingId: 'r1', dataUrl: 'data:image/jpeg;base64,AAA' },
        { id: 's2', meetingId: 'r1', dataUrl: 'data:image/jpeg;base64,BBB' },
      ],
    });

    const nota = (await montarDesejado()).get('nota:r1')!;
    expect(nota.item).toMatchObject({
      reuniaoTitulo: 'Planejamento',
      marcacoes: { decisao: 2, acao: 1 },
      prints: 2,
    });
    // O invariante que mais importa: base64 de imagem NUNCA entra no que sobe.
    expect(JSON.stringify(nota)).not.toContain('data:image');
  });

  it('nota vazia não vira item', async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.notes]: { r1: { meetingId: 'r1', texto: '   ', updatedAt: 1 } },
    });
    expect((await montarDesejado()).has('nota:r1')).toBe(false);
  });

  it('a reunião sobe sem telemetria de parser nem id de tile', async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.history]: [
        reuniao({
          participants: [
            { name: 'Ana', isHost: true, providerParticipantId: 'tile-xyz', confidence: 0.9 },
          ],
          speakersObserved: [
            { name: 'Ana', firstSeenAt: 1, lastSeenAt: 2, source: 'caption', confidence: 1, matchedParticipant: true },
          ],
        }),
      ],
    });
    const r = (await montarDesejado()).get('reuniao:r1')!;
    // Nem na projeção do conector, nem na cópia fiel que outra máquina restaura:
    // a decisão de não mandar telemetria e id de tile vale para as duas.
    const texto = JSON.stringify(r);
    expect(texto).not.toContain('tile-xyz');
    expect(texto).not.toContain('matchedParticipant');
    expect(texto).not.toContain('speakersObserved');
    expect(r.item).toMatchObject({ participantes: ['Ana'] });
    // ...e o que a restauração precisa continua lá.
    expect(r.copia?.corpo).toMatchObject({ id: 'r1', title: 'Planejamento', status: 'ready' });
  });
});

// ------------------------------------------------------------- planejar

describe('planejar', () => {
  it('na primeira vez, tudo é novidade', async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [reuniao()] });
    const plano = planejar(await montarDesejado(), {});
    expect(plano.enviar).toHaveLength(1);
    expect(plano.apagar).toHaveLength(0);
  });

  it('o que não mudou não é reenviado', async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [reuniao()] });
    const desejado = await montarDesejado();
    const assinaturas = { 'reuniao:r1': assinaturaDe(desejado.get('reuniao:r1')!) };
    expect(planejar(desejado, assinaturas).enviar).toHaveLength(0);
  });

  it('o que mudou PARA TRÁS também vai', async () => {
    // Renomear uma reunião antiga não mexe em data nenhuma. É o caso que um
    // "sincronizei até tal momento" perderia calado.
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [reuniao()] });
    const antes = await montarDesejado();
    const assinaturas = { 'reuniao:r1': assinaturaDe(antes.get('reuniao:r1')!) };

    await chrome.storage.local.set({
      [STORAGE_KEYS.history]: [reuniao({ title: 'Nome novo' })],
    });
    const depois = await montarDesejado();
    expect(planejar(depois, assinaturas).enviar).toHaveLength(1);
  });

  it('o que sumiu daqui vira remoção lá', () => {
    const plano = planejar(new Map(), { 'reuniao:r9': 'x', 'nota:r9': 'y' });
    expect(plano.apagar).toEqual([
      { chave: 'reuniao:r9', tipo: 'reuniao', id: 'r9' },
      { chave: 'nota:r9', tipo: 'nota', id: 'r9' },
    ]);
  });

  it('id com dois-pontos no meio é separado só no primeiro', () => {
    const plano = planejar(new Map(), { 'documento:abc:def': 'x' });
    expect(plano.apagar[0]).toEqual({
      chave: 'documento:abc:def',
      tipo: 'documento',
      id: 'abc:def',
    });
  });
});

// --------------------------------------------------------------- fatiar

describe('fatiar', () => {
  it('respeita o teto do servidor', () => {
    const plano = {
      enviar: Array.from({ length: 120 }, (_, i) => ({
        chave: `reuniao:r${i}`,
        tipo: 'reuniao' as const,
        item: {},
        assinatura: 'a',
      })),
      apagar: [],
    };
    const lotes = fatiar(plano, 50);
    expect(lotes.map((l) => l.chaves.length)).toEqual([50, 50, 20]);
  });

  it('envios e remoções cabem no mesmo lote', () => {
    const lotes = fatiar(
      {
        enviar: [{ chave: 'reuniao:a', tipo: 'reuniao', item: {}, assinatura: 'x' }],
        apagar: [{ chave: 'nota:b', tipo: 'nota', id: 'b' }],
      },
      50,
    );
    expect(lotes).toHaveLength(1);
    expect(lotes[0]?.itens).toHaveLength(1);
    expect(lotes[0]?.apagados).toHaveLength(1);
  });

  it('plano vazio não gera lote', () => {
    expect(fatiar({ enviar: [], apagar: [] })).toEqual([]);
  });
});

// ------------------------------------------------------------- sincronizar

describe('sincronizar', () => {
  it('desligado não faz nada — nem toca na rede', async () => {
    const rede = vi.spyOn(globalThis, 'fetch');
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [reuniao()] });
    expect(await sincronizar()).toEqual({ estado: 'desligado' });
    expect(rede).not.toHaveBeenCalled();
  });

  it('ligado mas sem token não tenta', async () => {
    await ligar();
    montarChromeComToken(null);
    const rede = vi.spyOn(globalThis, 'fetch');
    expect(await sincronizar()).toEqual({ estado: 'sem-token' });
    expect(rede).not.toHaveBeenCalled();
  });

  it('sem novidade, não abre requisição', async () => {
    await ligar();
    const rede = servidor();
    expect(await sincronizar()).toEqual({ estado: 'nada-a-fazer' });
    // Pergunta ao servidor o que mudou lá (a volta), mas não SOBE nada.
    expect(subidas(rede)).toHaveLength(0);
  });

  it('envia o que falta e não reenvia na passada seguinte', async () => {
    await ligar();
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [reuniao()] });

    const rede = servidor();

    expect(await sincronizar()).toEqual({ estado: 'ok', enviados: 1, apagados: 0 });
    expect(subidas(rede)).toHaveLength(1);
    // A reunião e a cópia fiel dela vão juntas, no mesmo lote.
    const lote = JSON.parse((subidas(rede)[0]![1] as RequestInit).body as string);
    expect(lote.itens.map((i: { tipo: string }) => i.tipo)).toEqual(['reuniao', 'copia']);

    // A segunda passada não tem o que fazer — é o que prova que o progresso
    // foi registrado.
    expect(await sincronizar({ forcarRestauracao: true })).toEqual({ estado: 'nada-a-fazer' });
    expect(subidas(rede)).toHaveLength(1);
  });

  it('manda a identidade do Google no cabeçalho', async () => {
    await ligar();
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [reuniao()] });
    const rede = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ gravados: 1 })));

    await sincronizar();
    const init = rede.mock.calls[0]?.[1] as RequestInit;
    const cabecalho = (init.headers as Record<string, string>).Authorization;
    // O valor exato é um JWT gerado pelo mock — o que importa afirmar é a
    // FORMA (Bearer + três partes separadas por ponto), não o literal.
    expect(cabecalho).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
  });

  it('falha no meio preserva o que já entrou', async () => {
    await ligar();
    // 60 reuniões = dois lotes. O segundo falha.
    await chrome.storage.local.set({
      [STORAGE_KEYS.history]: Array.from({ length: 60 }, (_, i) => reuniao({ id: `r${i}` })),
    });

    // Só as SUBIDAS contam: o primeiro lote passa, o segundo cai.
    let subida = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if (init?.method === 'GET') return new Response(JSON.stringify({ itens: [], proximo: 0, fim: true }));
      subida += 1;
      return subida === 1
        ? new Response(JSON.stringify({ gravados: 50 }))
        : new Response('erro', { status: 500 });
    });

    const r = await sincronizar();
    expect(r).toMatchObject({ estado: 'falhou', enviados: 50 });

    // A próxima passada manda só as dez que faltaram.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ gravados: 10 })));
    expect(await sincronizar()).toEqual({ estado: 'ok', enviados: 10, apagados: 0 });
  });

  it('401 descarta a identidade em cache, para a próxima passada pedir outra', async () => {
    await ligar();
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [reuniao()] });
    // Reinstala o mock para pegar a contagem de chamadas a partir de zero
    // (o `beforeEach` já tinha montado um, sem capturar o retorno).
    const chamadas = montarChromeComToken();

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nao', { status: 401 }));
    expect(await sincronizar()).toMatchObject({ estado: 'falhou', motivo: 'credencial recusada' });
    expect(chamadas.total).toBe(1);

    // Sem o descarte, esta segunda passada serviria a MESMA identidade do
    // cache (ainda dentro da validade) em vez de pedir outra — e repetiria a
    // mesma recusa do servidor para sempre.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ gravados: 1 })));
    await sincronizar();
    expect(chamadas.total).toBe(2);
  });

  it('servidor fora não derruba nada — vira resultado, não exceção', async () => {
    await ligar();
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [reuniao()] });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await sincronizar()).toMatchObject({
      estado: 'falhou',
      motivo: 'servidor inalcançável',
    });
  });

  it('apagar local vira apagar remoto', async () => {
    await ligar();
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [reuniao()] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ gravados: 1 })));
    await sincronizar();

    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [] });
    // No vitest 4, `spyOn` sobre um método já espionado devolve o MESMO spy, com
    // as chamadas da primeira sincronização ainda dentro. Restaurar antes deixa
    // `subidas(rede)` contar só o que esta segunda passada mandou.
    vi.restoreAllMocks();
    const rede = servidor(() => new Response(JSON.stringify({ apagados: 1 })));

    expect(await sincronizar()).toEqual({ estado: 'ok', enviados: 0, apagados: 1 });
    const corpo = JSON.parse((subidas(rede)[0]?.[1] as RequestInit).body as string);
    expect(corpo.apagados).toEqual([{ tipo: 'reuniao', id: 'r1' }]);
  });

  it('esquecer o progresso força o reenvio completo', async () => {
    await ligar();
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [reuniao()] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ gravados: 1 })));
    await sincronizar();
    expect(await sincronizar()).toEqual({ estado: 'nada-a-fazer' });

    await esquecerSincronizado();
    expect(await sincronizar()).toEqual({ estado: 'ok', enviados: 1, apagados: 0 });
  });
});

// ------------------------------------------------ histórico dos documentos

describe('histórico de versões dos documentos personalizados', () => {
  const documento = (id: string) => ({
    id,
    title: 'Proposta',
    content: 'x',
    formato: 'markdown' as const,
    createdAt: 1,
    updatedAt: 2,
    origem: 'gerado' as const,
    tipo: 'personalizado',
  });
  const arvore = (revisao: number) => ({
    revisao,
    titulo: 'Proposta',
    lacunas: [],
    blocos: [{ tipo: 'capa', blockId: 'capa', variante: 'padrao', titulo: 'Proposta', fontes: [], origem: 'agente' as const }],
  });
  const historico = (documentoId: string, revisoes: number[]) => ({
    documentoId,
    variante: 'editorial',
    fontesIds: ['m1'],
    versoes: revisoes.map((r) => ({
      revisao: r,
      arvore: arvore(r),
      criadaEm: 1000 + r,
      origem: 'edicao' as const,
      problemas: 0,
    })),
  });

  it('entra no estado desejado como "historico:<id>", só para documento que existe', async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.documents]: [documento('d1')],
      [STORAGE_KEYS.documentVersions]: [historico('d1', [1, 2]), historico('orfao', [1])],
    });
    const desejado = await montarDesejado();
    expect([...desejado.keys()].sort()).toEqual(['documento:d1', 'historico:d1']);
    const item = desejado.get('historico:d1')!.item as { id: string; versoes: { revisao: number }[] };
    expect(item.id).toBe('d1');
    expect(item.versoes.map((v) => v.revisao)).toEqual([1, 2]);
  });

  it('versão nova muda a assinatura e reenvia só o histórico', async () => {
    await ligar();
    await chrome.storage.local.set({
      [STORAGE_KEYS.documents]: [documento('d1')],
      [STORAGE_KEYS.documentVersions]: [historico('d1', [1])],
    });
    const rede = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ gravados: 2 })));
    expect(await sincronizar()).toMatchObject({ estado: 'ok', enviados: 2 });
    expect(await sincronizar()).toEqual({ estado: 'nada-a-fazer' });

    await chrome.storage.local.set({ [STORAGE_KEYS.documentVersions]: [historico('d1', [1, 2])] });
    expect(await sincronizar()).toMatchObject({ estado: 'ok', enviados: 1 });
    const corpo = JSON.parse(String((rede.mock.calls.at(-1)![1] as RequestInit).body)) as { itens: { tipo: string }[] };
    expect(corpo.itens.map((i) => i.tipo)).toEqual(['historico']);
  });

  it('apagar o documento (e o histórico) vira apagar lá', async () => {
    await ligar();
    await chrome.storage.local.set({
      [STORAGE_KEYS.documents]: [documento('d1')],
      [STORAGE_KEYS.documentVersions]: [historico('d1', [1])],
    });
    const rede = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ gravados: 2 })));
    await sincronizar();
    await chrome.storage.local.set({ [STORAGE_KEYS.documents]: [], [STORAGE_KEYS.documentVersions]: [] });
    expect(await sincronizar()).toMatchObject({ estado: 'ok', apagados: 2 });
    const corpo = JSON.parse(String((rede.mock.calls.at(-1)![1] as RequestInit).body)) as { apagados: { tipo: string; id: string }[] };
    expect(corpo.apagados.map((a) => `${a.tipo}:${a.id}`).sort()).toEqual(['documento:d1', 'historico:d1']);
  });

  it('item recusado pelo servidor por formato não trava a sincronização: registra e segue', async () => {
    await ligar();
    await chrome.storage.local.set({
      [STORAGE_KEYS.documents]: [documento('d1')],
      [STORAGE_KEYS.documentVersions]: [historico('d1', [1])],
    });
    const rede = servidor(
      () =>
        new Response(
          JSON.stringify({ gravados: 1, apagados: 0, recusados: [{ tipo: 'historico', id: 'd1', motivo: 'Histórico inválido (x).' }] }),
        ),
    );
    expect(await sincronizar()).toMatchObject({ estado: 'ok' });
    // Reenviar o mesmo item só o recusaria de novo: a passada seguinte não tenta.
    expect(await sincronizar()).toEqual({ estado: 'nada-a-fazer' });
    expect(subidas(rede)).toHaveLength(1);
  });

  it('a chave do histórico é observada: uma versão nova dispara a sincronização sozinha', async () => {
    const { CHAVES_OBSERVADAS } = await import('./sincronizacao');
    expect(CHAVES_OBSERVADAS).toContain(STORAGE_KEYS.documentVersions);
  });
});

describe('fatiar por bytes', () => {
  it('histórico grande não se junta a outros além do teto do lote', () => {
    const grande = 'x'.repeat(3 * 1024 * 1024);
    const plano = {
      enviar: [1, 2, 3].map((n) => ({
        chave: `historico:${n}`,
        tipo: 'historico' as const,
        item: { id: String(n), texto: grande },
        assinatura: String(n),
      })),
      apagar: [],
    };
    const lotes = fatiar(plano);
    // 3 MiB + 3 MiB passa de 4 MiB: um por lote.
    expect(lotes.map((l) => l.itens.length)).toEqual([1, 1, 1]);
  });

  it('itens pequenos vão em lotes de 100 itens no fio (o teto do servidor)', () => {
    const plano = {
      enviar: Array.from({ length: 120 }, (_, n) => ({
        chave: `nota:${n}`,
        tipo: 'nota' as const,
        item: { id: String(n) },
        assinatura: String(n),
      })),
      apagar: [],
    };
    expect(fatiar(plano).map((l) => l.itens.length)).toEqual([100, 20]);
  });

  it('cada item e a sua cópia fiel andam sempre no mesmo lote', () => {
    const plano = {
      enviar: Array.from({ length: 75 }, (_, n) => ({
        chave: `reuniao:${n}`,
        tipo: 'reuniao' as const,
        item: { id: String(n) },
        copia: { colecao: 'reuniao' as const, id: String(n), corpo: { id: String(n) } },
        assinatura: String(n),
      })),
      apagar: [],
    };
    const lotes = fatiar(plano);
    // 75 reuniões = 150 itens no fio: cabem 50 reuniões (100 itens) por lote.
    expect(lotes.map((l) => l.itens.length)).toEqual([100, 50]);
    for (const l of lotes) {
      const tipos = l.itens.map((i) => i.tipo);
      expect(tipos.filter((t) => t === 'reuniao')).toHaveLength(tipos.filter((t) => t === 'copia').length);
    }
  });
});


// --------------------------------------------------------- o alarme

describe('a atualização automática (alarme)', () => {
  /** O `chrome` do background: storage + runtime + alarms, com os listeners capturáveis. */
  function montarBackground(opcoes: { alarmeJaExiste?: boolean; semAlarms?: boolean } = {}) {
    const alarmes = {
      create: vi.fn(),
      get: vi.fn(async () => (opcoes.alarmeJaExiste ? { name: NOME_DO_ALARME } : undefined)),
      onAlarm: { addListener: vi.fn() },
    };
    const g = globalThis as unknown as { chrome: Record<string, unknown> };
    g.chrome = {
      ...g.chrome,
      runtime: {
        lastError: undefined,
        onStartup: { addListener: vi.fn() },
        onInstalled: { addListener: vi.fn() },
      },
      ...(opcoes.semAlarms ? {} : { alarms: alarmes }),
    };
    return alarmes;
  }

  it('cria um alarme periódico de 5 minutos, uma vez', async () => {
    const alarmes = montarBackground();
    ligarSincronizacaoAutomatica();
    await vi.waitFor(() => expect(alarmes.create).toHaveBeenCalledTimes(1));
    expect(alarmes.create).toHaveBeenCalledWith(NOME_DO_ALARME, {
      periodInMinutes: PERIODO_DO_ALARME_MIN,
      delayInMinutes: PERIODO_DO_ALARME_MIN,
    });
    expect(PERIODO_DO_ALARME_MIN).toBe(5);
  });

  it('não recria um alarme que já existe: acordar o worker não reinicia a contagem', async () => {
    const alarmes = montarBackground({ alarmeJaExiste: true });
    ligarSincronizacaoAutomatica();
    await vi.waitFor(() => expect(alarmes.get).toHaveBeenCalled());
    await Promise.resolve();
    expect(alarmes.create).not.toHaveBeenCalled();
  });

  it('o alarme dispara uma passada que PERGUNTA ao servidor, mesmo sem nada local para enviar', async () => {
    await ligar();
    const alarmes = montarBackground();
    const rede = servidor();
    ligarSincronizacaoAutomatica();

    const aoDisparar = alarmes.onAlarm.addListener.mock.calls[0]![0] as (a: { name: string }) => void;
    aoDisparar({ name: NOME_DO_ALARME });
    await vi.waitFor(() => expect(rede.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'GET')).toBe(true));
  });

  it('ignora alarmes de outros nomes', async () => {
    await ligar();
    const alarmes = montarBackground();
    const rede = servidor();
    ligarSincronizacaoAutomatica();
    const aoDisparar = alarmes.onAlarm.addListener.mock.calls[0]![0] as (a: { name: string }) => void;
    aoDisparar({ name: 'outro-alarme-qualquer' });
    await new Promise((r) => setTimeout(r, 30));
    expect(rede).not.toHaveBeenCalled();
  });

  it('sem a API de alarmes, os outros gatilhos continuam funcionando', () => {
    montarBackground({ semAlarms: true });
    expect(() => ligarSincronizacaoAutomatica()).not.toThrow();
    const c = (globalThis as unknown as { chrome: { runtime: { onStartup: { addListener: ReturnType<typeof vi.fn> } } } }).chrome;
    expect(c.runtime.onStartup.addListener).toHaveBeenCalled();
  });

  it('abrir o navegador e instalar também perguntam ao servidor', async () => {
    await ligar();
    montarBackground();
    const rede = servidor();
    ligarSincronizacaoAutomatica();
    const c = (globalThis as unknown as { chrome: { runtime: { onStartup: { addListener: ReturnType<typeof vi.fn> } } } }).chrome;
    (c.runtime.onStartup.addListener.mock.calls[0]![0] as () => void)();
    await vi.waitFor(() => expect(rede.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'GET')).toBe(true));
  });
});

describe('o manifesto', () => {
  it('declara a permissão de alarmes, sem tirar as outras', async () => {
    // Lido como texto: `manifest.config` usa o plugin do @crxjs, que não carrega em jsdom.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const fonte = readFileSync(join(process.cwd(), 'manifest.config.ts'), 'utf8');
    const linha = /permissions:\s*\[([^\]]*)\]/.exec(fonte)?.[1] ?? '';
    for (const p of ['storage', 'sidePanel', 'scripting', 'identity', 'alarms']) {
      expect(linha).toContain(`'${p}'`);
    }
  });
});

describe('resumoDaCota (o que a tela Conexões mostra)', () => {
  it('lê o uso e quantos itens esperam espaço', () => {
    expect(resumoDaCota({ assinaturas: {}, uso: { bytes: 5, cota: 100, em: 1 }, recusadosPorCota: 2 })).toEqual({
      usoBytes: 5,
      cotaBytes: 100,
      seguradosPorCota: 2,
    });
  });
  it('sem recusas o contador é zero', () => {
    expect(resumoDaCota({ assinaturas: {}, uso: { bytes: 5, cota: 100, em: 1 } })?.seguradosPorCota).toBe(0);
  });
  it.each([[null], [undefined], ['x'], [{}], [{ uso: { bytes: 'a', cota: 1 } }], [{ uso: { bytes: 1, cota: 0 } }]])(
    'não inventa número quando o servidor ainda não disse nada (%j)',
    (bruto) => {
      expect(resumoDaCota(bruto)).toBeNull();
    },
  );
});

describe('situacaoDoSync (a falha deixa de morrer no log)', () => {
  const situacaoAgora = async () =>
    situacaoDoSync((await chrome.storage.local.get(STORAGE_KEYS.syncEstado))[STORAGE_KEYS.syncEstado]);

  it('passada que deu certo registra quando, e sem falha', async () => {
    await ligar();
    servidor();
    await sincronizar();
    const s = await situacaoAgora();
    expect(s.falha).toBeNull();
    expect(s.ultimoSucessoEm).toEqual(expect.any(Number));
  });

  it('servidor fora fica registrado como falha de rede, e o último sucesso continua', async () => {
    await ligar();
    servidor();
    await sincronizar();
    const antes = (await situacaoAgora()).ultimoSucessoEm;

    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [reuniao()] });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await sincronizar();
    const s = await situacaoAgora();
    expect(s.falha?.tipo).toBe('rede');
    expect(s.ultimoSucessoEm).toBe(antes);
  });

  it('sessão do Google vencida fica registrada como falha de sessão', async () => {
    await ligar();
    montarChromeComToken(null);
    await sincronizar();
    expect((await situacaoAgora()).falha?.tipo).toBe('sessao');
  });

  it('desligar apaga a falha: quem desligou de propósito não vê "parou"', async () => {
    await ligar();
    montarChromeComToken(null);
    await sincronizar();
    await chrome.storage.local.set({ [STORAGE_KEYS.sync]: { ligada: false } });
    await sincronizar();
    expect((await situacaoAgora()).falha).toBeNull();
  });
});