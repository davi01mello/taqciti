# O conector

Serve o acervo do TaqCiti — reuniões, documentos, conversas e notas — para
uma IA de fora (Claude, ChatGPT) através de MCP. Quem paga o modelo é a
assinatura de quem pergunta; este servidor só responde consultas.

## O problema que o desenho resolve

Um conector dá à IA acesso ao acervo **inteiro**. O modo de falhar não é ela
não achar as coisas — é ela achar todas de uma vez. Doze reuniões de uma hora
numa única resposta de ferramenta são centenas de milhares de tokens: a janela
acaba antes de a pergunta ser respondida, e o que sobra de contexto é
justamente a parte que não interessava.

A resposta a isso não é pedir bom comportamento na descrição da ferramenta.
Quem monta a resposta é este servidor, então o limite é imposto aqui.

### A escada

    buscar  ─→  ler  ─→  conteudo
    achar       situar   trazer o pedaço certo

| ferramenta | custo típico | o que devolve |
| --- | --- | --- |
| `buscar` | ~2 mil caracteres | até 12 trechos, com id **e posição** do acerto |
| `listar` | ~2 mil caracteres | até 25 títulos + data + tamanho, zero conteúdo |
| `ler` | ~1,4 mil | um item: metadados, estrutura, abertura. Não traz o corpo |
| `conteudo` | ~8 mil | uma **fatia** do corpo, com `proximo` para continuar |

O que faz a escada funcionar é `buscar` devolver **`posicao`**: o índice da
fala onde o termo apareceu. A IA chama `conteudo(id, de: posicao)` e cai em
cima do trecho. Sem isso, achar custaria ler — e a segunda chamada devolveria
a transcrição toda, que é exatamente o que se quer evitar.

### Os tetos são o tamanho do balde, não uma regra

`quantidade` é limitada por `Math.min` contra o teto, não validada contra ele:
pedir 10.000 falas devolve 40 e um `proximo`. Não há como pedir mais.

Três camadas, porque uma não segura:

1. **Teto por item** — 40 falas por fatia, 25 itens por página, 12 acertos.
2. **Teto por caractere** — a fatia para antes das 40 falas se elas forem
   longas. Um teto só de itens é uma promessa vazia: 40 falas de uma palavra
   cabem, 40 de um parágrafo não.
3. **`aplicarTeto`** — mede a resposta **já serializada**, do jeito exato que
   vai sair, e encolhe item a item até caber em 24 mil caracteres. É a tranca
   que nenhum registro patológico fura.

A terceira camada existe porque as duas primeiras *deveriam* bastar, e
"deveria" não é garantia — basta um item com quarenta participantes para a
soma das peças passar do teto.

### O que não é exposto

`Print` é um `data:image/jpeg;base64,…`: uma captura de tela vira dezenas de
milhares de tokens se escapar para uma resposta. Prints aparecem só como
**contagem**, e o envelope diz isso em texto para o modelo não pedir e receber
um erro seco. Pelo mesmo motivo ficaram de fora `speakersObserved`
(telemetria do parser de legenda) e `providerParticipantId` (id opaco de tile).

É por isso que o conector tem o seu próprio tipo (`tipos.ts`) em vez de servir
o `MeetingRecord` do storage: a projeção magra é o orçamento.

## Os arquivos

| arquivo | o que é |
| --- | --- |
| `tipos.ts` | a projeção que o conector expõe + a interface `Acervo` |
| `orcamento.ts` | os tetos, o corte legível e `aplicarTeto` |
| `busca.ts` | ranqueamento e extração de trecho, com a coordenada do acerto |
| `ferramentas.ts` | as quatro ferramentas |
| `despacho.ts` | catálogo MCP + roteador, independente de protocolo |
| `chatgpt.ts` | a tradução de `search`/`fetch` para o contrato da OpenAI |
| `mcp.ts` | a ponte JSON-RPC: catálogo, chamadas, e `structuredContent` |
| `atenderMcp.ts` | a casca HTTP — token, transporte, e o fechamento sem cortar |
| `acervoDeMemoria.ts` | `Acervo` em arrays — é contra ele que a disciplina é verificada |
| `esquema.sql` | as tabelas, aplicáveis por cima de si mesmas |
| `banco.ts` | o pool e a interface `Consultador` (independente de driver) |
| `acervoPostgres.ts` | `Acervo` sobre Postgres, atrás da mesma interface |
| `escrita.ts` | os upserts — é por aqui que a sincronização entra |
| `pessoa.ts` | achar/criar a pessoa a partir de uma identidade já verificada |

### A interface `Acervo`, e por que ela tem três métodos

`indice` lista sem pagar pelo conteúdo, `obter` traz um item inteiro,
`procurar` é uma **peneira grossa** para a busca.

