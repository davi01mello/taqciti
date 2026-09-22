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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import type { MeetingRecord } from '@/shared/types/domain';
import {
  assinar,
  esquecerSincronizado,
  fatiar,
  montarDesejado,
  planejar,
  sincronizar,
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

/** Liga o "sim" e finge um token válido. */
function montarChromeComToken(token: string | null = 'tok') {
  const g = globalThis as unknown as { chrome: Record<string, unknown> };
  g.chrome = {
    ...(g.chrome ?? {}),
    runtime: {
      ...((g.chrome?.runtime as object) ?? {}),
      getManifest: () => ({ oauth2: { client_id: '1.apps.googleusercontent.com' } }),
      lastError: undefined,
    },
    identity: {
      getAuthToken: (_d: unknown, cb: (t?: string) => void) => cb(token ?? undefined),
      removeCachedAuthToken: (_d: unknown, cb: () => void) => cb(),
    },
  };
}

async function ligar() {
  await chrome.storage.local.set({ [STORAGE_KEYS.sync]: { ligada: true } });
}

beforeEach(() => {
  installChromeStorageMock();
  montarChromeComToken();
  vi.restoreAllMocks();
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

  it('junta as quatro coleções com id composto', async () => {
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
    const texto = JSON.stringify(r);
    expect(texto).not.toContain('tile-xyz');
    expect(texto).not.toContain('matchedParticipant');
    expect(r.item).toMatchObject({ participantes: ['Ana'] });
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
    const assinaturas = { 'reuniao:r1': assinar(desejado.get('reuniao:r1')!.item) };
    expect(planejar(desejado, assinaturas).enviar).toHaveLength(0);
  });

  it('o que mudou PARA TRÁS também vai', async () => {
    // Renomear uma reunião antiga não mexe em data nenhuma. É o caso que um
    // "sincronizei até tal momento" perderia calado.
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [reuniao()] });
    const antes = await montarDesejado();
    const assinaturas = { 'reuniao:r1': assinar(antes.get('reuniao:r1')!.item) };

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
    const rede = vi.spyOn(globalThis, 'fetch');
    expect(await sincronizar()).toEqual({ estado: 'nada-a-fazer' });
    expect(rede).not.toHaveBeenCalled();
  });

  it('envia o que falta e não reenvia na passada seguinte', async () => {
    await ligar();
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [reuniao()] });

    const rede = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ gravados: 1, apagados: 0 })));

    expect(await sincronizar()).toEqual({ estado: 'ok', enviados: 1, apagados: 0 });
    expect(rede).toHaveBeenCalledTimes(1);

    // A segunda passada não tem o que fazer — é o que prova que o progresso
    // foi registrado.
    expect(await sincronizar()).toEqual({ estado: 'nada-a-fazer' });
    expect(rede).toHaveBeenCalledTimes(1);
  });

  it('manda o token do Google no cabeçalho', async () => {
    await ligar();
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [reuniao()] });
    const rede = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ gravados: 1 })));

    await sincronizar();
    const init = rede.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('falha no meio preserva o que já entrou', async () => {
    await ligar();
    // 60 reuniões = dois lotes. O segundo falha.
    await chrome.storage.local.set({
      [STORAGE_KEYS.history]: Array.from({ length: 60 }, (_, i) => reuniao({ id: `r${i}` })),
    });

    let chamada = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      chamada += 1;
      return chamada === 1
        ? new Response(JSON.stringify({ gravados: 50 }))
        : new Response('erro', { status: 500 });
    });

    const r = await sincronizar();
    expect(r).toMatchObject({ estado: 'falhou', enviados: 50 });

    // A próxima passada manda só as dez que faltaram.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ gravados: 10 })));
    expect(await sincronizar()).toEqual({ estado: 'ok', enviados: 10, apagados: 0 });
  });

  it('401 descarta o token em cache, para a próxima passada pegar outro', async () => {
    await ligar();
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [reuniao()] });

    let descartou = false;
    const g = globalThis as unknown as { chrome: { identity: Record<string, unknown> } };
    g.chrome.identity.removeCachedAuthToken = (_d: unknown, cb: () => void) => {
      descartou = true;
      cb();
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nao', { status: 401 }));
    expect(await sincronizar()).toMatchObject({ estado: 'falhou', motivo: 'credencial recusada' });
    expect(descartou).toBe(true);
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
    const rede = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ apagados: 1 })));

    expect(await sincronizar()).toEqual({ estado: 'ok', enviados: 0, apagados: 1 });
    const corpo = JSON.parse((rede.mock.calls[0]?.[1] as RequestInit).body as string);
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
