# Os clientes OAuth do Google

**Dois clientes, de tipos diferentes**, para duas coisas que não dependem uma
da outra:

| recurso | cliente | sem ele | com ele |
|---|---|---|---|
| **Enviar ao Google Docs** | tipo "Extensão do Chrome" | baixa o `.html` e a pessoa arrasta para o Drive | a aba abre com a ata pronta |
| **Conexões** (sincronizar e conectar Claude/ChatGPT) | tipo "Aplicativo da Web" | **não funciona** — a página mostra "falta registrar o cliente OAuth" | liga com um clique, com escolha de conta |

Começaram como o mesmo cliente. Deixaram de ser quando ficou claro que
`chrome.identity.getAuthToken` (o mecanismo que um cliente "Extensão do
Chrome" exige) nunca oferece escolher entre contas Google — usa sempre a do
perfil do Chrome, sem perguntar — e que um erro de configuração naquele tipo
de cliente produz uma recusa sobre "cliente" que nada no código consegue
diagnosticar. A identidade migrou para `chrome.identity.launchWebAuthFlow`,
que abre a tela de escolha de conta de verdade e usa um cliente de outro tipo,
independente do primeiro: um problema num não contamina o outro.

O Google Docs tem alternativa (o download); o conector não tem. O servidor
precisa saber **de quem** é cada acervo, e a conta Google que a pessoa escolhe
é a resposta que não exige tela de login *nossa* — a tela que aparece é do
próprio Google.

> Este documento se chamava `google-docs-setup.md`. Virou `google-oauth-setup`
> quando o conector passou a precisar de um segundo cliente.

---

## A parte do Google Docs

Existem dois caminhos, e **a extensão escolhe sozinha** lendo o próprio
manifesto. Não há configuração no código para trocar.

| | quando acontece | o que a pessoa faz |
|---|---|---|
| **Download** | sempre que não há cliente OAuth registrado | baixa o `.html`, arrasta para o Drive, abre com Documentos Google |
| **Direto no Docs** | quando há cliente OAuth registrado | nada — a aba abre com a ata pronta |

O download **funciona hoje, sem nenhuma configuração**. O resto deste
documento é sobre ligar o caminho direto, que é opcional.

Os dois produzem o **mesmo documento**: o `files.create` do Drive e a
conversão de um HTML enviado à mão usam o mesmo conversor da Google.

---

## Vale a pena ligar o caminho direto?

A conta muda com o número de pessoas:

- **download** — ~5 cliques por documento, por pessoa, para sempre;
- **direto** — ~5 minutos de configuração, uma vez, por quem administra; depois
  disso um clique, e uma tela de consentimento na primeira vez de cada pessoa.

Com pouca gente ou uso esporádico, o download resolve. Com o time inteiro
gerando ata toda semana, o custo do download é o que cresce.

---

## Registrar os clientes

**Todo mundo no mesmo Google Workspace?** Então a tela de consentimento é
**Interna**, e isso remove a maior parte da burocracia: sem verificação da
Google, sem lista de usuários de teste, sem fila de revisão. A tela de
consentimento é **uma só**, compartilhada pelos dois clientes — só a criação
do cliente em si acontece duas vezes.

**ID desta extensão:** `jalebpaefejnbacgncgkailhemkdpnhm`

Ele vem da chave pública em `manifest.config.ts` e **não muda** entre
máquinas, clones do repo ou reinstalações. É esse valor que o console pede no
cliente tipo "Extensão do Chrome" — **não** no tipo "Aplicativo da Web", que
usa um redirect URI derivado dele, não o ID cru (ver a etapa B abaixo).

### 1. Ativar a Drive API — **só para o Google Docs**

**Pule este passo se você só quer o conector.** Identificar a conta usa
`openid` e `email`, que fazem parte do OpenID Connect e não são uma API que
se ative. A Drive API existe aqui para o envio da ata.

[console.cloud.google.com/apis/library/drive.googleapis.com](https://console.cloud.google.com/apis/library/drive.googleapis.com)

Confira o projeto no seletor do topo, depois **Ativar**.

*Se pular e usar o Docs:* a criação volta **403**, e a extensão diz
exatamente isso.

> Nada aqui cobra nada. Registrar cliente OAuth e ativar a Drive API são
> gratuitos e não pedem faturamento. A seção "O servidor precisa de chave
> PAGA", mais abaixo, é sobre outra coisa completamente diferente — a chave
> do Gemini que gera o documento. As duas não se encostam.

### 2. Tela de consentimento

[console.cloud.google.com/apis/credentials/consent](https://console.cloud.google.com/apis/credentials/consent)

Tipo **Interno**. Três escopos, e só estes — os DOIS clientes juntos nunca
pedem mais que isto:

| escopo | para quê | pedido por |
|---|---|---|
| `openid` | identificar a conta | cliente Web (identidade) |
| `.../auth/userinfo.email` | saber de quem é o acervo | cliente Web (identidade) |
| `.../auth/drive.file` | enviar a ata ao Google Docs | cliente Extensão do Chrome (Docs) |

Os três dispensam verificação da Google. `openid` e `email` são
não-sensíveis; `drive.file` dá acesso apenas aos arquivos que a própria
extensão criou — ela não enxerga, não lê e não altera mais nada do Drive de
quem usa. `drive` ou `drive.readonly` entrariam numa fila de revisão e
pediriam uma permissão que o produto não precisa.

**Estarem na mesma tela não significa que sejam pedidos juntos.** Cada
cliente só pede o seu: o cliente Web nunca pede `drive.file` (não teria como —
não é um escopo que ele declara em lugar nenhum), e o cliente da extensão só é
acionado ao clicar "enviar para o Docs". Ninguém que só sincroniza vê uma tela
pedindo acesso ao Drive.

### 3A. Criar o cliente do Google Docs — tipo "Extensão do Chrome"

**Pule esta etapa se você só quer o conector.**

[console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)

**+ Criar credenciais → ID do cliente OAuth → Extensão do Chrome**, com o ID
`jalebpaefejnbacgncgkailhemkdpnhm`. Copie o Client ID gerado — vai em
`VITE_GOOGLE_OAUTH_CLIENT_ID` na etapa 4.

### 3B. Criar o cliente de identidade — tipo "Aplicativo da Web"

**Este é o que liga Conexões.** Diferente do de cima: não tem campo de "ID da
extensão" — em vez disso, pede um **redirect URI**.

[console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)

**+ Criar credenciais → ID do cliente OAuth → Aplicativo da Web.** Em
**URIs de redirecionamento autorizados**, cole exatamente:

```
https://jalebpaefejnbacgncgkailhemkdpnhm.chromiumapp.org/
```

Barra final incluída — é o formato que `chrome.identity.getRedirectURL()`
gera, e é contra ESSE valor exato que o Google confere o retorno do popup de
login. Copie o Client ID gerado — vai em `VITE_GOOGLE_OAUTH_WEB_CLIENT_ID` na
etapa 4.

> Não crie um client secret nem o cole em lugar nenhum. Este fluxo
> (`launchWebAuthFlow` com `response_type=id_token`) é público — a extensão
> não guarda segredo nenhum, e um secret aqui não protegeria nada que a
> checagem de `aud` no servidor já não proteja.

### 4. Build

Os dois valores vão no mesmo lugar. Duas formas, e a de arquivo é a menos
sujeita a erro:

**Num `.env` na raiz do repo** (ignorado pelo git; template em
`.env.example`):

```
VITE_GOOGLE_OAUTH_CLIENT_ID=<client id do passo 3A>.apps.googleusercontent.com
VITE_GOOGLE_OAUTH_WEB_CLIENT_ID=<client id do passo 3B>.apps.googleusercontent.com
```

**Ou na sessão**, que é o que o CI faz e vence o arquivo:

```powershell
$env:VITE_GOOGLE_OAUTH_CLIENT_ID = '<client id do passo 3A>.apps.googleusercontent.com'
$env:VITE_GOOGLE_OAUTH_WEB_CLIENT_ID = '<client id do passo 3B>.apps.googleusercontent.com'
```

Depois, em qualquer um dos casos:

```powershell
npm run build
(Get-Content dist\manifest.json | ConvertFrom-Json).oauth2.client_id
```

Esse comando só confere o cliente do Docs (é o único que entra no
manifesto — o cliente Web não aparece ali, é lido em tempo de execução pelo
próprio código). Se sair `CLIENT_ID_NAO_CONFIGURADO`, o valor não chegou —
com `$env:`, rode os comandos na **mesma** janela. Sem o cliente do Docs
configurado, o Docs continua funcionando pelo download; sem o cliente Web,
a seção Conexões mostra "falta registrar o cliente OAuth".

> O arquivo `.env` só funciona para o cliente do Docs porque
> `manifest.config.ts` chama `loadEnv` explicitamente para montar o
> manifesto em Node. O cliente Web não precisa desse cuidado: é lido pelo
> código do NAVEGADOR (`shared/services/identidade.ts`), onde
> `import.meta.env` já reflete o `.env` normalmente — é assim que o Vite
> sempre funcionou para código de cliente.

### 5. Carregar

`chrome://extensions` → Modo do desenvolvedor → **Carregar sem compactação** →
`dist/`.

**Confira o ID que o Chrome mostra.** Tem que ser
`jalebpaefejnbacgncgkailhemkdpnhm`. Se for outro, a `key` não entrou no
manifesto e o Docs vai falhar com "bad client id" (isso não afeta Conexões,
que não depende desse ID).

### 6. O cliente Web no servidor

Só o Google Docs funciona sem este passo. O conector, não.

Em `server/.env.local` (ou nas variáveis do Railway, em produção):

```
GOOGLE_OAUTH_WEB_CLIENT_ID=<o mesmo client id do passo 3B>.apps.googleusercontent.com
```

**É o cliente Web (3B), não o da extensão (3A).** O servidor verifica um
`id_token`, que só o cliente Web emite. Colar o client id errado aqui não dá
erro na hora — dá uma recusa de "token emitido para outro aplicativo" na
primeira sincronização, porque o `aud` do token nunca vai bater.

**Não é redundância com a extensão ter o mesmo valor.** A extensão
*apresenta* o `id_token`; o servidor precisa conferir para **quem** aquele
token foi emitido (o campo `aud`). Sem essa conferência, um token emitido
para qualquer outro aplicativo que a pessoa já tenha autorizado também seria
aceito aqui — e quem operasse aquele aplicativo entraria como ela. Por isso
a rota **falha fechada** sem a variável: "não sei comparar" não pode virar
"então deixa passar". Ver o cabeçalho de `server/lib/identidade/google.ts`.

`TAQCITI_DOMINIO_PERMITIDO` existe (opcional, comentado em `.env.example`) mas
NÃO é usado aqui de propósito: quem usa o Claude/ChatGPT não necessariamente
paga por eles numa conta @citi.org.br, e a conta do Google só identifica de
quem é o acervo — não é uma cobrança. Deixado vazio, qualquer conta Google
verificada cria acervo no servidor.

### 7. Conferir

Abra a HOME → **Conexões**. O que você deve ver:

| o que aparece | o que significa |
|---|---|
| "Falta registrar o cliente OAuth" | falta `VITE_GOOGLE_OAUTH_WEB_CLIENT_ID` no build (etapas 3B/4) |
| Ao clicar "Ligar", a tela de escolha de conta do Google aparece | os passos 3B/4/6 estão certos até aqui |
| aviso âmbar depois de escolher a conta | o Google recusou — o texto exato do aviso diz o motivo |
| "Ligar sincronização" some e vira "conectado" | deu certo |
| erro ao gerar endereço | falta `DATABASE_URL`, ou o passo 6 |

---

## O servidor precisa de chave PAGA

Isto é independente do caminho de entrega, e **hoje impede o botão de
funcionar com reunião real** — nos dois caminhos.

Enquanto `DOCCITI_DATA_POLICY=training` estiver em `server/.env.local`, o
`/api/generate` recusa transcrição que não se declare sintética. A extensão
captura reunião de verdade, então não pode se declarar sintética. A trava
existe porque o free tier do Gemini manda todo o conteúdo enviado para
treinamento do provedor, com revisão humana.

### Conferir em que tier a chave está

**Medido em 14/08/2026:** o erro devolvido pela API foi
`generate_content_free_tier_requests`, com
`quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier` e limite **20 por
dia** no `gemini-3.5-flash`. Uma Ata consome 18 chamadas nesse modelo.

Faturamento ativo no projeto do Google Cloud **não basta** — a chave do Gemini
precisa estar num projeto com faturamento ligado *para a API do Gemini*. Uma
chave nova também não resolve: a cota é **por projeto**, não por chave.

Confira em [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey):
cada chave mostra o projeto e o plano.

### Quando estiver paga

1. remova `DOCCITI_DATA_POLICY=training` de `server/.env.local`;
2. reinicie o servidor — `.env.local` é lido no boot.

---

## Ao publicar na Web Store

A loja atribui a **própria** chave, e o ID muda. Depois da primeira publicação:
copie a chave que a loja mostra, troque o valor de `key` em
`manifest.config.ts`, e atualize o cliente OAuth para o novo ID. Sem isso, o ID
de desenvolvimento e o de produção divergem e o cliente vale só para um.
