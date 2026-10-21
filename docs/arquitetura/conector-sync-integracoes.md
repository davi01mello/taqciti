# Conector MCP, sincronização e integrações externas

Visão de manutenção. O código e os comentários de topo são a fonte; este arquivo
é o mapa. Onde algo não foi conferido no código, está escrito "não verificado".
Detalhes finos do conector: `server/lib/conector/README.md`. Passos do Google
Cloud: `docs/google-oauth-setup.md` e `docs/integracoes-google-workspace.md`.
Riscos conhecidos: `docs/plano-de-seguranca.md`.

## 1. Visão geral

```
extensão (storage local = fonte da verdade de cada máquina)
   │  src/features/sync          GET/POST /api/sync        Bearer <id_token Google>
   ▼
servidor Next.js (server/)  ──►  Postgres (Supabase em produção)
   │  /api/conector/token  cria/lista/revoga o token do conector
   ▼
/api/mcp/<token>  ◄── Claude e ChatGPT (somente leitura do acervo)
```

Três atores e duas credenciais:

| caminho | credencial | verificada em |
| --- | --- | --- |
| extensão → servidor (`/api/sync`, `/api/conector/token`) | `id_token` do Google (OIDC) | `server/lib/identidade/google.ts`, via `tokeninfo`, a cada uso (cache curto) |
| Claude/ChatGPT → servidor (`/api/mcp/...`) | token do conector (`taqciti_` + 256 bits) | `server/lib/identidade/tokenDoConector.ts`, hash no banco |

As rotas do acervo NÃO exigem `x-docciti-key` (esse segredo protege as rotas de
LLM; ver `server/lib/identidade/rota.ts`).

## 2. O conector MCP

Código: `server/lib/conector/` (`despacho.ts`, `ferramentas.ts`, `mcp.ts`,
`atenderMcp.ts`, `chatgpt.ts`, `orcamento.ts`, `busca.ts`) e rotas
`server/app/api/mcp/route.ts` e `server/app/api/mcp/[token]/route.ts`.

**Catálogo (6 ferramentas, `FERRAMENTAS` em `despacho.ts`)**

| ferramenta | para quem | função |
| --- | --- | --- |
| `buscar` | Claude | até 12 trechos com id e POSIÇÃO do acerto |
| `listar` | Claude | até 25 títulos por página, sem conteúdo |
| `ler` | Claude | metadados e abertura de um item, sem o corpo |
| `conteudo` | Claude | uma fatia do corpo (até 40 falas), com `proximo` |
| `search` | ChatGPT | alias de `buscar`: `{ results: [{ id, title, url }] }` |
| `fetch` | ChatGPT | `{ id, title, text, url, metadata? }`; `text` é o começo do corpo |

Pontos de projeto:
- **Escada `buscar → ler → conteudo`** para economizar contexto do modelo. Os
  tetos (`ORCAMENTO` em `orcamento.ts`): resposta 24.000 caracteres, trecho 260,
  envelope 1.400, fatia 8.000, 12 acertos, 25 por página, 40 falas. `aplicarTeto`
  mede o JSON já serializado e encolhe até caber.
- **Projeção magra** (`tipos.ts`): prints viram só contagem; `speakersObserved` e
  `providerParticipantId` não são expostos. O histórico de versões, a cópia fiel e
  os prints NÃO são lidos pelo conector.
- **ChatGPT**: `search`/`fetch` respondem em `structuredContent` E como string JSON
  em `content` (`mcp.ts`). O `url` de citação aponta para `/item/<id>`; a existência
  dessa página não foi verificada neste mapeamento.
- **Sem sessão** (`sessionIdGenerator: undefined`) e **resposta em JSON**
  (`enableJsonResponse: true`): cada requisição monta e fecha um servidor. Voltar ao
  modo SSE reintroduz o bug do "200 com corpo vazio" (o corpo é materializado antes
  do `finally`).
- **Erro de uso** (`ErroDeUso`: id inventado, argumento torto) vira resultado com
  `isError: true`, que o modelo lê; erro real devolve mensagem genérica.
- Servidor anuncia `name: 'taqciti'` e uma versão fixa em `mcp.ts` (`VERSAO`,
  acompanha o `package.json` da extensão; atualizar a mão).
