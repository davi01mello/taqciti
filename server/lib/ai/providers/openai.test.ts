/**
 * O adaptador OpenAI, sem tocar a rede.
 *
 * Nenhum teste deste arquivo tem permissão de sair da máquina: o `transporte` é
 * injetado, e um transporte que ninguém injetou seria um teste que chama a API
 * de verdade e gasta crédito. O primeiro caso abaixo existe para provar
 * justamente isso — que o provedor construído com transporte falso nunca
 * alcança o `fetch` global.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarOpenAIProvider } from './openai';
import { OverloadedError, ProviderError, RateLimitError } from '../types';

const CHAVE = () => 'chave-de-teste';

/** Uma resposta HTTP de mentira, no formato que o adaptador lê. */
function resposta(corpo: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(corpo), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function respostaDeTexto(texto: string, uso?: Record<string, unknown>) {
  return resposta({
    choices: [{ message: { content: texto }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 20, ...(uso ?? {}) },
  });
}

const PEDIDO = {
  system: 'Você resume reuniões.',
  messages: [{ role: 'user' as const, content: 'Resuma isto.' }],
  maxTokens: 512,
};

beforeEach(() => {
  // Sem espera: os testes de 429 e 503 seriam segundos de sono à toa.
  process.env.DOCCITI_RATE_LIMIT_RETRIES = '0';
});

afterEach(() => {
  delete process.env.DOCCITI_RATE_LIMIT_RETRIES;
  vi.restoreAllMocks();
});

describe('a rede é uma costura, e ela está fechada', () => {
  it('não chama o fetch global', async () => {
    const fetchGlobal = vi.spyOn(globalThis, 'fetch');
    const transporte = vi.fn(async () => respostaDeTexto('ok'));

    await criarOpenAIProvider({ transporte, apiKey: CHAVE }).complete('gpt-4.1-mini', PEDIDO);

    expect(transporte).toHaveBeenCalledTimes(1);
    expect(fetchGlobal).not.toHaveBeenCalled();
  });

  it('manda a chave no cabeçalho, e o modelo no corpo', async () => {
    // Os parâmetros são declarados para o `mock.calls` vir tipado — sem eles,
    // TypeScript infere a tupla vazia e `calls[0][1]` deixa de existir.
    const transporte = vi.fn(async (_url: string, _init: RequestInit) => respostaDeTexto('ok'));
    await criarOpenAIProvider({ transporte, apiKey: CHAVE }).complete('gpt-4.1-mini', PEDIDO);

    const [url, init] = transporte.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer chave-de-teste');

    const corpo = JSON.parse(init!.body as string);
    expect(corpo.model).toBe('gpt-4.1-mini');
    expect(corpo.max_completion_tokens).toBe(512);
    // O system vai como mensagem de papel `system`, e não concatenado no user.
    expect(corpo.messages[0]).toEqual({ role: 'system', content: 'Você resume reuniões.' });
  });

  it('a chave só é lida na hora da chamada', () => {
    const apiKey = vi.fn(CHAVE);
    criarOpenAIProvider({ transporte: async () => respostaDeTexto('ok'), apiKey });
    // Construir o provedor no topo de um módulo não pode exigir a chave: é o
    // que permite importar a camada num ambiente que roda só no mock.
    expect(apiKey).not.toHaveBeenCalled();
  });
});

describe('o que volta', () => {
  it('devolve o texto e normaliza o uso', async () => {
    const transporte = async () => respostaDeTexto('Três decisões e um pendente.');
    const r = await criarOpenAIProvider({ transporte, apiKey: CHAVE }).complete('gpt-4.1-mini', PEDIDO);

    expect(r.text).toBe('Três decisões e um pendente.');
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(r.meta.provider).toBe('openai');
    expect(r.meta.repaired).toBe(false);
  });

  /*
   * `prompt_tokens` da OpenAI JÁ INCLUI o que veio de cache — ao contrário da
   * Anthropic, onde é preciso somar. Confundir os dois infla ou desconta a
   * conta de custo justamente no provedor que se quer comparar.
   */
  it('conta o cache dentro da entrada, sem somar de novo', async () => {
    const transporte = async () =>
      respostaDeTexto('ok', { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 80 } });
    const r = await criarOpenAIProvider({ transporte, apiKey: CHAVE }).complete('gpt-4.1-mini', PEDIDO);

    expect(r.usage.inputTokens).toBe(100);
    expect(r.usage.cachedInputTokens).toBe(80);
  });
});

describe('saída estruturada', () => {
  const schema = {
    type: 'object',
    properties: { titulo: { type: 'string' } },
    required: ['titulo'],
  };

  it('pede json_schema nativo e devolve o valor validado', async () => {
    const transporte = vi.fn(async (_url: string, _init: RequestInit) =>
      respostaDeTexto('{"titulo":"Kickoff"}'),
    );
    const r = await criarOpenAIProvider({ transporte, apiKey: CHAVE }).complete('gpt-4.1-mini', {
      ...PEDIDO,
      jsonSchema: schema,
    });

    const corpo = JSON.parse(transporte.mock.calls[0]![1]!.body as string);
    expect(corpo.response_format.type).toBe('json_schema');
    expect(corpo.response_format.json_schema.schema).toEqual(schema);
    // Sem `strict`: o schema deste servidor não atende às exigências dele —
    // ver o cabeçalho do adaptador. Quem garante a forma é o reparo.
    expect(corpo.response_format.json_schema.strict).toBeUndefined();
    expect(r.parsed).toEqual({ titulo: 'Kickoff' });
  });

  it('repara uma vez quando a forma não vem, e diz que reparou', async () => {
    let chamada = 0;
    const transporte = async () => {
      chamada += 1;
      return respostaDeTexto(chamada === 1 ? 'não é JSON nenhum' : '{"titulo":"Kickoff"}');
    };

    const r = await criarOpenAIProvider({ transporte, apiKey: CHAVE }).complete('gpt-4.1-mini', {
      ...PEDIDO,
      jsonSchema: schema,
    });

    expect(chamada).toBe(2);
    expect(r.meta.repaired).toBe(true);
    expect(r.parsed).toEqual({ titulo: 'Kickoff' });
    // O uso das DUAS chamadas entra na conta: o reparo custou dinheiro.
    expect(r.usage.inputTokens).toBe(200);
  });

  it('falha explicitamente quando nem o reparo acerta', async () => {
    const transporte = async () => respostaDeTexto('continua não sendo JSON');
    await expect(
      criarOpenAIProvider({ transporte, apiKey: CHAVE }).complete('gpt-4.1-mini', {
        ...PEDIDO,
        jsonSchema: schema,
      }),
    ).rejects.toThrow(/não satisfez o schema/);
  });
});

describe('os erros do provedor, traduzidos', () => {
  it('429 vira RateLimitError com o retry-after', async () => {
    const transporte = async () =>
      resposta({ error: { message: 'rate limit', type: 'rate_limit_exceeded' } }, {
        status: 429,
        headers: { 'retry-after': '3' },
      });

    const erro = await criarOpenAIProvider({ transporte, apiKey: CHAVE })
      .complete('gpt-4.1-mini', PEDIDO)
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(RateLimitError);
    expect((erro as RateLimitError).retryAfterMs).toBe(3000);
    expect((erro as RateLimitError).perDay).toBe(false);
  });

  /*
   * Saldo esgotado não reabre esperando — é o análogo da cota diária do Google,
   * e foi ela que custou 16 minutos de espera inútil numa geração medida. Ver
   * `RateLimitError.perDay`.
   */
  it('saldo esgotado é marcado como não-esperável', async () => {
    const transporte = async () =>
      resposta({ error: { message: 'sem saldo', type: 'insufficient_quota' } }, { status: 429 });

    const erro = await criarOpenAIProvider({ transporte, apiKey: CHAVE })
      .complete('gpt-4.1-mini', PEDIDO)
      .catch((e: unknown) => e);

    expect((erro as RateLimitError).perDay).toBe(true);
  });

  it('5xx vira OverloadedError', async () => {
    const transporte = async () => resposta({ error: { message: 'oops' } }, { status: 503 });
    const erro = await criarOpenAIProvider({ transporte, apiKey: CHAVE })
      .complete('gpt-4.1-mini', PEDIDO)
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(OverloadedError);
  });

  it('400 sobe na hora, sem repetir', async () => {
    const transporte = vi.fn(async () =>
      resposta({ error: { message: 'modelo desconhecido' } }, { status: 400 }),
    );
    const erro = await criarOpenAIProvider({ transporte, apiKey: CHAVE })
      .complete('modelo-que-nao-existe', PEDIDO)
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ProviderError);
    expect(erro).not.toBeInstanceOf(RateLimitError);
    expect((erro as ProviderError).message).toContain('modelo desconhecido');
    expect(transporte).toHaveBeenCalledTimes(1);
  });

  it('falha de rede não vira erro de provedor mudo', async () => {
    const transporte = async () => {
      throw new Error('ECONNREFUSED');
    };
    await expect(
      criarOpenAIProvider({ transporte, apiKey: CHAVE }).complete('gpt-4.1-mini', PEDIDO),
    ).rejects.toThrow(/falha de rede: ECONNREFUSED/);
  });

  it('corpo que não é JSON não explode em SyntaxError', async () => {
    const transporte = async () => new Response('<html>502 Bad Gateway</html>', { status: 200 });
    await expect(
      criarOpenAIProvider({ transporte, apiKey: CHAVE }).complete('gpt-4.1-mini', PEDIDO),
    ).rejects.toThrow(/resposta não é JSON/);
  });
});

describe('capacidades e janela', () => {
  const provedor = criarOpenAIProvider({ transporte: async () => respostaDeTexto('x'), apiKey: CHAVE });

  it('declara saída estruturada nativa e nega controle de cache', () => {
    expect(provedor.supports('structuredOutput')).toBe(true);
    // Há cache, e ele é reportado — mas não há controle por requisição, que é
    // o que a capacidade pergunta.
    expect(provedor.supports('contextCache')).toBe(false);
  });

  it('erra a janela para baixo quando não conhece o modelo', () => {
    expect(provedor.maxContextTokens('gpt-4.1-mini')).toBe(1_000_000);
    expect(provedor.maxContextTokens('modelo-novo-em-folha')).toBe(128_000);
  });
});
