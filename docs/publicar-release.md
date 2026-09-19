# Publicar um instalador que funciona

Runbook da release: do servidor no ar até o arquivo que o time baixa.

Existe porque as duas últimas tentativas erraram por motivos opostos, e os
dois erros são fáceis de repetir:

- **`v2.0.0` publicou instaladores quebrados.** Os três saíram apontando para
  `http://localhost:3000`. Instalavam, abriam, e não geravam nada — a menos
  que a pessoa estivesse rodando o servidor na própria máquina. O sintoma na
  mão de quem instalou foi só "não gera nada", sem erro que explicasse.
- **`v2.1.0` não publicou nada.** O check de configuração abortou os três
  builds porque as variáveis não estavam configuradas no repositório. Esse é
  o comportamento **certo**: falhar aqui custa uma release, publicar errado
  custa a confiança de quem instalou.

---

## O que decide se o instalador funciona

Dois valores, e eles entram **no bundle da extensão na hora da build** — não
são lidos em runtime:

| Variável da build | Padrão sem configuração | Onde |
| --- | --- | --- |
| `VITE_DOCCITI_SERVER_URL` | `http://localhost:3000` | `src/shared/config/serverConfig.ts:13` |
| `VITE_DOCCITI_SHARED_KEY` | `taqciti-dev-local` | `src/shared/config/serverConfig.ts:30` |

Consequência que manda no resto deste documento: **um instalador publicado com
o valor errado não tem conserto.** Não é configuração que o usuário ajusta
depois, nem variável que o servidor corrige — o endereço está compilado dentro
do arquivo que a pessoa já baixou. A única saída é cortar outra release e
pedir para todo mundo reinstalar.

Por isso `.github/scripts/check-release-env.sh` roda **antes** de compilar
qualquer coisa, nos três jobs, e derruba a release inteira se algo estiver
errado.

---

## Antes de cortar a tag

### 1. Servidor no ar, e respondendo

O runbook do deploy é `server/docs/deploy.md`. Produção roda no **Railway**
(`https://taqciti-production.up.railway.app`), com redeploy automático a cada
push em `main`. O mínimo: **Root Directory = `server`**,
`DOCCITI_SHARED_KEY` e a chave do provedor nas variáveis de ambiente do
serviço.

Confirme que responde, antes de gastar uma release — a prova de fumaça não
consome cota de modelo nenhum:

```bash
cd server
SMOKE_BASE_URL=https://taqciti-production.up.railway.app \
DOCCITI_SHARED_KEY=<a mesma chave> \
node scripts/smokePdf.mjs
```

### 2. As duas variáveis no GitHub

**Settings → Secrets and variables → Actions**:

| Nome | Onde | Valor |
| --- | --- | --- |
| `DOCCITI_SERVER_URL` | **Variables** | `https://taqciti-production.up.railway.app` — `https://`, sem barra no fim |
| `DOCCITI_SHARED_KEY` | **Secrets** | **idêntico** ao valor que está no Railway |

> **O check não testa o servidor.** Ele confere só que as duas existem, que a
> URL não é `localhost`/`127.0.0.1`, que começa com `https://` e que não
> termina em `/`. Nada disso toca a rede. Se você preencher as duas com o
> servidor fora do ar, ou com a chave diferente da que está no host, a
> release **passa verde e publica instaladores quebrados** — com exatamente o
> mesmo sintoma da `v2.0.0`. É por isso que o passo 1 vem antes do 2.

---

## Cortar a release

### 3. Subir a versão nos dois lugares

```
package.json        → "version": "X.Y.Z"
manifest.config.ts  → version: 'X.Y.Z'
```

Esse número é o que o Chrome mostra na extensão instalada. O número do **nome
do arquivo** vem da tag, não daqui (`GITHUB_REF_NAME` sem o `v`) — são
independentes, então manter os dois iguais é disciplina, não automação.

### 4. Commit e push em `main`

```bash
git add package.json manifest.config.ts
git commit -m "chore(release): versao X.Y.Z na extensao e no manifesto"
git push origin main
```

### 5. Tag com **três** números

```bash
git tag -a vX.Y.Z -m "TaqCITi X.Y.Z"
git push origin vX.Y.Z
```