- Nenhuma ferramenta tem `readOnlyHint` e a saída traz transcrição crua sem aviso de
  "conteúdo de terceiros" (risco I4 do plano de segurança).

**Endereços e token**
- Endereço entregue ao usuário: `/api/mcp/<token>` (token no CAMINHO, porque o
  Claude sonda o endereço sem query string). `/api/mcp` continua aceitando
  `Authorization: Bearer` e `?token=` (`tokenDaRequisicao`).
- **Recusa de credencial = HTTP 200 com erro JSON-RPC** (código -32003, `id`
  ecoado), nunca 401: o cliente do Claude, diante de 401, procura OAuth e mostra
  mensagem enganosa. Consequência: monitor que olha só o status não vê recusas;
  olhar o `error` no corpo ou o `resultado: "recusa-token-invalido"` da linha `[mcp]`.
- `GET` sem `Accept: text/event-stream` responde 200 de cortesia; com SSE responde
  405 (não há canal de eventos). `Accept` incompleto em POST é completado.
- Sem `DATABASE_URL` as rotas respondem 503.
- Estamos fora da conformidade estrita de autorização do MCP (sem
  `WWW-Authenticate`, token na URL, recusa 200). Escolha consciente, registrada em
  `atenderMcp.ts`; a alternativa seria OAuth 2.1 (Fase 5 do plano de segurança).

## 3. Identidade e login

**Extensão** (`src/shared/services/identidade.ts`)
- `chrome.identity.launchWebAuthFlow` com cliente OAuth tipo "Aplicativo da Web"
  (variável de build `VITE_GOOGLE_OAUTH_WEB_CLIENT_ID`), `response_type=id_token`,
  escopo `openid email`, `nonce` conferido, `hd` do CITi como dica e
  `prompt=select_account` (clique) ou `prompt=none` + `login_hint` (silencioso).
- Nenhum diálogo sem clique: só `ligarSincronizacao()` pode abrir o popup, a partir
  da página Conexões. O "sim" fica em `taq:sync` (`{ ligada, email, emMs }`),
  separado da identidade: sem ele nada sobe.
- `id_token` fica só em memória (cache até `exp` menos 30 s); nunca em storage.
  `descartarToken()` é chamado quando o servidor responde 401.
- `contaEhDoCiti` barra conta de fora já no cliente; quem IMPÕE é o servidor.
- Desligar a sincronização é local e NÃO apaga o que já subiu.

**Servidor** (`server/lib/identidade/`)
- `google.ts`: `tokeninfo?id_token=`; recusa se `aud` != `GOOGLE_OAUTH_WEB_CLIENT_ID`
  (falha fechada se a variável faltar), se não há `sub`/e-mail, se
  `email_verified` é falso, se o e-mail não é do domínio permitido ou se o `hd` é de
  outra organização. Erro 400/401 do Google = recusa (401); outros = 502.
- Cache de identidade em memória: chave é o hash do token, validade limitada pelo
  `exp` (teto 5 min, margem 30 s).
- `dominio.ts`: padrão `citi.org.br` mesmo sem variável (fail-closed);
  `TAQCITI_DOMINIO_PERMITIDO` troca o domínio e `*` desliga (só desenvolvimento).
  O `hd` não é exigido (só pode ADICIONAR recusa).
- `rota.ts` (`autenticar`): Bearer → `identidadeDoToken` → `garantirPessoa`
  (upsert por `google_sub`, atualiza e-mail/nome/`vista_em`). Devolve `pessoaId`
  que nunca vem de parâmetro.
- `tokenDoConector.ts`: ver segurança (seção 7).

## 4. Rotas e contratos

| rota | método | função |
| --- | --- | --- |
| `/api/sync` | POST | lote de `{ itens, apagados }`; upsert; ver 5 |
| `/api/sync?desde=<seq>` | GET | volta incremental, `Cache-Control: no-store` |
| `/api/conector/token` | POST/GET/DELETE | cria (valor em claro UMA vez, rótulo até 80 caracteres, devolve a URL montada da origem da requisição), lista (sem token), revoga por `?id=` |
| `/api/mcp/[token]`, `/api/mcp` | POST/GET/DELETE | MCP |

CORS via `corsHeaders` de `lib/apiGuard`.

## 5. Sincronização

