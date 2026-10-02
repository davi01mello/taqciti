import { describe, expect, it, vi } from 'vitest';
import { OverloadedError, ProviderError, RateLimitError } from '@/lib/ai/types';
import { resolverConfiguracao } from './config';
import { criarAdaptadorGroq, ErroDeChamadaDoModelo, paraMensagensOpenAI } from './groq';
import { atenderTurno } from './atender';
import type { PedidoAoAdaptador } from './gemini';

const PEDIDO: PedidoAoAdaptador = {
  sistema: 'Você é o Taq.',
  contexto: '[CONTEXTO] reuniões: Sprint 12',
  mensagens: [
    { papel: 'pessoa', texto: 'O que foi decidido?' },
    {
      papel: 'modelo',
      texto: '',
      chamadas: [{ id: 'call_1', nome: 'search_records', argumentos: { consulta: 'deploy' } }],
    },
    {
      papel: 'ferramenta',
      resultados: [{ chamadaId: 'call_1', nome: 'search_records', conteudo: { resultados: [] } }],
    },
  ],
  ferramentas: [
    { nome: 'search_records', descricao: 'Busca registros.', parametros: { type: 'object', properties: {} } },
  ],
  maxTokensDeSaida: 512,
};

function resposta(status: number, corpo: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(corpo), { status, headers });
}

function adaptador(r: Response) {
  const fetchFalso = vi.fn(async () => r);
  return { fetchFalso, groq: criarAdaptadorGroq({ chave: () => 'gsk_teste', fetch: fetchFalso }) };
}

