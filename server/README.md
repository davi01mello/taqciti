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
(uma de texto, uma com `jsonSchema`) usando o modelo mais barato de cada um.
Chave ausente derruba só o provedor dela.

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
útil. `COMPARISON_MATRIX` em `config.ts` guarda o mapeamento equivalente nos
três provedores, para o harness da Fase 8 montar as configurações
comparáveis sem ninguém redigitar ID de modelo.

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
