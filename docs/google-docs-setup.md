# Como o documento chega até a pessoa

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

## Ligar o caminho direto (opcional)

**Todo mundo no mesmo Google Workspace?** Então a tela de consentimento é
**Interna**, e isso remove a maior parte da burocracia: sem verificação da
Google, sem lista de usuários de teste, sem fila de revisão. Sobram dois
passos de verdade.

**ID desta extensão:** `jalebpaefejnbacgncgkailhemkdpnhm`

Ele vem da chave pública em `manifest.config.ts` e **não muda** entre
máquinas, clones do repo ou reinstalações. É esse valor que o console pede.

### 1. Ativar a Drive API

[console.cloud.google.com/apis/library/drive.googleapis.com](https://console.cloud.google.com/apis/library/drive.googleapis.com)

Confira o projeto no seletor do topo, depois **Ativar**.

*Se pular:* a criação volta **403**, e a extensão diz exatamente isso.

### 2. Tela de consentimento

[console.cloud.google.com/apis/credentials/consent](https://console.cloud.google.com/apis/credentials/consent)

Tipo **Interno**. Escopo: **`.../auth/drive.file`**, e só ele.

`drive.file` dá acesso apenas aos arquivos que a própria extensão criou — ela
não enxerga, não lê e não altera mais nada do Drive de quem usa. É por isso
que esse escopo dispensa verificação. `drive` ou `drive.readonly` entrariam
numa fila de revisão e pediriam uma permissão que o produto não precisa.

### 3. Criar o cliente

[console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)

**+ Criar credenciais → ID do cliente OAuth → Extensão do Chrome**, com o ID
acima. Copie o Client ID gerado.

### 4. Build

```powershell
$env:VITE_GOOGLE_OAUTH_CLIENT_ID = '<client id>.apps.googleusercontent.com'
npm run build
(Get-Content dist\manifest.json | ConvertFrom-Json).oauth2.client_id
```

Se sair `CLIENT_ID_NAO_CONFIGURADO`, a variável não chegou — rode os comandos
na **mesma** janela do PowerShell. Com o placeholder ali, a extensão continua
funcionando pelo download; ela nem tenta autenticar.

### 5. Carregar

`chrome://extensions` → Modo do desenvolvedor → **Carregar sem compactação** →
`dist/`.

**Confira o ID que o Chrome mostra.** Tem que ser
`jalebpaefejnbacgncgkailhemkdpnhm`. Se for outro, a `key` não entrou no
manifesto e o OAuth vai falhar com "bad client id".

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