A separação entre `indice` e `obter` só mostra o valor quando há banco:
imprimir vinte e cinco títulos não pode custar vinte e cinco transcrições.
Os contadores do índice saem calculados em SQL (`jsonb_array_length`,
`length`), não de conteúdo trazido para contar em JavaScript.

`procurar` devolve candidatos, não resultados. Quem ranqueia e acha a
**posição** do termo é `busca.ts`, porque nenhum índice de texto do Postgres
devolve isso — e a posição é o que faz a escada funcionar. O banco só joga
fora o que não tem chance, por índice.

A regra que amarra as duas coisas: **a peneira tem que ser mais larga que o
ranqueamento, nunca mais estreita.** Por isso o `tsquery` liga os termos com
`|` e não `&`. Mais larga é desperdício inofensivo; mais estreita é resultado
sumindo sem ninguém ver.

## A busca casa prefixo de PALAVRA

A primeira versão usava `indexOf`, que é substring em qualquer posição:
procurar "ana" casava com "sem**ana**" e "pl**an**ejar". Num acervo de
reuniões, onde metade dos termos úteis é nome de gente, esse é o modo de
falhar mais provável — e ele não falha alto, só enche o resultado de lixo bem
ranqueado.

Hoje o casamento é `\b<termo>`, que resolve duas coisas de uma vez: a busca
fica correta, e a semântica passa a ser a mesma de um `tsquery` com `:*`. É o
que permite ao Postgres peneirar sem descartar nada que o ranqueamento
aceitaria.

## Acento: uma implementação só, usada dos dois lados

O caminho óbvio seria `to_tsvector('portuguese', …)` com a extensão
`unaccent`. Não é o que está aqui. Quem dobra o acento é `dobrar()`, em
TypeScript, e a escrita grava `texto_busca` **já dobrado** — o banco só
tokeniza, com a configuração `simple`.

O motivo é correção: duas implementações de "tirar acento" (a nossa e a do
`unaccent`) concordando para sempre é uma aposta; uma só, usada nos dois
lados, é um fato. Pelo mesmo motivo `simple` e não `portuguese` — o stemmer
casaria "deployamos" com "deploy", que o ranqueamento não casa, e peneira e
ranqueamento precisam falar a mesma língua.

Efeito colateral bom: nenhuma extensão é necessária, então o mesmo
`esquema.sql` roda igual na Supabase e no PGlite dos testes.

`despachar(acervo, nome, argumentos)` é uma função pura. O transporte —
JSON-RPC, stdio, ou uma chamada direta de dentro da HOME — fica de fora de
propósito: o contrato não muda quando o transporte muda.

### Tolerância a argumento torto

Os argumentos vêm de um modelo de linguagem. `"12"` em vez de `12`, um tipo
solto onde o esquema pede array, `de: -3`, um id inventado: nada disso vira
exceção. Vira `ErroDeUso`, que o cliente MCP entrega ao modelo como resultado
de ferramenta — e ele corrige na chamada seguinte. Um 500 de JSON-RPC ele não
lê, só quebra.

## Testes

```bash
cd server && npx vitest run lib/conector
```

90 testes, **sem precisar de banco nenhum** — e mesmo assim o SQL é de
verdade. Dois blocos carregam o peso:

`describe('o teto é real')` constrói doze reuniões de seis horas, um documento
de 1,6 MB e uma conversa de 900 mensagens, e **mede em caracteres** o que cada
ferramenta devolve. É o que pega a regressão de orçamento — acrescentar um
campo generoso a um envelope passa em todo teste de comportamento e só aparece
ali.

`acervoPostgres.test.ts` roda contra **PGlite**: o PostgreSQL de verdade
compilado para WASM, dentro do processo. Mesmo parser, mesmo planejador, mesma
busca textual, sem daemon e sem imagem para baixar. A alternativa era um
`docker run` que todo mundo precisa lembrar de dar — e teste que depende de
alguém lembrar é teste que não roda.

Dois testes ali merecem nome:

- **`isolamento entre pessoas`** — um `where pessoa_id` esquecido não lança,
  não quebra nada visível e entrega a reunião de alguém para o conector de
  outro. É a única falha deste módulo que é um incidente, não um bug.
- **`o resultado é idêntico ao do acervo de memória`** — a mesma entrada pelas
  duas implementações, comparando a saída. Se divergirem, a disciplina de
  contexto verificada em memória deixa de valer em produção.

O que o PGlite **não** cobre é o que difere do Postgres gerenciado: TLS,
permissões, e o `bigint` que o driver `pg` devolve como string (o PGlite
devolve como number). O último está tratado em `ms()`.

## Identidade — `lib/identidade/`

Duas credenciais, para dois caminhos diferentes:

