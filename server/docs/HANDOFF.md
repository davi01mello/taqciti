# Handoff — continuar o pipeline de geração de documento

> Cole este arquivo inteiro como primeira mensagem numa sessão nova, na raiz
> do repositório (`C:\Users\edisi\taqciti`).

---

Você está retomando um trabalho em andamento. **Não recomece do zero e não
refaça o que já existe.** Leia o estado abaixo, confirme o que precisar
confirmando no código, e continue de onde parou.

Branch de trabalho: **`dev/1.5.1`** (monobranch — commite e faça push
direto nela, sem perguntar). `release/1.5` e `release/1.0` são produtos
congelados, nunca commite lá.

---

## Onde o projeto está

O servidor (`server/`, Next.js 16 App Router, independente do resto do repo)
gera o documento inteiro. **`/api/generate` não é mais stub**: `generateStep`
roda Pensante → Auditor → Escritor nas nove seções e devolve a Ata em markdown.

Uma Ata completa foi gerada contra a API real a partir de uma transcrição
sintética — ver "O que foi medido" abaixo.

### O pipeline hoje

```
transcrição bruta
  └─> Pensante   lê a transcrição (cacheablePrefix), devolve dados + quotes literais
  └─> código     anchoring.ts localiza cada quote -> {start, end}
  └─> Auditor    (só em audit:'strict') recorta o original, com a citação marcada
  └─> Escritor   dados conferidos -> prosa. NUNCA vê a transcrição.
```

| | onde |
|---|---|
| Tranca do endpoint (`x-docciti-key`, falha fechada, teto de 400 mil chars) | `lib/apiGuard.ts` |
| Camada multi-provedor (Anthropic, Google, xAI) + pricing + matriz | `lib/ai/` |
| Pensante: transcrição bruta + `SectionSpec` → dados + citações ancoradas | `lib/agents/pensante.ts` |
| Localização de citação (o modelo nunca informa offset) | `lib/agents/anchoring.ts` |
| Auditor: confere contra o trecho ORIGINAL, com a citação marcada `⟦ ⟧` | `lib/agents/auditor.ts` |
| Laço Pensante ↔ Auditor, teto de 2 passadas | `lib/agents/sectionPipeline.ts` |
| Escritor: dados da seção → prosa; guarda contra vazamento do PDF | `lib/agents/escritor.ts` |
| Montagem das nove seções, lacunas e perguntas | `lib/generateStep.ts` |
| JSON intermediário (`document_data`) | `lib/documentData.ts` |
| Renderização `DocumentData` → HTML, no estilo do modelo institucional | `lib/render/html.ts` |
| Marca CITi embutida como `data:` URI | `lib/render/brand.ts` |
| Prompts como artefatos versionados | `lib/prompts/` |

`POST /api/generate` devolve `{ title, content, documentData, html, questions }`.
`content` é o markdown e continua sendo o que sempre foi; `documentData` é a
camada canônica e `html` sai DELA, nunca do markdown.

**242 testes passando + 4 de rede** (`npm test` / `npm run test:live`),
`npx tsc --noEmit` e `npm run build` limpos.

Rotas de exercício, todas exigindo o header `x-docciti-key`:
`/api/ai/smoke`, `/api/ai/bench`, `/api/ai/secao`.

`/api/ai/secao` roda Pensante + Auditor nas seções que você pedir e devolve as
métricas de citação — é o melhor lugar para medir sem gerar o documento todo.

### Falta

- **Fase 6 — só a metade da extensão.** O servidor já faz a parte dele:
  devolve `documentData` e `html`. Falta a extensão criar o arquivo no Drive, e
  isso está travado no manifest (ver "Fase 6" abaixo).
- **Fase 8 — harness** em `server/eval/`.
- **PDF** — adiado, não descartado. Sai do MESMO `documentData` que o HTML, e
  não do HTML.

---

## A compactação foi CORTADA

Existia um Analista que lia a transcrição e devolvia um contexto compactado com
âncoras. Foi removido por decisão do autor, e a razão principal é medida:

- **a compactação impedia o cache que a tornaria desnecessária.** O contexto
  compactado tinha ~1.000 tokens, abaixo do piso de cache implícito do
  provedor, e `cachedInputTokens` voltava zero nas nove chamadas. Gastava-se
  uma chamada de modelo para produzir um contexto barato e incacheável;
