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

Último commit: `b364794`.

---

## Onde o projeto está

O servidor (`server/`, Next.js 16 App Router, independente do resto do repo)
tem a rede de agentes montada até o Auditor. **Mas `/api/generate` ainda
devolve stub**: `lib/generateStep.ts` continua chamando `renderSectionStub`, e
nada no caminho da extensão chama os agentes. Quem gerar um documento hoje
recebe nove seções dizendo "Transcrição recebida com N caracteres".

### Pronto e verificado contra a API real

| | onde |
|---|---|
| Tranca do endpoint (`x-docciti-key`, falha fechada, teto de 400 mil chars) | `lib/apiGuard.ts` |
| Camada multi-provedor (Anthropic, Google, xAI) + pricing + matriz | `lib/ai/` |
| Analista: compactação com âncora localizada por código | `lib/agents/analista.ts`, `lib/agents/anchoring.ts`, `lib/agents/windowing.ts` |
| Pensante: contexto compactado + `SectionSpec` → dados estruturados | `lib/agents/pensante.ts` |
| Auditor: confere contra o trecho ORIGINAL | `lib/agents/auditor.ts` |
| Laço Pensante ↔ Auditor, teto de 2 passadas | `lib/agents/sectionPipeline.ts` |
| JSON intermediário (`document_data`) | `lib/documentData.ts` |
| Prompts como artefatos versionados (esqueleto da Fase 7) | `lib/prompts/` |

**210 testes passando + 3 de rede** (`npm test` / `npm run test:live`),
`npx tsc --noEmit` e `npm run build` limpos.

Rotas de exercício, todas exigindo o header `x-docciti-key`:
`/api/ai/smoke`, `/api/ai/bench`, `/api/ai/analista`, `/api/ai/secao`.

`/api/ai/secao` roda o pipeline inteiro (Analista → Pensante → Auditor) nas
nove seções e é o melhor ponto de partida para entender o que já funciona.

### Falta

- **Fase 5 — Escritor e montagem.** É aqui que `renderSectionStub` morre.
- **Fase 6 — saída em Google Docs** (a especificação original foi substituída
  pelo Adendo 2; ver "Fase 6" abaixo).
- **Fase 8 — harness** em `server/eval/`.

---

## ⚠️ DECISÃO ABERTA — resolva com o autor antes da Fase 5

**O Auditor está deixando passar a armadilha de decisão.**

`EXCERPT_PADDING_CHARS = 400` em `lib/agents/auditor.ts`. A folga existe
porque a citação sozinha costuma ser curta demais para julgar (`"Concordo."`
não diz com o quê). Mas numa reunião onde quase toda fala é seguida de
concordância, 400 caracteres quase sempre alcançam **alguma** concordância,
inclusive de outro assunto.

Medido na transcrição de teste: o Pensante propôs *"Avaliar desnormalizações
específicas após testes de desempenho"* como decisão e o Auditor **aprovou**,
justificando com "Ana sugerindo e Carlos concordando". A transcrição não tem
essa concordância — depois do "Podemos avaliar" da Ana, Carlos muda de
assunto. A concordância veio de um tópico vizinho, dentro da folga.

É a armadilha de decisão passando pela peça que existe para barrá-la.

Três saídas possíveis, e a escolha é do autor:

1. **reduzir a folga** — barato, mas volta o problema do trecho curto demais;
2. **marcar dentro do trecho qual parte é a âncora**, instruindo o Auditor a
   julgar centrado nela;
3. **exigir que a evidência de concordância também venha ancorada** — o
   Pensante teria de apontar o `statementId` da concordância, não só o da
   proposta. É a mais fiel ao desenho e a mais cara.

**Pergunte antes de escolher.** Se o autor mandar seguir sem resolver, siga —
mas registre no relatório que a Ata gerada pode conter proposta rotulada como
decisão.

---

## FASE 5 — Escritor e montagem

`server/lib/agents/escritor.ts`: dados estruturados da seção → prosa final.

Troque `renderSectionStub` pela chamada real dentro de `generateStep`,
mantendo o laço de chunking que já existe. `completed` passa a ser usado de
verdade: cada seção recebe as anteriores para não repetir nem se contradizer.

