# TaqCITi — servidor de geração de documento

Servidor Next.js (App Router) independente do resto do repositório, usado
pela extensão na fase 2 do fluxo "Continuar fluxo": recebe a transcrição de
uma reunião e devolve um documento gerado.

Só backend — sem interface própria. O fluxo de "Gerar Documento" inteiro
(escolher o tipo, mostrar loading/erro, exibir o resultado) vive dentro da
extensão TaqCiti (`src/document/GenerateDocumentMenu.tsx`), que chama a
rota daqui.

## Rodando localmente

```
cd server
cp .env.example .env.local     # preencha DOCCITI_SHARED_KEY e as chaves
npm install
npm run dev
```

Defaults de produção (todos conferidos na documentação oficial em
2026-08-12): `claude-sonnet-5` no Analista, Pensante e Escritor;
`claude-haiku-4-5` no Auditor. Haiku 4.5 **não** tem raciocínio adaptativo —
a exceção é tratada pela lista de modelos em `lib/ai/providers/anthropic.ts`.

Sobe em `http://localhost:3000`.

`.env.local` é lido **no boot**. Depois de mexer nele, reinicie o servidor —
não confie em hot reload, ou você mede contra um processo que ainda não viu
a mudança.

## Rotas

```
POST /api/generate
Content-Type: application/json
x-docciti-key: <segredo compartilhado>

{ "transcript": "string", "title"?: "string", "date"?: "string",
  "documentType": "ata" | "x1" | "daily" | "planning" | "review" }

→ 200 { "title": "string", "content": "string" }
→ 400 { "error": "string" }   payload inválido
→ 401 { "error": "string" }   header ausente ou errado
→ 413 { "error": "string" }   transcrição acima do teto
→ 500 { "error": "string" }   servidor sem DOCCITI_SHARED_KEY configurada
```

```
POST /api/ai/smoke
x-docciti-key: <segredo compartilhado>

{ "providers"?: ["anthropic" | "google" | "xai", ...] }   corpo vazio = os três

→ 200 { capabilities, agentConfig, results }
```

O smoke gasta tokens de verdade: faz duas chamadas triviais por provedor
(uma de texto, uma com `jsonSchema`) usando o piso de produção de cada um.
Chave ausente derruba só o provedor dela.

Por provedor ele reporta texto, `inputTokens`, `outputTokens`,
`cachedInputTokens`, custo pela tabela de preços, `parsedPreenchido`,
`repaired`, `rateLimitWaits` e latência.

**Ele falha (`ok: false`) mesmo com HTTP 200** quando `usage.inputTokens` vem
0, nulo ou ausente — e também em texto vazio, `parsed` faltando com schema
pedido, ou modelo fora da tabela de preços. Motivo: forma de payload aceita e
`usage` lido corretamente são duas provas diferentes, e só a primeira vem de
graça no 200. Um adaptador com normalização de `usage` errada responde 200
normalmente e reporta custo zero; o defeito só apareceria quando o harness
dissesse que uma geração completa custou nada — ou pior, não apareceria. As
asserções vivem em `lib/ai/smokeAssertions.ts`, fora do route handler, para
serem testadas.

A resposta traz um campo `naoVerificado` com o que o smoke **não** prova:

- **Cache.** Uma chamada única não exercita cache. O breakpoint de
  `cache_control` e o cache implícito só rendem no segundo request com o mesmo
  prefixo, e o prefixo aqui é curto demais para atingir o mínimo cacheável de
  qualquer provedor. `cachedInputTokens: 0` é o esperado e não prova nada. Como
  o ganho de cache entra direto na conta de custo por documento, isso fica em
  aberto até a Fase 2 fazer chamadas repetidas com o mesmo contexto compactado.
- **Espera por 429.** Tem teste unitário, mas nenhuma chamada real tomou 429
  ainda.

## A tranca do endpoint

A rota exige o segredo compartilhado `DOCCITI_SHARED_KEY` no header
`x-docciti-key`. **Não é autenticação de verdade** — o segredo viaja dentro
do bundle da extensão, então quem abrir o pacote acha. Serve pra barrar uso
acidental e varredura agora que existe uma chave de API paga atrás da rota;
não serve pra tratar o chamador como confiável. Motivação e limites em
[`lib/apiGuard.ts`](lib/apiGuard.ts).

Falha **fechada**: sem `DOCCITI_SHARED_KEY` definida a rota devolve 500. Com
dinheiro atrás dela, "sem segredo configurado" não pode significar "aberto
pra todo mundo".

O CORS continua refletindo qualquer origem `chrome-extension://` — o id da
extensão muda entre dev (unpacked) e produção (Web Store), não dá pra fixar
um valor só. O que segura o abuso agora é o header, não o CORS.

