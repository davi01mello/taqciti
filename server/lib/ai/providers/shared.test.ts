import { describe, expect, it, vi } from 'vitest';
import { runCompletion, type RawInvocation } from './shared';
import type { CompletionRequest, JsonSchema } from '../types';

const schema: JsonSchema = {
  type: 'object',
  properties: {
    saudacao: { type: 'string' },
    idioma: { type: 'string', enum: ['pt', 'en'] },
  },
  required: ['saudacao', 'idioma'],
  additionalProperties: false,
};

const VALID = '{"saudacao":"ok","idioma":"pt"}';

function request(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    system: 'INSTRUCAO ORIGINAL',
    messages: [{ role: 'user', content: 'PERGUNTA' }],
    maxTokens: 1024,
    ...overrides,
  };
}

describe('laço de reparo', () => {
  it('acerto de primeira: uma chamada, repaired false, parsed preenchido', async () => {
    const invoke = vi.fn().mockResolvedValue({
      text: VALID,
      usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 2 },
    });

    const result = await runCompletion(
      'anthropic',
      'modelo-falso',
      request({ jsonSchema: schema }),
      { nativeStructuredOutput: true },
      invoke,
    );

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.meta.repaired).toBe(false);
    expect(result.parsed).toEqual({ saudacao: 'ok', idioma: 'pt' });
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 2 });
  });

  it('erro seguido de acerto: duas chamadas, repaired true, usage somado', async () => {
    // O usage somado importa: se só a segunda chamada contasse, o custo
    // de um provedor que repara sempre pareceria igual ao de um que acerta.
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ text: '{"idioma":"fr"}', usage: { inputTokens: 10, outputTokens: 5 } })
      .mockResolvedValueOnce({ text: VALID, usage: { inputTokens: 20, outputTokens: 7 } });

    const result = await runCompletion(
      'xai',
      'modelo-falso',
      request({ jsonSchema: schema }),
      { nativeStructuredOutput: true },
      invoke,
    );

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.meta.repaired).toBe(true);
    expect(result.usage.inputTokens).toBe(30);
    expect(result.usage.outputTokens).toBe(12);
  });

  it('a chamada de reparo devolve ao modelo a saída dele e os erros', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ text: '{"idioma":"fr"}', usage: { inputTokens: 1, outputTokens: 1 } })
      .mockResolvedValueOnce({ text: VALID, usage: { inputTokens: 1, outputTokens: 1 } });

    await runCompletion(
      'google',
      'modelo-falso',
      request({ jsonSchema: schema }),
      { nativeStructuredOutput: true },
      invoke,
    );

    const second = invoke.mock.calls[1]![0] as RawInvocation;
    expect(second.messages.at(-2)).toEqual({ role: 'assistant', content: '{"idioma":"fr"}' });
    const repairPrompt = second.messages.at(-1)!.content;
    expect(repairPrompt).toContain('enum');
    expect(repairPrompt).toContain('saudacao');
  });

  it('falha dupla lança ProviderError e para em duas chamadas', async () => {
    // Uma tentativa, não um laço. Provedor que não acerta a forma em duas
    // passadas é informação sobre o provedor, não algo pra insistir.
    const invoke = vi.fn().mockResolvedValue({
      text: 'nao sou json',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    await expect(
      runCompletion(
        'google',
        'modelo-falso',
        request({ jsonSchema: schema }),
        { nativeStructuredOutput: true },
        invoke,
      ),
    ).rejects.toThrow(/não satisfez o schema nem após reparo/);

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('sem jsonSchema não valida nada e devolve o texto cru', async () => {
    const invoke = vi.fn().mockResolvedValue({
      text: 'texto livre, sem json nenhum',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const result = await runCompletion(
      'anthropic',
      'modelo-falso',
      request(),
      { nativeStructuredOutput: true },
      invoke,
    );

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.text).toBe('texto livre, sem json nenhum');
    expect(result.parsed).toBeUndefined();
    expect(result.meta.repaired).toBe(false);
  });

  it('preenche meta com provedor, modelo e latência', async () => {
    const invoke = vi.fn().mockResolvedValue({ text: 'ok', usage: { inputTokens: 1, outputTokens: 1 } });
    const result = await runCompletion('xai', 'grok-falso', request(), { nativeStructuredOutput: true }, invoke);

    expect(result.meta.provider).toBe('xai');
    expect(result.meta.model).toBe('grok-falso');
    expect(result.meta.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('degradação quando não há saída estruturada nativa', () => {
  it('injeta o schema no system e não manda jsonSchema no payload', async () => {
    const invoke = vi.fn().mockResolvedValue({ text: VALID, usage: { inputTokens: 1, outputTokens: 1 } });

    await runCompletion(
      'xai',
      'modelo-falso',
      request({ jsonSchema: schema }),
      { nativeStructuredOutput: false },
      invoke,
    );

    const invocation = invoke.mock.calls[0]![0] as RawInvocation;
    expect(invocation.jsonSchema).toBeUndefined();
    expect(invocation.system.startsWith('INSTRUCAO ORIGINAL')).toBe(true);
    expect(invocation.system).toContain('JSON Schema:');
    expect(invocation.system).toContain('saudacao');
  });

  it('com nativa, o schema vai no payload e não polui o system', async () => {
    const invoke = vi.fn().mockResolvedValue({ text: VALID, usage: { inputTokens: 1, outputTokens: 1 } });

    await runCompletion(
      'anthropic',
      'modelo-falso',
      request({ jsonSchema: schema }),
      { nativeStructuredOutput: true },
      invoke,
    );

    const invocation = invoke.mock.calls[0]![0] as RawInvocation;
    expect(invocation.jsonSchema).toBe(schema);
    expect(invocation.system).toBe('INSTRUCAO ORIGINAL');
  });
});

describe('posicionamento do cacheablePrefix', () => {
  it('põe o prefixo no início da primeira mensagem de usuário', async () => {
    // Todo cache de prefixo casa por bytes desde o começo do prompt. Se o
    // conteúdo volátil vier antes do estável, o cache nunca dá hit — nos
    // três provedores.
    const invoke = vi.fn().mockResolvedValue({ text: 'ok', usage: { inputTokens: 1, outputTokens: 1 } });

    await runCompletion(
      'anthropic',
      'modelo-falso',
      request({ cacheablePrefix: 'CONTEXTO ESTAVEL' }),
      { nativeStructuredOutput: true },
      invoke,
    );

    const invocation = invoke.mock.calls[0]![0] as RawInvocation;
    expect(invocation.messages).toHaveLength(1);
    expect(invocation.messages[0]!.content.startsWith('CONTEXTO ESTAVEL')).toBe(true);
    expect(invocation.messages[0]!.content.endsWith('PERGUNTA')).toBe(true);
    expect(invocation.cacheablePrefixLength).toBe('CONTEXTO ESTAVEL'.length);
  });

  it('o comprimento informado recorta exatamente o prefixo', async () => {
    // O adaptador da Anthropic fatia por este número pra marcar o
    // breakpoint; se ele estiver deslocado, o breakpoint cai no meio do
    // conteúdo e o cache não bate.
    const invoke = vi.fn().mockResolvedValue({ text: 'ok', usage: { inputTokens: 1, outputTokens: 1 } });
    const prefix = 'CONTEXTO ESTAVEL';

    await runCompletion(
      'anthropic',
      'modelo-falso',
      request({ cacheablePrefix: prefix }),
      { nativeStructuredOutput: true },
      invoke,
    );

    const invocation = invoke.mock.calls[0]![0] as RawInvocation;
    const sliced = invocation.messages[0]!.content.slice(0, invocation.cacheablePrefixLength);
    expect(sliced).toBe(prefix);
  });

  it('cria uma mensagem de usuário quando a conversa não começa com uma', async () => {
    const invoke = vi.fn().mockResolvedValue({ text: 'ok', usage: { inputTokens: 1, outputTokens: 1 } });

    await runCompletion(
      'anthropic',
      'modelo-falso',
      request({
        cacheablePrefix: 'CONTEXTO',
        messages: [{ role: 'assistant', content: 'turno anterior' }],
      }),
      { nativeStructuredOutput: true },
      invoke,
    );

    const invocation = invoke.mock.calls[0]![0] as RawInvocation;
    expect(invocation.messages[0]).toEqual({ role: 'user', content: 'CONTEXTO' });
    expect(invocation.messages[1]).toEqual({ role: 'assistant', content: 'turno anterior' });
  });

  it('sem cacheablePrefix não mexe nas mensagens', async () => {
    const invoke = vi.fn().mockResolvedValue({ text: 'ok', usage: { inputTokens: 1, outputTokens: 1 } });

    await runCompletion('anthropic', 'modelo-falso', request(), { nativeStructuredOutput: true }, invoke);

    const invocation = invoke.mock.calls[0]![0] as RawInvocation;
    expect(invocation.messages).toEqual([{ role: 'user', content: 'PERGUNTA' }]);
    expect(invocation.cacheablePrefixLength).toBeUndefined();
  });
});
