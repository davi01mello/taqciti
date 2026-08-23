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

Configuração ativa, dividida por natureza da tarefa:

| agente | modelo | por quê |
|---|---|---|
| `pensante` | `gemini-3.5-flash` | raciocínio sobre a transcrição, com `thinkingLevel: HIGH` |
| `auditor` | `gemini-3.5-flash-lite` | verificação binária, a chamada mais frequente |
| `escritor` | `gemini-3.5-flash` | geração de prosa |

O nível de raciocínio é por modelo (`THINKING_LEVEL` em
`lib/ai/providers/google.ts`), não uniforme: raciocínio custa token de saída e
latência, e conferir um trecho curto é trabalho mecânico enquanto decidir o que
entra numa seção é julgamento.

> ⚠️ **Política de dados é do PLANO DA CHAVE, não do modelo.** Uma chave de
> free tier do Gemini manda o conteúdo para treinamento em qualquer modelo —
> trocar de modelo não protege nada. Defina `DOCCITI_DATA_POLICY=training`
> quando a chave for de free tier: as rotas passam a exigir `"sintetica": true`
> e todo relatório carrega o aviso.

Sobe em `http://localhost:3000`.

`.env.local` é lido **no boot**. Depois de mexer nele, reinicie o servidor —
não confie em hot reload, ou você mede contra um processo que ainda não viu
a mudança.

## Deploy

O servidor é um app Next.js (App Router) comum — sem `output: 'export'`, sem
nada que exija hospedagem especial. `npm run build` já compila as rotas de
API como dinâmicas (confirmado: `next build` gera `/api/generate` e as
outras como `ƒ`, não `○`), então qualquer host Node/Next serve.

**Produção hoje roda no Railway**, em
`https://taqciti-production.up.railway.app`, com redeploy automático a cada
push em `main`. Seja qual for o host, aponte o **Root Directory para
`server/`** (é um projeto Next.js à parte dentro do monorepo) e configure as
variáveis abaixo no painel dele.

O runbook completo — incluindo por que o teto de 300s que o código ainda
declara não vale aqui — está em [`docs/deploy.md`](docs/deploy.md).

### Variáveis no host

As mesmas de `.env.local` (ver `.env.example`), preenchidas no ambiente do
deploy em vez de arquivo:

- `DOCCITI_SHARED_KEY` — **precisa bater com `VITE_DOCCITI_SHARED_KEY`** da
  build da extensão (ver abaixo). Sem ela a rota devolve 500 de propósito
  (falha fechada).
- `GOOGLE_API_KEY` — a chave do Gemini. Enquanto for free tier, mantenha
  `DOCCITI_DATA_POLICY=training` também (aí as rotas só aceitam transcrição
  que se declare `"sintetica": true`); tire a linha quando a chave virar
  paga.
- `ANTHROPIC_API_KEY` / `XAI_API_KEY` — só entram em cena se algum agente for
  apontado pra esses provedores via `DOCCITI_PENSANTE`/`DOCCITI_AUDITOR`/
  `DOCCITI_ESCRITOR`. A configuração ativa em `lib/ai/config.ts` usa só
  `google` nos três agentes, então deixar essas duas vazias é o normal, não
  uma pendência.

### Apontando a extensão pra esse servidor

Por padrão a extensão fala com `http://localhost:3000` — é o valor de dev, e
continua sendo o default sem configuração nenhuma (ver
`src/shared/config/serverConfig.ts`). Para uma build que fale com o servidor
deployado, defina as duas variáveis **na build da extensão** (raiz do repo,
não aqui):

```powershell
$env:VITE_DOCCITI_SERVER_URL = 'https://taqciti-production.up.railway.app'
$env:VITE_DOCCITI_SHARED_KEY = '<o mesmo valor de DOCCITI_SHARED_KEY no host>'
npm run build
```

O CORS (`lib/apiGuard.ts`) reflete **qualquer** origem, sem configuração por
navegador nem por site. Não é desleixo: o painel é um content script
declarado para `<all_urls>`, e um `fetch` de content script carrega a origem
da PÁGINA — uma lista de origens permitidas precisaria conter a internet
inteira. A justificativa completa, e por que isso não afrouxa nada, está no
bloco de `corsHeaders`.

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

Por modelo ele reporta texto, `inputTokens`, `outputTokens`,
`cachedInputTokens`, custo pela tabela de preços, `parsedPreenchido`,
`repaired`, `rateLimitWaits` e latência.