Código da extensão: `src/features/sync/` (`sincronizacao.ts`, `restauracao.ts`,
`paraOAcervo.ts`). Servidor: `app/api/sync/route.ts`, `copia.ts`, `prints.ts`,
`historico.ts`, `escrita.ts`, `cota.ts`, `cabeca.ts`.

**O que sobe** (`montarDesejado`): reuniões, documentos, conversas, notas
(com marcações e contagem de prints), histórico de versões dos documentos
personalizados (só de documentos que existem) e prints (só de reuniões que
existem). Reunião, documento, conversa e nota vão em DOIS itens: a projeção do
conector (`tipos.ts`) e a cópia fiel (`tipo: 'copia'`, `copia_local`). Histórico
(`tipo: 'historico'`) e print (`tipo: 'print'`) vão em um.

**Como decide** (`planejar`): assinatura por item (`tamanho.hash`, de projeção +
cópia). Mudou ou é novo → envia; sumiu localmente mas tinha assinatura → apaga.
Print é imutável: assinatura é id + tamanho. Assinaturas são gravadas a cada lote
aceito (queda no meio não recomeça do zero). Item e sua cópia andam sempre no mesmo
lote.

**Limites de lote**: 100 itens (conta itens no fio) e 8 MB de corpo no servidor
(413 se passar); a extensão corta em 4 MB e 100. Tudo é upsert, reenviar é seguro.
Lote falho devolve 500 com `gravados`. Gravações são sequenciais.

**Gatilhos**: mudança em `taq:history`, documentos, versões, conversas, notas,
marcas, prints ou `taq:sync` (espera de 1,5 s); `onStartup`/`onInstalled`
(forçam a volta); alarme `taq:sync-periodico` a cada 5 min (permissão `alarms`).
`taq:state` (estado vivo da reunião) NÃO dispara.

**A volta** (`restauracao.ts`, `GET /api/sync`): cursor `seq` de uma sequência do
banco (`copia_seq`), não relógio. Página: até 25 itens e 3 MB, sempre ao menos um
item; leitura em duas fases (metadados, depois corpos só dos escolhidos). A página
traz `{ itens: [{ colecao, id, corpo, apagado, seq }], proximo, fim }`. A volta roda
ANTES da subida, no máximo a cada 60 s, salvo: passada forçada, nunca rodou, ou há
algo a enviar. No máximo 400 páginas por passada; progresso gravado a cada página.

**Resolução de conflito** (`decidir`, pura): só toma o remoto quem NÃO mexeu no item
desde o último envio. Se os dois lados mudaram, o local vence e a versão remota vira
cópia recuperável: documento "(versão de outra máquina)", conversa "(outra máquina)",
nota com o texto remoto ao fim sob `--- versão de outra máquina ---` e marcações
somadas (as locais prevalecem). Cada item guarda uma BASE (resumo do último acordo) e
`tratados` evita duplicar a cópia. Reunião, histórico e prints não geram cópia.
Comparação é canônica (chaves ordenadas), porque o `jsonb` reordena.

**Itens que nunca se tocam**: reunião em gravação (`status === 'recording'`, protegida
na volta); itens locais que a versão atual não entende (preservados); um item que
sumiu localmente mas ainda tem assinatura não é ressuscitado; apagado remoto só remove
o local se este não mudou. Reunião remota que volta entra com `status: 'ready'`.
**Não voltam**: preferências e o estado interno do Taq.

**Troca de conta no mesmo navegador**: se o `sub` mudou, o acervo local é marcado
como já tratado (não sobe para a conta nova) e o cursor recomeça; o que está no storage
fica.

**Quota e limites do servidor** (`cota.ts`)
- Por pessoa: `TAQCITI_COTA_MB` (padrão 25) sobre cópias + prints + histórico, em
  bytes lógicos. Edição cobra só a diferença; exclusões passam sempre e rodam ANTES
  das gravações do lote.
- Disjuntor global: `TAQCITI_LIMITE_BANCO_MB` (padrão 400) com `pg_database_size`,
  medido no máximo 1x/min por instância; falha aberta se não conseguir medir.
- Recusa por cota vem em `recusados` com `temporario: true` e `chave`; a extensão
  NÃO a dá como enviada, pausa 30 min e mostra o resumo (`resumoDaCota`) em Conexões.
  Recusa por formato (corpo inválido) não é temporária e é registrada como aceita.
