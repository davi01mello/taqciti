# Servidor de geração de documentos

Mapa de manutenção do servidor Next.js em `server/` que transforma transcrição de reunião em documento (PDF, e DOCX para personalizados). Tudo aqui foi conferido no código; o que não foi está marcado "não verificado". Os comentários de topo de cada arquivo explicam as decisões, e este texto aponta para eles.

> Aviso: o `server/` usa uma versão do Next.js com mudanças incompatíveis (ver `server/AGENTS.md`). Antes de mexer em rotas, leia `server/node_modules/next/dist/docs/`.

## 1. Duas famílias de documento

| Família | Tipos | Entrada | Quem decide a estrutura |
|---|---|---|---|
| Catálogo | `ata`, `x1`, `resumo`, `daily`, `planning`, `review` (`lib/documentTypes.ts`) | uma transcrição | o template (`lib/templates/`) + o Leitor |
| Personalizado | texto livre | um pedido + fontes escolhidas pela pessoa | o modelo (papel `redator`), validado em código |

As duas terminam no mesmo compilador (`lib/documentos/compilador/`), na variante visual `editorial`.

## 2. Pipeline do catálogo

```
transcrição ──> [data semeada em código] ──> Leitor (1 chamada) ──> âncoras (código)
   ──> guarda de fidelidade (código) ──> Auditor (1 chamada, só seções strict)
   ──> descarte + lacunas extremas (código) ──> DocumentData
   ──> markdown (código) / HTML (render/html.ts) / ContentTree ──> compilador ──> PDF
```

Orquestração:

- `lib/generateDocument.ts` — fachada: semeia a data, laça `generateStep` até `done`, monta `content`, `html` e `pdf` (base64). A falha do PDF é isolada (`try/catch`): HTML e `content` saem mesmo assim, exceto `DocumentoSemConteudoError`, que sobe.
- `lib/generateStep.ts` — `apurar()` (passos Leitor a lacunas, reaproveitado por `/api/ai/secao`) e `generateStep()` (monta markdown por seção, aplica `omitWhenEmpty`, `assertSemVazamento`). Respeita `completed` (seção pronta não é regerada) e `documentData` de passada anterior. Hoje uma passada resolve tudo (`done: true`).
- `lib/dataDaReuniao.ts` — a data real da captura (`date` do corpo) vira `DD/MM/AAAA` no fuso `America/Sao_Paulo` (override `DOCCITI_TIMEZONE`) e entra em `metadata.date` ANTES do pipeline. Data inválida/ausente devolve `undefined`, nunca "hoje".
- `lib/rotuloDeSelf.ts` — "Você" (rótulo do Meet para quem gravou) não é nome: some dos participantes no PDF do catálogo (`ehRotuloDeSelf`).

Custo: no máximo 2 chamadas por documento (0 se nenhuma seção precisa de modelo; 1 se não há seção `strict` com afirmação a conferir). Personalizado: 1 chamada de geração, com até 2 tentativas se nada sobreviver à checagem; edição: 1 chamada.

## 3. Os agentes: por que só dois

Tipos em `lib/ai/types.ts`: `AgentName = 'leitor' | 'auditor'`. Já existiram Analista (compactação), Pensante (uma leitura por seção) e Escritor (prosa). Os cortes estão justificados em `lib/agents/leitor.ts` e `server/README.md`: contexto de 1M tokens elimina divisão em seções; saída estruturada e raciocínio nativos tornam o Pensante repetido redundante; o Escritor só produzia um markdown que podia discordar do PDF.