O Escritor recebe **os dados da seção**, não o contexto compactado nem a
transcrição. Tom institucional, sério e limpo; não é peça publicitária. Não
repete os blocos de instrução do PDF.

O prompt vai em `lib/prompts/escritor/v1.md`, seguindo as mesmas quatro regras
do carregador (`lib/prompts/index.ts`): neutro quanto ao provedor, versionado,
sem duplicar regra que já está no `guidance`, formato declarado por schema e
não por prosa. Há teste garantindo a neutralidade — siga o padrão dos outros.

`confidence` por seção: `ok` quando completa, `partial` quando faltou algo não
crítico, `missing` quando uma lacuna impediu.

### Lacunas sem UI de perguntas

A tela de perguntas não existe e **não deve bloquear nada**:

- campo com lacuna vira `**[A preencher: qual é o cargo de João?]**`, visível
  no documento. Os `Gap` já vêm prontos de `pensante.ts` e de
  `sectionPipeline.ts` (afirmação descartada pelo Auditor também vira lacuna);
- as `questions` voltam populadas na resposta da API, prontas para quando a UI
  existir;
- `omitWhenEmpty: true` continua valendo — Outcomes e Outputs somem se vazios,
  em vez de virarem placeholder.

### Guarda contra vazamento

Depois de montado o documento, **em código, não confiando no modelo**,
verifique que nenhuma destas expressões aparece na saída:

`O que escrever aqui` · `Narrativa Resumida` · `O Veredito` · `Ação Concreta` ·
`Alinhamentos Abstratos` · `Diferença para Decisões` · `Produtos Gerados` ·
`Resumo Executivo` · `[Nome do Tópico]` · `[Decisão A]` · `[Nome] – [Cargo]`

São instruções de autoria do PDF original. Se vazarem, chegam num cliente.
Se alguma aparecer, **falhe alto** — não entregue calado.

**PARE e reporte.** O autor quer ver uma Ata completa, em markdown, com as
nove seções, gerada de uma transcrição real.

---

## FASE 6 — saída em Google Docs (substitui a Fase 6 original)

Só depois da 5, e o autor decide a ordem. Resumo do que foi combinado:

- **A extensão cria o documento, não o servidor.** O servidor devolve o
  `DocumentData` e o HTML; a extensão pega o token via
  `chrome.identity.getAuthToken`, cria o arquivo no Drive do usuário e abre a
  aba. O servidor nunca vê token OAuth de usuário.
- Use **Drive API `files.create`** com o HTML e o mimeType de destino do Google
  Docs. **Não** use `documents.batchUpdate`.
- Escopo **`drive.file` e só ele**. Se parecer que precisa de mais, **pare e
  pergunte**.
- Mantenha o alvo **PDF** — só adiado, não descartado. Os dois renderizam a
  partir do `DocumentData`, não um do outro.
- Nome do arquivo: `Ata de Reunião — {projeto} — {DD-MM-AAAA}`, caindo para o
  título da reunião quando o projeto for lacuna. Sem `undefined` nem colchetes.

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
  fornecedor com todas as entradas puladas vira linha própria;
- `lib/ai/config.ts` — `COMPARISON_MATRIX` com teto e piso por fornecedor;
- `lib/ai/pricing.ts` + `costForEntry()` — custo, com free tier valendo zero;
- `lib/agents/anchoring.ts` — a taxa de âncoras é a asserção mais importante;
- `lib/ai/bench.ts` — a tarefa de referência e `checkAnchors`.

Fixtures precisam ser sintéticas. Há uma pronta, inventada pelo autor (reunião
sobre modelagem de banco de dados, ~2.900 chars, com a armadilha de decisão do
"Podemos avaliar desnormalizações"). Ela está fora do repo; peça ao autor.

Precisa de test runner? Já tem: **vitest**, em `server/`.

---

## Dívidas abertas

1. **Anthropic e xAI nunca fizeram chamada real.** Só há chave do Google. As
   formas de requisição vieram dos `.d.ts` dos SDKs. Os onze pontos específicos
   que vão quebrar primeiro, e como cada um falha, estão em
   [`docs/divida-verificacao-provedores.md`](divida-verificacao-provedores.md).
   **Leia antes de ligar qualquer chave nova.**