O gatilho do workflow é `v*.*.*`. **`v2.1` não dispara nada** — nenhum erro,
nenhuma run, só silêncio. Tem que ser `v2.1.0`.

---

## O que o workflow faz

`.github/workflows/release.yml`, em ordem:

| Job | O que faz |
| --- | --- |
| `build-windows` / `build-linux` / `build-macos` | `npm ci` → **check-release-env** → build → compila o instalador nativo → sobe como artefato |
| `release` | espera os três, baixa os artefatos, **monta e confere o pacote** (`TaqCiti.zip`) e publica a **GitHub Release** da tag |
| `distribute-gdrive` | espera a Release, **reconfere o pacote** e sobe só ele na **pasta do Drive do time** |

Os três builds rodam o check em paralelo: se a configuração estiver errada, os
três morrem juntos em ~35s e `release`/`distribute-gdrive` são pulados. Nada
sai pela metade.

### Compilar sem publicar

**Actions → Release → Run workflow**, com **`publicar` desmarcado** (o padrão):
os três instaladores são compilados e ficam como artefatos da run — e nada é
publicado. `release` e `distribute-gdrive` são pulados pela condição
`github.event_name == 'push' || inputs.publicar`, que os dois carregam.

É o caminho para pôr a mão num instalador de verdade sem gastar uma release nem
tocar no arquivo que o time tem no Drive. Serve principalmente para o
**`.pkg` do macOS**: ele exige um runner macOS, e `build-macos` já roda em
`macos-latest` — não dá para compilá-lo em Windows nem em Linux.

| Artefato da run | O que é |
| --- | --- |
| `windows-installer` | `taqciti-instalador-windows-<versão>.exe` |
| `linux-installer` | `taqciti-instalador-linux-<versão>.run` |
| `macos-installer` | `taqciti-instalador-mac-<versão>.pkg` |

Baixe os três para uma pasta e monte o ZIP localmente:

```bash
node scripts/package-distribution.mjs --origem <a pasta> --saida release/pacote
```

O campo **`versao`** existe porque numa run disparada de um branch não há tag
de onde tirar o número: sem ele, os artefatos sairiam nomeados com o nome do
branch. Vazio, o número vem do `package.json`. Ver
`.github/scripts/resolve-version.sh`.

> **Publicar continua sendo o que a tag faz.** Empurrar `vX.Y.Z` publica
> sozinho, como sempre. Marcar `publicar` num disparo manual é a exceção —
> existe para reprocessar uma release que falhou depois dos builds, não para o
> dia a dia.

---

## O pacote de distribuição

O que o time baixa do Drive é **um arquivo só**: `TaqCiti.zip`. Dentro dele:

```
TaqCiti/
  COMECE_AQUI.html
  Instaladores/taqciti-instalador-windows-X.Y.Z.exe
  Instaladores/taqciti-instalador-mac-X.Y.Z.pkg
  Instaladores/taqciti-instalador-linux-X.Y.Z.run
```

A pessoa extrai, abre a pasta e dá dois cliques em `COMECE_AQUI.html`. O guia
abre no navegador, pergunta o sistema e conduz as quatro fases (preparar,
instalar, Chrome, conferir) até a extensão estar funcionando — inclusive os
avisos do Windows e do macOS, que assustam quem não sabe que são esperados. A
origem do guia é `assetsingestion/`; ver o README de lá.

**O nome do ZIP não tem versão, e isso é de propósito.**
`upload-to-gdrive.sh` procura por nome e sobrescreve o que achar, então um nome
fixo faz cada release substituir a anterior no mesmo arquivo do Drive: o link
compartilhado com o time nunca muda, e nunca existem duas versões lado a lado
esperando alguém baixar a errada. A versão vive **dentro** do pacote — no nome
dos três instaladores, que o guia também exibe.

**A pasta da extensão não vem do pacote.** Ela só existe depois que o
instalador roda, na máquina de quem instala. Por isso o guia dentro do ZIP não
mostra caminho nenhum: o instalador copia esse mesmo guia para uma pasta por
usuário, grava um `install-path.js` ao lado com o caminho real e abre essa
cópia — é ali que aparece o endereço e o botão "Copiar caminho". Nenhum caminho
da máquina de build entra no pacote.

