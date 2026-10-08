/**
 * Os especialistas implementados — `app_assistant` e `documents` — pela porta
 * de verdade: o Taq delega, o especialista roda o próprio ciclo com as
 * próprias ferramentas e instruções, e a resposta volta à pessoa.
 *
 * Como em `taq.test.ts`, o único simulado é o MODELO (roteirizado, e o mesmo
 * para o Taq e para o especialista — as chamadas são em sequência). A tela é
 * um `acoes` com `vi.fn`, no lugar do `platform.send` e da navegação da HOME.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import type { MeetingRecord } from '@/shared/types/domain';
import { lerDocumentos } from '@/features/documents/store';
import { limparVinculosDaReuniao } from '@/features/annotations/vinculos';
import { lerNota } from '@/features/annotations/notes';
import { readLocal, writeLocal } from '@/shared/services/storage';
import { lerLixeira } from './lixeira';
import { desfazerExclusao } from './interface';
import { armazenamentoLocal } from './armazenamento';
import type { AdaptadorDeModelo, PedidoDeTurno, RespostaDoTurno } from './modelo';
import { criarOrquestrador, type PedidoAoTaq } from './orquestrador';
import type { AcoesDaInterface } from './tipos';
import type * as Exportacao from '@/features/history/export';

vi.mock('@/features/history/export', async (original) => ({
  ...(await original<typeof Exportacao>()),
  downloadTranscript: vi.fn(),
}));
const { downloadTranscript } = await import('@/features/history/export');

import type * as ClienteDoPersonalizado from '@/features/documents/personalizado/cliente';

const gerarPersonalizado = vi.hoisted(() => vi.fn());
vi.mock('@/features/documents/personalizado/cliente', async (original) => ({
  ...(await original<typeof ClienteDoPersonalizado>()),
  gerarPersonalizado,
}));

function reuniao(id: string, title: string, dia: number): MeetingRecord {
  const inicio = Date.UTC(2026, 8, dia, 13);
  return {
    id,
    title,
    startedAt: inicio,
    endedAt: inicio + 60_000,
    durationSeconds: 60,
    participants: [],
    segments: [
      {
        captionId: `${id}-0`,
        speaker: 'Ana',
        text: 'Decidido: o deploy fica na sexta.',
        startOffsetMs: 0,
        endOffsetMs: 5_000,
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
}

const SPRINT = reuniao('m-sprint', 'Planejamento da Sprint 12', 18);
const COMERCIAL = reuniao('m-comercial', 'Reunião comercial', 19);
const ORBITAL = reuniao('m-orbital', 'Reunião comercial Orbital', 20);

let acoes: AcoesDaInterface & { enviar: ReturnType<typeof vi.fn> };

beforeEach(() => {
  installChromeStorageMock({
    local: {
      [STORAGE_KEYS.history]: [ORBITAL, COMERCIAL, SPRINT],
      [STORAGE_KEYS.notes]: {
        'm-comercial': { meetingId: 'm-comercial', texto: 'nota', updatedAt: 1 },
      },
      [STORAGE_KEYS.documents]: [
        {
          id: 'd-ata',
          title: 'Ata comercial',
          content: 'x',
          formato: 'markdown',
          createdAt: 1,
          updatedAt: 1,
          origem: 'gerado',
          meetingId: 'm-comercial',
        },
      ],
    },
  });
  acoes = {
    enviar: vi.fn(async () => ({ ok: true })),
    abrirReuniao: vi.fn(),
    abrirDocumento: vi.fn(),
  };
  vi.mocked(downloadTranscript).mockClear();
});

// --------------------------------------------------------- modelo roteirizado

type Passo = RespostaDoTurno | ((p: PedidoDeTurno) => RespostaDoTurno);
const base = {
  uso: { entrada: 10, saida: 5 },
  provedor: 't',
  modelo: 'roteiro',
  instrucoesVersao: 'x',
  latenciaMs: 1,
};
const final = (texto: string): RespostaDoTurno => ({
  ...base,
  tipo: 'final',
  texto,
  chamadas: [],
});
const pede = (nome: string, argumentos: Record<string, unknown>): RespostaDoTurno => ({
  ...base,
  tipo: 'ferramentas',
  texto: '',
  chamadas: [{ id: `c-${nome}`, nome, argumentos }],
});

function roteiro(passos: Passo[]) {
  const pedidos: PedidoDeTurno[] = [];
  const modelo: AdaptadorDeModelo = {
    turno: vi.fn(async (p: PedidoDeTurno) => {
      pedidos.push(structuredClone(p));
      const passo = passos.shift();
      if (!passo) throw new Error('roteiro acabou');
      return typeof passo === 'function' ? passo(p) : passo;
    }),
  };
  return { modelo, pedidos };
}

function resultadoDe(p: PedidoDeTurno, nome: string): Record<string, unknown> {
  for (const m of [...p.mensagens].reverse()) {
    if (m.papel === 'ferramenta') {
      const r = m.resultados.find((x) => x.nome === nome);
      if (r) return r.conteudo;
    }
  }
  throw new Error(`sem resultado de ${nome}`);
}

const delegar = (agente: string, objetivo: string) =>
  pede('delegate_task', { agente, objetivo });

function executar(
  texto: string,
  modelo: AdaptadorDeModelo,
  extra: Partial<PedidoAoTaq> = {},
) {
  return criarOrquestrador({ modelo, armazenamento: armazenamentoLocal }).executar({
    conversaId: 'c-1',
    texto,
    anteriores: [],
    selecionados: [],
    acoes,
    ...extra,
  });
}

// ------------------------------------------------------------ app_assistant

describe('app_assistant — operações', () => {
  it('renomeia pelo mesmo caminho da tela, e a resposta do especialista vai direto', async () => {
    const { modelo, pedidos } = roteiro([
      delegar('app_assistant', 'Renomear a reunião da sprint para Alinhamento Semanal'),
      pede('rename_meeting', { reuniao: 'sprint', novo_nome: 'Alinhamento Semanal' }),
      final('Pronto: a reunião agora se chama “Alinhamento Semanal”.'),
    ]);
    const r = await executar(
      'Renomeie a reunião da sprint para Alinhamento Semanal',
      modelo,
    );

    expect(acoes.enviar).toHaveBeenCalledWith({
      type: 'ui/history/rename',
      id: 'm-sprint',
      title: 'Alinhamento Semanal',
    });
    expect(r).toMatchObject({
      estado: 'concluido',
      resposta: 'Pronto: a reunião agora se chama “Alinhamento Semanal”.',
    });
    expect(r.operacoes).toEqual([
      {
        acao: 'renomear',
        tipo: 'reuniao',
        id: 'm-sprint',
        titulo: 'Alinhamento Semanal',
        ok: true,
      },
    ]);
    // Três chamadas, não quatro: o Taq não reescreve a resposta do especialista.
    expect(pedidos.map((p) => p.instrucoes)).toEqual([
      'taq-v7',
      'app-assistant-v5',
      'app-assistant-v5',
    ]);
    // O especialista tem as ferramentas DELE; o Taq, não.
    expect(pedidos[0]!.ferramentas.map((f) => f.nome)).not.toContain('rename_meeting');
    expect(pedidos[0]!.ferramentas.map((f) => f.nome)).not.toContain('create_document');
    expect(pedidos[1]!.ferramentas.map((f) => f.nome)).toEqual(
      expect.arrayContaining(['rename_meeting', 'delete_meeting', 'get_usage_guide']),
    );
    // "Renomeie" não pede ação na tela: abrir e exportar ficam de fora.
    expect(pedidos[1]!.ferramentas.map((f) => f.nome)).not.toContain('open_meeting');
  });

  it('nome ambíguo: age no mais recente, sem perguntar, e diz quais outros casavam', async () => {
    let resultado: unknown;
    const { modelo } = roteiro([
      delegar('app_assistant', 'Renomear a reunião comercial'),
      pede('rename_meeting', { reuniao: 'comercial', novo_nome: 'Vendas' }),
      (p) => {
        resultado = resultadoDe(p, 'rename_meeting');
        return final('Renomeei a mais recente, “Reunião comercial Orbital”, para “Vendas”.');
      },
    ]);
    const r = await executar('Renomeie a reunião comercial para Vendas', modelo);
    expect(acoes.enviar).toHaveBeenCalledWith({ type: 'ui/history/rename', id: 'm-orbital', title: 'Vendas' });
    expect(resultado).toMatchObject({
      renomeada: true,
      tambem_casavam: [{ id: 'm-comercial', titulo: 'Reunião comercial', data: '19/09/2026' }],
    });
    expect(r.pergunta).toBeUndefined();
  });

  it('apagar vai direto para a lixeira, e Desfazer devolve reunião, nota e vínculo', async () => {
    // O background de verdade, reduzido ao que importa: apagar é a limpeza real
    // de vínculos; restaurar é gravar o registro de volta no histórico.
    acoes.enviar.mockImplementation(async (m: { type: string; id?: string; record?: MeetingRecord }) => {
      if (m.type === 'ui/history/delete') return { ok: true, limpeza: await limparVinculosDaReuniao(m.id!) };
      if (m.type === 'ui/history/restore') {
        const atual = (await readLocal<MeetingRecord[]>(STORAGE_KEYS.history)) ?? [];
        await writeLocal(STORAGE_KEYS.history, [m.record!, ...atual]);
        return { ok: true };
      }
      return { ok: false };
    });
    let resultado: unknown;
    const { modelo, pedidos } = roteiro([
      delegar('app_assistant', 'Apagar a reunião comercial'),
      pede('delete_meeting', { reuniao: 'Reunião comercial' }),
      (p) => {
        resultado = resultadoDe(p, 'delete_meeting');
        return final('Apaguei “Reunião comercial”. Ela fica 30 dias na lixeira: dá para desfazer.');
      },
    ]);
    const r = await executar('Apague a reunião comercial', modelo);

    expect(pedidos).toHaveLength(3); // nenhuma pergunta no caminho
    expect(resultado).toMatchObject({ apagada: true, foi_junto: { nota: true }, documentos_sem_vinculo: 1 });
    expect(r.operacoes).toEqual([
      { acao: 'apagar', tipo: 'reuniao', id: 'm-comercial', titulo: 'Reunião comercial', ok: true, desfazivel: true },
    ]);
    const historico = () => readLocal<MeetingRecord[]>(STORAGE_KEYS.history);
    expect((await historico())!.map((m) => m.id)).not.toContain('m-comercial');
    expect((await lerLixeira()).map((i) => i.id)).toEqual(['m-comercial']);

    // O botão Desfazer: direto, sem modelo.
    expect(await desfazerExclusao('m-comercial', acoes)).toBe(true);
    expect((await historico())!.map((m) => m.id)).toContain('m-comercial');
    expect(await lerNota('m-comercial')).toMatchObject({ texto: 'nota' });
    expect((await lerDocumentos()).find((d) => d.id === 'd-ata')!.meetingId).toBe('m-comercial');
    expect(await lerLixeira()).toEqual([]);
  });

  it('falha da ferramenta: explica, não afirma a exclusão, e não deixa nada na lixeira', async () => {
    acoes.enviar.mockResolvedValue({ ok: false, error: 'meeting-active' });
    let resultado: unknown;
    const { modelo } = roteiro([
      delegar('app_assistant', 'Apagar a reunião comercial'),
      pede('delete_meeting', { reuniao: 'm-comercial' }),
      (p) => {
        resultado = resultadoDe(p, 'delete_meeting');
        return final('Não apaguei: a reunião ainda está sendo capturada.');
      },
    ]);
    const r = await executar('Apague a reunião m-comercial', modelo);

    expect(resultado).toMatchObject({ erro: { codigo: 'operacao_falhou' } });
    expect(r.operacoes).toEqual([expect.objectContaining({ acao: 'apagar', id: 'm-comercial', ok: false })]);
    expect(r.resposta).toMatch(/Não apaguei/);
    expect(await lerLixeira()).toEqual([]);
  });
  it('abre a última reunião e exporta a transcrição pelos caminhos da tela', async () => {
    const { modelo } = roteiro([
      delegar('app_assistant', 'Abrir a última reunião e exportar a transcrição'),
      pede('open_meeting', { reuniao: 'ultima' }),
      pede('export_transcript', { reuniao: 'ultima' }),
      final('Abri “Reunião comercial Orbital” e baixei a transcrição.'),
    ]);
    const r = await executar(
      'Abra minha última reunião e exporte essa transcrição',
      modelo,
    );
    expect(acoes.abrirReuniao).toHaveBeenCalledWith('m-orbital');
    expect(downloadTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm-orbital' }),
    );
    expect(r.operacoes!.map((o) => `${o.acao}:${o.ok}`)).toEqual([
      'abrir:true',
      'exportar:true',
    ]);
  });

  it('sem pedido de ação na tela, abrir e exportar nem são oferecidos', async () => {
    const { modelo, pedidos } = roteiro([
      delegar('app_assistant', 'Explicar onde ficam as reuniões'),
      pede('get_usage_guide', { pergunta: 'onde ficam minhas reuniões' }),
      final('Na HOME, seção “Reuniões”.'),
    ]);
    await executar('Onde ficam minhas reuniões?', modelo);
    const nomes = pedidos[1]!.ferramentas.map((f) => f.nome);
    expect(nomes).toContain('get_usage_guide');
    expect(nomes).not.toContain('open_meeting');
    expect(nomes).not.toContain('delete_meeting');
  });
});

// -------------------------------------------------------------------- ajuda
//
// O modelo é roteirizado: o que se testa aqui é o que o especialista RECEBE —
// as ferramentas oferecidas e o que a referência devolve — e que nenhuma
// operação acontece quando não há ferramenta para ela. O comportamento do
// modelo de verdade diante disso fica em `taq.live.test.ts`.

describe('app_assistant — ajuda pela referência', () => {
  it('pergunta de uso: só as consultas de leitura, e o guia traz os nomes da tela', async () => {
    let guia: Record<string, unknown> = {};
    const { modelo, pedidos } = roteiro([
      delegar('app_assistant', 'Explicar como gerar uma ata'),
      pede('get_usage_guide', { pergunta: 'como gero uma ata' }),
      (p) => {
        guia = resultadoDe(p, 'get_usage_guide');
        return final('HOME → “Reuniões” → a reunião → “Criar documento” → “Ata de Reunião”.');
      },
    ]);
    const r = await executar('Como eu gero uma ata?', modelo);
    const nomes = pedidos[1]!.ferramentas.map((f) => f.nome);
    expect(nomes).toEqual(expect.arrayContaining(['get_app_capabilities', 'get_usage_guide']));
    expect(nomes).not.toContain('get_help');
    expect(nomes).not.toContain('delete_meeting');
    expect(guia).toMatchObject({ encontrou: true });
    const g = (guia.guias as Array<{ passos: string[]; o_agente_executa: boolean }>)[0]!;
    expect(g.passos.join(' ')).toMatch(/“Criar documento”/);
    expect(g.o_agente_executa).toBe(true);
    expect(r.operacoes ?? []).toEqual([]);
  });

  it('comando que só existe na tela: o agente recebe "não executa", e nada acontece', async () => {
    let guia: Record<string, unknown> = {};
    const { modelo, pedidos } = roteiro([
      delegar('app_assistant', 'Apagar o documento Ata comercial'),
      pede('get_usage_guide', { pergunta: 'apague o documento Ata comercial' }),
      (p) => {
        guia = resultadoDe(p, 'get_usage_guide');
        return final(
          'Ainda não consigo apagar documentos por você. Pela tela: “Documentos” → abra o documento → “Mais ações” → “Apagar documento” → “Apagar”.',
        );
      },
    ]);
    const r = await executar('Apague o documento Ata comercial', modelo);
    // Nenhuma ferramenta de apagar documento existe para ser oferecida.
    expect(
      pedidos[1]!.ferramentas.some((f) => /^(delete|remove|download|export)_document/.test(f.nome)),
    ).toBe(false);
    const g = (guia.guias as Array<{ titulo: string; o_agente_executa: boolean }>).find(
      (x) => x.titulo === 'Apagar um documento',
    )!;
    expect(g.o_agente_executa).toBe(false);
    expect(acoes.enviar).not.toHaveBeenCalled();
    expect(r.operacoes ?? []).toEqual([]);
    expect((await lerDocumentos()).map((d) => d.id)).toContain('d-ata');
  });

  it('baixar documento (manual): nenhuma exportação dispara', async () => {
    const { modelo } = roteiro([
      delegar('app_assistant', 'Baixar o documento Ata comercial'),
      pede('get_app_capabilities', { assunto: 'exportacao' }),
      (p) => {
        const c = resultadoDe(p, 'get_app_capabilities') as {
          funcionalidades: Array<{ id: string; o_agente_executa: boolean }>;
        };
        expect(c.funcionalidades.find((f) => f.id === 'baixar_documento')).toMatchObject({
          o_agente_executa: false,
        });
        return final('Isso você faz pela tela: “Documentos” → o documento → “Baixar .md”.');
      },
    ]);
    const r = await executar('Baixe o documento Ata comercial', modelo);
    expect(downloadTranscript).not.toHaveBeenCalled();
    expect(r.operacoes ?? []).toEqual([]);
  });
});

// ---------------------------------------------------------------- documents

describe('documents', () => {
  it('o Taq delega, e o especialista cria o documento com as regras do pedido DA PESSOA', async () => {
    const { modelo, pedidos } = roteiro([
      delegar('documents', 'Criar ata da sprint'),
      pede('create_document', {
        tipo: 'ata',
        reuniao_id: 'm-sprint',
        campos: { projeto: 'Orbital' },
        secoes: [{ id: 'decisoes', conteudo: 'Deploy na sexta.' }],
      }),
      final('Criei a ata para revisão.'),
    ]);
    const r = await executar('Crie uma ata da sprint 12, projeto Orbital', modelo);
    expect(pedidos.map((p) => p.instrucoes)).toEqual([
      'taq-v7',
      'documents-v4',
      'documents-v4',
    ]);
    expect(r.documentos).toHaveLength(1);
    expect(
      (await lerDocumentos()).find((d) => d.id === r.documentos[0]!.id),
    ).toMatchObject({
      meetingId: 'm-sprint',
      conversationId: 'c-1',
      tipo: 'Ata de Reunião',
    });
  });

  it('o objetivo escrito pelo modelo não disfarça um pedido fora do catálogo', async () => {
    // "Relatório" tem dica de roteamento: o especialista roda direto, e o modelo
    // (aqui roteirizado) tenta "traduzir" o pedido para uma ata.
    const { modelo } = roteiro([
      pede('create_document', {
        tipo: 'ata',
        reuniao_id: 'm-sprint',
        campos: { projeto: 'X' },
        secoes: [{ id: 'decisoes', conteudo: 'a' }],
      }),
      (p) => {
        expect(resultadoDe(p, 'create_document')).toMatchObject({
          erro: { codigo: 'tipo_fora_do_catalogo' },
        });
        return final('Esse tipo de documento ainda não está disponível no TaqCiti.');
      },
    ]);
    const r = await executar('Crie um relatório executivo da sprint', modelo);
    expect(r.resposta).toMatch(/ainda não está disponível/); // o roteiro chegou ao fim
    expect(r.documentos).toEqual([]);
  });
});

describe('documents — documento personalizado', () => {
  afterEach(() => gerarPersonalizado.mockReset());

  const resposta = () => ({
    status: 'ok' as const,
    dados: {
      arvore: {
        revisao: 1,
        titulo: 'Relatório da Sprint 12',
        lacunas: [],
        blocos: [
          { tipo: 'capa', blockId: 'capa', variante: 'padrao', titulo: 'Relatório da Sprint 12', fontes: [], origem: 'agente' },
          { tipo: 'paragrafo', blockId: 's1-b1', texto: 'O deploy ficou na sexta.', fontes: [], origem: 'agente' },
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
    },
  });

  it('"monte um relatório" vai direto ao especialista, que cria o documento personalizado com a reunião do pedido', async () => {
    gerarPersonalizado.mockResolvedValue(resposta());
    const { modelo, pedidos } = roteiro([
      // Sem `delegar`: a dica de roteamento põe o especialista de documentos na frente.
      pede('create_custom_document', { pedido: 'Relatório da sprint 12', reuniao_ids: ['m-sprint'] }),
      final('Criei o relatório para revisão, com a reunião da Sprint 12 como fonte.'),
    ]);
    const r = await executar('Monte um relatório da sprint 12', modelo);

    expect(pedidos.map((p) => p.instrucoes)).toEqual(['documents-v4', 'documents-v4']);
    expect(r.documentos).toHaveLength(1);
    const doc = (await lerDocumentos()).find((d) => d.id === r.documentos[0]!.id)!;
    expect(doc).toMatchObject({ tipo: 'personalizado', meetingId: 'm-sprint', conversationId: 'c-1' });
    // O servidor só recebeu a reunião pedida.
    const [enviado] = gerarPersonalizado.mock.calls[0]!;
    expect(enviado.fontes.map((f: { id: string }) => f.id)).toEqual(['m-sprint']);
    expect(enviado.pedido).toContain('Monte um relatório da sprint 12');
  });

  it('"prepare um e-mail sobre o relatório" NÃO vai para o documento personalizado', async () => {
    const { modelo, pedidos } = roteiro([final('Posso preparar o rascunho do e-mail.')]);
    await executar('Prepare um e-mail para a Ana sobre o relatório', modelo);
    expect(pedidos.map((p) => p.instrucoes)).not.toContain('documents-v4');
    expect(gerarPersonalizado).not.toHaveBeenCalled();
  });
});