- **o Pensante raciocinava sobre a paráfrase de outro modelo**, e o Auditor
  gastava folga tentando reconstruir a vizinhança que a compactação jogou fora;
- **a evidência de concordância não tinha como ser ancorada** — ver abaixo.

Foram embora junto: `analista.ts`, `windowing.ts`, `compactedContext.ts`,
`/api/ai/analista`, `lib/prompts/analista/`, o agente `analista` de
`lib/ai/config.ts`, e a dívida de quase-duplicatas entre janelas.

**Consequência a não esquecer:** não há mais janelamento. O teto de 400 mil
caracteres do endpoint continua valendo, mas uma transcrição maior que a janela
do modelo agora falha, em vez de ser fatiada.

---

## A armadilha de decisão — RESOLVIDA estruturalmente

Era a decisão aberta do handoff anterior: com folga de 400 caracteres, o
Auditor aprovava proposta como decisão porque quase sempre alcançava *alguma*
concordância por perto, inclusive de outro assunto.

A correção não foi mexer no tamanho da folga. `Decision.agreement` é uma
**citação própria e ancorada** da fala que aceita aquela proposta:

- concordância que não se localiza na transcrição derruba a decisão em
  **código**, sem gastar chamada (`AuditableClaim.blocker`);
- concordância que se localiza chega ao Auditor **marcada entre `⟦ ⟧`**, junto
  com a proposta. A pergunta deixou de ser "existe alguma concordância por
  perto?" e voltou a ser "esta fala aceita esta proposta?";
- a folga continua em 400, agora só para dar vizinhança legível.

O caso da concordância vizinha virou teste canônico de rede
(`auditor.canonical.test.ts`, `npm run test:live`).

---

## O que foi medido (2026-08-14)

> Os artefatos estão versionados em
> [`docs/medicao-2026-08-14/`](medicao-2026-08-14/README.md): a transcrição de
> entrada, a Ata gerada e as respostas cruas das duas rotas.

Transcrição sintética de 3.358 caracteres, com duas armadilhas plantadas: uma
proposta de desnormalizar tabela que foi explicitamente descartada na conversa,
e um pedido de ambiente de homologação que foi adiado.

**A Ata saiu completa, com as nove seções.** Nenhuma das duas armadilhas entrou
em "Decisões tomadas"; as três decisões reais entraram. Cargo sem evidência
virou `**[A preencher: ...]**` visível no documento. Nenhuma instrução do PDF
vazou.

Três números que você precisa conhecer antes de continuar:

### 1. O cache CONTINUA sem dar hit

`cachedInputTokens: 0` nas quatro seções medidas, com a transcrição de 3.358
caracteres (~1.000 tokens). **O mesmo número da dívida anterior**, e pela mesma
causa: a transcrição de teste é pequena demais para o piso de cache implícito
do provedor.

Ou seja: o argumento de cache que motivou o corte da compactação **ainda não
foi provado**. Ele é plausível numa reunião real (dezenas de milhares de
caracteres passam folgado do piso), mas plausível não é medido. **Confirme com
número antes de afirmar que o cache funciona** — de preferência com uma
transcrição sintética longa, de 30 mil caracteres para cima.

### 2. Cota diária do free tier: 20 requisições por dia no `gemini-3.5-flash`