- Tetos: cópia 6 MB, print 1,5 MB (jpeg/png/webp validado pelos bytes), histórico
  3 MB e 30 versões.
- As projeções do conector (`reuniao`, `documento`, `conversa`, `nota`) e as
  lápides NÃO entram na cota nem passam pelo disjuntor (risco S7 do plano).
- Lápides expiram em 90 dias, limpas com probabilidade ~10% a cada escrita.
- Polling: `cabeca.ts` guarda o maior `seq` por pessoa por 15 s e responde "nada de
  novo" sem tocar no banco; escrita local invalida. Por instância (outra instância só
  vê a mudança quando o TTL vence). `cache.ts` (buscas do conector): TTL 30 s.

**Restauração em outra máquina**: instalar a extensão, entrar com a mesma conta
CITi e ligar a sincronização em Conexões. Cursor 0 traz tudo, em páginas.

## 6. Esquema de dados do servidor (`server/lib/conector/esquema.sql`)

Aplicado a mão, inteiro e idempotente (`if not exists`); NÃO roda no boot. Nenhuma
extensão do Postgres é exigida. Conteúdo em `jsonb`; busca por `texto_busca` já
dobrado pela aplicação (`dobrar()`), `tsvector` com configuração `simple` e índice GIN.

| tabela | para quê |
| --- | --- |
| `pessoa` | uma pessoa; chave estável `google_sub`; e-mail, nome, `vista_em` |
| `token_do_conector` | hash do token por pessoa, rótulo, `usado_em`; revogar apaga a linha (`revogado_em` é legado) |
| `reuniao`, `documento`, `conversa`, `nota` | projeção magra lida pelo conector; PK `(pessoa_id, id)` |
| `historico_do_documento` | versões dos documentos personalizados, backup; tem `seq` e `tamanho` |
| `copia_local` | cópia fiel por `(pessoa_id, colecao, id)`, lápide `apagado`, `seq`, `tamanho` |
| `print_local` | prints em `bytea`, imutáveis, lápide, `seq` |
| `copia_seq` (sequência) | cursor global das escritas |

Tudo referencia `pessoa(id)` com `on delete cascade`. Tabelas com RLS ligada no
arquivo: `historico_do_documento`, `copia_local`, `print_local`. As outras seis não
têm RLS no arquivo (risco S9); em produção o plano de segurança registra RLS ligada
em todas (conferido no advisor em 21/10/2026; não reverificado aqui).

Banco: `banco.ts` mantém um pool de 5 conexões por processo, criado na primeira
chamada; TLS com `rejectUnauthorized: false` fora de localhost. Em produção a
`DATABASE_URL` deve ser a do pooler (a conexão direta só responde em IPv6, que a função
serverless não tem). Interface `Consultador` independente de driver (PGlite nos testes).

## 7. Segurança

- **Isolamento por conta**: toda consulta filtra `pessoa_id` vindo da autenticação
  (identidade ou token do conector), nunca de parâmetro. `AcervoPostgres` recebe o
  `pessoaId` no construtor. Teste `isolamento entre pessoas` em `acervoPostgres.test.ts`
  e testes pela rota em `syncRota.test.ts`/`copia.test.ts`.
- **Token do conector**: `taqciti_` + 32 bytes aleatórios; banco guarda só o SHA-256;
  valor em claro aparece uma vez; revogar apaga a linha e filtra por `pessoa_id` (404
  igual para id alheio ou inexistente). `pessoaDoToken` reconfere o e-mail da dona
  contra o domínio permitido a cada uso e atualiza `usado_em` sem bloquear. Token não
  expira e não há limite de quantidade (S6). O token vai no caminho da URL e a linha
  `[mcp]` registra o pathname (S5; o comentário da função afirma o contrário).
- **Cliente**: tokens do Google (`id_token` e tokens de acesso das integrações) ficam em
  memória/cache do Chrome; não vão a storage, log, cartão nem exportação, e os de
  acesso das integrações nunca ao servidor do TaqCiti.
- **O que nunca sobe ao servidor**: preferências, estado interno do Taq, tokens
  OAuth das integrações, registro `taq:integracoes` e `taq:acoes-externas`. Prints
  sobem (como binário, só para restauração), mas o conector nunca os serve.
