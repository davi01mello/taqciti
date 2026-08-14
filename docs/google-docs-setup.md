# Ligar o envio para o Google Docs

O código está pronto. Falta uma coisa que **só pode ser feita no Google Cloud
Console**, por quem é dono do projeto: registrar um cliente OAuth para esta
extensão. Sem isso, `chrome.identity.getAuthToken` falha com "bad client id" —
mensagem que não diz nada sobre a causa, e por isso o código a traduz.

São três passos, uma vez só.

---

## O que já está feito

| | onde |
|---|---|
| ID estável da extensão (`key` no manifesto) | `manifest.config.ts` |
| Permissão `identity` e bloco `oauth2` com escopo `drive.file` | `manifest.config.ts` |
| Criação do documento no Drive (`files.create`, multipart) | `src/document/googleDocs.ts` |
| Botão: gerar → enviar → abrir a aba | `src/document/GenerateDocumentMenu.tsx` |

**ID da extensão:** `jalebpaefejnbacgncgkailhemkdpnhm`

Ele vem da chave pública no manifesto e **não muda** entre máquinas, clones do
repo ou reinstalações. É esse valor que o console vai pedir.

---

## Passo 1 — ative a Drive API

No [Google Cloud Console](https://console.cloud.google.com/), com o projeto da
chave do Gemini selecionado:

**APIs e serviços → Biblioteca → "Google Drive API" → Ativar.**

Sem isso, a criação do arquivo volta 403 — e o código já diz exatamente isso na
mensagem de erro.

## Passo 2 — configure a tela de consentimento

**APIs e serviços → Tela de permissão OAuth.**

- Tipo: **Interno** se todo mundo que vai usar está no mesmo Google Workspace;
  **Externo** caso contrário.
- Escopo a adicionar: `.../auth/drive.file` — **e só ele**.

`drive.file` dá acesso apenas aos arquivos que a própria extensão criou. Ela
não enxerga, não lê e não altera mais nada do Drive de quem usa. É por isso que
esse escopo **não exige verificação da Google**: com `drive` ou
`drive.readonly` você entraria numa fila de revisão de semanas, e pediria ao
usuário uma permissão que o produto não precisa.

> Em **Externo** e modo "Teste", só os e-mails que você listar como usuários de
> teste conseguem autorizar. Adicione quem vai testar.

## Passo 3 — crie o cliente OAuth

**APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth.**

- Tipo de aplicativo: **Extensão do Chrome**
- ID do aplicativo: `jalebpaefejnbacgncgkailhemkdpnhm`

Copie o **Client ID** gerado (termina em `.apps.googleusercontent.com`).

---

## Ligar na build

```powershell
$env:VITE_GOOGLE_OAUTH_CLIENT_ID = '<o client id>.apps.googleusercontent.com'
npm run build
```

Ou, se preferir fixar, troque o valor de `OAUTH_CLIENT_ID` em
`manifest.config.ts`.

Confira que pegou:

```powershell
(Get-Content dist\manifest.json | ConvertFrom-Json).oauth2.client_id
```

Se aparecer `CLIENT_ID_NAO_CONFIGURADO`, a variável não chegou à build.

---

## Carregar e testar

1. `chrome://extensions` → **Modo do desenvolvedor** ligado → **Carregar sem
   compactação** → aponte para `dist/`.
2. Confirme que o ID mostrado é `jalebpaefejnbacgncgkailhemkdpnhm`. Se for
   outro, a `key` não entrou no manifesto.
3. Suba o servidor (`cd server; npm run dev`).
4. Gere um documento pelo botão. Na primeira vez o Chrome abre a tela de
   consentimento; depois ele usa o token do cache sem interromper.

---

## O servidor precisa de chave PAGA

Isto é independente do OAuth, e hoje **impede o fluxo com reunião real**.

Enquanto `DOCCITI_DATA_POLICY=training` estiver em `server/.env.local`, o
`/api/generate` recusa qualquer transcrição que não se declare sintética — e a
extensão captura reunião de verdade, então ela não pode se declarar sintética.
O botão vai falhar com a mensagem do servidor, e isso é a trava funcionando: o
free tier do Gemini manda todo o conteúdo enviado para treinamento do provedor,
com revisão humana.

Some a isso a cota: o free tier dá **20 requisições por dia, por projeto, por
modelo**, e uma Ata consome 18 no `gemini-3.5-flash`. Uma chave nova **não
resolve** — a cota é do projeto, não da chave.

Para o botão funcionar de ponta a ponta com reunião real:

1. ative faturamento no projeto do Google Cloud (a chave sai do free tier);
2. **remova `DOCCITI_DATA_POLICY=training`** de `server/.env.local`;
3. reinicie o servidor — `.env.local` é lido no boot.

---

## Ao publicar na Web Store

A loja atribui a **própria** chave à extensão, e o ID muda. Depois da primeira
publicação:

1. copie a chave que a loja mostra;
2. troque o valor de `key` em `manifest.config.ts` por ela;
3. crie um segundo cliente OAuth com o novo ID, ou atualize o existente.

Sem isso, o ID de desenvolvimento e o de produção divergem, e o cliente OAuth
vale só para um dos dois.