- **Leitor** (`lib/agents/leitor.ts`): lê a transcrição UMA vez, `reasoning: 'high'`, `maxTokens` 48.000 (`LEITOR_MAX_TOKENS`), prompt `leitor/v2`. A transcrição vai como `cacheablePrefix`; o `guidance` de cada seção vai ÍNTEGRO na mensagem de usuário (regra mora num lugar só). O schema é um objeto com uma chave por seção. Seções `fromUserOnly` ficam fora da leitura. O modelo devolve citações literais (`quote`); NUNCA offsets.
- **Âncoras** (`lib/agents/anchoring.ts`, código): localiza cada citação (passada literal, depois normalizada em espaços/aspas/caixa; acento NÃO é normalizado, de propósito). Mantém um cursor, para citações curtas repetidas não apontarem todas à primeira ocorrência. Um localizador por seção. Sem localização: `anchor: null`, a citação não sustenta nada e aparece em `unlocatable`. `QuoteStats.anchorRate` é o principal indicador de saúde do Leitor.
- **Auditor** (`lib/agents/auditor.ts`): julga cada afirmação vendo SÓ o trecho original em volta das âncoras (folga `EXCERPT_PADDING_CHARS` = 400), com o citado marcado entre `⟦ ⟧`. Prompt `auditor/v4`. Uma chamada para todas as afirmações. É genérico (não conhece "participante"). Veredito ausente ou malformado conta como rejeição; id repetido vale o primeiro. Afirmação com `blocker` (decisão cuja concordância não localizou) é rejeitada em código, sem chamada.

## 4. Seções, auditoria e templates

`SectionSpec` (`lib/templates/types.ts`): `id`, `title`, `order`, `required`, `needs`, `guidance`, `audit` (`strict|light|none`), `askWhenMissing`, `omitWhenEmpty`, `fromUserOnly`. O `audit` é política; só `strict` aciona o Auditor (`apurar`). `light` e `none` passam apenas pelas guardas de código.

| Tipo | Seções (id: audit) |
|---|---|
| `ata` | `identificacao`: light; `topico_geral`: none; `participantes`: strict; `topicos_discutidos`: light; `decisoes`: strict; `outcomes`: strict (omitida se vazia); `outputs`: strict (omitida se vazia); `conclusao`: none; `assinatura`: none (`fromUserOnly`, omitida sem nome) |
| `x1` | `perguntas_respostas`: strict (pares pergunta/resposta de entrevista 1:1) |
| `resumo` | `resumo_por_periodo`: strict (trechos cronológicos, carimbos `HH:MM:SS` copiados, nunca calculados) |
| `daily`, `planning`, `review` | uma seção `documento`: strict, placeholder genérico (`DocumentData.generic`) |

A afirmação auditável de cada seção, e como removê-la, está em `SECTION_DATA_SPECS` (`lib/documentData.ts`): cada seção define `schema`, `merge`, `claims`, `drop`, `serialize` e `markdown`. Acrescentar seção não exige mexer no Auditor.

Decisão x proposta: `Decision.agreement` é uma citação própria e ancorada da fala que aceita a proposta. Concordância não localizada derruba a decisão em código; a localizada chega ao Auditor marcada. Isso substituiu a ideia de aumentar a folga (ver `server/README.md`, "A armadilha de decisão").

## 5. Modelo de dados

### DocumentData (`lib/documentData.ts`)

Camada canônica; markdown, HTML e PDF saem DELA, nunca um do outro. Campos opcionais: `metadata {date, projectName}`, `generalTopic`, `participants[] {name, role?, roleSource: meeting|user|unknown, quotes}`, `topicsDiscussed[]`, `decisions[] {text, agreement, confidence, quotes}`, `outcomes[]`, `outputs[]`, `conclusion`, `signature`, `qa[]` (X1), `periods[]` (Resumo), `generic{seção: itens}`. `AnchoredQuote = {quote, anchor: {start,end,...}|null}`. Campo sem evidência fica AUSENTE; nunca preenchido por inferência.

### Gap e a política "sem campo faltante"