- **Verificação do `aud`**: sem ela um `id_token` de outro app seria aceito.
- **Pontos abertos** (ver `docs/plano-de-seguranca.md`): S4 SDK MCP sem limite de corpo,
  S5, S6, S7, S9, S10, S12, S13, I4. Confirmados no código nesta leitura: S5, S6, S7,
  S9, S10, I4 (sem `readOnlyHint`).

## 8. Integrações Google (Gmail, Agenda, diretório)

Código: `src/features/integracoes/` (`escopos.ts`, `token.ts`, `google.ts`, `estado.ts`,
`gmail.ts`, `calendario.ts`, `diretorio.ts`, `colegas.ts`, `registroDeAcoes.ts`,
`erros.ts`) e as ferramentas do Taq em `src/features/taq/ferramentasDeIntegracao.ts`.

**Dois clientes OAuth independentes**
1. Tipo "Extensão do Chrome" (`VITE_GOOGLE_OAUTH_CLIENT_ID`, vai no manifesto):
   `chrome.identity.getAuthToken` para Google Docs (`drive.file`) e para as integrações.
2. Tipo "Aplicativo da Web" (`VITE_GOOGLE_OAUTH_WEB_CLIENT_ID`): só identidade/sync.

**Escopos** (fonte única `escopos.ts`; o `manifest.config.ts` repete como teto, com
`drive.file`, 7 no total; um teste em `integracoes.test.ts` compara)

| escopo | por que | o que não dá |
| --- | --- | --- |
| `openid`, `userinfo.email` | identificar a conta | — |
| `gmail.send` | enviar e-mail como a pessoa | não lê a caixa nem a pasta Enviados |
| `directory.readonly` | achar colegas do domínio (People API) | não altera nada |
| `calendar.events` | criar, remarcar, cancelar eventos na agenda da pessoa | — |
| `calendar.freebusy` | ocupado/livre de colegas | sem títulos |
| `drive.file` | enviar a ata ao Google Docs | só arquivos criados pela extensão |

**Conectar**: só no clique de "Conectar conta do CITi" em Conexões (`conectarConta`):
pede todos os escopos de uma vez (interativo), lê `tokeninfo` (escopos concedidos) e
`userinfo` (e-mail, `hd`) e guarda só e-mail, domínio, escopos, data e capacidades
desligadas em `taq:integracoes`. Demais chamadas usam `interativo: false`.

**Capacidades** (`estado.ts`): `diretorio`, `email`, `agenda_consulta`, `agenda_eventos`,
com estados `planned`, `implemented_unconfigured`, `available`, `disabled`, decididos
por fatos (cliente OAuth na build, conta não pessoal, escopos concedidos, desligada pela
pessoa). Sem condição atendida a ferramenta nem é oferecida ao Taq. Conta `gmail.com` ou
`googlemail.com` (ou sem domínio) é tratada como pessoal.

**O que o Taq pode fazer**
- Gmail: enviar texto com anexos (até 3 MB no total, máximo 10 destinatários); MIME
  montado com limpeza de quebra de linha nos cabeçalhos; resultado "aceito" não é
  "entregue".
- Agenda: ocupado/livre do calendário principal (sem acesso = desconhecido, nunca
  livre; janelas de 30 min, padrão 9h–18h); listar eventos próprios; criar (id derivado
  da chave de idempotência, 409 = já existia), remarcar e cancelar apenas eventos que a
  conta organiza; `sendUpdates=all`.
- Diretório: busca por nome em `DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE/CONTACT`; só
  endereços do domínio da conta entram no resultado.
- Não existe, de propósito: ler caixa de entrada, responder e-mail.

**Confirmação por clique**: `send_email`, `create_event`, `reschedule_event` e
`cancel_event` chamados pelo modelo só guardam rascunho (`registroDeAcoes.ts`, estado
`rascunho`) e mostram cartão. Quem executa é `confirmarAcao` do orquestrador, a partir
do botão, conferindo chave do rascunho, conversa e versão dos anexos. Chave de
idempotência calculada em código. Estados: `rascunho`, `enviando` (gravado antes da
chamada, sob trava; vence em 2 min para `desconhecido`), `aceito`, `falhou`,
`desconhecido` (não reenviar sozinho), `cancelado`. Até 200 registros.
`google.ts`: 401 descarta o token e repete UMA vez; rede, tempo esgotado (15 s, 30 s no
envio) e 5xx nunca são repetidos. Riscos abertos nessa área (I1, I2) estão no plano.

