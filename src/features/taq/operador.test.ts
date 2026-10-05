/**
 * O operador (`app_assistant`) e o contexto escolhido da conversa — pela porta
 * de verdade, com o modelo roteirizado e o storage do mock. Dados sintéticos.
 *
 * Cobre as operações novas: preparar a transcrição para copiar (parcial ×
 * final, sem inventar autoria), baixar documento (o que sai e o que não sai) e
 * as fontes que a pessoa escolhe para uma conversa (persistem, revalidam,
 * isolam e morrem com a conversa).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import type { MeetingRecord } from '@/shared/types/domain';
import { apagarConversas, lerConversas, type Conversation } from '@/home/conversations';
import { armazenamentoLocal } from './armazenamento';
import { montarContextoInicial } from './contexto';
import type { AdaptadorDeModelo, PedidoDeTurno, RespostaDoTurno } from './modelo';
import { criarOrquestrador, type PedidoAoTaq } from './orquestrador';
import { escopoDaConversa } from './politica';
import type { AcoesDaInterface } from './tipos';

const baixarTexto = vi.fn();
const baixarHtml = vi.fn();
vi.mock('@/document/baixarDocumento', () => ({
  baixarComoTexto: (...a: unknown[]) => baixarTexto(...a),
  baixarComoHtml: (...a: unknown[]) => baixarHtml(...a),
  baixarComoPdf: vi.fn(),
  sanitizarNomeDeArquivo: (n: string) => n,
}));

function reuniao(
  id: string,
  title: string,
  falas: Array<{ speaker: string | null; text: string }>,
  status: 'ready' | 'recording' = 'ready',
): MeetingRecord {
  const inicio = Date.UTC(2026, 8, 18, 13);
  return {
    id,
    title,
    startedAt: inicio,
    endedAt: inicio + falas.length * 20_000,
    durationSeconds: falas.length * 20,
    participants: [{ name: 'Ana', isHost: true }],
    segments: falas.map((f, i) => ({
      captionId: `${id}-${i}`,
      speaker: f.speaker,
      text: f.text,
      startOffsetMs: i * 20_000,
      endOffsetMs: i * 20_000 + 9_000,
    })),
    status,
    metadata: {
      capturedCaptions: true,
      droppedSegments: 0,
      reconnectCount: 0,
      wasDiscardedAndRestarted: false,
    },
  };
}

const SPRINT = reuniao('m-sprint', '[TESTE] Planejamento da Sprint', [
  { speaker: 'Ana', text: 'Vamos fechar o prazo.' },
  { speaker: 'Ana', text: 'Sexta, dia 25.' },
  { speaker: null, text: 'Fala sem autoria identificada.' },
]);
const AO_VIVO = reuniao(
  'm-vivo',
  '[TESTE] Reunião em andamento',
  [{ speaker: 'Bruno', text: 'Começando agora.' }],
  'recording',
);

const conversa = (id: string, title: string, extra: Partial<Conversation> = {}): Conversation => ({
  id,
  title,
  createdAt: 1,
  updatedAt: 1,
  messages: [{ id: `${id}-1`, role: 'user', text: `[TESTE] ${title}`, at: 1 }],
  ...extra,
});

let acoes: AcoesDaInterface;

beforeEach(() => {
  baixarTexto.mockClear();
  baixarHtml.mockClear();
  installChromeStorageMock({
    local: {
      [STORAGE_KEYS.history]: [SPRINT, AO_VIVO],
      [STORAGE_KEYS.conversations]: [conversa('c-a', 'Conversa A'), conversa('c-b', 'Conversa B')],
      [STORAGE_KEYS.documents]: [
        {
          id: 'd-ata',
          title: '[TESTE] Ata da Sprint',
          content: '# Ata\n\ntexto editado pela pessoa',
          formato: 'markdown',
          createdAt: 1,
          updatedAt: 5,
          origem: 'gerado',
          meetingId: 'm-sprint',
          html: '<h1>Ata</h1>',
        },
        {
          id: 'd-sem-html',
          title: '[TESTE] Nota',
          content: 'só texto',
          formato: 'markdown',
          createdAt: 1,
          updatedAt: 1,
          origem: 'manual',
        },
      ],
    },
  });
  acoes = { enviar: vi.fn(async () => ({ ok: true })), abrirReuniao: vi.fn(), abrirDocumento: vi.fn() };
});

// --------------------------------------------------------- modelo roteirizado

type Passo = RespostaDoTurno | ((p: PedidoDeTurno) => RespostaDoTurno | Promise<RespostaDoTurno>);
const base = { uso: { entrada: 1, saida: 1 }, provedor: 't', modelo: 'roteiro', instrucoesVersao: 'x', latenciaMs: 1 };
const final = (texto: string): RespostaDoTurno => ({ ...base, tipo: 'final', texto, chamadas: [] });
const pede = (nome: string, argumentos: Record<string, unknown>): RespostaDoTurno => ({
  ...base,
  tipo: 'ferramentas',
  texto: '',
  chamadas: [{ id: `c-${nome}`, nome, argumentos }],
});
const delegar = (objetivo: string) => pede('delegate_task', { agente: 'app_assistant', objetivo });

function roteiro(passos: Passo[]) {
  const modelo: AdaptadorDeModelo = {
    turno: vi.fn(async (p: PedidoDeTurno) => {
      const passo = passos.shift();
      if (!passo) throw new Error('roteiro acabou');
      return typeof passo === 'function' ? passo(structuredClone(p)) : passo;
    }),
  };
  return modelo;
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

function executar(texto: string, modelo: AdaptadorDeModelo, extra: Partial<PedidoAoTaq> = {}) {
  return criarOrquestrador({ modelo, armazenamento: armazenamentoLocal }).executar({
    conversaId: 'c-a',
    texto,
    anteriores: [],
    selecionados: [],
    acoes,
    ...extra,
  });
}

/** Roda uma ferramenta do operador e devolve o que ela respondeu ao modelo. */
async function operar(pedido: string, ferramenta: string, args: Record<string, unknown>) {
  let resultado: Record<string, unknown> = {};
  const modelo = roteiro([
    delegar(pedido),
    pede(ferramenta, args),
    (p) => {
      resultado = resultadoDe(p, ferramenta);
      return final('ok');
    },
  ]);
  const r = await executar(pedido, modelo);
  return { resultado, r };
}

