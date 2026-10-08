/**
 * "Gerar com o padrão CITi": o pedido em linguagem natural vira um documento
 * personalizado, com a reunião aberta como única fonte. O servidor é simulado
 * (`gerarPersonalizado`); o storage e a tela são os de verdade.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import type { MeetingRecord } from '@/shared/types/domain';
import { lerDocumentos } from '@/features/documents/store';
import { lerHistorico } from '@/features/documents/personalizado/versoes';
import type * as Cliente from '@/features/documents/personalizado/cliente';
import type { ResultadoDoServidor } from '@/features/documents/personalizado/tipos';
import type * as Baixar from '@/document/baixarDocumento';

const gerarPersonalizado = vi.hoisted(() => vi.fn());
vi.mock('@/features/documents/personalizado/cliente', async (original) => ({
  ...(await original<typeof Cliente>()),
  gerarPersonalizado,
}));
const baixarComoPdf = vi.hoisted(() => vi.fn());
vi.mock('@/document/baixarDocumento', async (original) => ({
  ...(await original<typeof Baixar>()),
  baixarComoPdf,
}));
const { GerarDocumento } = await import('./GerarDocumento');

const REGISTRO: MeetingRecord = {
  id: 'm-aurora',
  title: 'Aurora — diagnóstico',
  startedAt: 1,
  endedAt: 2,
  durationSeconds: 60,
  participants: [],
  segments: [
    { id: 's1', speaker: 'Ana', text: 'O gargalo está na integração.', startOffsetMs: 0, endOffsetMs: 1000 },
  ] as unknown as MeetingRecord['segments'],
  status: 'ready',
  metadata: { capturedCaptions: true, droppedSegments: 0, reconnectCount: 0, wasDiscardedAndRestarted: false },
};

const resultado = (extra: Partial<ResultadoDoServidor> = {}): ResultadoDoServidor => ({
  arvore: {
    revisao: 1,
    titulo: 'Proposta Aurora',
    lacunas: [],
    blocos: [
      { tipo: 'capa', blockId: 'capa', variante: 'padrao', titulo: 'Proposta Aurora', fontes: [], origem: 'agente' },
      { tipo: 'paragrafo', blockId: 'p1', texto: 'O gargalo é a integração.', fontes: [], origem: 'agente' },
    ],
  },
  pdf: 'JVBERg==',
  manifesto: {
    revisaoDoConteudo: 1,
    perfilId: 'citi',
    perfilVersao: 2,
    perfilEstado: 'provisorio',
    rendererVersao: 'x',
    ativosEFontes: [],
    formatos: [{ formato: 'pdf', hash: 'a'.repeat(64) }],
    paginas: 2,
  },
  relatorio: { problemas: [], verificacoesRealizadas: ['x'], limitacoes: [] },
  avisos: [],
  lacunas: [],
  ...extra,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  installChromeStorageMock();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  gerarPersonalizado.mockReset();
  baixarComoPdf.mockReset();
  vi.unstubAllGlobals();
});

async function abrirEPedir(pedido: string) {
  await act(async () =>
    root.render(<GerarDocumento registro={REGISTRO} onAbrirDocumento={() => {}} onPedirLivre={() => {}} />),
  );
  await act(async () => host.querySelector<HTMLButtonElement>('.tq-acao')!.click());
  const campo = host.querySelector<HTMLInputElement>('input[aria-label="Descreva o documento"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(campo, pedido);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const botaoPersonalizado = () =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('padrão CITi'))!;

async function esperar(texto: string) {
  for (let i = 0; i < 80 && !host.textContent!.includes(texto); i += 1) {
    await act(async () => new Promise((r) => setTimeout(r, 10)));
  }
}

it('o botão só vale com um pedido escrito', async () => {
  await abrirEPedir('');
  expect(botaoPersonalizado().disabled).toBe(true);
});

it('gera, salva o documento com o histórico, e só então diz "Salvo"', async () => {
  gerarPersonalizado.mockResolvedValue({
    status: 'ok',
    dados: resultado({
      lacunas: [{ campo: 'Prazo', pergunta: 'Qual é o prazo do piloto?' }],
      relatorio: {
        problemas: [{ tipo: 'sustentacao', descricao: 'removida' }],
        verificacoesRealizadas: ['x'],
        limitacoes: [],
      },
    }),
  });
  await abrirEPedir('Monte uma proposta para a Aurora.');
  await act(async () => botaoPersonalizado().click());
  await esperar('Salvo em Documentos');

  // A reunião aberta é a ÚNICA fonte, e a capa não inventa cliente nem autor.
  const [pedido] = gerarPersonalizado.mock.calls[0]!;
  expect(pedido.pedido).toBe('Monte uma proposta para a Aurora.');
  expect(pedido.fontes).toHaveLength(1);
  expect(pedido.fontes[0]).toMatchObject({ id: 'm-aurora', titulo: 'Aurora — diagnóstico' });
  expect(pedido.fontes[0].texto).toContain('O gargalo está na integração.');
  expect(pedido.capa.cliente).toBeUndefined();
  expect(pedido.capa.autor).toBeUndefined();
  expect(pedido.variante).toBe('editorial');

  expect(host.textContent).toContain('Uma afirmação foi removida por não estarem sustentadas');
  expect(host.textContent).toContain('Falta saber: Qual é o prazo do piloto?');

  const [doc] = await lerDocumentos();
  expect(doc).toMatchObject({ title: 'Proposta Aurora', tipo: 'personalizado', meetingId: 'm-aurora' });
  expect((await lerHistorico(doc!.id))!.versoes).toHaveLength(1);
});

it('baixa o PDF que o servidor devolveu', async () => {
  gerarPersonalizado.mockResolvedValue({ status: 'ok', dados: resultado() });
  await abrirEPedir('Monte um relatório.');
  await act(async () => botaoPersonalizado().click());
  await esperar('Salvo em Documentos');
  const baixar = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Baixar PDF'))!;
  await act(async () => baixar.click());
  expect(baixarComoPdf).toHaveBeenCalledWith('JVBERg==', expect.stringContaining('Documento'));
});

it('erro do servidor aparece com a causa, e nada é salvo', async () => {
  gerarPersonalizado.mockResolvedValue({
    status: 'erro',
    codigo: 'sem_conteudo',
    message: 'Nenhum trecho do documento ficou sustentado pelas fontes selecionadas.',
  });
  await abrirEPedir('Monte algo.');
  await act(async () => botaoPersonalizado().click());
  await esperar('sustentado');
  expect(host.textContent).toContain('Nenhum trecho do documento ficou sustentado');
  expect(host.textContent).not.toContain('Salvo em Documentos');
  expect(await lerDocumentos()).toEqual([]);
});

it('se a gravação falha, o PDF não se perde: dá para baixar, e não diz "Salvo"', async () => {
  gerarPersonalizado.mockResolvedValue({ status: 'ok', dados: resultado() });
  const guardar = await import('@/features/documents/personalizado/documento');
  const espiao = vi.spyOn(guardar, 'guardarGeracao').mockRejectedValue(new Error('cota'));
  await abrirEPedir('Monte um relatório.');
  await act(async () => botaoPersonalizado().click());
  await esperar('não foi possível salvá-lo');
  expect(host.textContent).not.toContain('Salvo em Documentos');
  const baixar = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Baixar PDF'))!;
  await act(async () => baixar.click());
  expect(baixarComoPdf).toHaveBeenCalled();
  espiao.mockRestore();
});

it('os achados de layout do servidor aparecem junto dos avisos', async () => {
  gerarPersonalizado.mockResolvedValue({
    status: 'ok',
    dados: resultado({
      relatorio: {
        problemas: [{ tipo: 'visual', pagina: 3, descricao: 'A página 3 está quase vazia (4% ocupada) e não é a última.' }],
        verificacoesRealizadas: ['x'],
        limitacoes: [],
      },
    }),
  });
  await abrirEPedir('Monte um relatório.');
  await act(async () => botaoPersonalizado().click());
  await esperar('Salvo em Documentos');
  expect(host.textContent).toContain('A página 3 está quase vazia');
});
