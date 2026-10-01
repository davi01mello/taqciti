/**
 * Memória e Contexto, e a exclusão de conversas — pela porta de verdade.
 *
 * Como nos outros testes do Taq, o único simulado é o MODELO (roteirizado). O
 * storage é o mock de `chrome.storage` com `onChanged` de verdade, e todos os
 * dados são sintéticos. Aqui se testa o que o runtime e as ferramentas
 * GARANTEM — o registro certo, o escopo, o que é apagado e o que fica, o que
 * uma resposta tardia consegue gravar. O comportamento do modelo de verdade
 * fica em `taq.live.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import type { MeetingRecord } from '@/shared/types/domain';
import { lerDocumentos } from '@/features/documents/store';
import {
  acrescentarMensagem,
  apagarConversas,
  lembrarRegistros,
  lerConversas,
  type Conversation,
} from '@/home/conversations';
import { readLocal } from '@/shared/services/storage';
import { armazenamentoLocal } from './armazenamento';
import { montarContextoInicial } from './contexto';
import { _definirTaq, perguntarAoTaq } from './interface';
import { registrosUsados, revalidarMemoria } from './memoria';
import type { AdaptadorDeModelo, PedidoDeTurno, RespostaDoTurno } from './modelo';
import { criarOrquestrador, type PedidoAoTaq } from './orquestrador';
import { escopoDaConversa } from './politica';
import type { AcoesDaInterface } from './tipos';

// ------------------------------------------------------------------ dados

function reuniao(id: string, title: string, dia: number, falas: string[]): MeetingRecord {
  const inicio = Date.UTC(2026, 8, dia, 13);
  return {
    id,
    title,
    startedAt: inicio,
    endedAt: inicio + falas.length * 20_000,
    durationSeconds: falas.length * 20,
    participants: [{ name: 'Ana', isHost: true }],
    segments: falas.map((text, i) => ({
      captionId: `${id}-${i}`,
      speaker: i % 2 ? 'Bruno' : 'Ana',
      text,
      startOffsetMs: i * 20_000,
      endOffsetMs: i * 20_000 + 9_000,
    })),
    status: 'ready',
    metadata: {
      capturedCaptions: true,
      droppedSegments: 0,
      reconnectCount: 0,
      wasDiscardedAndRestarted: false,
    },
  };
}

const SPRINT = reuniao('m-sprint', '[TESTE] Planejamento da Sprint 12', 18, [
  'Bruno propôs levar o deploy para quinta.',
  'Decidido: o prazo da entrega fica na sexta, dia 25. A Carla é a responsável.',
]);
const COMERCIAL = reuniao('m-comercial', '[TESTE] Reunião comercial', 19, [
  'A Orbital pediu desconto de 10%.',
  'Ninguém falou de prazo aqui.',
]);
const RECENTE = reuniao('m-recente', '[TESTE] Alinhamento geral', 21, ['Bom dia a todos.']);

function conversa(id: string, title: string, extra: Partial<Conversation> = {}): Conversation {
  return {
    id,
    title,
    createdAt: 1,
    updatedAt: 1_000 + id.length,
    messages: [
      { id: `${id}-1`, role: 'user', text: `[TESTE] mensagem em ${title}`, at: 1 },
      { id: `${id}-2`, role: 'assistant', text: 'O prazo é segunda.', at: 2 },
    ],
    ...extra,
  };
}

let acoes: AcoesDaInterface;

beforeEach(() => {
  installChromeStorageMock({
    local: {
      [STORAGE_KEYS.history]: [RECENTE, COMERCIAL, SPRINT],
      [STORAGE_KEYS.conversations]: [
        conversa('c-atual', '[TESTE] Conversa atual'),
        conversa('c-plan-a', '[TESTE] Planejamento Q3'),
        conversa('c-plan-b', '[TESTE] Planejamento Q4'),
        conversa('c-orbital', '[TESTE] Orbital'),
      ],
      [STORAGE_KEYS.documents]: [
        {
          id: 'd-da-conversa',
          title: '[TESTE] Ata gerada na conversa Orbital',
          content: 'x',
          formato: 'markdown',
          createdAt: 1,
          updatedAt: 1,
          origem: 'gerado',
          meetingId: 'm-comercial',
          conversationId: 'c-orbital',
        },
      ],
      [STORAGE_KEYS.taqExecucoes]: [
        { id: 'x1', conversaId: 'c-orbital' },
        { id: 'x2', conversaId: 'c-atual' },
      ],
    },
  });
  acoes = { enviar: vi.fn(async () => ({ ok: true })), abrirReuniao: vi.fn(), abrirDocumento: vi.fn() };
});

// --------------------------------------------------------- modelo roteirizado

type Passo =
  | RespostaDoTurno
  | ((p: PedidoDeTurno, sinal: AbortSignal) => RespostaDoTurno | Promise<RespostaDoTurno>);
const base = { uso: { entrada: 1, saida: 1 }, provedor: 't', modelo: 'roteiro', instrucoesVersao: 'x', latenciaMs: 1 };
const final = (texto: string): RespostaDoTurno => ({ ...base, tipo: 'final', texto, chamadas: [] });
const pede = (nome: string, argumentos: Record<string, unknown>): RespostaDoTurno => ({
  ...base,
  tipo: 'ferramentas',
  texto: '',
  chamadas: [{ id: `c-${nome}`, nome, argumentos }],
});
const delegar = (agente: string, objetivo: string) => pede('delegate_task', { agente, objetivo });

function roteiro(passos: Passo[]) {
  const pedidos: PedidoDeTurno[] = [];
  const modelo: AdaptadorDeModelo = {
    turno: vi.fn(async (p: PedidoDeTurno, sinal: AbortSignal) => {
      pedidos.push(structuredClone(p));
      const passo = passos.shift();
      if (!passo) throw new Error('roteiro acabou');
      return typeof passo === 'function' ? passo(p, sinal) : passo;
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

function executar(texto: string, modelo: AdaptadorDeModelo, extra: Partial<PedidoAoTaq> = {}) {
  return criarOrquestrador({ modelo, armazenamento: armazenamentoLocal }).executar({
    conversaId: 'c-atual',
    texto,
    anteriores: [],
    selecionados: [],
    acoes,
    ...extra,
  });
}

// ------------------------------------------------------------- recuperação

describe('recuperação', () => {
  it('"em qual reunião falamos do prazo?": acha a reunião certa, com id, data, trecho e local', async () => {
    let busca: Record<string, unknown> = {};
    const { modelo } = roteiro([
      pede('search_records', { consulta: 'prazo entrega' }),
      (p) => {
        busca = resultadoDe(p, 'search_records');
        return final('Foi no Planejamento da Sprint 12 [r1].');
      },
    ]);
    const r = await executar('Encontre a reunião em que discutimos o prazo da entrega.', modelo);
    const primeiro = (busca.resultados as Array<Record<string, unknown>>)[0]!;
    expect(primeiro).toMatchObject({ tipo: 'reuniao', id: 'm-sprint', data: '2026-09-18' });
    expect((primeiro.trechos as Array<Record<string, unknown>>)[0]).toMatchObject({
      ref: 'r1',
      segmento: 1,
      instante: '0:20',
    });
    // A fonte citada existe e abre o registro certo.
    expect(r.evidencias).toEqual([
      expect.objectContaining({ id: 'r1', registroId: 'm-sprint', tipo: 'reuniao' }),
    ]);
  });

  it('busca paginada: devolve a página pedida e diz se há a seguinte', async () => {
    let p1: Record<string, unknown> = {};
    let p2: Record<string, unknown> = {};
    const { modelo } = roteiro([
      pede('search_records', { consulta: '', tipos: ['reuniao'], limite: 2 }),
      (p) => {
        p1 = resultadoDe(p, 'search_records');
        return pede('search_records', { consulta: '', tipos: ['reuniao'], limite: 2, pagina: 2 });
      },
      (p) => {
        p2 = resultadoDe(p, 'search_records');
        return final('ok');
      },
    ]);
    await executar('Liste minhas reuniões', modelo);
    expect((p1.resultados as Array<{ id: string }>).map((x) => x.id)).toEqual(['m-recente', 'm-comercial']);
    expect(p1.proxima_pagina).toBe(2);
    expect((p2.resultados as Array<{ id: string }>).map((x) => x.id)).toEqual(['m-sprint']);
    expect(p2).not.toHaveProperty('proxima_pagina');
  });

  it('informação ausente: a busca diz que não achou, sem inventar', async () => {
    let busca: Record<string, unknown> = {};
    const { modelo } = roteiro([
      pede('search_records', { consulta: 'orçamento marketing' }),
      (p) => {
        busca = resultadoDe(p, 'search_records');
        return final('Não encontrei nada sobre orçamento de marketing nas reuniões.');
      },
    ]);
    const r = await executar('Qual foi o orçamento de marketing aprovado?', modelo);
    expect(busca).toMatchObject({ total: 0, aviso: expect.stringMatching(/Nada encontrado/) });
    expect(r.evidencias).toEqual([]);
  });

  it('conversas: acha outras conversas, diz quem escreveu, e resposta antiga do Taq não vira fonte', async () => {
    let busca: Record<string, unknown> = {};
    let leitura: Record<string, unknown> = {};
    const { modelo } = roteiro([
      pede('search_records', { consulta: 'prazo', tipos: ['conversa'] }),
      (p) => {
        busca = resultadoDe(p, 'search_records');
        return pede('read_conversation', { conversa_id: 'c-orbital' });
      },
      (p) => {
        leitura = resultadoDe(p, 'read_conversation');
        return final('ok');
      },
    ]);
    const r = await executar('O que eu já tinha perguntado sobre o prazo?', modelo);
    const conversas = busca.conversas as Array<{ id: string; trechos: Array<{ quem: string }> }>;
    // A conversa atual não entra: o histórico dela já está no contexto.
    expect(conversas.map((c) => c.id)).not.toContain('c-atual');
    expect(conversas[0]!.trechos[0]!.quem).toMatch(/resposta anterior do Taq \(não é fonte\)/);
    expect(leitura.mensagens).toEqual([
      expect.objectContaining({ mensagem: 0, quem: 'a pessoa' }),
      expect.objectContaining({ mensagem: 1, quem: 'resposta anterior do Taq (não é fonte)' }),
    ]);
    // Nada disso é citável como evidência.
    expect(r.evidencias).toEqual([]);
  });

  it('escopo na ferramenta: conversa da sidebar de uma reunião não lê conversa de outra', async () => {
    let leitura: Record<string, unknown> = {};
    const { modelo } = roteiro([
      pede('read_conversation', { conversa_id: 'c-orbital' }),
      (p) => {
        leitura = resultadoDe(p, 'read_conversation');
        return final('ok');
      },
    ]);
    await executar('O que foi conversado?', modelo, { meetingId: 'm-sprint' });
    expect(leitura).toMatchObject({ erro: { codigo: 'fora_do_escopo' } });
  });
});

// --------------------------------------------------------------- memória

describe('memória da conversa', () => {
  it('retomada: reabrir a conversa traz o foco, e "essa reunião" vira a ata DELA, não da mais recente', async () => {
    // A resposta anterior usou a Sprint — é o que a interface grava na memória.
    await lembrarRegistros('c-atual', [{ tipo: 'reuniao', id: 'm-sprint', titulo: SPRINT.title }]);

    // Um orquestrador NOVO, como depois de fechar e reabrir a HOME.
    const { modelo, pedidos } = roteiro([
      delegar('documents', 'Gerar uma ata da reunião em foco'),
      pede('create_document', { tipo: 'ata', secoes: [{ id: 'decisoes', conteudo: 'Prazo na sexta.' }] }),
      final('Criei a ata para revisão.'),
    ]);
    const r = await executar('Agora gere uma ata dessa reunião', modelo);

    const contexto = pedidos[0]!.contexto;
    expect(contexto).toMatch(/EM FOCO \(o último de que a conversa falou\): reuniao m-sprint/);
    expect(r.documentos).toHaveLength(1);
    const doc = (await lerDocumentos()).find((d) => d.id === r.documentos[0]!.id)!;
    expect(doc).toMatchObject({ meetingId: 'm-sprint', conversationId: 'c-atual', tipo: 'Ata de Reunião' });
  });

  it('a tela vence o foco; e o que a resposta usou vira o foco seguinte', async () => {
    await lembrarRegistros('c-atual', [{ tipo: 'reuniao', id: 'm-sprint', titulo: SPRINT.title }]);
    const { modelo } = roteiro([
      delegar('documents', 'ata'),
      pede('create_document', { tipo: 'ata', secoes: [{ id: 'decisoes', conteudo: 'x' }] }),
      final('ok'),
    ]);
    const r = await executar('Gere uma ata dessa reunião', modelo, {
      selecionados: [{ tipo: 'reuniao', id: 'm-comercial' }],
    });
    const doc = (await lerDocumentos()).find((d) => d.id === r.documentos[0]!.id)!;
    expect(doc.meetingId).toBe('m-comercial');
    expect(registrosUsados(r)[0]).toMatchObject({ tipo: 'documento', id: doc.id });
  });

  it('revalida: registro apagado sai da memória; renomeado aparece com o nome novo', async () => {
    await lembrarRegistros('c-atual', [
      { tipo: 'reuniao', id: 'm-apagada', titulo: 'Não existe mais' },
      { tipo: 'reuniao', id: 'm-sprint', titulo: 'Nome antigo da sprint' },
    ]);
    const c = (await lerConversas()).find((x) => x.id === 'c-atual');
    const escopo = escopoDaConversa({ conversaId: 'c-atual', texto: 'x' });
    const m = await revalidarMemoria(c, escopo, armazenamentoLocal);
    expect(m.foco).toBeUndefined(); // o foco era a apagada
    expect(m.recentes).toEqual([
      { tipo: 'reuniao', id: 'm-sprint', titulo: SPRINT.title, tituloAnterior: 'Nome antigo da sprint' },
    ]);
    expect(m.descartados).toBe(1);
    const contexto = await montarContextoInicial(
      { escopo, selecionados: [], conversaId: 'c-atual' },
      armazenamentoLocal,
    );
    expect(contexto).not.toMatch(/m-apagada/);
    expect(contexto).toMatch(/1 registro\(s\) usado\(s\) antes foram apagados/);
  });
});

// ------------------------------------------------------ apagar conversas

describe('apagar conversas', () => {
  it('pelo nome: resolve para o id real, apaga só ela, e reuniões e documentos ficam', async () => {
    let resultado: Record<string, unknown> = {};
    const { modelo } = roteiro([
      delegar('app_assistant', 'Apagar a conversa Orbital'),
      pede('delete_conversation', { conversas: ['Orbital'] }),
      (p) => {
        resultado = resultadoDe(p, 'delete_conversation');
        return final('Apaguei a conversa “[TESTE] Orbital”. Reuniões e documentos continuam guardados.');
      },
    ]);
    const r = await executar('Exclua a conversa chamada Orbital', modelo);

    expect(resultado).toMatchObject({ apagada: true, documentos_mantidos_sem_vinculo: 1 });
    expect(r.operacoes).toEqual([
      { acao: 'apagar', tipo: 'conversa', id: 'c-orbital', titulo: '[TESTE] Orbital', ok: true },
    ]);
    expect((await lerConversas()).map((c) => c.id)).toEqual(['c-atual', 'c-plan-a', 'c-plan-b']);
    // O documento gerado nela continua, sem o vínculo; a reunião, intacta.
    const doc = (await lerDocumentos()).find((d) => d.id === 'd-da-conversa')!;
    expect(doc).toBeDefined();
    expect(doc.conversationId).toBeUndefined();
    expect(doc.meetingId).toBe('m-comercial');
    expect((await armazenamentoLocal.listarReunioes()).map((x) => x.id)).toContain('m-comercial');
    // O registro das execuções DELA saiu; o das outras ficou.
    const execucoes = (await readLocal<Array<{ id: string }>>(STORAGE_KEYS.taqExecucoes))!.map((e) => e.id);
    expect(execucoes).toContain('x2');
    expect(execucoes).not.toContain('x1');
  });

  it('nome ambíguo: pergunta qual, com opções reais, e NÃO apaga nada', async () => {
    // A pergunta registrada pela ferramenta encerra o turno: não há passo depois.
    const { modelo, pedidos } = roteiro([
      delegar('app_assistant', 'Apagar a conversa Planejamento'),
      pede('delete_conversation', { conversas: ['Planejamento'] }),
    ]);
    const r = await executar('Apague a conversa Planejamento', modelo);
    expect(pedidos).toHaveLength(2);
    expect(r.resposta).toMatch(/Qual delas eu apago\?/);
    expect(r.pergunta).toMatchObject({ motivo: 'escolha_de_registro' });
    expect(r.pergunta!.opcoes.map((o) => o.mensagem)).toEqual([
      'Apague a conversa “[TESTE] Planejamento Q3” (id c-plan-a).',
      'Apague a conversa “[TESTE] Planejamento Q4” (id c-plan-b).',
    ]);
    expect((await lerConversas()).map((c) => c.id)).toHaveLength(4);
    expect((r.operacoes ?? []).filter((o) => o.ok)).toEqual([]);
  });

  it('a opção escolhida continua o pedido e apaga a conversa pelo id', async () => {
    const { modelo } = roteiro([
      delegar('app_assistant', 'Apagar a conversa c-plan-b'),
      pede('delete_conversation', { conversas: ['c-plan-b'] }),
      final('Apaguei “[TESTE] Planejamento Q4”.'),
    ]);
    const r = await executar('Apague a conversa “[TESTE] Planejamento Q4” (id c-plan-b).', modelo, {
      continua: 'escolha_de_registro',
    });
    expect(r.operacoes).toEqual([expect.objectContaining({ id: 'c-plan-b', ok: true })]);
    expect((await lerConversas()).map((c) => c.id)).not.toContain('c-plan-b');
    expect((await lerConversas()).map((c) => c.id)).toContain('c-plan-a');
  });

  it('"as que selecionei": a tela não tem seleção de conversas — não apaga nada', async () => {
    let resultado: Record<string, unknown> = {};
    const { modelo } = roteiro([
      delegar('app_assistant', 'Apagar as conversas selecionadas'),
      pede('delete_conversation', { conversas: ['as que selecionei'] }),
      (p) => {
        resultado = resultadoDe(p, 'delete_conversation');
        return final('Não consigo identificar quais: diga os nomes delas.');
      },
    ]);
    await executar('Apague aquelas duas conversas que selecionei', modelo);
    expect(resultado).toMatchObject({ erro: { codigo: 'alvo_nao_identificado' } });
    expect(await lerConversas()).toHaveLength(4);
  });

  it('falha na gravação: não confirma sucesso', async () => {
    const original = armazenamentoLocal.apagarConversas;
    armazenamentoLocal.apagarConversas = vi.fn(async () => {
      throw new Error('disco cheio');
    });
    try {
      let resultado: Record<string, unknown> = {};
      const { modelo } = roteiro([
        delegar('app_assistant', 'Apagar a conversa Orbital'),
        pede('delete_conversation', { conversas: ['Orbital'] }),
        (p) => {
          resultado = resultadoDe(p, 'delete_conversation');
          return final('Não consegui apagar: o aplicativo recusou.');
        },
      ]);
      const r = await executar('Apague a conversa Orbital', modelo);
      expect(resultado).toMatchObject({ erro: { codigo: 'operacao_falhou' } });
      expect(r.operacoes).toEqual([expect.objectContaining({ id: 'c-orbital', ok: false })]);
    } finally {
      armazenamentoLocal.apagarConversas = original;
    }
  });

  it('apagada: some da lista, da busca, da leitura e da memória, mesmo relendo tudo do storage', async () => {
    await lembrarRegistros('c-orbital', [{ tipo: 'reuniao', id: 'm-comercial', titulo: COMERCIAL.title }]);
    await apagarConversas(['c-orbital']);

    // "Recarregar": nada em memória — só o que está no storage.
    expect((await lerConversas()).map((c) => c.id)).not.toContain('c-orbital');
    let busca: Record<string, unknown> = {};
    let leitura: Record<string, unknown> = {};
    const { modelo } = roteiro([
      pede('search_records', { consulta: 'Orbital', tipos: ['conversa'] }),
      (p) => {
        busca = resultadoDe(p, 'search_records');
        return pede('read_conversation', { conversa_id: 'c-orbital' });
      },
      (p) => {
        leitura = resultadoDe(p, 'read_conversation');
        return final('ok');
      },
    ]);
    await executar('Procure a conversa Orbital', modelo);
    expect(busca.conversas ?? []).toEqual([]);
    expect(leitura).toMatchObject({ erro: { codigo: 'nao_encontrado' } });
  });
});

describe('pela interface', () => {
  it('a resposta grava o foco na conversa, e a pergunta seguinte o recebe', async () => {
    const id = await acrescentarMensagem(null, { texto: '[TESTE] O que ficou decidido sobre o prazo?' });
    const { modelo, pedidos } = roteiro([
      pede('search_records', { consulta: 'prazo entrega' }),
      final('O prazo da entrega ficou na sexta [r1].'),
      final('A responsável é a Carla.'),
    ]);
    _definirTaq({ orquestrador: criarOrquestrador({ modelo, armazenamento: armazenamentoLocal }) });
    try {
      await perguntarAoTaq({ conversaId: id, texto: '[TESTE] O que ficou decidido sobre o prazo?' });
      const salva = (await lerConversas()).find((c) => c.id === id)!;
      expect(salva.memoria?.foco).toMatchObject({ tipo: 'reuniao', id: 'm-sprint' });
      expect(salva.messages.at(-1)).toMatchObject({
        role: 'assistant',
        fontes: [expect.objectContaining({ registroId: 'm-sprint' })],
      });

      await acrescentarMensagem(id, { texto: 'Quem ficou responsável por essa entrega?' });
      await perguntarAoTaq({ conversaId: id, texto: 'Quem ficou responsável por essa entrega?' });
      expect(pedidos.at(-1)!.contexto).toMatch(/EM FOCO.*m-sprint/);
    } finally {
      _definirTaq({ orquestrador: null });
    }
  });
});

// ------------------------------------------ resposta tardia não ressuscita

describe('resposta em andamento numa conversa apagada', () => {
  it('é cancelada, e nem a resposta nem a memória recriam a conversa', async () => {
    const id = await acrescentarMensagem(null, { texto: '[TESTE] O que ficou decidido na sprint?' });
    let abortado = false;
    const { modelo } = roteiro([
      pede('search_records', { consulta: 'decidido' }),
      async (_p, sinal) => {
        // Enquanto o Taq "pensa", a pessoa apaga a conversa (noutra aba, p. ex.).
        // O modelo simulado se comporta como o fetch do adaptador real: o
        // abort derruba a chamada em curso.
        await apagarConversas([id]);
        await new Promise<void>((_, falhar) => {
          const parar = () => {
            abortado = true;
            falhar(new DOMException('abortado', 'AbortError'));
          };
          if (sinal.aborted) parar();
          else sinal.addEventListener('abort', parar, { once: true });
        });
        return final('O prazo ficou na sexta [r1].');
      },
    ]);
    _definirTaq({ orquestrador: criarOrquestrador({ modelo, armazenamento: armazenamentoLocal }) });
    try {
      const r = await perguntarAoTaq({ conversaId: id, texto: '[TESTE] O que ficou decidido na sprint?' });
      expect(abortado).toBe(true);
      expect(r?.estado).toBe('cancelado');
      expect((await lerConversas()).some((c) => c.id === id)).toBe(false);
      // Nenhuma conversa nova com a resposta tardia, também.
      expect((await lerConversas()).map((c) => c.id).sort()).toEqual(
        ['c-atual', 'c-orbital', 'c-plan-a', 'c-plan-b'].sort(),
      );
    } finally {
      _definirTaq({ orquestrador: null });
    }
  });
});
