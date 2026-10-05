# A conta do CITi: colegas, e-mail e agenda

O login é a **conta Google do CITi** (Workspace). Com ela conectada em
**Conexões → Conta do CITi → Conectar**, o Taq:

- acha **colegas da mesma organização** no diretório do Workspace (nome e e-mail
  reais, nunca um endereço suposto);
- **envia e-mail** por você, com documento ou transcrição como anexo;
- **consulta agendas** (ocupado/livre) e **cria, remarca e cancela eventos** na sua
  agenda.

Tudo isso **só quando você pede** na conversa. Sem a conta conectada, o código
continua lá, mas as ferramentas **não são oferecidas ao Taq** (estado
`implemented_unconfigured`): ele só prepara o rascunho e sugere horário.

> Quem faz esta configuração é quem administra o projeto do Google Cloud do
> TaqCiti. O código **não** precisa de mudança: é só registrar o que está abaixo e
> compilar de novo.

## O que é preciso (resumo de 5 minutos)

1. Ativar **3 APIs** no projeto do Google Cloud (Gmail, People, Calendar).
2. Acrescentar **4 escopos** à tela de consentimento (tipo **Interno**).
3. **Usar o mesmo cliente "Extensão do Chrome"** que já existe para o Google Docs
   (etapa 3A de `docs/google-oauth-setup.md`) — **não** se cria um cliente novo.
4. Conferir, no **Admin Console**, que o diretório do domínio é visível aos
   membros.
5. Compilar (`npm run build`), recarregar a extensão e clicar em **Conectar conta
   do CITi**.

Se `VITE_GOOGLE_OAUTH_CLIENT_ID` ainda não existe, faça antes as etapas 3A e 4 de
`docs/google-oauth-setup.md`: **sem cliente OAuth nada disto liga** (a tela
Conexões mostra "Falta registrar o cliente OAuth").

## 1. Ativar as APIs