Há também um teto por requisição: transcrição acima de
`DOCCITI_MAX_TRANSCRIPT_CHARS` (padrão 400.000 caracteres) é recusada com
413, antes de virar uma conta cara.

## A camada de IA

`lib/ai/` é o **único** lugar do servidor que fala com API de modelo, e
`lib/ai/config.ts` é o **único** lugar onde existe nome de modelo. String
`claude-*`, `gemini-*` ou `grok-*` fora de `config.ts` e `pricing.ts` é bug.

O sistema roda sobre **Claude, Gemini ou Grok** indistintamente, porque a
escolha de provedor é uma decisão a tomar com dados de custo e qualidade na
mão, não uma premissa. A interface declara capacidades e o adaptador degrada
em código quando o provedor não tem a nativa — ver [`lib/ai/types.ts`](lib/ai/types.ts).

```ts
import { complete } from '@/lib/ai';

const result = await complete('analista', {
  system: '...',
  messages: [{ role: 'user', content: transcript }],
  maxTokens: 16000,
  jsonSchema: SCHEMA,          // sempre funciona nos três
  cacheablePrefix: contexto,   // otimização opcional
});
```

### Quem suporta o quê

`supports(c)` responde **"existe controle nativo, no nível da requisição,
para isto?"** — não "isto funciona?". `jsonSchema` funciona nos três; o que
varia é se o provedor garante a forma ou se o adaptador precisou validar e
reparar (e aí marca `repaired: true`, que é dado de comparação).

| Capacidade         | anthropic | google | xai |
|--------------------|-----------|--------|-----|
| `structuredOutput` | ✅ `output_config.format` | ✅ `responseJsonSchema` | ✅ `response_format` |
| `contextCache`     | ✅ `cache_control` explícito | ❌ só implícito | ❌ automático |
| `extendedThinking` | ✅ `thinking: adaptive` | ✅ `thinkingConfig` | ❌ escolhido pelo ID do modelo |

Os `false` não querem dizer "não tem cache" nem "não raciocina": querem
dizer que não há botão por requisição. O Gemini tem cache implícito a partir
da família 2.5 e a xAI tem cache automático; os dois casam por prefixo, e é
por isso que `cacheablePrefix` vai sempre no início da primeira mensagem de
usuário, para os três. O Grok escolhe raciocínio por variante de modelo
(`-reasoning` / `-non-reasoning`) em vez de parâmetro.

### Convenção de `usage`

Cada provedor reporta de um jeito. O adaptador normaliza para:

- `inputTokens` — **todos** os tokens de entrada, cache incluído
- `cachedInputTokens` — a parte de `inputTokens` que veio de cache
- `outputTokens` — saída, tokens de raciocínio incluídos

Sem isso não há comparação de custo possível. `lib/ai/pricing.ts` converte
`usage` em dólares e carrega a **data de consulta** de cada tabela de preço.

### Trocando provedor sem recompilar

```
DOCCITI_ANALISTA=google:gemini-3.6-flash
DOCCITI_AUDITOR=xai:grok-4.3
```

Cada agente pode usar um provedor diferente — é um resultado provável e
útil.

### A matriz de comparação

`COMPARISON_MATRIX` em `config.ts` é o insumo do harness da Fase 8, e **não**
é uma configuração por provedor. Ela não tenta emparelhar modelos entre
fornecedores: emparelhar seria inventar uma equivalência que não existe —
Sonnet 5 e Gemini Flash não são o mesmo degrau, e chamar os dois de "o
modelo médio" transformaria a comparação numa opinião sobre tiers em vez de
uma medição.

A pergunta que a matriz responde é: **por fornecedor, qual é o custo por
documento no menor modelo que ainda passa as asserções determinísticas?**
Daí duas configurações por provedor — teto e piso — com o mesmo modelo nos
quatro agentes.

| id | provedor | tier | modelo | |
|---|---|---|---|---|
| `anthropic-caro` | anthropic | caro | `claude-opus-5` | |
| `anthropic-barato` | anthropic | barato | `claude-haiku-4-5` | |
| `google-caro` | google | caro | `gemini-3.6-flash` | |
| `google-barato` | google | barato | `gemini-3.5-flash-lite` | |
| `google-caro-preview` | google | caro | `gemini-3.1-pro-preview` | ⚠️ preview |
| `google-dev-free` | google | barato | `gemini-2.5-flash` | ⚠️ free tier |
| `xai-caro` | xai | caro | `grok-4.5` | |
| `xai-barato` | xai | barato | `grok-4.3` | |

As duas entradas ⚠️ são `experimental: true` e ficam **fora** de
`productionCandidates()`. A regra de "um teto e um piso por fornecedor" vale
sobre os candidatos a produção — as experimentais respondem perguntas
laterais em vez de disputar a decisão, e por isso podem repetir tier.