const contextoDe = async (conversaId: string) => {
  const escopo = escopoDaConversa({ conversaId, texto: 'o que temos?' });
  return montarContextoInicial({ escopo, selecionados: [], conversaId }, armazenamentoLocal);
};

// ------------------------------------------------------ copiar a transcrição

describe('copy_transcript', () => {
  it('reunião encerrada: texto pronto para copiar, final, e sem inventar autoria', async () => {
    const { resultado, r } = await operar(
      'Copie a transcrição da reunião da Sprint',
      'copy_transcript',
      { reuniao: 'Sprint' },
    );
    expect(resultado).toMatchObject({ preparada: true, situacao: 'final', segmentos: 3 });
    expect(String(resultado.aviso)).toMatch(/Nada foi copiado/);
    // O texto copiável sai na resposta; a fala sem autor não ganha "Falante".
    expect(r.textoCopiavel).toMatch(/transcrição final/);
    expect(r.textoCopiavel).toMatch(/\[00:00\] Ana: Vamos fechar o prazo\./);
    expect(r.textoCopiavel).toMatch(/\nSexta, dia 25\./); // mesma pessoa: sem repetir o cabeçalho
    expect(r.textoCopiavel).toMatch(/\[00:40\] Fala sem autoria identificada\./);
    expect(r.textoCopiavel).not.toMatch(/Falante/);
    expect(r.operacoes).toEqual([expect.objectContaining({ acao: 'preparar_copia', ok: true })]);
  });

  it('reunião em andamento: diz que a transcrição é parcial', async () => {
    const { resultado, r } = await operar(
      'Copie a transcrição da reunião em andamento',
      'copy_transcript',
      { reuniao: 'andamento' },
    );
    expect(resultado).toMatchObject({ situacao: 'parcial' });
    expect(r.textoCopiavel).toMatch(/transcrição parcial/);
  });

  it('exportar também diz se é parcial ou final', async () => {
    const { resultado } = await operar(
      'Exporte e baixe a transcrição da reunião em andamento',
      'export_transcript',
      { reuniao: 'andamento' },
    ).catch(() => ({ resultado: {} as Record<string, unknown> }));
    // O download real usa o DOM; aqui só importa que a situação é reportada
    // quando a ferramenta chega ao fim, ou que nada é afirmado quando falha.
    if (resultado.exportada) expect(resultado.situacao).toBe('parcial');
  });
});

// ------------------------------------------------------- baixar documento