`Gap {sectionId, field, question, why, extrema?}`. `detectGaps` (`agents/leitor.ts`) só olha `askWhenMissing` (data, projeto, cargo de participante, nome de "Você", assinatura). Mas em `apurar` toda lista de lacunas passa por `soDuvidasExtremas`, que mantém só `extrema === true`. O comentário do código diz que nenhuma detecção automática marca `extrema` hoje, logo na prática nenhuma lacuna sai: não há `[A preencher: ...]` em documento de cliente, cargo/assinatura/projeto desconhecidos simplesmente não entram, e afirmação descartada pelo Auditor some sem pergunta. O mecanismo (marcador `textoDeLacuna`, `questions`, `/api/answers`) continua de pé para o dia em que algo for marcado extrema. Nota: `discardedAsGap` não marca `extrema`, portanto também é filtrada.

`applyAnswers` (`lib/applyAnswers.ts`, sem modelo) preenche `metadata.date`, `metadata.projectName`, `signature.name|role` e `participants[X].role` (com `roleSource: 'user'`). Resposta em branco não apaga; resposta sem campo correspondente volta em `naoAplicadas`.

### ContentTree e blocos (`lib/documentos/contentTree.ts`)

`ContentTree {revisao, titulo, blocos[], lacunas[]}` (zod). Fonte de verdade de PDF, DOCX e preview; revisão por chat é patch sobre `blockId`. Tipos de bloco: `capa`, `titulo` (nível 1-3), `paragrafo`, `lista` (ordenada ou não), `tabela` (cabeçalho, linhas, legenda), `imagem` (`ativoId` + `textoAlternativo` obrigatório), `referencia`, `quebra_de_secao`, `sumario`. Comuns: `blockId`, `papel` (papel de estilo), `fontes[] {fonteId, trecho?}`, `classificacao` (`fato|recomendacao|pendencia`), `origem` (`agente|pessoa`), `layout` (`normal|compacto|quebra_antes|manter_junto`). Não existe bloco de HTML livre: o modelo pede PAPÉIS, nunca medidas.

`validarArvore`: ids únicos, capa só no início, um sumário depois da capa, tipo compilável, fato precisa de fonte. `aplicarPatch` (`substituir|remover|inserir_depois`) exige a revisão esperada e lança `ConflitoDeRevisao` (HTTP 409); incrementa a revisão.

### Catálogo para ContentTree (`lib/documentos/doCatalogo.ts`)

`arvoreDoCatalogo` monta capa (título do template, subtítulo = projeto, título da reunião ou tópico; data) e corpo a partir do `DocumentData`, e passa pelo MESMO compilador, variante `editorial`. Não entram: campo ausente, "Você", e o título da seção quando só há uma e ela repete o documento. Sem nenhum corpo e sem lacuna extrema: `DocumentoSemConteudoError` (HTTP 422), por exemplo X1 em reunião de equipe.

## 6. Personalizados (`lib/documentos/gerar.ts`)

- Papel `redator` usa a configuração do agente `leitor`. Gerar: prompt `redator/v3`, `maxTokens` 12.000, raciocínio `medium` (`DOCUMENTOS_RACIOCINIO_GERACAO`). Editar: `redator/v4`, `maxTokens` 8.000, raciocínio `low` (`DOCUMENTOS_RACIOCINIO_EDICAO`). Valor inválido cai no padrão.
- A capa (cliente, autor, data) vem da pessoa, nunca do modelo. IDs de bloco são do código (`s1-b1`; edição `e<rev+1>-n`).
- **Sustentação** (`blocoDoModelo`): bloco `fato` só entra se ao menos uma citação existe literalmente numa fonte SELECIONADA. Sem isso, o bloco sai e vira problema `sustentacao` no relatório. `recomendacao` entra como recomendação. Sumário, referência, capa e título não afirmam fato e só passam pela validação de formato. Referência após recomendação é descartada.
- Fatos também passam pela guarda de fidelidade (`guardarConteudo`) com os turnos em volta da citação. Seção que perdeu todo o conteúdo some com o título. Se só a capa sobra: `ErroDeGeracao` (422).
- Edição: recusa bloco inexistente, fora do `escopo`, escrito por pessoa e não selecionado, remoção de capa, troca que mudaria o tipo. Capa substituída preserva cliente/autor/data.
- Relatório (`QualityReport`): problemas de sustentação, achados medidos de layout (`inspecao.ts`: página quase vazia, título no pé, sobra na última página) e extensão (`firme` ou `aproximada`; nada é cortado). Declara a limitação de que as páginas não foram inspecionadas visualmente.