A primeira tentativa de gerar a Ata **falhou depois de 16 minutos**. O erro era
`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, limite **20 por dia**. Uma
Ata completa faz 9 chamadas do Pensante + 9 do Escritor = 18 nesse modelo, e a
cota do dia acaba numa geração.

Pior: o provedor manda `retryDelay: 44s` mesmo na cota diária, e o laço de
espera perseguiu esse número até esgotar as tentativas. Isso foi corrigido —
`RateLimitError.perDay` distingue cota diária de cota por minuto, e a diária
sobe na hora (`providers/shared.ts`, `providers/google.ts`).

**A Ata medida rodou em `gemini-3.5-flash-lite` no Pensante e no Escritor**,
via `DOCCITI_PENSANTE` e `DOCCITI_ESCRITOR`, porque a cota do `flash` já tinha
acabado. Não é a configuração ativa. Levou 99 segundos.

### 3. Participante sem citação some da Ata — instabilidade real

Numa das execuções, o Pensante devolveu Ana e Carlos **sem nenhuma citação**, e
o Auditor corretamente os descartou: "Nenhuma citação localizável sustenta esta
afirmação". Duas pessoas que obviamente participaram sumiram da seção.

Noutra execução, com a mesma transcrição e o mesmo modelo, os dois apareceram
normalmente. É intermitente, e o comportamento do Auditor está certo — o
problema é o Pensante não citar.

Taxa de âncoras nas execuções medidas: **100%** (1/1, 11/11, 8/8, 0/0). Quando
ele cita, a citação existe. O problema é ele às vezes não citar.

Não foi corrigido, de propósito: mexer no prompt depois de medir e sem medir de
novo seria reportar o que se espera, não o que se mediu. Caminhos plausíveis,
em ordem de custo: (a) uma linha no prompt do Pensante exigindo citação por
participante; (b) `blocker` para participante sem citação, com mensagem que
diga ao modelo o que fazer na segunda passada; (c) medir antes no modelo
configurado (`gemini-3.5-flash`), já que a medição saiu no `lite`.

---

## FASE 6 — saída em Google Docs

### Feito

O servidor devolve `documentData` e `html` em `/api/generate`.

`lib/render/html.ts` renderiza a partir do `DocumentData`, nunca do markdown —
o markdown já perdeu que Maria tem cargo de origem `meeting` e que a decisão
tem concordância ancorada, e reparsear texto é onde a informação some sem
ninguém notar. Pelo mesmo motivo o PDF, quando entrar, sai do `DocumentData` e
**não** deste HTML: são irmãos, não um derivado do outro.

### O estilo vem do modelo, e as medidas foram EXTRAÍDAS dele

O modelo é `public/assets-docs/ata-de-reuniao/example.pdf` (na raiz do repo,
não em `server/`). A marca é `image.png`, ao lado dele.

Nada ali foi estimado — os valores saíram do próprio arquivo: **A4
(596×842pt)**, **Arial**, texto `#000000`, rodapé `#888888`, escala
tipográfica **44 / 26,7 / 17,3 / 14,7 / 10,7pt**, marca desenhada com
**160,5pt** de largura. Se precisar reconferir, o caminho foi `pdftotext
-layout` para a estrutura e leitura dos streams do PDF (fontes, operadores
`rg`/`RG` de cor, `Tf` de tamanho, `cm`+`Do` de imagem) — não há dependência
nova envolvida.

**A capa não sobrevive ao Docs.** O modelo tem uma página inteira só de marca
e título, sobre um fundo sangrado. Nem página dedicada nem fundo atravessam o
import, e uma capa em branco no meio de um documento importado é pior que não
ter capa — por isso ela vira um bloco de abertura na MESMA página do conteúdo.
Foi a decisão do autor ("a marca na mesma página").

**Cabeçalho de seção só onde o modelo tem.** Identificação, Tópico geral,
Participantes e Assinatura entram como linhas rotuladas (`DATA:`, `TÓPICO:`,
`PARTICIPANTES – CARGO:`) e como fecho de carta. É a única divergência
deliberada entre o HTML e o markdown do Escritor, que mantém todos os
cabeçalhos por ser rascunho de tela.

**Estilo INLINE, não folha.** O conversor do Drive descarta quase toda regra
de `<style>` e preserva atributo `style` no elemento. A folha carrega só o
`@page`, que não tem equivalente inline. Há teste garantindo que nada depende
de classe.

Documento completo com `<meta charset>`, e não fragmento, porque vai como
ARQUIVO — sem o charset, "gestão" chega ao Docs como "gestÃ£o".

Duas regras que os testes prendem: **HTML e markdown mostram a mesma frase de
lacuna** (`textoDeLacuna` em `documentData.ts` é a fonte única) e **usam a
mesma definição de vazio** (`spec.serialize()` devolvendo `null`), senão os
dois formatos discordam sobre quais seções o documento tem.

Ver `docs/medicao-2026-08-14/execucao-2-ata.html` para uma saída real.

### Falta — e está travado

- **A extensão cria o documento, não o servidor.** Ela pega o token via
  `chrome.identity.getAuthToken`, manda o `html` para o Drive e abre a aba. O
  servidor nunca vê token OAuth de usuário.
- Use **Drive API `files.create`** com o HTML e o mimeType de destino do Google
  Docs. **Não** use `documents.batchUpdate`.
- Escopo **`drive.file` e só ele**. Se parecer que precisa de mais, **pare e
  pergunte**.
