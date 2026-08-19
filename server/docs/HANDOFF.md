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

- **Fase 6 — concluída.** O servidor devolve `documentData` e `html`; a
  extensão decide entre Docs direto e download sozinha (ver "Fase 6"
  abaixo, atualizado — o impedimento de manifest que este handoff descrevia
  foi resolvido depois de escrito).
- **Deploy do servidor** — nunca foi hospedado; `server/` só roda via
  `npm run dev` local, e a extensão apontava pra `localhost:3000` fixo sem
  jeito de trocar. Resolvido em 17/08/2026: `VITE_DOCCITI_SERVER_URL` na
  build da extensão, guia de deploy em `server/README.md`.
- **Fase 8 — harness** em `server/eval/`.
- **PDF — feito em 18/08/2026.** `lib/render/pdf.ts`, `pdfkit` nativo (sem
  navegador headless — decisão do autor, ver o comentário no topo do
  arquivo). Sai do MESMO `documentData` que o HTML, gerado em `generateDocument.ts`
  e `/api/answers` isolado num try/catch — se falhar, a geração não morre,
  só sai sem `pdf`. É o formato que a extensão baixa por padrão agora
  (`baixarComoPdf` em `src/document/baixarDocumento.ts`); `html` continua de
  fallback e para o caminho OAuth. Paridade com o HTML é estrutural (mesmas
  seções, rótulos, disciplina de lacuna), não pixel a pixel — motores de
  desenho diferentes.

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
não em `server/`).

Nada ali foi estimado — os valores saíram do próprio arquivo, lendo os streams
de página decodificados (`Tf` de tamanho, `rg`/`RG` de cor, `cm`+`Do` de
imagem, `re`+`W* n` de recorte). Cuidado com um detalhe fácil de perder: cada
bloco de texto vem embrulhado num `cm` de escala `.75 0 0 .75`, então o valor
bruto do `Tf` é PIXEL a 96dpi e o pt real é ele × 0,75. Já convertido:

- **A4** (596×842pt no modelo), margem lateral de **1in**;
- texto `#000000` — **inclusive o rodapé**; o único cinza escuro é
  a linha fina acima dele (`#888888`), e o único cinza claro é o subtítulo da
  capa (`#999999`);
- escala **33 / 20 / 13 / 12 / 11 / 8pt** — título da capa, subtítulo da capa,
  título de seção, corpo e linha rotulada, item de lista, rodapé;
- entrelinha **1,3225×** o tamanho da fonte, **12pt** entre parágrafos e
  **6pt** entre um rótulo/título e a lista que ele abre;
- lista com marcador a **18pt** da margem e texto a **32,5pt** (recuo
  pendente).

**A FONTE é Barlow, e é a única coisa que NÃO vem do modelo.** O modelo usa
Arial; a decisão do autor foi Barlow. Ela vai **embutida** no PDF
(`lib/render/assets/fonts/`, SIL OFL — `OFL.txt` ao lado dos `.ttf` é
condição da licença, não documentação opcional). Consequência que já cobrou
caro uma vez: **nenhuma métrica de fonte pode ser constante** em
`lib/render/pdf.ts`. Entrelinha e linha de base saem da fonte ativa
(`currentLineHeight`, ascendente do `_font`), porque Helvetica ocupa 0,925em e
Barlow ocupa 1,2em — os números antigos, aplicados à Barlow, desmontariam o
ritmo vertical inteiro. No HTML a fonte não pode ser embutida (`@font-face` só
vive em `<style>`, que o Docs descarta), então lá ela é pedida com Arial de
queda; o Docs tem Barlow no catálogo.

**Os dois assets da capa saíram do modelo, não de uma biblioteca de marca.**
`lib/render/assets/citi-preto.png` é o XObject `/X4` (a marca PRETA, a mesma
da capa e do cabeçalho das três páginas) e `capa-grafico.jpg` é o `/X9` (a
onda sangrada). A marca VERDE "citi 30 anos" que estava aqui antes era outra
marca e foi removida. `/X9` é a capa inteira ACHATADA, com um "Ata de reunião"
queimado em pixel: ele só pode entrar recortado na faixa de baixo, como o
modelo faz — ver `lib/render/modelo.ts`.

**A capa não sobrevive ao Docs.** O modelo tem uma página inteira só de marca
e título, sobre um fundo sangrado. Nem página dedicada nem fundo atravessam o
import, e uma capa em branco no meio de um documento importado é pior que não
ter capa — por isso, **no HTML**, ela vira um bloco de abertura na MESMA
página do conteúdo. Foi a decisão do autor ("a marca na mesma página"). **No
PDF a capa é fiel**: `lib/render/pdf.ts` monta a página com o gráfico real, a
marca preta centralizada e título/subtítulo centralizados nas coordenadas do
modelo.

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

### O PDF precisa ser conferido contra `next start`, não só contra o vitest

`pdfkit` lê arquivos de dentro do próprio pacote. Empacotado pelo Turbopack,
o caminho é reescrito e a leitura falha — **só em build de produção**. E como
`generateDocument` isola a geração do PDF de propósito (o HTML continua
saindo), a rota respondia **200 sem PDF e sem erro visível**: o download vinha
sem o arquivo, em silêncio, exatamente no ambiente que importa. Nenhum teste
unitário pega isso, porque nenhum passa pelo bundler.

Duas travas hoje: `serverExternalPackages: ['pdfkit']` em `next.config.ts` e
`font: null` no construtor (não pedir fonte padrão nenhuma — todas as fontes
do documento são Barlow embutida).