2. **Cache nunca deu hit.** `cachedInputTokens: 0` nas nove chamadas do
   Pensante, apesar do contexto compactado ir como `cacheablePrefix` idêntico.
   Causa provável: o mínimo do Gemini para cache implícito (2.048 tokens na
   família 2.5, mais nas 3.x) contra um contexto compactado de ~1.000 tokens na
   transcrição de teste. Numa reunião real deve passar. **Confirme com número
   antes de afirmar que o cache funciona.**
3. **Espera por 429/503 tem teste unitário, mas nunca foi exercitada de
   verdade** contra a API (um 503 chegou a derrubar uma execução, o que motivou
   o tratamento — mas a espera em si não foi observada acertando).
4. **Janelamento gera quase-duplicatas.** A deduplicação compara `text` +
   `quote` exatos; com 3 janelas, 3 citações foram usadas por 2 afirmações cada
   (mesma citação, redação diferente). Com o padrão de 200 mil chars uma reunião
   normal cabe numa janela e o problema não aparece. Deduplicar semanticamente
   tem risco real de fundir afirmações distintas — **não faça sem decisão do
   autor**.
5. **`gemini-3.5-flash` corrompeu caracteres** numa execução do bench:
   devolveu `"gesto"` onde a transcrição diz `"gestão"`, derrubando a taxa de
   âncoras de 100% para 29%. Intermitente, amostra de duas execuções. Hoje ele
   está no Pensante e no Escritor, onde não produz citação — risco menor. **Não
   o mova para o Analista sem medir mais.**

---

## Ambiente

```
cd server
npm install
npm run dev          # http://localhost:3000 — .env.local é lido NO BOOT
npm test             # 210 testes, offline, rápido
npm run test:live    # + 3 casos canônicos do Auditor contra a API
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
| analista, auditor | `gemini-3.5-flash-lite` (extração/verificação) |
| pensante, escritor | `gemini-3.5-flash` com `thinkingLevel: HIGH` |

> ⚠️ **`DOCCITI_DATA_POLICY=training` está ligado**, porque a chave é de free
> tier e free tier manda o conteúdo para treinamento do provedor em qualquer
> modelo. **Use SOMENTE transcrição sintética. Nenhuma gravação real de
> reunião.** As rotas exigem `"sintetica": true` no corpo enquanto isso valer.

---

## Regras que não podem ser quebradas

Do autor, e valendo desde o começo:

- **Não altere o contrato de `/api/generate`** além do header de chave.
- **Não mexa em `server/Legado/`.**
- **Não preencha os templates de `x1`, `daily`, `planning`, `review`** — não há
  modelo para eles. Eles geram seção única e genérica, e isso é esperado. O que
  não pode é quebrar.
- **Não construa a UI de perguntas.**
- **Não invente regra de negócio** que não esteja no `guidance` do template ou
  na especificação. Sinalize em vez de inventar.
- **Não instale dependência sem perguntar.**
- **Não comite transcrição real** como fixture.
- **Não deixe nome de modelo fora de `lib/ai/config.ts`** (e `pricing.ts`).
- **Não escreva prompt específico de um provedor** — há teste garantindo.

E as que se firmaram durante o trabalho:

- **Nunca peça offset de caractere ao modelo.** Ele entrega `quote`; o código
  localiza. Âncora errada é pior que âncora nenhuma.
- **Nunca omita em silêncio.** Entrada pulada, afirmação descartada, capacidade
  não verificada — tudo aparece no relatório, com motivo.
- **Custo `undefined` é melhor que custo zero.** Zero silencioso vira relatório
  de custo mentiroso.
- **Na dúvida, o Auditor rejeita.** Afirmação descartada vira lacuna; aprovada
  por engano vira fato inventado num documento tratado como registro.
- **Reporte o que mediu, não o que espera.** Se o número saiu na direção
  errada, diga o número.

---

## Primeira coisa a fazer

1. Rode `npm test` e `npm run build` para confirmar que o estado bate com o
   descrito aqui.
2. Suba o servidor e rode `/api/ai/secao` com a fixture sintética, para ver o
   pipeline funcionando antes de mexer nele.
3. **Pergunte ao autor sobre a decisão aberta do Auditor** (folga de 400
   caracteres) antes de começar a Fase 5.