No [Google Cloud Console](https://console.cloud.google.com/), no **mesmo projeto**
do cliente da extensão: **APIs e serviços → Biblioteca**, e ative:

| API | serviço | para quê |
| --- | --- | --- |
| **Gmail API** | `gmail.googleapis.com` | enviar e-mail |
| **People API** | `people.googleapis.com` | diretório da organização |
| **Google Calendar API** | `calendar-json.googleapis.com` | agendas e eventos |

Sem a API ativada o Google responde **403**, e o Taq diz "o Google recusou (403):
a conta não tem essa permissão, ou a API não está ativada". Ativar API não cobra
nada.

## 2. Tela de consentimento

**APIs e serviços → Tela de permissão OAuth**, tipo **Interno** (só contas do
domínio do CITi; é o que **dispensa a verificação do Google** para escopos
sensíveis). Em **Escopos**, além dos que já existem (`openid`, `userinfo.email`,
`drive.file`), acrescente:

| escopo | para quê | o que **não** dá |
| --- | --- | --- |
| `https://www.googleapis.com/auth/gmail.send` | enviar e-mail como você | **não lê** a caixa de entrada, nem a pasta Enviados |
| `https://www.googleapis.com/auth/directory.readonly` | achar colegas do domínio | não altera nada |
| `https://www.googleapis.com/auth/calendar.events` | criar, remarcar e cancelar eventos na sua agenda | não mexe em outros calendários além dos seus eventos |
| `https://www.googleapis.com/auth/calendar.freebusy` | ver ocupado/livre dos colegas | só "ocupado/livre", sem os títulos |

Esta lista tem **uma fonte só no código**: `src/features/integracoes/escopos.ts`
(`ESCOPOS_DA_CONEXAO`). O `manifest.config.ts` repete os mesmos escopos como
teto, e um teste (`integracoes.test.ts`) falha se os dois divergirem.

## 3. O cliente OAuth

**Nenhum cliente novo.** O `chrome.identity.getAuthToken` usa o cliente do tipo
**"Extensão do Chrome"** do manifesto (`VITE_GOOGLE_OAUTH_CLIENT_ID`, ID da
extensão `jalebpaefejnbacgncgkailhemkdpnhm`). Cada capacidade pede só os escopos
dela; a tela **Conexões** pede todos de uma vez, **no clique** de "Conectar conta
do CITi" — nunca ao abrir a página.

A pessoa precisa **aceitar todas as permissões**. Se desmarcar alguma, o Google
concede o resto e o Taq abre só as capacidades cujos escopos vieram (a linha da
conta mostra o que falta). A conexão guarda o que foi **de fato concedido**, lido
do `tokeninfo`.

> Entrar com a conta certa: o Chrome usa a conta do **perfil**. Se o perfil está
> com uma conta pessoal, o Google abre a escolha de conta — escolha a do CITi. Uma
> conta `@gmail.com` é recusada pelo Taq para diretório e agenda ("a conta
> conectada é pessoal").

## 4. Admin Console (uma vez, por quem administra o Workspace)

1. **Diretório visível.** *Diretório → Configurações do diretório → Opções de
   compartilhamento → Compartilhamento de contatos*: **ativado**. Sem isso o
   `people:searchDirectoryPeople` volta vazio — o Taq diz "ninguém com esse nome no
   diretório", sem inventar.
2. **Se o domínio restringe apps:** *Segurança → Controle de acesso e de dados →
   Controles de API → Gerenciar acesso de apps de terceiros*, **confie** no cliente
   OAuth da extensão (o mesmo ID de cliente do passo 3).
3. **Agendas dos colegas.** O ocupado/livre só aparece para quem **compartilha a
   agenda** com você (ou o domínio compartilha "ocupado/livre" por padrão — é uma
   configuração do Calendar). Sem acesso, o Taq diz "sem acesso" e trata a
   disponibilidade como **desconhecida**, nunca "livre".

## 5. Compilar e conferir

```powershell
$env:VITE_GOOGLE_OAUTH_CLIENT_ID = '<client id do cliente da extensão>.apps.googleusercontent.com'
npm run build
(Get-Content dist\manifest.json | ConvertFrom-Json).oauth2.scopes
```

O último comando deve listar os 7 escopos. Recarregue a extensão, abra a HOME →
**Conexões** → **Conectar conta do CITi**.

### Teste de ponta a ponta (sem incomodar ninguém)

Use **você mesmo** como destinatário e uma agenda sua:

1. **Conexões**: a linha "Conta do CITi" mostra seu e-mail e as quatro capacidades
   como "pronto".
2. Pergunte ao Taq: *"qual o e-mail da [uma colega]?"* → deve devolver nome e e-mail
   do diretório.
3. *"Envie a ata [X] para [o seu próprio nome]"* → deve chegar na sua caixa, com o
   anexo. O cartão diz **"Aceito pelo Google"** (e não "entregue").
4. *"Marque um teste amanhã às 10h comigo"* → cria na sua agenda; sem convidados,
   nada é enviado a ninguém.
5. *"Cancele o teste"* → cancela (sem convidados, vai direto).

## Como o Taq se protege (resumo; o código é a fonte)

- **O efeito vem da sua frase.** Enviar e mexer na agenda têm efeito
  `acao_externa`, que só entra quando **você** pede ("envie…", "marque…",
  "cancele…"). Uma instrução dentro de uma transcrição não tem ferramenta para usar.
- **Prévia e confirmação.** Se você já disse **quem** e **o quê** (destinatários
  citados, anexo escolhido, texto curto ou ditado por você), o Taq envia. Senão —
  nome ambíguo, texto escrito pelo Taq, destinatário de fora, dado sensível,
  convidado não citado — mostra o cartão **"Aguardando você"** e só executa quando
  você disser **"envie"** / **"pode marcar"** numa mensagem **seguinte**. O que
  sai é o rascunho guardado, não o que o modelo reescrever.
- **Pessoas reais.** Endereço sai do diretório, em código. Um endereço que o modelo
  escreveu sozinho é recusado. Nome com mais de uma pessoa vira pergunta com **nome
  e e-mail**.
- **Sem reenvio às cegas.** Cada ação tem uma chave de idempotência (o conteúdo) e
  um registro (`taq:acoes-externas`). Tempo esgotado ou erro 5xx = **"resultado
  desconhecido"**: o Taq **não reenvia** — peça "reenvie mesmo assim" se conferir a
  pasta Enviados e não estiver lá. Convite repetido bate no `409` do Google (o id do
  evento sai da chave) e não cria outro.
- **"Aceito" não é "entregue".** Com `gmail.send` o Taq não consegue conferir a
  pasta Enviados nem a entrega. Ele diz o que sabe: o Google aceitou.
- **Credenciais.** O token fica no cache do Chrome. Não vai para storage, log,
  mensagem de erro, cartão nem arquivo exportado, e **nunca** ao servidor do
  TaqCiti. Só a conexão (e-mail, domínio, escopos concedidos) fica em
  `taq:integracoes`.

## Limites conhecidos

- **Anexos:** até 3 MB no total; documentos vão como `.md`/`.txt` (o conteúdo
  **editável**, com a sua edição) e a transcrição como `.txt`. Transcrição de
  reunião em andamento vai marcada **PARCIAL**.
- **Cota do Gmail:** a do Workspace (por usuário/dia). Passou, o Google devolve 429 e
  o Taq diz "limite de uso".
- **Eventos:** só os que **você organiza** podem ser remarcados ou cancelados pelo
  Taq. Cancelar evento com convidados **sempre** passa por prévia.
- **Disponibilidade:** é ocupado/livre do calendário principal, em horário comercial
  (9h–18h no seu fuso). Não prova que a pessoa pode.
- **Destinatário de fora da organização:** só se **você** escreveu o endereço, e
  sempre com prévia.
- **Não existe** (de propósito): ler a caixa de entrada, responder e-mail, convidar
  por chat, enviar a quem não está no diretório sem você escrever o endereço.

## Se algo não liga

| sintoma | causa provável |
| --- | --- |
| "Falta registrar o cliente OAuth" | falta `VITE_GOOGLE_OAUTH_CLIENT_ID` no build |
| Google mostra "bad client id" / `invalid_client` | o ID do cliente não bate com o ID da extensão (`docs/google-oauth-setup.md`, 3A) |
| Linha da conta diz "O Google não concedeu todas as permissões" | a pessoa desmarcou um escopo no consentimento — **Desconectar** e conectar de novo |
| "A conta conectada é pessoal" | o perfil do Chrome entrou com `@gmail.com`; escolha a conta do CITi |
| 403 em e-mail, diretório ou agenda | a API correspondente não está ativada (passo 1), ou o domínio restringe o app (passo 4.2) |
| Diretório volta vazio | compartilhamento de contatos desligado no Admin Console (passo 4.1) |
| "sem acesso" para todos na agenda | os colegas não compartilham ocupado/livre com você |
| 401 repetido | o Taq já descarta o token vencido e tenta uma vez; se persistir, **Desconectar** e conectar |
