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
| `release` | espera os três, baixa os artefatos e publica a **GitHub Release** da tag |
| `distribute-gdrive` | espera a Release e sobe os mesmos arquivos na **pasta do Drive do time** |

Os três builds rodam o check em paralelo: se a configuração estiver errada, os
três morrem juntos em ~35s e `release`/`distribute-gdrive` são pulados. Nada
sai pela metade.

Acompanhar:

```bash
gh run watch                          # a run mais recente
gh run view --log-failed              # só o passo que falhou
```

---

## Conferir antes de avisar o time

Release verde não prova instalador bom — a `v2.0.0` ficou verde.

1. **Os nomes carregam a versão.** Confira na Release e no Drive:
   `taqciti-instalador-windows-X.Y.Z.exe`, `-linux-X.Y.Z.run`,
   `-mac-X.Y.Z.pkg`. Se o nome ainda for o da versão anterior, a run não
   publicou nada — vá ver a run, não o arquivo.

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

- **GitHub Release da tag** — canal técnico e de auditoria; fica versionado
  para sempre, com o changelog gerado.
- **Pasta do Drive do time** — canal oficial de distribuição, porque nem todo
  mundo tem acesso ao GitHub.

O `.github/scripts/upload-to-gdrive.sh` procura por **nome** e sobrescreve o
que achar, em vez de duplicar. Como o nome carrega a versão, uma release nova
**não substitui** a anterior no Drive: os arquivos convivem na mesma pasta.

Isso importa: os instaladores quebrados da `v2.0.0` continuam lá ao lado dos
novos, e quem abrir a pasta vê os dois. **Apague as versões antigas do Drive
depois de confirmar a nova**, ou alguém vai baixar a errada.