**Como conferir sem gastar cota de modelo:** `npm run build && npm run start`
e chamar **`POST /api/answers`** com um `documentData` salvo. Essa rota
renderiza HTML e PDF e não chama modelo nenhum — é o caminho real de "responder
uma lacuna" e serve de prova de fumaça do render em produção. `POST
/api/generate` também serve, mas roda o pipeline inteiro e queima a cota
diária do free tier (20 requisições por dia, por modelo).

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

**Este impedimento foi resolvido depois deste handoff.** O commit
`feat(fase6)` já entregou o caminho: `manifest.config.ts` tem `identity` nas
`permissions`, o bloco `oauth2` (client id lido de
`VITE_GOOGLE_OAUTH_CLIENT_ID`, com placeholder que mantém o manifesto válido
sem client registrado) e a `key` fixa que trava o ID da extensão entre
clones/máquinas — ver `docs/google-docs-setup.md`. `entregarDocumento` em
`src/document/generateDocument.ts` já decide sozinho entre Docs direto e
download, lendo `oauthConfigurado()`.

**Estado real (17/08/2026):** nenhum build de release define
`VITE_GOOGLE_OAUTH_CLIENT_ID` (não está em `.github/workflows/release.yml`
nem em nenhum `.env` versionado), então `oauthConfigurado()` é sempre
`false` em produção e o caminho de Docs direto nunca roda — todo mundo usa
o download. Decisão do autor: tratar isso como **descontinuado por ora**,
não como pendência a destravar. Se um dia precisar do caminho direto de
verdade, o trabalho é só configurar o client OAuth (`docs/google-docs-setup.md`),
não mexer em código.

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
2. **Cache: já deu hit, mas não fecha a dívida.** Atualizado em 17/08/2026 —
   ver [`docs/medicao-2026-08-16-longa/`](medicao-2026-08-16-longa/README.md).
   Com a fixture longa (13.943 chars, ~3.500 tokens), `cachedInputTokens`
   saiu de zero pela primeira vez: **1.899 tokens cacheados**, sobre um teto
   teórico de ~14.000. O cache funciona, mas rende **13% do esperado** — não
   trate como resolvido, trate como "funciona, ganho menor que a arquitetura
   assumiu".
3. **Espera por 429/503 tem teste unitário, e a de cota DIÁRIA foi exercitada
   de verdade** (foi ela que motivou `perDay`). A espera por cota por minuto
   ainda não foi observada acertando.
4. **O modelo perde acentuação — mas só foi visto no `lite`.** Vista no bench
   (`"gesto"` por `"gestão"`) e na medição de 14/08 no `flash-lite`. **Não
   reapareceu na medição de 16/08, com o Pensante já no `flash` (config
   ativa)** — consistente com a hipótese de ser defeito do `lite`, mas é uma
   amostra só, não confirmação. Se algum dia trocar o Pensante de volta pro
   `lite`, essa dívida volta a valer.
5. **Participante sem citação some da Ata** — ver medição 3 acima
   (`docs/medicao-2026-08-14/`). **Não reapareceu na medição de 16/08**
   (os cinco certos entraram, o sexto — que era do cliente, não participante
   — ficou de fora corretamente), mas de novo é uma amostra, não descarta a
   instabilidade. Mitigação aplicada em 17/08/2026: `guidance` da seção
   `participantes` em `lib/templates/ata.ts` agora pede citação ativa por
   participante e avisa a consequência (descarte) — não foi medida de novo
   depois da mudança, então é aplicada, não confirmada.
6. **O Pensante põe citação literal da transcrição dentro da Conclusão.**
   Vista na execução 2 de 14/08. Mitigação aplicada em 17/08/2026: `guidance`
   da seção `conclusao` em `lib/templates/ata.ts` ganhou um lembrete
   explícito de prosa sem aspas — mesma ressalva, não medida de novo.
7. **NOVO (17/08/2026), ATUALIZADO (18/08/2026) — o plano Hobby da Vercel
   provavelmente não aguenta uma Ata inteira.** `app/api/generate`,
   `/api/ai/secao` e `/api/ai/bench` ganharam `export const maxDuration = 300`
   depois que a medição de 16/08 mostrou 202s para só cinco das nove seções
   (cota diária cortou antes de fechar) — extrapolando, nove seções ficam por
   volta de 360s. Tentei 600 primeiro; o deploy real falhou com "Serverless
   Functions must have a maxDuration between 1 and 300 for plan hobby" — 300
   é o TETO DURO confirmado do plano, não um valor conservador escolhido.
   Ou seja: mesmo no máximo permitido, uma Ata completa tem boa chance de
   estourar o teto de função no Hobby. Isso não se resolve subindo o número —
   precisa de plano pago da Vercel (teto exato não verificado) ou de tornar a
   geração assíncrona (job em background/streaming), redesenho que não foi
   feito.

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
2. **Atualizado 17/08/2026 — feito, parcialmente.** A fixture longa existe
   (`docs/fixtures/reuniao-longa-ruidosa.txt`, 13.943 chars — menor que os 30
   mil sugeridos aqui antes, mas já bastou para passar do piso de cache) e a
   medição rodou (`docs/medicao-2026-08-16-longa/`): cache saiu de zero, mas
   rendeu bem menos que o teto teórico. **O que ainda falta**: ninguém rodou
   as nove seções fechando o documento inteiro — a cota diária cortou na
   sexta. Se quiser medir isso, precisa de chave paga (a free tier não
   aguenta uma Ata inteira) ou economizar quota reduzindo `thinkingLevel` em
   seções simples antes de tentar.
3. Só então decida entre Fase 6 e Fase 8 com o autor.