## 7. Compilador e variantes visuais

`lib/documentos/compilador/index.ts`: `compilarPdf(arvore, {perfil?, variante?})` e `compilarDocumento(arvore, {formatos})` (PDF e/ou DOCX da mesma árvore, um manifesto, hashes sha256). `preparar` lança `ErroDeCompilacao` se a árvore é inválida, a variante não é aplicável (fonte/ativo ausente sem substituição autorizada) ou imagem sem ativo. Com sumário, são duas passadas (a primeira mede a página de cada título); se a paginação mexer, avisa. Fontes: `pdfkit` com `font: null` (nada de Helvetica); `serverExternalPackages: ['pdfkit']` em `next.config.ts` (o `pdfkit` lê arquivos do próprio pacote e quebra empacotado).

Perfil (`perfil.ts`): `PERFIL_CITI_PROVISORIO` (estado provisório, nenhuma regra validada por responsável), cada regra com proveniência `explicita|observada|inferida`. Variantes:

| Variante | Origem | Desenho | Uso |
|---|---|---|---|
| `ata` | modelo da Ata, medido (margem 72pt, Barlow embutida, marca preta) | `compilador/ata.ts`, reaproveita `render/pdf.ts` | ainda existe e é a primeira do perfil (padrão quando `variante` não é informada) |
| `editorial` | Apostila Unit Economics (referência de ESTILO, não de texto) | `compilador/editorial.ts`, margem 54pt, capa gráfica, marcador quadrado verde, rótulos em monoespaçada | `VARIANTE_DOS_PERSONALIZADOS = 'editorial'` |

Quem usa o quê hoje: personalizados (gerar, editar, `/api/documentos/renderizar`) e TODOS os documentos do catálogo (`renderPdfDoCatalogo`) usam `editorial`. A `ata` só roda quando alguém pede `variante: 'ata'` ou chama o compilador sem variante. `render/pdf.ts` já não é o caminho do PDF do catálogo; `render/html.ts` continua sendo o HTML do catálogo (subconjunto aceito pelo import do Google Docs). Substituição autorizada: Neue Haas por Barlow (registrada no perfil).

## 8. Guardas

### Fidelidade (`lib/guardaDeFidelidade.ts`) — código, sem chamada, antes do Auditor

1. **Léxico fora da fonte**: palavra de cargo/hierarquia (diretor, gerente, gestor, coordenador, líder, analista, CEO etc.) ou de gravidade (crítico, grave, urgente) presente no texto gerado e ausente da transcrição derruba a FRASE. Léxico estreito de propósito.
2. **Certeza indevida**: frase que afirma causa com certeza (constatou-se, se deve a, decorre, "que afetavam...") apoiada em citação que era hipótese (acho, talvez, pode ter) sobre o MESMO assunto (pelo menos 2 palavras de conteúdo em comum, medido por turno de fala via `turnosEmVolta`: o turno da citação e 3 antes e 3 depois). Frase que já mantém a dúvida não é tocada.

Escopo: prosa (tópico geral, tópicos, períodos, conclusão) perde só a frase; itens (decisões, outcomes, outputs, generic) caem inteiros. Descartes entram em `report.discarded` e a seção dona perde o item. Não cobertos por `guardarFidelidade`: `qa` (X1) e participantes (estes passam pelo Auditor). Só remove, nunca reescreve.

### Vazamento (`lib/vazamento.ts`)

`assertSemVazamento` procura `FRASES_PROIBIDAS` (instruções de autoria do modelo da Ata, sensíveis a caixa) no markdown por seção, no documento montado, no HTML e em `/api/answers`; falha ALTO com `VazamentoDeInstrucaoError`. O PDF não é varrido (texto comprimido), a garantia é a fonte única de dados. `confidenceFor` decide a confiança da seção em código.