| caminho | credencial | verificada como |
| --- | --- | --- |
| extensão → servidor | `id_token` do Google (`chrome.identity.launchWebAuthFlow`) | contra o Google, a cada uso (com cache) |
| Claude/ChatGPT → servidor | token do conector | hash no banco, revogável |

**A extensão fala com o Google de DUAS formas independentes, com dois
clientes OAuth diferentes.** `document/googleDocs.ts` usa
`chrome.identity.getAuthToken` (cliente tipo "Extensão do Chrome") só para
enviar a ata ao Docs — isso nunca passa por este servidor. A identidade —
tudo que este arquivo descreve — usa `chrome.identity.launchWebAuthFlow`
(cliente tipo "Aplicativo da Web"), porque `getAuthToken` não oferece
escolher entre contas Google e sempre usa a do perfil do Chrome. Os dois
clientes não se tocam: um problema num não contamina o outro.

**`google.ts` usa `tokeninfo?id_token=`, não `userinfo`, e isso não é
preferência.** `userinfo` responde *de quem* é o token; não responde *para
quem ele foi emitido*. Um `id_token` emitido para outro aplicativo qualquer
também decodifica igual — então quem operasse aquele aplicativo poderia
apresentá-lo aqui e receber o acervo, porque o token é mesmo da pessoa.
`tokeninfo` devolve `aud`, e este servidor recusa qualquer token cujo `aud`
não seja o nosso `GOOGLE_OAUTH_WEB_CLIENT_ID`. Sem essa checagem a
autenticação é decorativa — e o caminho feliz funciona perfeitamente sem
ela, que é o que torna a omissão perigosa.

Sem `GOOGLE_OAUTH_WEB_CLIENT_ID` configurado, recusa. "Não sei comparar" não
pode virar "então deixa passar".

**`tokenDoConector.ts`** é o segredo que a pessoa copia da página Conexões e
cola ao adicionar o conector — é assim que se tem acesso por pessoa sem
nenhuma tela de login. O preço é honesto: é credencial ao portador, quem tem
a URL tem o acervo. As três coisas que tornam isso administrável estão
implementadas — o token aparece **uma** vez, o banco guarda só o hash, e
revogar é imediato.

## O caminho completo, hoje

```
extensão                        servidor                      Claude/ChatGPT
────────                        ────────                      ──────────────
storage local
   │  diff por assinatura
   │  (features/sync)
   ▼
POST /api/sync ──────────────►  Postgres
   Bearer <id_token do Google>      │
                                   │
POST /api/conector/token ──────►  token_do_conector
   devolve a URL uma vez           │  (só o hash)
                                   ▼
                              POST /api/mcp/<token> ◄──────── conecta
                                   │
                              buscar → ler → conteudo
```

`/api/mcp` é sem sessão (`sessionIdGenerator: undefined`): cada requisição
monta um servidor, responde e morre. As quatro ferramentas são de leitura e
não guardam nada entre chamadas, então não há estado que uma sessão
preservasse — e um mapa de sessões na memória do processo mandaria o cliente
para a instância errada assim que houvesse mais de uma, que na Vercel é o
caso normal.

## Três coisas que só um cliente de verdade revelou

Nada aqui apareceu em teste, em `curl` ou em log. Todas as três foram
encontradas tentando conectar de verdade, e as três produziam sintomas que
pareciam sucesso.

**1. Resposta em JSON, não em SSE.** No padrão, o transporte devolve uma
`Response` cujo corpo é um stream que ele ainda vai preencher — e o `finally`
que fecha o transporte corria na frente. O cliente recebia **200 com corpo
vazio** e ficava esperando até estourar o tempo. Status 200, log de sucesso,
`curl` "funcionando": três sinais verdes sobre uma coisa quebrada. Hoje é
`enableJsonResponse: true`, e a resposta é materializada antes do `finally`.

**2. O token vai no CAMINHO, não na query.** A Claude verifica o servidor
sondando a URL **sem a query string** — a especificação define a URI canônica
de um servidor MCP sem query nem fragmento, então quem canonicaliza antes de
sondar perde o `?token=`. A sonda levava 401, e a tela dizia "não foi possível
determinar como este servidor faz login". `/api/mcp?token=` continua atendido,
para endereços já colados por aí não quebrarem.

**3. Nada de `WWW-Authenticate` no 401.** Mandar esse cabeçalho SINALIZA
"sou um recurso OAuth 2.1", e um cliente que segue a especificação vai atrás
de `/.well-known/oauth-protected-resource`, de um servidor de autorização e de
**registro dinâmico de cliente** (RFC 7591). Nada disso existe aqui, de
propósito — e a Claude falhava com "não foi possível registrar no serviço de
login do TaqCiti". O cabeçalho prometia um protocolo que este servidor nunca
implementou.