> **Na primeira release com o pacote, limpe a pasta do Drive.** Os instaladores
> soltos das versões anteriores continuam lá (nada é apagado automaticamente, e
> os links antigos seguem válidos apontando para arquivos que não serão mais
> atualizados). Depois de confirmar que o `TaqCiti.zip` novo está bom, apague os
> `taqciti-instalador-*` antigos à mão — inclusive os quebrados da `v2.0.0`.

### Gerar e revisar o pacote na sua máquina

```bash
# com os três instaladores numa pasta (ex.: baixados dos artefatos da run)
node scripts/package-distribution.mjs --origem release --saida release/pacote
```

O script monta `release/pacote/TaqCiti.zip` **e** a mesma estrutura em pasta,
em `release/pacote/TaqCiti/` — dá para abrir o guia com dois cliques e navegar
os arquivos exatamente como quem baixar vai ver.

Ele recusa gerar um pacote incompleto: se faltar um dos três instaladores, se
houver mais de um do mesmo sistema, se algum estiver vazio ou se os três não
forem da mesma versão, ele explica o que houve, sai com erro e **não grava
nada** — o ZIP anterior no disco (e, no job, a última entrega no Drive)
continua intacto. Depois de gravar, ele reabre o ZIP e confere nome, tamanho,
CRC e permissão de cada entrada antes de dar por bom.

**Nome certo não basta: ele olha dentro.** Cada instalador precisa ter a cara
do formato que promete — `MZ` mais a marca `Inno Setup Setup Data` no `.exe`,
`xar!` no `.pkg`, shebang mais a marca `Makeself` no `.run`. Isso existe porque
durante o desenvolvimento os testes usaram arquivos substitutos (um zip
renomeado) e eles passavam por todas as outras conferências. Um substituto
publicado no Drive seria pior do que uma release falhando: o time baixaria,
daria dois cliques e nada aconteceria. Não é assinatura e não prova
procedência — prova que o artefato é do formato que as etapas de build geram.

Para conferir um pacote que já existe:

```bash
node scripts/package-distribution.mjs --conferir release/pacote/TaqCiti.zip
```

Para revisar só o guia, sem ter instalador nenhum em mãos:

```bash
node scripts/package-distribution.mjs --somente-guia --saida release/preview-guia
```

### O texto que acompanha o link

Para colar junto do link do Drive:

> **TaqCITi X.Y.Z** — baixe o `TaqCiti.zip`, **extraia** (não abra o arquivo
> compactado direto) e, dentro da pasta `TaqCiti`, dê dois cliques em
> **`COMECE_AQUI.html`**. O guia abre no navegador e conduz o resto — serve
> para Windows, Mac e Linux.

Acompanhar:

```bash
gh run watch                          # a run mais recente
gh run view --log-failed              # só o passo que falhou
```

---

## Pendências anteriores à distribuição

Duas coisas para resolver **antes** de distribuir amplamente. Nenhuma bloqueia
um teste interno; as duas bloqueiam abrir o instalador para muita gente.

1. **Limites efetivos de consumo.** `VITE_DOCCITI_SHARED_KEY` entra no bundle e
   fica legível na pasta que o Chrome carrega — está escrito assim mesmo em
   `src/shared/config/serverConfig.ts` e em `server/lib/apiGuard.ts`: é tranca
   contra varredura, não autenticação. Ela é o **único** portão de
   `/api/generate`, `/api/ai/secao`, `/api/ai/bench` e `/api/ai/smoke`, que
   gastam cota paga, e não há limite por chamador no servidor (não existe
   `middleware.ts`; o código de *rate limit* em `server/lib/ai/providers/` trata
   429 **do provedor**). O teto é só `maxTranscriptChars`. Confira teto de gasto
   nas contas dos provedores antes de distribuir — rotacionar essa chave é caro,
   porque ela está compilada dentro dos instaladores já entregues.

2. **Restringir `bench` e `smoke` em produção.** São rotas de desenvolvimento, e
   `/api/ai/bench` chama **vários modelos** por requisição. Distribuir um
   instalador cuja chave destrava um endpoint de benchmark é pior do que um que
   destrava só `/api/generate`.

Autenticação por usuário, com rotação, continua sendo a fase futura que o
próprio `apiGuard.ts` descreve — não é o que estas duas pendências pedem.