Configuração mista (Analista caro, Auditor barato) é otimização de uma
segunda rodada, depois de saber onde cada fornecedor quebra.

### `gemini-2.5-flash` — configuração de desenvolvimento

Existe para desenvolver contra o free tier enquanto o pipeline não está
pronto. **Não é candidata a produção** por três motivos independentes, todos
registrados na `note` da entrada:

1. O free tier usa o conteúdo enviado para melhorar produtos, **com revisão
   humana**. Transcrição de reunião é exatamente o tipo de dado que os termos
   desaconselham.
2. É geração anterior — comparar com a família 3.x mede geração, não fornecedor.
3. Limites de requisição baixos.

> ⚠️ **Enquanto a configuração ativa for esta, só transcrição sintética.**
> Nenhuma gravação real de reunião.

Isso é imposto em código, não só em comentário: a entrada carrega
`dataPolicy: 'training'`, `usesContentForTraining()` responde por ela, e
`dataPolicyWarning()` devolve o aviso pronto para log. Um teste garante que
o piso de produção de nenhum fornecedor seja uma configuração de treinamento.

O preço fica registrado como o preço **pago** do modelo ($0,30/$2,50). O zero
mora em `billing: 'free-tier'` na entrada da matriz, e quem aplica é
`costForEntry()` — o harness deve somar por ela, não por `estimateCost()`
direto. Registrar 0 na tabela de preços poria um número falso justamente no
lugar onde alguém vai olhar para decidir migrar para pago.

### Compatibilidade por família de modelo

A 2.5 é anterior à geração adaptada primeiro, e **duas** coisas mudaram de
forma. Verificado nos `.d.ts` do `@google/genai` v2.16.0 instalado, não na
documentação pública:

| | família 3.x | família 2.5 |
|---|---|---|
| saída estruturada | `responseJsonSchema` (JSON Schema) | `responseSchema` (subconjunto OpenAPI) |
| raciocínio | `thinkingConfig.thinkingLevel` (enum) | `thinkingConfig.thinkingBudget` (tokens) |

`lib/ai/providers/geminiSchema.ts` faz a conversão. O que se perde: `type`
vira enum maiúsculo, `enum` vira `string[]`, e **`additionalProperties` não
existe** na forma OpenAPI. A restrição continua valendo — quem passa a
garanti-la é o validador local, o que pode custar uma chamada de reparo onde
a 3.x não custaria. É isso que `repaired` vai mostrar.

### Espera por 429

Uma geração completa faz de 20 a 30 chamadas (1 Analista + 9 Pensante +
N Auditor + 9 Escritor). Em free tier isso estoura o limite por minuto com
facilidade, e sem espera a primeira geração morre no meio — parecendo bug de
lógica, que é o diagnóstico errado e caro.

O laço vive em `providers/shared.ts` e é o mesmo para os três: exponencial
com jitter, teto de 60s por espera, honrando `retry-after` quando o provedor
manda. Só repete 429 — repetir um 401 daria o mesmo erro cinco vezes mais
devagar. `DOCCITI_RATE_LIMIT_RETRIES` ajusta o teto de tentativas (padrão 5).

O cliente da Anthropic roda com `maxRetries: 0` de propósito: o SDK repetiria
sozinho, as esperas ficariam invisíveis, e `rateLimitWaits` reportaria zero
enquanto a geração leva minutos. Cada resultado carrega
`meta.rateLimitWaits`.

## Testes

```
npm test          # vitest run
npm run test:watch
```

Cobrem a lógica pura da camada de IA (validador de schema, extração de JSON
embrulhado, laço de reparo, posicionamento do `cacheablePrefix`), a
coerência da tabela de preços e da matriz, e os templates. **Não** fazem
chamada de rede — provedor de verdade se testa com `/api/ai/smoke`.

`lib/templates/templates.test.ts` só passou a rodar de verdade agora: era um
script que dependia de `node arquivo.ts` resolver import ESM sem extensão, o
que não acontece.

## A geração ainda é um stub

`generateDocument` em `lib/generateDocument.ts` ainda devolve seções stub —
a camada de IA está de pé, mas os agentes (Analista, Pensante, Auditor,
Escritor) ainda não existem. `lib/generateStep.ts` continua sendo o ponto
único de troca.

## DocCiti (mockup do hero animado) — descontinuado

O mockup HTML standalone da tela de geração de documento (a animação de onda
reativa ao cursor/clique) foi descartado como frontend: o fluxo real de
geração agora vive inteiro dentro da extensão TaqCiti, sem nenhum caminho que
leve pra fora dela. Os arquivos ficam arquivados, só como referência
histórica, em [`Legado/`](Legado/) — fora de `public/`, então não são mais
servidos por este servidor. Detalhes de manutenção da animação (caso algum
dia vire algo reaproveitável) em [`Legado/HANDOFF.md`](Legado/HANDOFF.md).
