/**
 * O painel do documento personalizado — servidor simulado, storage e tela de
 * verdade. Segura: a prévia é o PDF renderizado, a alteração leva o escopo e a
 * revisão certos, conflito e recusa aparecem ditos, e voltar a uma versão cria
 * uma versão nova.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import type { MeetingRecord } from '@/shared/types/domain';
import { lerDocumentos, type DocumentoGuardado } from '@/features/documents/store';
import { guardarGeracao } from '@/features/documents/personalizado/documento';
import { lerHistorico } from '@/features/documents/personalizado/versoes';
import type * as Cliente from '@/features/documents/personalizado/cliente';
import type { ArvoreDoDocumento, ResultadoDoServidor } from '@/features/documents/personalizado/tipos';

const renderizarArvore = vi.hoisted(() => vi.fn());
const editarPersonalizado = vi.hoisted(() => vi.fn());
vi.mock('@/features/documents/personalizado/cliente', async (original) => ({
  ...(await original<typeof Cliente>()),
  renderizarArvore,
  editarPersonalizado,
}));
const { DocumentoPersonalizado } = await import('./DocumentoPersonalizado');

const REUNIAO: MeetingRecord = {
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

const arvore = (revisao: number, titulo = 'Proposta Aurora'): ArvoreDoDocumento => ({
  revisao,
  titulo,
  lacunas: [],
  blocos: [
    { tipo: 'capa', blockId: 'capa', variante: 'padrao', titulo, fontes: [], origem: 'agente' },
    { tipo: 'titulo', blockId: 's1-titulo', nivel: 1, texto: 'Diagnóstico', fontes: [], origem: 'agente' },
    { tipo: 'paragrafo', blockId: 's1-b1', texto: 'O gargalo é a integração.', fontes: [], origem: 'agente' },
  ],
});

const resultado = (revisao: number, extra: Partial<ResultadoDoServidor> = {}): ResultadoDoServidor => ({
  arvore: arvore(revisao),
  pdf: 'JVBERg==',
  manifesto: {
    revisaoDoConteudo: revisao,
    perfilId: 'citi',
    perfilVersao: 2,
    perfilEstado: 'provisorio',
    rendererVersao: 'x',
    ativosEFontes: [],
    formatos: [{ formato: 'pdf', hash: 'a'.repeat(64) }],
    paginas: 3,
  },
  relatorio: { problemas: [], verificacoesRealizadas: ['x'], limitacoes: [] },
  avisos: [],
  lacunas: [],
  ...extra,
});

let host: HTMLDivElement;
let root: Root;
let documento: DocumentoGuardado;
const onVoltar = vi.fn();

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  installChromeStorageMock();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:previa'), revokeObjectURL: vi.fn() }));
  renderizarArvore.mockResolvedValue({
    status: 'ok',
    dados: { pdf: 'JVBERg==', manifesto: resultado(1).manifesto, avisos: [], substituicoes: [] },
  });
  const criado = await guardarGeracao(
    resultado(1),
    { pedido: 'Monte uma proposta.', fontes: [{ id: 'm-aurora', titulo: 'x', texto: 'x' }], variante: 'editorial' },
    { meetingId: 'm-aurora' },
  );
  documento = criado.documento;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  renderizarArvore.mockReset();
  editarPersonalizado.mockReset();
  onVoltar.mockReset();
  vi.unstubAllGlobals();
});

async function abrir(registros: MeetingRecord[] = [REUNIAO]) {
  await act(async () =>
    root.render(
      <DocumentoPersonalizado documento={documento} registros={registros} onVoltar={onVoltar} onIrParaReuniao={() => {}} />,
    ),
  );
  await esperar('Versões');
}

async function esperar(texto: string) {
  for (let i = 0; i < 80 && !host.textContent!.includes(texto); i += 1) {
    await act(async () => new Promise((r) => setTimeout(r, 10)));
  }
}

const botao = (rotulo: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === rotulo)!;

async function pedir(texto: string) {
  const campo = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Pedido de alteração"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(campo, texto);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function escolherEscopo(valor: string) {
  const select = host.querySelector<HTMLSelectElement>('select')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, valor);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

it('mostra o PDF renderizado da revisão atual, a contagem de páginas e o aviso de perfil provisório', async () => {
  await abrir();
  await esperar('3 página(s)');
  expect(renderizarArvore).toHaveBeenCalledWith(expect.objectContaining({ revisao: 1 }), 'editorial');
  expect(host.querySelector('iframe')!.getAttribute('src')).toBe('blob:previa');
  expect(host.textContent).toContain('padrão CITi provisório');
  expect(host.textContent).toContain('Revisão 1');
});

it('o escopo oferece a capa e as seções', async () => {
  await abrir();
  const opcoes = [...host.querySelectorAll('select option')].map((o) => o.textContent);
  expect(opcoes).toEqual(['Documento todo', 'Capa', 'Seção: Diagnóstico']);
});

it('pede alteração só na capa: leva o escopo, a revisão lida e as fontes; aplica e sobe a revisão', async () => {
  editarPersonalizado.mockResolvedValue({
    status: 'ok',
    dados: { ...resultado(2, { aplicadas: 1, recusadas: [], observacao: undefined }), arvore: arvore(2, 'Título novo') },
  });
  await abrir();
  await escolherEscopo('capa');
  await pedir('Troque o título da capa.');
  await act(async () => botao('Pedir alteração').click());
  await esperar('Alteração aplicada');

  const [pedido] = editarPersonalizado.mock.calls[0]!;
  expect(pedido).toMatchObject({ revisaoEsperada: 1, escopo: ['capa'], variante: 'editorial', pedido: 'Troque o título da capa.' });
  expect(pedido.fontes[0]).toMatchObject({ id: 'm-aurora' });
  expect(pedido.fontes[0].texto).toContain('O gargalo está na integração.');

  const historico = (await lerHistorico(documento.id))!;
  expect(historico.versoes.map((v) => v.revisao)).toEqual([1, 2]);
  expect((await lerDocumentos())[0]).toMatchObject({ title: 'Título novo' });
  expect(host.textContent).toContain('Revisão 2');
});

it('o que o servidor recusou ou removeu aparece dito, e sem mudança não cria versão', async () => {
  editarPersonalizado.mockResolvedValue({
    status: 'ok',
    dados: resultado(1, {
      aplicadas: 0,
      recusadas: ['remover s1-b1: fora do escopo selecionado.'],
      relatorio: {
        problemas: [{ tipo: 'sustentacao', descricao: 'Afirmação sem sustentação nas fontes selecionadas foi removida: "R$ 2 milhões"' }],
        verificacoesRealizadas: ['x'],
        limitacoes: [],
      },
      lacunas: [{ campo: 'Custo', pergunta: 'Qual é o custo total?' }],
    }),
  });
  await abrir();
  await pedir('Inclua o custo total.');
  await act(async () => botao('Pedir alteração').click());
  await esperar('Nada foi alterado');
  expect(host.textContent).toContain('Não apliquei: remover s1-b1: fora do escopo selecionado.');
  expect(host.textContent).toContain('sem sustentação');
  expect(host.textContent).toContain('Falta saber: Qual é o custo total?');
  expect((await lerHistorico(documento.id))!.versoes).toHaveLength(1);
});

it('conflito do servidor (409) vira mensagem, e nada é gravado', async () => {
  editarPersonalizado.mockResolvedValue({ status: 'erro', codigo: 'conflito', message: 'O documento mudou desde que você o abriu.' });
  await abrir();
  await pedir('Mude algo.');
  await act(async () => botao('Pedir alteração').click());
  await esperar('O documento mudou');
  expect((await lerHistorico(documento.id))!.versoes).toHaveLength(1);
});

it('reunião de origem ausente: avisa que conteúdo novo não será sustentado, mas ainda deixa pedir', async () => {
  await abrir([]);
  expect(host.textContent).toContain('não está mais neste computador');
  expect(botao('Pedir alteração')).toBeDefined();
});

it('ver uma revisão antiga trava a alteração; restaurar cria uma revisão nova', async () => {
  editarPersonalizado.mockResolvedValue({
    status: 'ok',
    dados: { ...resultado(2, { aplicadas: 1 }), arvore: arvore(2, 'Título novo') },
  });
  await abrir();
  await pedir('Mude o título.');
  await act(async () => botao('Pedir alteração').click());
  await esperar('Alteração aplicada');

  // Vê a revisão 1 (a antiga).
  const ver = [...host.querySelectorAll<HTMLButtonElement>('.tq-personalizado-historico li')]
    .find((li) => li.textContent!.includes('Revisão 1'))!
    .querySelector('button')!;
  await act(async () => ver.click());
  expect(host.textContent).toContain('Você está vendo a revisão 1, que não é a atual');
  expect(botao('Pedir alteração').disabled).toBe(true);

  await act(async () => botao('Restaurar esta').click());
  await esperar('restaurada como revisão 3');
  const historico = (await lerHistorico(documento.id))!;
  expect(historico.versoes.map((v) => [v.revisao, v.origem])).toEqual([
    [1, 'geracao'],
    [2, 'edicao'],
    [3, 'restauracao'],
  ]);
  expect((await lerDocumentos())[0]).toMatchObject({ title: 'Proposta Aurora' });
});

it('falha ao montar a prévia mostra a causa e permite tentar de novo', async () => {
  renderizarArvore.mockResolvedValueOnce({ status: 'erro', codigo: 'indisponivel', message: 'O servidor respondeu com erro (502).' });
  await abrir();
  await esperar('erro (502)');
  await act(async () => botao('Tentar de novo').click());
  await esperar('3 página(s)');
  expect(renderizarArvore).toHaveBeenCalledTimes(2);
});