**Por modelo, não por provedor:** exercita a configuração ativa do pipeline
*e* o piso de produção da matriz, porque eles podem divergir — hoje divergem
(`gemini-2.5-flash` contra `gemini-3.5-flash-lite`), e as duas famílias usam
caminhos de código diferentes para saída estruturada e raciocínio. Testar só
o piso deixaria sem prova exatamente o caminho que o pipeline usa. O campo
`papel` diz qual é qual.

**Fornecedor sem chave é PULADO com motivo, nunca omitido** — sai em
`pulados`, e `ok` só é `true` se ao menos uma execução aconteceu. Uma tabela
comparativa sem a linha da Anthropic parece completa e não é: quem lê conclui
que o Gemini ganhou, quando os outros nem correram. A mesma lógica, na forma
que o harness da Fase 8 consome, está em `lib/ai/availability.ts`
(`planMatrixRun`, `describeSkips`), com a regra extra de que fornecedor cujas
entradas foram *todas* puladas vira linha própria no relatório.

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
  o ganho de cache entra direto na conta de custo por documento, isso só se
  resolve medindo as nove chamadas do Pensante, que repetem a transcrição
  inteira como prefixo.
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

O CORS reflete qualquer origem e **não segura abuso nenhum** — quem segura é
o header. Vale dizer por extenso, porque a tentação de "trancar pelo CORS"
já custou dois bugs: CORS é regra que o NAVEGADOR aplica a páginas, e `curl`
ou um script de servidor ignoram o cabeçalho por completo. Um POST sem
`Origin` nenhum chega ao handler e é recusado pelo segredo. O único ataque
que uma lista de origens impediria é uma página web usando o navegador de
quem a visita, com uma chave que já viaja pública dentro do bundle.

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