### Política de dados e tranca

- `DOCCITI_DATA_POLICY=training` (ou modelo de entrada da matriz com `dataPolicy: 'training'`) liga `activeDataPolicyWarning`; as rotas que chamam modelo então exigem `"sintetica": true` (400 com `aviso` caso contrário). A política é do PLANO DA CHAVE, não do modelo. `/api/answers` e `/api/documentos/renderizar` não chamam modelo e não têm a trava.
- `lib/apiGuard.ts`: header `x-docciti-key` contra `DOCCITI_SHARED_KEY` (comparação de tempo constante; sem a variável a rota responde 500, falha fechada). Não é autenticação real: o segredo viaja na extensão. CORS reflete qualquer origem e não protege nada. Teto `DOCCITI_MAX_TRANSCRIPT_CHARS` (padrão 400.000).

## 9. Camada de IA (`lib/ai/`)

Único lugar que fala com provedor e conhece nome de modelo (`config.ts` e `pricing.ts`). API: `complete(agent, req)` e `completeStructured`. `CompletionRequest`: `system`, `messages`, `maxTokens`, `jsonSchema`, `cacheablePrefix` (sempre no início da primeira mensagem de usuário), `reasoning` (`low|medium|high`). Resultado traz `usage` normalizado (`inputTokens` inclui cache), `meta` (`repaired`, `rateLimitWaits`, `overloadWaits`).

Provedores (`ProviderId`): `anthropic`, `openai`, `google`, `xai`, `groq`, `mock`. Chaves por provedor: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `GROQ_API_KEY`. Saída estruturada funciona nos cinco reais; o adaptador valida e faz UMA tentativa de reparo (`repaired: true`) quando o provedor não garante a forma. Em `supports()`, só anthropic tem cache explícito e só anthropic/google têm raciocínio por requisição (openai, xai e groq: `false`).

Configuração ativa padrão (`DEFAULT_AGENT_CONFIG`): `leitor` em Google (família flash), `auditor` em Google (flash-lite). Precedência (`buildAgentConfig`):

1. `MOCK_LLM=true` — todos no mock; vale em produção também.
2. `DOCCITI_LEITOR` / `DOCCITI_AUDITOR` no formato `provedor:modelo` (`DOCCITI_PENSANTE` ainda vale pelo Leitor; `DOCCITI_ESCRITOR` não faz nada). Mal formado ou provedor desconhecido lança erro.
3. `LLM_PROVIDER` — provedor de todos os agentes, modelo padrão em `MODELO_PADRAO_POR_PROVEDOR`; aceita `claude`, `gpt`, `gemini`, `grok`, `groq`, `mock` e ids internos.
4. Padrões; ou mock quando não há chave e não é produção (`mockPadrao`). Atenção: a lista de chaves de `mockPadrao` é Anthropic, OpenAI, Google e xAI; `GROQ_API_KEY` NÃO está nela, então só com chave da Groq e sem `LLM_PROVIDER` o servidor cai no mock.

Outras variáveis: `DOCCITI_RATE_LIMIT_RETRIES` (padrão 5), `GROQ_TPM_LIMIT` (padrão 8000), `DOCCITI_TIMEZONE`, `DOCUMENTOS_RACIOCINIO_GERACAO` e `DOCUMENTOS_RACIOCINIO_EDICAO`.

Espera (`providers/shared.ts`, `withRateLimitRetry`): repete só 429 e 503/529, contados em separado; backoff exponencial com jitter, teto de 60s por espera, honra `retry-after`. `RateLimitError.perDay` (cota diária) sobe na hora, sem esperar. O cliente da Anthropic roda com `maxRetries: 0` para as esperas ficarem visíveis.

### Groq (plano gratuito)

