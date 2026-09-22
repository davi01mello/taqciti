# A camada de IA

Nenhum outro arquivo do servidor instancia cliente de provedor ou conhece nome
de modelo. Quem precisa de inferência chama `complete(agent, req)` — ou
`completeStructured(agent, req)` quando a resposta tem forma — e não vê provedor
nenhum.

```ts
import { complete, completeStructured } from '@/lib/ai';

const { text } = await complete('escritor', {
  system: 'Você redige atas.',
  messages: [{ role: 'user', content: transcricao }],
  maxTokens: 2000,
});

const { value } = await completeStructured<{ decisoes: string[] }>('pensante', {
  system: 'Extraia as decisões.',
  messages: [{ role: 'user', content: transcricao }],
  maxTokens: 1000,
  jsonSchema: {
    type: 'object',
    properties: { decisoes: { type: 'array', items: { type: 'string' } } },
    required: ['decisoes'],
  },
});
```

## Trocar entre Claude, GPT e mock

Nada disso exige recompilar nem editar código. A precedência vai do mais forte
para o mais fraco:

| # | Variável | O que faz |
|---|---|---|
| 1 | `MOCK_LLM=true` | Põe **todos** os agentes no mock. Vence tudo, inclusive em produção. |
| 2 | `DOCCITI_PENSANTE`, `DOCCITI_AUDITOR`, `DOCCITI_ESCRITOR` | `provedor:modelo` para **um** agente. |
| 3 | `LLM_PROVIDER` | O provedor de **todos** os agentes. |
| 4 | — | Os defaults de `config.ts`; ou o mock, quando não há chave nenhuma e não é produção. |

```bash
# tudo no Claude
LLM_PROVIDER=claude npm run dev

# tudo no GPT
LLM_PROVIDER=openai npm run dev      # `gpt` também vale

# tudo no Claude, menos o auditor
LLM_PROVIDER=claude DOCCITI_AUDITOR=mock:mock-1 npm run dev

# nada sai da máquina
MOCK_LLM=true npm run dev
```

`LLM_PROVIDER` aceita o nome comercial (`claude`, `gpt`, `gemini`, `grok`) ou o
id interno (`anthropic`, `openai`, `google`, `xai`, `mock`). O modelo, nesse
caso, é o padrão do provedor em `MODELO_PADRAO_POR_PROVEDOR`; para escolher o
modelo, use o override por agente.

### Quando o mock assume sozinho

Fora de produção, e **só** quando não há nenhuma chave de provedor definida.
Quem clona o repositório e roda `npm run dev` ganha um servidor que funciona;
quem tem chave configurada continua com o que configurou — a regra ingênua
("mock sempre em dev") faria o segundo caso receber documentos `[mock]` sem ter
pedido. Ver `mockPadrao` em `config.ts`.

Em teste, o mock é o provedor de todos os casos: nenhum teste desta pasta toca a
rede, e o adaptador da OpenAI recebe o `fetch` por parâmetro justamente para
isso (`criarOpenAIProvider({ transporte })`).

## Adicionar um provedor

1. `providers/<nome>.ts` implementando `Provider` — a chamada crua vai dentro de
   `runCompletion`, que cuida de schema, reparo e espera por 429/503;
2. o id em `ProviderId` e `PROVIDER_IDS` (`types.ts`);
3. entradas em `PROVIDERS` (`index.ts`), `API_KEY_ENV_VAR` (`availability.ts`) e
   `PRICING` (`pricing.ts`);
4. o apelido em `APELIDO_DE_PROVEDOR` e o modelo padrão em
   `MODELO_PADRAO_POR_PROVEDOR` (`config.ts`).

O TypeScript cobra 2, 3 e 4: os três são `Record<ProviderId, …>`.

## O que está pendente

- **Modelos da OpenAI.** `MODELO_PADRAO_POR_PROVEDOR.openai` é um palpite, e
  `CONTEXT_WINDOWS` em `providers/openai.ts` não foi conferido contra a API —
  esta fase não consultou a rede.
- **Preços da OpenAI.** `PRICING.openai` está **vazio** de propósito: preço
  inventado produziria relatório de custo mentiroso. Enquanto estiver vazio,
  `estimateCost` devolve `undefined` para modelos da OpenAI, e a OpenAI fica
  fora de `COMPARISON_MATRIX`.
- **`reasoning_effort`.** Os modelos de raciocínio da OpenAI expõem um controle
  que não é o `thinking` da Anthropic; `supports('extendedThinking')` é `false`
  até a família de modelos ser escolhida.
- **`strict: true`.** A saída estruturada da OpenAI pode ser garantida se os
  schemas passarem a declarar `additionalProperties: false` e todas as chaves em
  `required`. Hoje não declaram, e quem garante a forma é o reparo.
