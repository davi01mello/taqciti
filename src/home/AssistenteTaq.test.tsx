/**
 * O Taq na HOME, de ponta a ponta na árvore: o servidor é simulado no `fetch`
 * (estado e turnos roteirizados), e todo o resto — a tela, o runtime, as
 * ferramentas, o storage — é o código de produção.
 *
 * O que estes casos protegem é a honestidade da tela: resposta só aparece
 * quando o servidor respondeu; falha aparece como falha; configuração pendente
 * aparece antes de a pessoa escrever; e a fonte citada ABRE a origem.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import type { MeetingRecord } from '@/shared/types/domain';
import type { Conversation } from './conversations';

class ResizeObserverMock implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const SPRINT: MeetingRecord = {
  id: 'm-sprint',
  title: 'Planejamento da Sprint 12',
  startedAt: Date.UTC(2026, 8, 18, 13),
  endedAt: Date.UTC(2026, 8, 18, 14),
  durationSeconds: 3600,
  participants: [{ name: 'Ana', isHost: null }],
  segments: [
    {
      captionId: 'c0',
      speaker: 'Ana',
      text: 'Decidido: o deploy fica na sexta.',
      startOffsetMs: 65_000,
      endOffsetMs: 70_000,
    },
  ],
  status: 'ready',
  metadata: {
    capturedCaptions: true,
    droppedSegments: 0,
    reconnectCount: 0,
    wasDiscardedAndRestarted: false,
  },
};

const PRONTO = {
  pronto: true,
  provedor: 'google',
  modelo: 'gemini-3.5-flash',
  instrucoesVersao: 'taq-v1',
  politicaDeDados: 'private',
  pendencias: [],
};

function turno(extra: Record<string, unknown>) {
  return {
    tipo: 'final',
    texto: '',
    chamadas: [],
    uso: { entrada: 10, saida: 5 },
    provedor: 'google',
    modelo: 'gemini-3.5-flash',
    instrucoesVersao: 'taq-v1',
    latenciaMs: 1,
    ...extra,
  };
}

let host: HTMLDivElement;
let root: Root;
let storage: ReturnType<typeof installChromeStorageMock>;
let turnosPedidos: unknown[];

function servidor(
  estado: unknown,
  respostas: Array<{ status?: number; corpo: unknown }>,
) {
  turnosPedidos = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/taq/estado'))
        return new Response(JSON.stringify(estado), { status: 200 });
      turnosPedidos.push(JSON.parse(String(init?.body)));
      const r = respostas.shift() ?? { status: 500, corpo: {} };
      return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200 });
    }),
  );
}

async function montar() {
  storage = installChromeStorageMock({
    local: { [STORAGE_KEYS.history]: [SPRINT] },
    extra: {
      runtime: {
        getURL: (p: string) => `chrome-extension://taqciti/${p}`,
        sendMessage: vi.fn(async () => ({ phase: 'idle', session: null })),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    },
  });
  const { PlatformProvider } = await import('@/shared/platform/context');
  const { extensionPlatform } = await import('@/shared/platform/extension');
  const { HomePage } = await import('./HomePage');
  await act(async () => {
    root.render(
      <PlatformProvider platform={extensionPlatform}>
        <HomePage />
      </PlatformProvider>,
    );
  });
}

const q = <T extends Element>(sel: string): T => {
  const el = host.querySelector<T>(sel);
  if (!el) throw new Error(`não achei ${sel}`);
  return el;
};

async function ate(condicao: () => boolean) {
  for (let i = 0; i < 100 && !condicao(); i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  expect(condicao()).toBe(true);
}

async function enviar(texto: string) {
  await act(async () => {
    const campo = q<HTMLTextAreaElement>('.tq-campo textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      campo,
      texto,
    );
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    q<HTMLFormElement>('.tq-escrita').requestSubmit();
  });
}

const conversas = () =>
  storage.local.values[STORAGE_KEYS.conversations] as Conversation[];

beforeEach(() => {
  vi.resetModules();
  globalThis.ResizeObserver = ResizeObserverMock;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal('scrollTo', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, '', '/');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('responde com fonte, grava a resposta, e a fonte abre a reunião', async () => {
  servidor(PRONTO, [
    {
      corpo: turno({
        tipo: 'ferramentas',
        chamadas: [
          { id: 'a', nome: 'search_records', argumentos: { consulta: 'deploy' } },
        ],
      }),
    },
    { corpo: turno({ texto: 'O deploy ficou na sexta [r1].' }) },
  ]);
  await montar();
  await ate(() => host.textContent!.includes('IA conectada'));

  await enviar('Quando ficou o deploy?');
  await ate(() => host.textContent!.includes('O deploy ficou na sexta'));

  // O que foi ao servidor: as declarações de LEITURA (a pergunta não pede escrita).
  const primeiro = turnosPedidos[0] as { ferramentas: Array<{ nome: string }> };
  // Documento e operação no app são dos especialistas: o Taq só vê como delegar.
  expect(primeiro.ferramentas.map((f) => f.nome)).toEqual([
    'search_records',
    'read_meeting',
    'read_document',
    'read_conversation',
    'ask_user',
    'delegate_task',
    // A referência de ajuda: o Taq não explica o app de memória nem quando a delegação falha.
    'get_app_capabilities',
    'get_usage_guide',
  ]);

  const resposta = conversas()[0]!.messages.at(-1)!;
  expect(resposta).toMatchObject({ role: 'assistant', desfecho: 'concluido' });
  expect(resposta.fontes).toEqual([
    expect.objectContaining({ ref: 'r1', registroId: 'm-sprint', offsetMs: 65_000 }),
  ]);

  expect(q('.tq-resp-fontes summary').textContent).toContain('Fontes (1)');
  expect(q('.tq-resp-origem').textContent).toContain('Planejamento da Sprint 12 · 1:05');
  await act(async () => {
    q<HTMLButtonElement>('.tq-resp-fontes li button').click();
  });
  await ate(() => host.querySelector('.tq-main-reuniao') !== null);
});

it('configuração pendente aparece ANTES de escrever, e a mensagem só é salva', async () => {
  servidor({ ...PRONTO, politicaDeDados: 'training' }, []);
  await montar();
  await ate(() => host.textContent!.includes('configuração pendente'));
  expect(host.textContent).toContain('treinar o provedor');

  await enviar('Uma pergunta qualquer');
  await ate(() => conversas()?.[0]?.messages.length === 1);
  expect(turnosPedidos).toEqual([]);
  expect(host.textContent).toContain('O assistente não respondeu porque');
});

it('falha do provedor aparece como falha, sem resposta gravada', async () => {
  servidor(PRONTO, [
    {
      status: 502,
      corpo: { erro: { codigo: 'falha_do_provedor', mensagem: 'x', transitorio: false } },
    },
  ]);
  await montar();
  await ate(() => host.textContent!.includes('IA conectada'));

  await enviar('Oi');
  await ate(() => host.textContent!.includes('Falha de execução'));
  expect(conversas()[0]!.messages.map((m) => m.role)).toEqual(['user']);
  // O registro da execução guarda a falha — sem a pergunta.
  const [execucao] = storage.local.values[STORAGE_KEYS.taqExecucoes] as Array<{
    estado: string;
    erros: unknown[];
  }>;
  expect(execucao).toMatchObject({
    estado: 'falhou',
    erros: [{ codigo: 'falha_do_provedor' }],
  });
  expect(JSON.stringify(execucao)).not.toContain('Oi');
});

it('pergunta o tipo com opções do catálogo, sem ir ao servidor, e o clique continua o pedido', async () => {
  servidor(PRONTO, [{ corpo: turno({ texto: 'Vou montar a ata.' }) }]);
  await montar();
  await ate(() => host.textContent!.includes('IA conectada'));

  await enviar('Crie um documento da reunião da sprint');
  await ate(() => host.querySelectorAll('.tq-resp-opcoes button').length === 2);
  // Documento sem tipo não gasta chamada ao modelo: a pergunta sai do catálogo.
  expect(turnosPedidos).toEqual([]);
  const opcoes = [...host.querySelectorAll<HTMLButtonElement>('.tq-resp-opcoes button')];
  expect(opcoes.map((b) => b.querySelector('strong')!.textContent)).toEqual([
    'Ata de Reunião',
    'Doc Conversa (X1)',
  ]);

  await act(async () => opcoes[0]!.click());
  await ate(() => host.textContent!.includes('Vou montar a ata.'));
  // O clique virou a mensagem da pessoa, e a resposta dela liberou a escrita.
  expect(conversas()[0]!.messages.map((m) => m.text)).toContain('Criar Ata de Reunião');
  const segundo = turnosPedidos[0] as { ferramentas: Array<{ nome: string }> };
  expect(segundo.ferramentas.map((f) => f.nome)).toContain('delegate_task');
  // A resposta "Criar Ata de Reunião" continua o pedido: escrita liberada para o especialista.
  expect(JSON.stringify(segundo)).toMatch(/create_document e update_document estão disponíveis/);
});