`providers/groq.ts`, via `fetch` ao endpoint compatível com OpenAI. O limite que manda é tokens por MINUTO, contando entrada mais `max_tokens` pedido. O adaptador: estima a entrada (3,5 caracteres por token), REDUZ o `max_tokens` para caber em `GROQ_TPM_LIMIT`, recusa com a conta na mensagem se a entrada não deixa ao menos 1.200 tokens de saída (o 413 da Groq vira `ProviderError`), e usa `reasoning_effort: 'low'` em modelos `gpt-oss` quando a saída fica abaixo de 4.000. Modelo padrão: `openai/gpt-oss-120b`. O valor padrão do limite (8.000) é o do plano gratuito desse modelo, medido pelo autor do adaptador; plano pago exige subir a variável. Tabela de preços da Groq (e da OpenAI) VAZIA: custo estimado é `undefined`. Na prática, o Leitor pede 48.000 tokens de saída e uma transcrição real não cabe em 8.000 por minuto: o plano gratuito serve para transcrição curta (não medido por mim).

Matriz de comparação (`COMPARISON_MATRIX`): só anthropic, google e xai; insumo do harness, não configuração. Entradas experimentais (preview e free tier) ficam fora de `productionCandidates()`.

## 10. Prompts (`lib/prompts/`)

Arquivos `lib/prompts/<agente>/vN.md`, lidos por `renderPrompt(agente, versão)` com cache em memória (caminho a partir de `process.cwd()`, que é `server/`; um build `standalone` precisaria copiar a pasta). Regras: neutros quanto ao provedor (há teste); **versão nova é arquivo novo, nunca edição no lugar** (o resultado do harness fica atrelado à versão); `{{marcador}}` sem valor falha alto; formato de saída vai no `jsonSchema`, não em prosa. Em uso no pipeline de documentos: `leitor/v2`, `auditor/v4`, `redator/v3` (gerar), `redator/v4` (editar). Existem também `leitor/v1`, `auditor/v3`, `redator/v1` e `v2`. A pasta `taq/` é do chat do Taq, fora deste escopo. A troca de versão em uso é uma edição no agente que chama (`promptVersion` no Leitor e no Auditor); publicar prompt novo exige publicar o servidor antes da extensão quando a extensão passar a depender dele (não verificado para estes prompts).

## 11. Rotas HTTP

Todas: `POST` JSON, `OPTIONS` (CORS), header `x-docciti-key`. Códigos comuns: 400 corpo/campo inválido ou trava de dados; 401 chave ausente/errada; 500 servidor sem `DOCCITI_SHARED_KEY`.

| Rota | Chama modelo | Corpo | Resposta 200 |
|---|---|---|---|
| `/api/generate` | sim | `transcript`, `documentType`, `title?`, `date?`, `sintetica?` | `title`, `content` (markdown), `documentData`, `html`, `pdf?` (base64), `questions`, `gaps` |
| `/api/answers` | não | `documentType`, `documentData`, `answers`, `gaps?`, `title?` | `documentData`, `gaps`, `questions`, `html`, `pdf?`, `aplicadas`, `naoAplicadas` |
| `/api/documentos/gerar` | sim | `pedido`, `fontes[] {id,titulo,texto}`, `capa?`, `extensao?`, `orientacoesEditoriais?`, `variante?`, `sintetica?` | árvore, `pdf` (base64), `manifesto`, `relatorio`, `avisos`, `lacunas` |
| `/api/documentos/editar` | sim | `arvore`, `revisaoEsperada`, `pedido`, `fontes`, `escopo?`, `variante?` | como gerar, mais `aplicadas`, `recusadas`, `observacao?` |
| `/api/documentos/renderizar` | não | `arvore`, `variante?`, `formatos?` (`pdf`, `docx`; padrão `pdf`) | `pdf?`, `docx?`, `manifesto`, `avisos`, `substituicoes` |
| `/api/ai/secao` | sim | `transcript`, `sections?`, `documentType?` (padrão `ata`), `sintetica?` | diagnóstico: vereditos, descartes, citações, `documentData` |
| `/api/ai/smoke`, `/api/ai/bench` | sim | ver comentários de topo | diagnóstico de provedor (fora do fluxo de produto) |