- Nome do arquivo: `Ata de Reunião — {projeto} — {DD-MM-AAAA}`, caindo para o
  título da reunião quando o projeto for lacuna. Sem `undefined` nem colchetes.
  O `documentData.metadata` tem os dois campos, e lacuna ali é campo AUSENTE,
  não string vazia.

**Impedimento já levantado, não resolvido:** o `manifest.config.ts` não tem a
permissão `identity` nem a chave `oauth2`, e `getAuthToken` exige **ID de
extensão estável** — o próprio repo documenta que o ID muda entre dev
(unpacked) e Web Store. A correção é fixar `key` no manifest e registrar o
client no Google Cloud. Não é motivo para inverter a arquitetura.

---

## FASE 8 — harness

`server/eval/`, com `fixtures/`, `run.ts` e `assertions.ts`.

Boa parte do insumo já existe e **deve ser reaproveitada, não reescrita**:

- `lib/ai/availability.ts` — `planMatrixRun()` e `describeSkips()` já pulam
  entrada sem chave e reportam o pulo. Entrada pulada nunca some em silêncio;
- `lib/ai/config.ts` — `COMPARISON_MATRIX` com teto e piso por fornecedor;
- `lib/ai/pricing.ts` + `costForEntry()` — custo, com free tier valendo zero;
- `lib/agents/anchoring.ts` — a taxa de âncoras é a asserção mais importante, e
  agora ela mede o Pensante;
- `lib/ai/bench.ts` — a tarefa de referência e `checkAnchors`. Ela mantém
  prompt e schema próprios de propósito, para o resultado de duas execuções
  continuar comparável quando o prompt do Pensante mudar de versão.

Fixtures precisam ser sintéticas. Há duas:

- `docs/medicao-2026-08-14/transcricao.txt`, no repo, 3.358 chars, com duas
  armadilhas de proposta-que-não-virou-decisão e o resultado esperado descrito
  no README da pasta;
- a do autor (reunião sobre modelagem de banco de dados, ~2.900 chars), fora do
  repo — peça a ele.

**O harness precisa de uma fixture LONGA também** — nenhuma das duas serve para
medir cache, e sem isso a dívida 2 não fecha (ver medição 1).

Precisa de test runner? Já tem: **vitest**, em `server/`.

---

## Dívidas abertas

1. **Anthropic e xAI nunca fizeram chamada real.** Só há chave do Google. As
   formas de requisição vieram dos `.d.ts` dos SDKs. Os onze pontos específicos
   que vão quebrar primeiro, e como cada um falha, estão em
   [`docs/divida-verificacao-provedores.md`](divida-verificacao-provedores.md).
   **Leia antes de ligar qualquer chave nova.**
2. **Cache nunca deu hit** — ver medição 1 acima. Continua aberta, e agora com
   uma causa concreta: falta transcrição de teste grande o bastante.
3. **Espera por 429/503 tem teste unitário, e a de cota DIÁRIA foi exercitada
   de verdade** (foi ela que motivou `perDay`). A espera por cota por minuto
   ainda não foi observada acertando.
4. **O modelo perde acentuação.** Vista no bench (`"gesto"` por `"gestão"`) e
   de novo na medição de 14/08, agora no `flash-lite`: as quatro entradas de
   `topicsDiscussed` voltaram sem nenhum acento numa execução.

   **A ressalva muda o tamanho do problema.** Na mesma chamada, as 20 citações
   vieram acentuadas e todas as 20 localizaram. O modelo corrompe a paráfrase
   que ele escreve e preserva a citação que ele copia. Isso é bom para a
   âncora — a auditoria não desaba — e ruim para o documento, porque a ata sai
   sem acento no corpo do texto. Continua sendo risco de qualidade voltado ao
   cliente. Anotado em `lib/ai/config.ts`, no comentário do agente `pensante`.
5. **Participante sem citação some da Ata** — ver medição 3 acima, e
   `docs/medicao-2026-08-14/` para as duas execuções lado a lado.
6. **O Pensante põe citação literal da transcrição dentro da Conclusão.** Vista
   na execução 2: o campo `conclusion.text` veio com trechos de fala entre
   aspas. O `guidance` pede "um único parágrafo executivo", e transcrever fala
   não é isso. O Escritor não tem culpa — ele redigiu o que recebeu.

---

## Ambiente

```
cd server
npm install
npm run dev          # http://localhost:3000 — .env.local é lido NO BOOT
npm test             # 242 testes, offline, rápido
npm run test:live    # + 4 casos canônicos do Auditor contra a API
npx tsc --noEmit
npm run build
```