**Cor das falas** (`colegas.ts`): o e-mail do diretório só conta se o nome for igual ao
do falante e o domínio for `citi.org.br` ou subdomínio; cache local, inclusive de quem
não foi achado (um dia).

## 9. Como testar

**Servidor** (`cd server`; `npm test` = `vitest run`, inclui `lib/**/*.test.ts`)
- `npx vitest run lib/conector lib/identidade`: usa PGlite (Postgres em WASM, sem
  daemon, sem Docker). Cobre busca, teto de resposta, isolamento, casca HTTP do MCP
  (`atenderMcp.test.ts`), cota, cópia, prints, histórico e a rota de sync
  (`syncRota.test.ts`). Timeouts altos (hook 60 s) porque cada suíte sobe um Postgres.
- `npm run typecheck`. Não cobertos: TLS, permissões do Postgres gerenciado, resposta
  real do `tokeninfo` (os testes injetam o transporte). O `bigint` volta como string no
  `pg` e como number no PGlite (tratado em `ms()`).

**Extensão**: `sincronizacao.test.ts`, `restauracao.test.ts`, `integracoes.test.ts`,
`colegas.test.ts` rodam sem rede (dependências injetáveis).

**Teste ao vivo de sincronização** (`src/features/sync/sync.e2e.live.test.ts`): pulado
por padrão. Exige:
- um Postgres REAL descartável (o teste usa `docker exec ... psql` num contêiner de
  nome em `TAQCITI_E2E_PG`) com `esquema.sql` aplicado;
- o servidor em `next start` apontando para esse banco, com `GOOGLE_OAUTH_WEB_CLIENT_ID`
  igual ao cliente de teste e um preload do Node (fora do repositório) que simula o
  `tokeninfo`: o Google é a única parte falsa;
- variáveis `TAQCITI_E2E_SERVER`, `VITE_DOCCITI_SERVER_URL`,
  `VITE_GOOGLE_OAUTH_WEB_CLIENT_ID`, `TAQCITI_E2E_PG`;
- os cenários de cota rodam contra um SEGUNDO servidor com `TAQCITI_COTA_MB` pequeno e
  `TAQCITI_E2E_COTA=1`.
NUNCA apontar para produção: o teste escreve e apaga acervo. Reiniciar o servidor após
mudar código ou variáveis. Outros testes `*.live.test.ts` do repositório são de IA
(não do escopo deste documento; não verificados).

**Verificação em produção** (prática do projeto, não verificada aqui): conferir o
comportamento do conector com cliente MCP real, porque sondas e testes em processo não
reproduzem o corpo vazio nem o tratamento de 401.

## 10. Variáveis de ambiente (só nomes)

| nome | onde | função |
| --- | --- | --- |
| `DATABASE_URL` | servidor | conexão Postgres (pooler em produção) |
| `GOOGLE_OAUTH_WEB_CLIENT_ID` | servidor | `aud` esperado do `id_token` |
| `TAQCITI_DOMINIO_PERMITIDO` | servidor | troca o domínio (`*` desliga) |
| `TAQCITI_COTA_MB` | servidor | cota por pessoa (padrão 25) |
| `TAQCITI_LIMITE_BANCO_MB` | servidor | disjuntor global (padrão 400) |
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | build da extensão | cliente "Extensão do Chrome" (manifesto) |
| `VITE_GOOGLE_OAUTH_WEB_CLIENT_ID` | build da extensão | cliente "Aplicativo da Web" |

## 11. Pendências e dívidas conhecidas

- Comentário de topo de `app/api/mcp/route.ts` diz que a sonda sem credencial leva 401;
  hoje `atenderMcp` responde 200 com erro JSON-RPC. Comentários de `banco.ts` e
  `esquema.sql` ainda citam Railway (produção é Supabase).
- O teste ao vivo e `docs/google-oauth-setup.md` dependem do ID da extensão derivado da
  `key` do manifesto; o teste ao vivo tem esse ID escrito no código (fora do escopo).
- Atualização automática da extensão e OAuth 2.1 no conector: decisões de produto
  adiadas, não propor sem o usuário puxar.