---

## Conferir antes de avisar o time

Release verde não prova instalador bom — a `v2.0.0` ficou verde.

1. **Baixe o `TaqCiti.zip` do Drive e abra.** Como o nome do arquivo é fixo, a
   data de modificação no Drive é o que diz se a run publicou: se for a de
   antes, vá ver a run, não o arquivo. Dentro do ZIP, os três instaladores têm
   que carregar a versão nova no nome (`-X.Y.Z.exe`, `-X.Y.Z.pkg`,
   `-X.Y.Z.run`), e o `COMECE_AQUI.html`, na etapa "Abra o instalador", tem que
   citar exatamente esse nome. O job recusa publicar um pacote onde isso não
   bata — mas conferir com o olho custa dez segundos.

2. **Instale de verdade e procure `localhost` no bundle.** O instalador copia
   a extensão descompactada para a Área de Trabalho, em `TaqCITi (não
   apagar)`. Se o endereço de dev aparecer ali, o instalador está quebrado:

   ```powershell
   # Windows
   Select-String -Path "$env:USERPROFILE\Desktop\TaqCITi (não apagar)\assets\*.js" -Pattern "localhost:3000"
   ```

   ```bash
   # Linux / macOS
   grep -r "localhost:3000" ~/Desktop/"TaqCITi (não apagar)"/assets/
   ```

   Sem resultado = certo. Para confirmar o outro lado, procure
   `taqciti-production.up.railway.app` no mesmo lugar — ele **tem** que
   aparecer.

3. **Rode uma reunião de verdade** — carregue a pasta em `chrome://extensions`
   e gere um documento até o fim. É o único teste que exercita extensão,
   servidor e chave juntos.

---

## Quando falhar

| No log | Causa | O que fazer |
| --- | --- | --- |
| `FALTA VITE_DOCCITI_SERVER_URL` | a Variable `DOCCITI_SERVER_URL` não existe | criar em *Variables* (não em *Secrets*) |
| `FALTA VITE_DOCCITI_SHARED_KEY` | o Secret `DOCCITI_SHARED_KEY` não existe | criar em *Secrets* |
| `aponta para a maquina local` | a Variable foi preenchida com `localhost` | trocar pelo endereço de produção (Railway) |
| `precisa comecar com https://` | endereço `http://` | a extensão roda em página https (Meet); `http://` seria bloqueado como conteúdo misto |
| `nao pode terminar com '/'` | barra no fim | duplicaria em `${url}/api/generate` |
| nenhuma run apareceu | tag fora do padrão `v*.*.*` | cortar `vX.Y.Z` com três números |

**Não precisa de tag nova para tentar de novo.** Depois de arrumar a
configuração, é re-rodar a mesma run — ela relê as variáveis do repositório na
hora que roda:

```bash
gh run rerun <id> --failed
```

Ou "Re-run all jobs" na página da run.

---

## Onde os arquivos aparecem

- **GitHub Release da tag** — canal técnico e de auditoria. Leva os **três
  instaladores soltos** (útil para baixar um só) **e** o `TaqCiti.zip`, para
  ficar registrado exatamente o arquivo que o time recebeu. Fica versionado
  para sempre, com o changelog gerado.
- **Pasta do Drive do time** — canal oficial de distribuição, porque nem todo
  mundo tem acesso ao GitHub. Leva **só o `TaqCiti.zip`**.

O `.github/scripts/upload-to-gdrive.sh` procura por **nome** e sobrescreve o
que achar, em vez de duplicar. Como o nome do pacote é fixo, cada release
substitui a anterior **no mesmo arquivo**: o link compartilhado com o time vale
para sempre e aponta sempre para a versão mais nova.

> **Resíduo das releases antigas.** Antes do pacote, o Drive recebia os três
> instaladores soltos, com a versão no nome — então eles se acumulavam em vez
> de se substituir. Esses arquivos continuam lá (nada é apagado
> automaticamente) e, a partir de agora, **param de ser atualizados**: quem
> abrir um link antigo vai baixar um instalador congelado na última versão
> publicada por aquele caminho. Apague-os do Drive assim que confirmar o
> primeiro `TaqCiti.zip` bom — inclusive os quebrados da `v2.0.0`.