Isto nos deixa **fora da conformidade estrita**: a especificação manda enviar
o cabeçalho e proíbe token na URL. A alternativa conforme é montar um servidor
OAuth 2.1 inteiro (descoberta, registro dinâmico, PKCE) só para autenticar —
exatamente a máquina que o requisito "sem login" recusa. A escolha é
consciente, e está aqui escrita para ser revista quando o requisito mudar.

## O contrato do ChatGPT é outro

A Claude lê as quatro ferramentas nomeadas e o JSON que elas devolvem. O
ChatGPT não: ele procura duas ferramentas de nome fixo e campos de nome fixo,
e ignora o resto.

```
search → { results: [ { id, title, url } ] }
fetch  → { id, title, text, url, metadata? }
```

E as duas precisam vir **duas vezes**: em `structuredContent` e como string
JSON dentro de `content`. A documentação da OpenAI é explícita — a segunda
cópia existe "para compatibilidade". Mandar só uma faz o conector aparecer
conectado e não devolver nada.

O `url` é usado para CITAR a fonte, então ele aponta para `/item/<id>` deste
servidor: uma página real que diz o que aquele item é e **não** mostra
conteúdo (não há autenticação ali, então não pode mostrar). Sem isso, toda
citação do ChatGPT seria um link quebrado.

`mcp.ts` usa a classe `Server` do SDK, e não `McpServer`: o catálogo já
existe em `despacho.ts`, em JSON Schema. Passar por `McpServer` exigiria
reescrever aqueles esquemas em Zod só para o SDK os converter de volta —
duas descrições das mesmas ferramentas, e a que diverge é sempre a que
ninguém está olhando.

## O que ainda não existe

1. **Registrar o cliente OAuth de identidade (tipo "Aplicativo da Web").** É a
   única peça que não é código. Sem ela a página Conexões mostra `sem-oauth`.
   Ver `docs/google-oauth-setup.md` — inclui o redirect URI exato a cadastrar.
2. **`GOOGLE_OAUTH_WEB_CLIENT_ID` no servidor** (o mesmo id do `.env` da
   extensão). `TAQCITI_DOMINIO_PERMITIDO` fica **vazio** de propósito: quem
   usa a Claude não necessariamente paga por ela numa conta `@citi.org.br`, e
   restringir por domínio barraria gente legítima.
3. **`DATABASE_URL`** — a do pooler da Supabase, ver "Subir o banco" — e
   aplicar `esquema.sql` uma vez.

### O que os testes não cobrem

Duas coisas, e vale saber quais:

**A resposta real do Google.** `google.test.ts` roda com `transporte`
injetado, descrevendo o que o `tokeninfo` responderia. Isso prova a lógica —
`aud` errado, e-mail não verificado, 400 contra 500 — e não prova que o
formato descrito é o que o Google devolve hoje. Só se confirma na primeira
sincronização real.

**A casca HTTP do MCP — hoje coberta, e vale saber por quê.** Era o buraco
listado aqui, e o bug do corpo vazio estava exatamente nele. `atenderMcp.test.ts`
cobre agora: token no caminho, token revogado, isolamento entre pessoas,
tolerância a `Accept` incompleto, e a asserção central — **o corpo tem o
resultado dentro e é JSON parseável**, não só "respondeu 200".

O que essas asserções pegam é a CONFIGURAÇÃO que causava a corrida, não o
instante em que ela acontecia: dentro do processo o stream se enche rápido
demais para a corrida aparecer. Reproduzi-la exigiria o tempo de rede de um
ambiente serverless. É a proteção possível, e basta, porque a corrida só volta
se alguém voltar ao modo SSE — e aí os testes ficam vermelhos.

### Subir o banco

Produção: **Supabase**, e a `DATABASE_URL` precisa ser a do **pooler**
(Supavisor, porta 6543), não a "Direct connection".

Isto não é sobre performance. A conexão direta da Supabase responde só em
IPv6, e a função serverless da Vercel não tem saída IPv6: a direta falha com
`getaddrinfo ENOTFOUND` em produção **mesmo funcionando na sua máquina**, que
tem IPv6. O usuário do pooler também muda — é `postgres.<ref-do-projeto>`, não
`postgres`, que é como o Supavisor sabe para qual projeto rotear.

`aplicarEsquema()` existe para um passo de deploy — de propósito **não** roda
no boot: um processo que altera schema ao subir é um processo que altera
schema em toda réplica, ao mesmo tempo, na hora do pico.

Para desenvolver não é preciso banco local; se quiser um:

```bash
docker run -d --name taqciti-pg -e POSTGRES_PASSWORD=taqciti \
  -e POSTGRES_DB=taqciti -p 55432:5432 postgres:17-alpine
# DATABASE_URL=postgres://postgres:taqciti@localhost:55432/taqciti
```