const result = await complete('pensante', {
  system: '...',
  messages: [{ role: 'user', content: pedidoDaSecao }],
  maxTokens: 8000,
  jsonSchema: SCHEMA,            // sempre funciona nos três
  cacheablePrefix: transcript,   // otimização opcional
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

Configuração mista (Pensante caro, Auditor barato) é otimização de uma
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

Uma geração completa faz de 20 a 30 chamadas (9 Pensante + N Auditor +
9 Escritor). Em free tier isso estoura o limite por minuto com
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

## Por que não existe uma etapa de compactação

Existiu — um "Analista" que lia a transcrição e devolvia um contexto compactado
com âncoras, sobre o qual os outros agentes trabalhavam. Foi **cortado**, e a
razão principal foi medida, não estimada:

- **a compactação impedia o cache que a tornaria desnecessária.** O contexto
  compactado tinha ~1.000 tokens, abaixo do piso de cache implícito do provedor
  (2.048 na família 2.5 do Gemini, mais nas 3.x), e `cachedInputTokens` voltava
  zero nas nove chamadas. A transcrição bruta passa folgado desse piso e vai
  como `cacheablePrefix` idêntico nas nove seções;
- **o Pensante raciocinava sobre a paráfrase de outro modelo**, e o Auditor
  gastava folga tentando reconstruir a vizinhança que a compactação jogou fora;
- **a evidência de concordância não tinha como ser ancorada.** Com a
  transcrição em mãos, o Pensante aponta a citação da concordância, e é isso
  que separa decisão de proposta (ver abaixo).

Com o Analista foram embora o janelamento e a deduplicação entre janelas — o
teto de 400 mil caracteres do endpoint continua valendo, e uma transcrição
acima da janela do modelo agora falha alto em vez de ser fatiada.

## Pensante e Auditor (Fases 3 e 4)

`lib/agents/pensante.ts` recebe a **transcrição bruta**, um `SectionSpec` e as
respostas já dadas, e devolve **dados estruturados** (`lib/documentData.ts`) —
não prosa.

As regras de cada seção vêm do `guidance` do `SectionSpec`, repassadas
íntegras. Não são reescritas — regra que mora em dois lugares diverge. Elas vão
na mensagem de usuário, **depois** da transcrição: o prompt de sistema precisa
ser byte-idêntico nas nove seções, ou o prefixo comum acaba antes da
transcrição e o cache não pega.

### O modelo não informa offsets

`AnchoredQuote.anchor` tem `start` e `end` numéricos, e **eles nunca são
pedidos ao modelo**. LLM erra offset de caractere sistematicamente, e âncora
errada é pior que âncora nenhuma — dá falsa confiança à auditoria. O fluxo é:

1. o modelo devolve `quotes` (literais) junto de cada afirmação;
2. `lib/agents/anchoring.ts` localiza cada citação e preenche os offsets;
3. citação não localizada → `anchor: null`, e ela não sustenta nada.

A busca tem duas passadas — literal e depois normalizada (espaços, aspas
curvas, caixa). **Acento não é normalizado, de propósito**: foi por aí que um
modelo falhou no bench, devolvendo `"gesto"` onde a transcrição diz `"gestão"`.
Tolerar isso esconderia o defeito na própria métrica que existe para pegá-lo.

O localizador guarda onde terminou a âncora anterior e busca dali primeiro.
Sem isso, citações curtas e repetidas (`"Concordo."`) apontariam todas para a
primeira ocorrência, e o Auditor leria o trecho errado.

`QuoteStats` acompanha cada seção: total, exatas, normalizadas, não
localizadas, e a **taxa de âncoras**. É o principal indicador de saúde do
Pensante — foi a única métrica que pegou um modelo devolvendo citação
corrompida. As citações não localizadas voltam inteiras em `unlocatable`;
nenhuma some em silêncio.

### A auditoria

`lib/agents/auditor.ts` roda só em seção `audit: 'strict'`. Ele lê o trecho
ORIGINAL, recortado pelas âncoras com folga, e **dentro do recorte o que foi
citado vem marcado entre `⟦ ⟧`** — a folga dá vizinhança legível, a marcação
diz o que é evidência.

O laço vive em `lib/agents/sectionPipeline.ts`, com **teto de duas passadas**:
Pensante propõe → Auditor rejeita → Pensante refaz com a justificativa → se
rejeitar de novo, a afirmação é descartada e vira lacuna. Nunca entra no
documento.

### A armadilha de decisão

`EXCERPT_PADDING_CHARS` é 400, e a folga sozinha não distingue proposta de
decisão. Numa reunião onde quase toda fala é seguida de concordância, 400
caracteres quase sempre alcançam **alguma** concordância, inclusive de outro
assunto. Foi observado: o Pensante propôs "Avaliar desnormalizações específicas
após testes de desempenho" como decisão, e o Auditor aprovou justificando com
"Ana sugerindo e Carlos concordando" — concordância que a transcrição não tem,
porque depois do "Podemos avaliar" da Ana o Carlos muda de assunto.

A correção é estrutural, não de tamanho de folga. `Decision.agreement` é uma
**citação própria e ancorada** da fala que aceita aquela proposta:

- concordância que não se localiza na transcrição derruba a decisão em
  **código**, sem gastar chamada (`AuditableClaim.blocker`);
- concordância que se localiza chega ao Auditor **marcada**, junto com a
  proposta, e a pergunta deixa de ser "existe alguma concordância por perto?"
  para voltar a ser "esta fala aceita esta proposta?".

O caso da concordância vizinha está em `auditor.canonical.test.ts` e roda
contra a API em `npm run test:live`.

## Dívida conhecida

`anthropic` e `xai` nunca fizeram uma chamada real — só há chave do Google.
As formas de requisição vieram dos `.d.ts` dos SDKs, que pegam nome e tipo de
campo errados mas não provam que a API aceita o corpo nem que lemos a resposta
direito. O que especificamente não foi provado, e como cada item falha, está
em [`docs/divida-verificacao-provedores.md`](docs/divida-verificacao-provedores.md).

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

## O pipeline está de pé

`generateDocument` em `lib/generateDocument.ts` não é mais stub: chama
`generateStep` em laço pelas nove seções (Pensante → Auditor → Escritor,
ver `lib/agents/`), monta o markdown na ordem do template e devolve
`documentData` + `html` junto. `/api/generate` expõe isso como "documento
inteiro numa tacada"; quem quiser controle fino (uma seção por vez,
perguntas, respostas) usa `generateStep` ou `/api/ai/secao` direto. Ver
`docs/HANDOFF.md` para o estado detalhado e o que falta (harness da Fase 8).

`/api/generate` e `/api/answers` também devolvem `pdf` (base64) — irmão do
`html`, saído do mesmo `documentData` via `lib/render/pdf.ts` (`pdfkit`
nativo, sem navegador headless). É o formato que a extensão baixa por
padrão; `html` continua existindo como fallback e para o caminho OAuth
direto ao Google Docs, que precisa de HTML.

## DocCiti (mockup do hero animado) — descontinuado

O mockup HTML standalone da tela de geração de documento (a animação de onda
reativa ao cursor/clique) foi descartado como frontend: o fluxo real de
geração agora vive inteiro dentro da extensão TaqCiti, sem nenhum caminho que
leve pra fora dela. Os arquivos ficam arquivados, só como referência
histórica, em [`Legado/`](Legado/) — fora de `public/`, então não são mais
servidos por este servidor. Detalhes de manutenção da animação (caso algum
dia vire algo reaproveitável) em [`Legado/HANDOFF.md`](Legado/HANDOFF.md).