Não analisadas por mim: `/api/mcp`, `/api/sync`, `/api/conector/token`, `/api/taq/*` (outras áreas).

Erros específicos:
- 413: transcrição (generate, secao) ou soma das fontes (gerar, editar) acima do teto.
- 422 (`erroConhecido` em `documentos/requisicao.ts`): `ErroDeGeracao`, `ErroDeCompilacao`, `DocumentoSemConteudoError`. Vale para generate, gerar, editar e renderizar.
- 409: `ConflitoDeRevisao` em editar (revisão mudou).
- 429: `RateLimitError` (mensagem distingue cota diária de por minuto). 503: `OverloadedError`.
- 502: qualquer outro erro na geração, com mensagem genérica (inclui `VazamentoDeInstrucaoError` e erro de provedor). `/api/ai/secao` devolve 502 com a mensagem do erro.
- `/api/answers`: 400 se a guarda de vazamento dispara; não tem 413. `/api/documentos/renderizar`: erro desconhecido vira 500 (não 502).
- `maxDuration = 300` nas rotas é diretiva da Vercel; o código diz que é inerte em host de processo longo. Produção hoje roda na Vercel segundo `server/README.md` (que também registra o deploy manual); não verificado se o limite incide agora.

## 12. Rodar e testar

Scripts de `server/package.json`: `dev`, `build`, `start`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `test:watch`, `test:live`.

- `.env.local` é lido no boot: reinicie o servidor depois de mexer.
- Vitest (`vitest.config.mts`): inclui `lib/**/*.test.ts`; `vitest.setup.ts` define `MOCK_LLM=true` antes de qualquer import, então nenhum teste chama provedor (adaptadores recebem `fetch` por parâmetro). Alias `@/` declarado à mão. Suítes com PGlite (Postgres em WASM) usam `hookTimeout` 60s.
- Sem memória: `npx vitest run --maxWorkers=3`.
- Testes `.live`: `npm run test:live` (script `scripts/testLive.mjs`) liga `DOCCITI_LIVE_TESTS=1`; `agents/auditor.canonical.test.ts` roda só com isso e `GOOGLE_API_KEY`. `documentos/gerar.live.test.ts` é gateado por `DOCUMENTOS_LIVE=1` e roda o redator ao vivo com reunião sintética (arquivo à parte do `test:live`, ligar a variável direto). Eles gastam cota e exigem fixture sintética.
- Prova de fumaça do render em build de produção: `npm run build`, `npm run start`, depois `node scripts/smokePdf.mjs` (usa `DOCCITI_SHARED_KEY`, base em `SMOKE_BASE_URL`, padrão `http://localhost:3000`; chama `/api/answers`, sem modelo). Necessária porque testes verdes não passam pelo bundler.
- Fixtures sintéticas em `server/docs/fixtures`. Não comitar transcrição real.

## 13. Onde olhar primeiro

| Sintoma | Arquivo |
|---|---|
| Seção sumiu ou frase caiu | `guardaDeFidelidade.ts`, `report.discarded` (`/api/ai/secao`) |
| Citação não localizada, taxa de âncoras baixa | `agents/anchoring.ts`, `unlocatable` |
| Participante/decisão rejeitado | `agents/auditor.ts`, veredito e `excerpt` |
| PDF sem arquivo em produção | `next.config.ts`, `scripts/smokePdf.mjs` |
| Layout (página vazia, título no pé) | `compilador/inspecao.ts`, `compilador/editorial.ts` |
| Trocar provedor ou modelo | `lib/ai/config.ts`, variáveis `DOCCITI_*` |
| Mudar o texto que o Leitor recebe | `guidance` em `lib/templates/*.ts`, nova versão em `lib/prompts/` |

Documentos relacionados: `docs/documentos-personalizados.md`, `docs/redesenho-dos-documentos.md` (desenho de melhorias, não o estado atual), `server/README.md`, `server/lib/ai/README.md`, `server/docs/HANDOFF.md` (histórico, parcialmente superado).