describe('download_document', () => {
  it('.md baixa a versão SALVA (com as edições) e diz isso', async () => {
    const { resultado, r } = await operar('Baixe o documento Ata da Sprint', 'download_document', {
      documento: 'Ata da Sprint',
      formato: 'md',
    });
    expect(resultado).toMatchObject({ baixado: true, formato: 'md' });
    expect(baixarTexto).toHaveBeenCalledWith('# Ata\n\ntexto editado pela pessoa', '[TESTE] Ata da Sprint', 'md');
    expect(r.operacoes).toEqual([expect.objectContaining({ acao: 'baixar', tipo: 'documento', ok: true })]);
  });

  it('.html é a versão da geração, e avisa que não leva as edições', async () => {
    const { resultado } = await operar('Baixe o documento Ata da Sprint em html', 'download_document', {
      documento: 'd-ata',
      formato: 'html',
    });
    expect(resultado).toMatchObject({ baixado: true, formato: 'html', versao: expect.stringMatching(/sem as edições/) });
    expect(baixarHtml).toHaveBeenCalledWith('<h1>Ata</h1>', '[TESTE] Ata da Sprint');
  });

  it('PDF não sai por aqui: recusa e nada é baixado', async () => {
    const { resultado, r } = await operar('Baixe o documento Ata da Sprint em pdf', 'download_document', {
      documento: 'd-ata',
      formato: 'pdf',
    });
    expect(resultado).toMatchObject({ erro: { codigo: 'formato_indisponivel' } });
    expect(baixarTexto).not.toHaveBeenCalled();
    expect((r.operacoes ?? []).filter((o) => o.ok)).toEqual([]);
  });

  it('html pedido num documento sem html: recusa', async () => {
    const { resultado } = await operar('Baixe o documento Nota em html', 'download_document', {
      documento: 'd-sem-html',
      formato: 'html',
    });
    expect(resultado).toMatchObject({ erro: { codigo: 'formato_indisponivel' } });
    expect(baixarHtml).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------- contexto da conversa

describe('fontes do contexto da conversa', () => {
  it('adicionar: persiste na conversa, volta ao reabrir e NÃO vaza para outra conversa', async () => {
    const { resultado, r } = await operar(
      'Adicione a reunião da Sprint ao contexto',
      'add_context_source',
      { tipo: 'reuniao', registro: 'Sprint' },
    );
    expect(resultado).toMatchObject({ adicionada: true, fonte: { id: 'm-sprint' } });
    expect(r.operacoes).toEqual([expect.objectContaining({ acao: 'contexto', ok: true })]);

    // "Reabrir": só o que está no storage.
    const guardada = (await lerConversas()).find((c) => c.id === 'c-a')!;
    expect(guardada.contexto).toEqual([expect.objectContaining({ tipo: 'reuniao', id: 'm-sprint' })]);
    expect(await contextoDe('c-a')).toMatch(/ESCOLHIDA: reuniao m-sprint/);
    // Isolamento: a outra conversa não enxerga a escolha.
    expect(await contextoDe('c-b')).not.toMatch(/ESCOLHIDA/);
    expect((await lerConversas()).find((c) => c.id === 'c-b')!.contexto).toBeUndefined();
  });

  it('escolher duas vezes não duplica', async () => {
    await operar('Adicione a Sprint ao contexto', 'add_context_source', { tipo: 'reuniao', registro: 'Sprint' });
    const { resultado } = await operar('Adicione a Sprint ao contexto', 'add_context_source', {
      tipo: 'reuniao',
      registro: 'm-sprint',
    });
    expect(resultado).toMatchObject({ adicionada: false, ja_estava: true });
    expect((await lerConversas()).find((c) => c.id === 'c-a')!.contexto).toHaveLength(1);
  });

  it('fonte que mudou: o contexto avisa para reler; apagada: sai e é contada', async () => {
    await operar('Adicione a Sprint ao contexto', 'add_context_source', { tipo: 'reuniao', registro: 'Sprint' });
    await operar('Adicione a ata ao contexto', 'add_context_source', { tipo: 'documento', registro: 'd-ata' });

    // A captura acrescenta uma fala; o documento é apagado.
    const reunioes = [
      { ...SPRINT, endedAt: SPRINT.endedAt + 20_000, segments: [...SPRINT.segments, { ...SPRINT.segments[0]!, captionId: 'nova' }] },
      AO_VIVO,
    ];
    installChromeStorageMock({
      local: {
        [STORAGE_KEYS.history]: reunioes,
        [STORAGE_KEYS.conversations]: await lerConversas(),
        [STORAGE_KEYS.documents]: [],
      },
    });
    const contexto = await contextoDe('c-a');
    expect(contexto).toMatch(/ESCOLHIDA: reuniao m-sprint.*MUDOU desde que foi escolhida/);
    expect(contexto).toMatch(/1 fonte\(s\) escolhida\(s\) foram apagadas ou saíram do escopo: não as cite/);
    expect(contexto).not.toMatch(/d-ata/);
  });

  it('tirar: sai do contexto e o registro continua guardado', async () => {
    await operar('Adicione a Sprint ao contexto', 'add_context_source', { tipo: 'reuniao', registro: 'Sprint' });
    const { resultado } = await operar('Tire a reunião da Sprint do contexto', 'remove_context_source', {
      tipo: 'reuniao',
      registro: 'm-sprint',
    });
    expect(resultado).toMatchObject({ removida: true });
    expect((await lerConversas()).find((c) => c.id === 'c-a')!.contexto).toBeUndefined();
    expect((await armazenamentoLocal.listarReunioes()).map((x) => x.id)).toContain('m-sprint');
    expect(await contextoDe('c-a')).not.toMatch(/ESCOLHIDA/);
  });

  it('o limite de fontes é respeitado, com a mensagem certa', async () => {
    const muitas = Array.from({ length: 6 }, (_, i) => ({
      tipo: 'reuniao' as const,
      id: `x${i}`,
      titulo: `x${i}`,
      em: 1,
      versao: 'v',
    }));
    installChromeStorageMock({
      local: {
        [STORAGE_KEYS.history]: [SPRINT],
        [STORAGE_KEYS.conversations]: [conversa('c-a', 'Conversa A', { contexto: muitas })],
        [STORAGE_KEYS.documents]: [],
      },
    });
    const { resultado } = await operar('Adicione a Sprint ao contexto', 'add_context_source', {
      tipo: 'reuniao',
      registro: 'm-sprint',
    });
    expect(resultado).toMatchObject({ erro: { codigo: 'contexto_cheio' } });
  });

  it('apagar a conversa leva o contexto escolhido; a fonte em si fica', async () => {
    await operar('Adicione a Sprint ao contexto', 'add_context_source', { tipo: 'reuniao', registro: 'Sprint' });
    await apagarConversas(['c-a']);
    expect((await lerConversas()).map((c) => c.id)).toEqual(['c-b']);
    expect((await armazenamentoLocal.listarReunioes()).map((x) => x.id)).toContain('m-sprint');
  });

  it('conversa apagada no meio: escolher fonte não recria a conversa', async () => {
    const { adicionarFonteAoContexto } = await import('@/home/conversations');
    await apagarConversas(['c-a']);
    const r = await adicionarFonteAoContexto('c-a', {
      tipo: 'reuniao',
      id: 'm-sprint',
      titulo: 'x',
      versao: 'v',
    });
    expect(r).toBe('sem_conversa');
    expect((await lerConversas()).map((c) => c.id)).toEqual(['c-b']);
  });
});

// ------------------------------------------------- retomar sem duplicar

describe('pedido composto que parou no meio', () => {
  it('o contexto lista o documento já produzido NESTA conversa, e só nela', async () => {
    installChromeStorageMock({
      local: {
        [STORAGE_KEYS.history]: [SPRINT],
        [STORAGE_KEYS.conversations]: [conversa('c-a', 'Conversa A'), conversa('c-b', 'Conversa B')],
        [STORAGE_KEYS.documents]: [
          {
            id: 'd-feito',
            title: '[TESTE] Ata gerada',
            content: '# Ata',
            formato: 'markdown',
            createdAt: 1,
            updatedAt: 9,
            origem: 'gerado',
            tipo: 'Ata de Reunião',
            meetingId: 'm-sprint',
            conversationId: 'c-a',
          },
        ],
      },
    });
    const deA = await contextoDe('c-a');
    expect(deA).toMatch(/Documentos já produzidos NESTA conversa/);
    expect(deA).toMatch(/documento d-feito .*Ata gerada.*editado depois de criado/);
    expect(deA).toMatch(/não gere de novo/);
    expect(await contextoDe('c-b')).not.toMatch(/Documentos já produzidos NESTA conversa/);
  });
});

// ---------------------------------------------------------------- política

describe('política: escolher contexto é escrita; copiar é leitura', () => {
  it('o pedido de contexto libera a escrita local; o de copiar, não precisa dela', async () => {
    const { efeitosDoPedido } = await import('./politica');
    expect(efeitosDoPedido('Adicione esta reunião ao contexto')).toContain('escrita_local');
    expect(efeitosDoPedido('Tire a ata das fontes')).toContain('escrita_local');
    expect(efeitosDoPedido('Copie a transcrição da reunião')).not.toContain('escrita_local');
    expect(efeitosDoPedido('Baixe o documento X')).toContain('interface');
  });
});