describe('Groq (temporário)', () => {
  it('converte o histórico: contexto antes da primeira pergunta, chamadas e resultados casados por id', () => {
    const m = paraMensagensOpenAI(PEDIDO.sistema, PEDIDO.contexto, PEDIDO.mensagens);
    expect(m.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(m[1]).toMatchObject({ content: expect.stringMatching(/^\[CONTEXTO\][\s\S]*O que foi decidido\?$/) });
    expect(m[2]).toMatchObject({
      content: null,
      tool_calls: [{ id: 'call_1', function: { name: 'search_records', arguments: '{"consulta":"deploy"}' } }],
    });
    expect(m[3]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{"resultados":[]}' });
  });

  it('manda ferramentas no formato da OpenAI e lê as chamadas de volta', async () => {
    const { fetchFalso, groq } = adaptador(
      resposta(200, {
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [{ id: 'call_9', function: { name: 'read_meeting', arguments: '{"id":"m1"}' } }],
            },
          },
        ],
        usage: { prompt_tokens: 900, completion_tokens: 30 },
      }),
    );
    const r = await groq.executar('openai/gpt-oss-120b', PEDIDO);
    expect(r).toMatchObject({
      tipo: 'ferramentas',
      chamadas: [{ id: 'call_9', nome: 'read_meeting', argumentos: { id: 'm1' } }],
      uso: { entrada: 900, saida: 30 },
      provedor: 'groq',
    });
    expect(r.continuacao).toBeUndefined();
    const [url, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer gsk_teste');
    const corpo = JSON.parse(String(init.body));
    expect(corpo).toMatchObject({
      model: 'openai/gpt-oss-120b',
      max_completion_tokens: 512,
      tool_choice: 'auto',
      tools: [{ type: 'function', function: { name: 'search_records' } }],
    });
  });

  it('resposta final e truncada', async () => {
    const final = await adaptador(
      resposta(200, { choices: [{ finish_reason: 'stop', message: { content: 'Ficou na sexta.' } }] }),
    ).groq.executar('m', PEDIDO);
    expect(final).toMatchObject({ tipo: 'final', texto: 'Ficou na sexta.', chamadas: [] });
    const cortada = await adaptador(
      resposta(200, { choices: [{ finish_reason: 'length', message: { content: 'Ficou na' } }] }),
    ).groq.executar('m', PEDIDO);
    expect(cortada.tipo).toBe('truncado');
  });

  it('cita 【r2】 do gpt-oss como [r2], que é o que a extensão reconhece', async () => {
    const r = await adaptador(
      resposta(200, {
        choices: [{ finish_reason: 'stop', message: { content: 'Ficou na sexta【r3】 e antes na quinta【r2†L1-L3】.' } }],
      }),
    ).groq.executar('m', PEDIDO);
    expect(r.texto).toBe('Ficou na sexta[r3] e antes na quinta[r2].');
  });

  it('limite por minuto com espera curta: espera e tenta de novo, uma vez', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValueOnce(
        resposta(429, { error: { message: 'Rate limit reached on tokens per minute (TPM). Please try again in 0.05s.' } }),
      )
      .mockResolvedValueOnce(resposta(200, { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }));
    const groq = criarAdaptadorGroq({ chave: () => 'k', fetch: fetchFalso });
    expect((await groq.executar('m', PEDIDO)).texto).toBe('ok');
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it('chamada de ferramenta recusada pelo Groq (visto ao vivo) volta como transitória', async () => {
    const r = await adaptador(
      resposta(400, {
        error: {
          message:
            'Tool call validation failed: parameters for tool read_meeting did not match schema: errors: [/quantidade: maximum: got 100, want 40]',
        },
      }),
    )
      .groq.executar('m', PEDIDO)
      .catch((e: unknown) => e);
    expect(r).toBeInstanceOf(ErroDeChamadaDoModelo);

    const turno = await atenderTurno(
      { instrucoes: 'taq-v7', contexto: '', mensagens: [{ papel: 'pessoa', texto: 'oi' }], maxTokensDeSaida: 256 },
      {
        adaptadores: { groq: { provedor: 'groq', executar: async () => { throw r; } } },
        env: { TAQ_ORQUESTRADOR: 'groq:m', GROQ_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv,
      },
    );
    expect(turno.corpo).toMatchObject({ erro: { codigo: 'falha_do_provedor', transitorio: true } });
  });

  it('429 por minuto com espera longa volta como erro transitório; por dia não; 503 é sobrecarga', async () => {
    const minuto = await adaptador(
      resposta(429, { error: { message: 'Rate limit reached on tokens per minute (TPM)' } }, { 'retry-after': '45' }),
    )
      .groq.executar('m', PEDIDO)
      .catch((e: unknown) => e);
    expect(minuto).toBeInstanceOf(RateLimitError);
    expect(minuto).toMatchObject({ perDay: false, retryAfterMs: 45000 });

    const dia = await adaptador(
      resposta(429, { error: { message: 'Rate limit reached on tokens per day (TPD)' } }),
    )
      .groq.executar('m', PEDIDO)
      .catch((e: unknown) => e);
    expect(dia).toMatchObject({ perDay: true });

    const cheio = await adaptador(resposta(503, { error: { message: 'over capacity' } }))
      .groq.executar('m', PEDIDO)
      .catch((e: unknown) => e);
    expect(cheio).toBeInstanceOf(OverloadedError);

    const ruim = await adaptador(resposta(400, { error: { message: 'tool_use_failed' } }))
      .groq.executar('m', PEDIDO)
      .catch((e: unknown) => e);
    expect(ruim).toBeInstanceOf(ProviderError);
    expect((ruim as Error).message).toContain('tool_use_failed');
  });

  it('configuração: groq:<modelo> com a chave fica pronto; sem ela, pendente', () => {
    const pronto = resolverConfiguracao({ TAQ_ORQUESTRADOR: 'groq:openai/gpt-oss-120b', GROQ_API_KEY: 'x' } as unknown as NodeJS.ProcessEnv);
    expect(pronto).toMatchObject({ provedor: 'groq', modelo: 'openai/gpt-oss-120b', pendencias: [] });
    const sem = resolverConfiguracao({ TAQ_ORQUESTRADOR: 'groq:openai/gpt-oss-120b' } as unknown as NodeJS.ProcessEnv);
    expect(sem.pendencias.join(' ')).toMatch(/GROQ_API_KEY/);
    const vazio = resolverConfiguracao({ TAQ_ORQUESTRADOR: 'groq:' } as unknown as NodeJS.ProcessEnv);
    expect(vazio.pendencias.join(' ')).toMatch(/modelo está vazio/);
  });
});