**Reinicie o servidor antes de qualquer curl.** Não confie em hot reload: se
medir contra um processo antigo, uma mudança que não carregou parece uma
mudança que não quebrou nada.

`.env.local` existe e é ignorado pelo git. Contém `DOCCITI_SHARED_KEY`,
`GOOGLE_API_KEY` (free tier) e `DOCCITI_DATA_POLICY=training`.

Configuração ativa (`lib/ai/config.ts`):

| agente | modelo |
|---|---|
| pensante | `gemini-3.5-flash` com `thinkingLevel: HIGH` |
| auditor, escritor | `gemini-3.5-flash-lite` |

O Escritor desceu para `lite` em 15/08 por **aritmética de cota**, não por
custo: no free tier o teto é 20 requisições por dia, por projeto, POR MODELO.
Uma Ata faz 9 chamadas do Pensante e 9 do Escritor; com os dois no `flash` isso
dá 18 a 20 e a geração morre no meio — medido três vezes. Com o Escritor no
`lite`, o `flash` carrega só o Pensante (9, ou 11 com as segundas passadas) e o
documento fecha. **Com chave paga, reconsidere:** a redação em `flash` é
melhor, e o motivo da descida desaparece.

> ⚠️ **`DOCCITI_DATA_POLICY=training` está ligado**, porque a chave é de free
> tier e free tier manda o conteúdo para treinamento do provedor em qualquer
> modelo. **Use SOMENTE transcrição sintética. Nenhuma gravação real de
> reunião.** Todas as rotas exigem `"sintetica": true` no corpo enquanto isso
> valer — **incluindo `/api/generate`**, que ganhou a trava quando deixou de
> ser stub. Com chave paga a trava não existe e o contrato fica como sempre foi.

---

## Regras que não podem ser quebradas

Do autor, e valendo desde o começo:

- **Não altere o contrato de `/api/generate`** além do header de chave e da
  trava de política de dados (que só age em free tier).
- **Não mexa em `server/Legado/`.**
- **Não preencha os templates de `x1`, `daily`, `planning`, `review`** — não há
  modelo para eles. Eles geram seção única e genérica, e isso é esperado. O que
  não pode é quebrar.
- **Não construa a UI de perguntas.** As `questions` já voltam populadas.
- **Não invente regra de negócio** que não esteja no `guidance` do template ou
  na especificação. Sinalize em vez de inventar.
- **Não instale dependência sem perguntar.**
- **Não comite transcrição real** como fixture.
- **Não deixe nome de modelo fora de `lib/ai/config.ts`** (e `pricing.ts`).
- **Não escreva prompt específico de um provedor** — há teste garantindo.

E as que se firmaram durante o trabalho:

- **Nunca peça offset de caractere ao modelo.** Ele entrega `quote`; o código
  localiza. Âncora errada é pior que âncora nenhuma.
- **O prompt de sistema do Pensante precisa ser byte-idêntico nas nove
  seções.** Todo cache de prefixo casa desde o começo do prompt; sistema que
  varia por seção encerra o prefixo comum antes da transcrição. É por isso que
  o `guidance` vai na mensagem de usuário, e há teste garantindo que o prompt
  não tem marcador.
- **O Escritor não vê a transcrição.** Ele redige a partir de dados já
  conferidos; dar-lhe a transcrição abriria uma segunda porta para informação
  não auditada entrar na ata. Há teste garantindo.
- **Nunca omita em silêncio.** Entrada pulada, afirmação descartada, citação
  não localizada, lacuna que o modelo esqueceu de marcar — tudo aparece, com
  motivo.
- **Custo `undefined` é melhor que custo zero.** Zero silencioso vira relatório
  de custo mentiroso.
- **Na dúvida, o Auditor rejeita.** Afirmação descartada vira lacuna, aprovada
  por engano vira fato inventado num documento tratado como registro.
- **Reporte o que mediu, não o que espera.** Se o número saiu na direção
  errada, diga o número.

---

## Primeira coisa a fazer

1. Rode `npm test` e `npm run build` para confirmar que o estado bate com o
   descrito aqui.
2. Peça ao autor uma transcrição sintética **longa** (30 mil caracteres para
   cima) e meça o cache com ela em `/api/ai/secao`. É a única dívida que o
   corte da compactação prometeu resolver e ainda não resolveu na medição.
3. Só então decida entre Fase 6 e Fase 8 com o autor.
