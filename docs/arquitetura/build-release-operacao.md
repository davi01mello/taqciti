# Build, testes, CI, release e operação

Mapa de manutenção do que cerca o código: como compilar, testar, publicar e
operar o TaqCiti. Só consta aqui o que foi conferido nos arquivos do
repositório; o que não foi, está marcado como "não verificado". Valores de
variáveis, endereços de produção e identificadores de conta não aparecem
neste documento de propósito (o repositório é público).

## 1. Estrutura do repositório

| Onde | O que é |
| --- | --- |
| raiz | A **extensão** (Chrome/Edge, MV3): Vite + `@crxjs/vite-plugin`, React 18, Tailwind, Zod. `package.json` e `package-lock.json` próprios. |
| `server/` | O **servidor** Next.js (App Router): geração de documentos, camada de IA, conector/sincronização, Postgres. `package.json` e `package-lock.json` próprios. |
| `installer/` | Instaladores nativos (`windows/` Inno Setup, `macos/` pkgbuild, `linux/` makeself) e `guide/` (o `COMECE_AQUI.html`). |
| `scripts/` | Utilitários da raiz: ícones, empacotamento, `verify-*.cjs`, `lib/` (motor de ZIP e PNG sem dependência). |
| `.github/` | `workflows/ci.yml`, `workflows/release.yml` e `scripts/` (`check-release-env.sh`, `resolve-version.sh`, `upload-to-gdrive.sh`). |
| `docs/` | Documentação; `docs/verification/` guarda saídas dos `verify-*.cjs` (capturas e JSON). |

São **dois projetos independentes**: um `npm ci` na raiz não instala nada do
servidor. O `server/next.config.ts` fixa `turbopack.root` justamente porque há
dois lockfiles (sem isso o Turbopack avisa "raiz ambígua" a cada build).
`server/.vercelignore` exclui `**/*.test.ts(x)`, `vitest.config.mts` e
`vitest.setup.ts` do upload: o type-check do build puxava testes que importam
de `src/`, fora do upload de `server/`.

## 2. Scripts npm

### Raiz (extensão, versão do pacote 2.1.2 no `package.json`)

| Script | Faz |
| --- | --- |
| `dev` | `vite` (servidor de desenvolvimento). Ver a ressalva da seção 3. |
| `build` | `vite build` (produção, saída em `dist/`). |
| `build:dev` | `vite build --mode development` (saída em `dist-dev/`, com o andaime de simulação). |
| `typecheck` | `tsc --noEmit`. |
| `test` / `test:watch` | `vitest run` / `vitest`. |
| `lint` | `eslint src` (só `src`). |
| `format` | `prettier --write` em `src`, `docs/**/*.md` e arquivos de raiz. |
| `icons` | `node scripts/generate-icons.mjs`. |
| `package` | `node scripts/package-release.mjs`: roda `npm run build` e grava `release/taqciti-v<versão>.zip` (a extensão crua, montada com `scripts/lib/zip.mjs`). |

### `server/`

| Script | Faz |
| --- | --- |
| `dev` / `build` / `start` | `next dev` / `next build` / `next start`. |
| `typecheck` | `tsc --noEmit`. |
| `test` / `test:watch` | `vitest run` / `vitest`. |
| `test:live` | `node scripts/testLive.mjs`: roda `vitest run` com `DOCCITI_LIVE_TESTS=1` (portável entre shells, sem `cross-env`). |

Não há script de lint no servidor. Scripts avulsos: `server/scripts/smokePdf.mjs`
e `server/scripts/testLive.mjs`. Aviso do `server/AGENTS.md`: o Next usado
tem mudanças incompatíveis; a documentação correta está em
`server/node_modules/next/dist/docs/`.

## 3. Builds e pastas de saída

`vite.config.ts` decide a saída pelo modo: `production` vai para `dist/`,
qualquer outro (`development`) para `dist-dev/`. Pastas separadas para que
carregar a extensão de desenvolvimento não exija rebuildar a de produção.
`dist/`, `dist-dev/`, `release/` e `.env*` (exceto `.env.example`) estão no
`.gitignore`.

Pontos do `vite.config.ts` que importam na manutenção:

- Constante de build `__TAQCITI_DEV__` (`true` fora de produção): elimina o
  andaime de desenvolvimento do bundle de produção. Nos testes ela é `true`.
- Entradas extras do Rollup: `src/document/index.html` e `src/home/index.html`
  (páginas abertas por URL, sem chave de manifesto). O painel lateral é achado
  pelo `side_panel` do manifesto.
- Plugin `taqciti:panel-resources-only-on-meet` (antes `panel-resources-everywhere`;
  **mudança do commit `923ea5a`, 21/10/2026**): depois do @crxjs, fixa o
  `matches` das `web_accessible_resources` em `ONDE_O_PAINEL_VIVE`
  (`https://meet.google.com/*`). Era `<all_urls>`. É uma trava nos dois sentidos: nenhuma
  entrada gerada fica mais larga (qualquer site detectaria a extensão pelo ID fixo) nem
  mais estreita (o painel morreria no `import`, com o build passando e o `dist/`
  parecendo correto). Acompanha o `matches` do content script em
  `manifest.config.ts`, que passou a `https://meet.google.com/*`. Se o
  `manifest.json` não estiver no bundle, o plugin falha alto.
- Plugin `taqciti:servidor-de-producao-seguro` (commit `923ea5a`):
  uma build `production` é **recusada** se `VITE_DOCCITI_SERVER_URL` não for `https://`
  ou se `VITE_DOCCITI_SHARED_KEY` estiver ausente ou com o valor de desenvolvimento
  (`taqciti-dev-local`). Lê `loadEnv` do `.env` e `process.env` (este vence). O CI de
  release já recusava isso (`.github/scripts/check-release-env.sh`), mas a build local —
  a que vai por robocopy para o Chrome de quem desenvolve — caía em
  `http://localhost:3000` e na chave pública de dev, em silêncio: sem TLS, a transcrição
  e o token do Google viajariam em claro. Para testar contra o servidor local, use
  `npm run build:dev`.
  **CI:** os jobs `Extensão (raiz)` e `Instalador Windows` de `ci.yml` passam valores
  fictícios no `env` do passo de build (`VITE_DOCCITI_SERVER_URL: https://ci.invalid`
  e `VITE_DOCCITI_SHARED_KEY: ci-build-only`), porque ali só interessa que a build
  COMPILE. Sem eles a trava recusaria e os dois jobs ficariam vermelhos. Quem acrescentar
  outro passo `npm run build` de produção no CI precisa repetir esse `env`.
- O manifesto vem de `manifest.config.ts` (versão, permissões, `client_id`).
  `manifest.config.ts` lê `VITE_*` do `.env` à mão com `loadEnv` (o Vite não
  povoa `process.env`); `process.env` tem precedência (caminho do CI).
  Sem `VITE_GOOGLE_OAUTH_CLIENT_ID` o manifesto sai com um placeholder válido:
  a extensão carrega, só o envio ao Google Docs e a seção Conexões ficam
  indisponíveis. Ver `docs/google-oauth-setup.md`.

### Variáveis lidas na build da extensão (só nomes)

| Nome | Função |
| --- | --- |
| `VITE_DOCCITI_SERVER_URL` | Endereço do servidor; padrão de desenvolvimento `http://localhost:3000`. Entra no bundle. |
| `VITE_DOCCITI_SHARED_KEY` | Segredo compartilhado enviado no header `x-docciti-key`; tem valor padrão público de dev (a build de produção recusa esse valor, ver acima). Entra no bundle: é tranca contra varredura, não autenticação. Desde o plano de segurança é só uma **ponte**: as rotas de IA preferem o `id_token` do Google (`fetchDeIa`). |
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | Cliente OAuth "Extensão do Chrome", lido por `manifest.config.ts`. |
| `VITE_GOOGLE_OAUTH_WEB_CLIENT_ID` | Cliente OAuth "Aplicativo da Web", lido em `src/shared/services/identidade.ts`; ausente = erro "não configurado na build". |

Observação verificada: o `release.yml` repassa à build **apenas** as duas
primeiras (`DOCCITI_SERVER_URL` e `DOCCITI_SHARED_KEY`). Os dois clientes OAuth
não entram pelo workflow; se a release deve trazê-los, isso não está
configurado lá (não verificado se é intencional).

## 4. Carregar a extensão no Chrome

1. `npm ci` e `npm run build` (produção, `dist/`) ou `npm run build:dev`
   (`dist-dev/`).
2. `chrome://extensions` (ou `edge://extensions`), ligar o "Modo do
   desenvolvedor", "Carregar sem compactação" e escolher a **pasta** (`dist` ou
   `dist-dev`), nunca o `.zip`.
3. Depois de cada rebuild, recarregar a extensão na página de extensões.

Armadilhas registradas em `vite.config.ts` e nos docs: o `npm run dev` (dev
server do @crxjs) não é o caminho usado de fato pelo time; não verificado aqui
se ele funciona hoje. Quem instala pelo instalador recebe uma cópia
descompactada em `TaqCITi (não apagar)` na Área de Trabalho; mover ou apagar
essa pasta quebra a extensão. O Chrome não abre `chrome://extensions` por
linha de comando de outro processo, por isso o guia manda colar o endereço.

## 5. Estratégia de testes

### Extensão (`vitest.config.ts`)

- Ambiente `jsdom` (o parser de legendas do Meet só vale contra DOM de
  verdade), `include: src/**/*.test.{ts,tsx}`, sem plugin @crxjs, alias `@`
  para `src/`, `testTimeout` de 20 s (a HOME e a sidebar montadas em jsdom
  estouravam os 5 s padrão com CPU ocupada).
- `setupFiles: src/test/semRede.ts`: troca `globalThis.fetch` por uma rejeição
  imediata ("Failed to fetch"). Motivo: o `App` pergunta ao servidor se o
  assistente está disponível; sem isso a pergunta ia a `localhost:3000` e
  passava no Windows e falhava no Linux do CI (painel preso em "Verificando o
  assistente…"). Quem precisa de resposta faz `vi.stubGlobal('fetch', ...)`.
- **Exceção:** se `TAQ_LIVE_URL` está definida, o `fetch` real é mantido. É o
  que habilita os `*.live.test.ts`.
- Mocks de `chrome.*`: `src/test/chromeStorageMock.ts` (`installChromeStorageMock`,
  áreas de storage com `vi.fn` e eventos de mudança); os testes de recursos
  que usam outras APIs `chrome.*` montam stubs próprios (não inventariado aqui).

### Servidor (`server/vitest.config.mts`)

- Ambiente `node`, `include: lib/**/*.test.ts`, alias `@/` para `server/`
  declarado à mão (sem `vite-tsconfig-paths`).
- `vitest.setup.ts` define `MOCK_LLM=true` **antes** de qualquer import: é a
  "tranca" que faz todo agente resolver para o provedor `mock`, mesmo com chave
  de provedor presente no ambiente (a configuração é resolvida na importação,
  então definir dentro de `beforeEach` chegaria tarde). Não cobre quem monta um
  adaptador com transporte de rede de verdade; por isso `providers/openai.ts`
  recebe o `fetch` por parâmetro e o teste prova que o `fetch` global não é
  chamado.
- Banco: suítes usam **PGlite** (Postgres em WASM, devDependency). Cada suíte
  que o usa sobe um Postgres no `beforeAll`; em paralelo o boot passa dos 10 s
  só por disputa de CPU. Daí `hookTimeout` de 60 s e `testTimeout` de 30 s.
  Sobre consumo de memória das suítes de banco: o repositório não registra
  nenhuma configuração de limite de memória; não verificado.

### Testes ao vivo

Rodam contra servidor e provedor reais, ficam pulados por padrão e usam
reunião **inventada** (com chave de free tier o conteúdo vai a treinamento do
provedor: nunca gravação real).

| Arquivo | Habilita com | Exige |
| --- | --- | --- |
| `src/features/{taq/{taq,copiloto,trabalho},apoio,acompanhamento/juiz,estado,calibracao/historico}.live.test.ts` | `TAQ_LIVE_URL` + `TAQ_LIVE_KEY` | `cd server; npx next build; npx next start -p 3100` em outro terminal; `TAQ_LIVE_KEY` = o `DOCCITI_SHARED_KEY` do servidor. `trabalho` aceita `TAQ_LIVE_PAUSA_MS`. |
| `src/features/sync/sync.e2e.live.test.ts` | `TAQCITI_E2E_SERVER` (e `TAQCITI_E2E_COTA=1` para o servidor de cota) | Postgres local em contêiner, `server/lib/conector/esquema.sql` aplicado, `next start` com `DATABASE_URL` local, cliente OAuth de teste e um preload do Node (fora do repo) que responde ao `tokeninfo`; `TAQCITI_E2E_PG` nomeia o contêiner usado pelo `psql`; `VITE_DOCCITI_SERVER_URL` e `VITE_GOOGLE_OAUTH_WEB_CLIENT_ID` apontando para o ambiente de teste. **Nunca contra produção**: escreve e apaga acervo. |
| `server/lib/documentos/gerar.live.test.ts` | `DOCUMENTOS_LIVE=1` (e `DOCUMENTOS_AMOSTRAS=<pasta>`) | Suspende a tranca `MOCK_LLM` só nesse arquivo; lê `.env.local` do servidor sem imprimir. Gasta chamadas do provedor. |
| `server/lib/agents/auditor.canonical.test.ts` | `DOCCITI_LIVE_TESTS=1` + chave do Google | Via `npm run test:live` no servidor. |

Observação: os `*.live.test.ts` da raiz fazem parte do `include`, então rodam
em `npm test`, mas ficam `describe.skip` sem as variáveis (padrão `rodar =
… ? describe : describe.skip`, conferido em vários deles).

### `scripts/verify-*.cjs` (Playwright)

Verificações **no navegador**, com a extensão carregada, para o que o jsdom não
cobre (layout, visibilidade, `chrome.storage` de verdade). O `playwright-core`
não é dependência do projeto: o caminho é passado como argumento ou por
`PLAYWRIGHT_CORE_PATH`; `BROWSER_PATH` troca o executável (o padrão dos
scripts é o Edge do Windows). Usam perfil temporário isolado, dados `[TESTE]`
e nenhuma chamada de IA. Saídas (capturas e JSON) vão para `docs/verification/<tema>/`.

| Script | Verifica | Pasta carregada |
| --- | --- | --- |
| `verify-ajuda.cjs` | rótulos da referência de ajuda (`src/features/taq/ajuda.ts`) contra a interface; grava `resultado.json` que o `ajuda.test.ts` usa | build de desenvolvimento |
| `verify-apagar.cjs` | botões de apagar da HOME (documento, conversa, notas) | `dist` |
| `verify-meetings-documents.cjs` | fluxo de reuniões e documentos | `dist` |
| `verify-preparar.cjs` | página "Preparar" (HOME larga e estreita) | build de desenvolvimento |
| `verify-trabalho.cjs` | cartões do Taq e página "Acompanhamento" | build de desenvolvimento |

Exemplo: `npx vite build --mode development --outDir <pasta>` e depois
`node scripts/verify-preparar.cjs <playwright-core> <pasta>`. O Chrome
recente pode ignorar `--load-extension`; os scripts usam o Edge por padrão.

## 6. CI (`.github/workflows/ci.yml`)

Dispara em push (qualquer branch), pull request e manualmente. Node 20.

| Job | Runner | Passos | Por que existe |
| --- | --- | --- | --- |
| `extensao` | ubuntu | `npm ci`, `typecheck`, `lint`, `test`, `build` | Antes, esses checks só rodavam na máquina de quem desenvolvia. |
| `instalador-windows` | windows | `npm ci`, `build`, instala Inno Setup (choco), compila `taqciti.iss` com versão fictícia `0.0.0-ci` | Erro de sintaxe no `.iss` só aparecia na release (v2.0.0: comentário `{ ... }` citando `{pf32}`, que fecha o comentário no primeiro `}` em Pascal). |
| `servidor` | ubuntu, `working-directory: server` | `npm ci`, `typecheck`, `test`, `build` (com `DOCCITI_SHARED_KEY` descartável), `npm run start` + `wait-on` + `node scripts/smokePdf.mjs` | O `build` não é redundante: o `pdfkit` lê arquivos do próprio pacote e, empacotado, quebrava só em produção (PDF ausente com resposta 200). Por isso `serverExternalPackages: ['pdfkit']` em `next.config.ts`. A prova de fumaça usa `POST /api/answers`, que renderiza HTML e PDF sem chamar modelo, e falha se não vier PDF válido com a Barlow embutida. |

Nenhuma chave real deve ir ao CI. O CI não cobre `lint` do servidor (não existe),
nem os instaladores macOS e Linux (compilados só na release).

## 7. Release

Gatilho: tag `v*.*.*` (três números; `v2.1` não dispara nada, em silêncio) ou
disparo manual de `release.yml`. Runbook completo: `docs/publicar-release.md`.

1. Subir a versão em `package.json` e `manifest.config.ts` (independentes do
   nome dos arquivos, que vem da tag).
2. Publicar o servidor **antes** (deploy manual) e conferir com a prova de
   fumaça.
3. Garantir no GitHub: variável `DOCCITI_SERVER_URL` (Variables) e segredo
   `DOCCITI_SHARED_KEY` (Secrets). Para o Drive: `GDRIVE_SA_KEY` e
   `GDRIVE_TAQCITI_FOLDER_ID` (Secrets).
4. Commit em `main`, tag, push da tag.

Jobs do `release.yml`:

- `build-windows`, `build-linux`, `build-macos` (runners windows/ubuntu/macos):
  `npm ci`, `check-release-env.sh`, build, instalador, artefato.
  `check-release-env.sh` recusa: variável ausente, URL com `localhost` ou
  `127.0.0.1`, URL sem `https://` (conteúdo misto no Meet), URL terminando em
  `/`. **Não toca a rede**: não prova que o servidor está no ar nem que a chave
  confere (a v2.0.0 saiu verde com instaladores apontando para `localhost`).
- `release`: só em push de tag `v*` ou `publicar=oficial`. Baixa os três
  artefatos, monta `TaqCiti.zip` com `scripts/package-distribution.mjs`
  (recusa pacote incompleto, instalador vazio, versões diferentes ou formato
  falso: confere `MZ` + Inno Setup, `xar!`, shebang + Makeself; relê o ZIP
  gravado) e publica a GitHub Release (três instaladores + ZIP).
- `distribute-gdrive`: mesma condição; autentica como Service Account (escopo
  `drive` explícito: o padrão `cloud-platform` dava 403), reconfere o ZIP e
  sobe só `TaqCiti.zip` com nome fixo (sobrescreve pelo nome; o link
  compartilhado nunca muda).
- `distribuir-teste`: só com `publicar=teste`; sobe `TaqCiti-teste.zip` sem
  GitHub Release, sem tocar no oficial.

Disparo manual: `publicar` = `nao` (padrão, só artefatos), `teste` ou
`oficial`; `versao` opcional (ordem em `resolve-version.sh`: campo, tag,
`package.json`).

### Instaladores

| Sistema | Origem | Saída (`release/`) | Destino da extensão |
| --- | --- | --- | --- |
| Windows | `installer/windows/taqciti.iss` (Inno Setup 6, `ISCC /DAppVersion=...`) | `taqciti-instalador-windows-<versão>.exe` | `Área de Trabalho\TaqCITi (não apagar)`; guia em `%LOCALAPPDATA%\TaqCITi\guide` |
| macOS | `installer/macos/build-installer.sh` + `postinstall` (`pkgbuild`) | `taqciti-instalador-mac-<versão>.pkg` | `~/Desktop/TaqCITi (não apagar)` (cai em `~/` se não houver Desktop); guia em `~/Library/Application Support/TaqCITi/guide` |
| Linux | `installer/linux/build-installer.sh` + `install.sh` (`makeself`) | `taqciti-instalador-linux-<versão>.run` | `~/Desktop/TaqCITi (não apagar)` (idem); guia em `~/.local/share/taqciti/guide` |

Todos copiam `installer/guide/COMECE_AQUI.html` **intocado** e gravam ao lado um
`install-path.js` com o caminho real; nunca reescrevem o HTML. O Windows
detecta Chrome e Edge (pergunta se houver os dois, aborta se não houver
nenhum). Nenhum é assinado: SmartScreen e Gatekeeper avisam, e é esperado. O
`.pkg` nunca foi instalado num Mac (ver `installer/macos/README.md` e o
`roteiro-de-teste.md`): tratar como não verificado.

## 8. Deploy do servidor

- Produção roda na **Vercel** desde 22/09/2026 (segundo `docs/publicar-release.md`
  e `server/docs/deploy.md`). O deploy é **manual**: nenhum push publica.
- Projeto no host com **Root Directory = `server`** (ajuste de painel, não de
  arquivo). `server/vercel.json` fixa a região `gru1`; `maxDuration` está
  declarado nas rotas de geração, e na Vercel vale como teto de função
  (`300` em `generate`, `ai/secao`, `ai/bench`, `documentos/gerar` e
  `documentos/editar`; `60` em `taq/turno`).
- `server/docs/deploy.md` ainda descreve o corpo do runbook com os cliques do
  Railway (host anterior); use-o como lista do **que** configurar, não de onde
  clicar. A seção 5 dele (tempo de execução) está desatualizada em relação à
  Vercel, e os comentários "INERTE" nas rotas voltaram a ser falsos: ainda não
  revistos.
- `DATABASE_URL` tem que ser o endereço do **pooler** da Supabase, não a
  conexão direta (o texto de erro de `lib/conector/banco.ts` ainda cita o
  Railway). O pool é criado de forma preguiçosa, um por processo.
- A chave do provedor precisa ser **paga**: no free tier o conteúdo vai para
  treinamento; `DOCCITI_DATA_POLICY=training` exige `sintetica: true`, que a
  extensão não envia (400 em toda geração). Não definir em produção.
- Depois de qualquer deploy: `node scripts/smokePdf.mjs` em `server/` com
  `SMOKE_BASE_URL` e `DOCCITI_SHARED_KEY`. Não gasta cota. Um 200 na home não
  prova nada.
- Variável de ambiente só vale a partir do próximo deploy. Trocar
  `DOCCITI_SHARED_KEY` exige reconstruir a extensão (o valor está no bundle).

### Variáveis do servidor (só nomes e funções)

| Nome | Função |
| --- | --- |
| `DOCCITI_SHARED_KEY` | Segredo do header `x-docciti-key`. Ausente = 500 (falha fechada). Desde o commit `09e99ab` é ponte para as extensões antigas. |
| `DOCCITI_CHAVE_LEGADA` | `recusar` desliga a ponte do segredo nas rotas de IA (só o `id_token` do Google vale). |
| `TAQCITI_IA_CHAMADAS_DIA`, `TAQCITI_IA_CARACTERES_DIA` | Tetos diários por pessoa das rotas de IA (padrão 2.000 chamadas e 80 milhões de caracteres). |
| `TAQCITI_TOKEN_INATIVO_DIAS` | Dias sem uso depois dos quais um token do conector deixa de valer (padrão 90). Cada uso renova o prazo; no máximo 5 tokens ativos por pessoa (409 ao passar). |
| `DOCCITI_DIAGNOSTICO` | `ligado` reabre as rotas `/api/ai/{secao,smoke,bench}` em produção (404 sem ela); usar só pontualmente. |
| `DOCCITI_DATA_POLICY` | `private` (chave paga) ou `training`. **Desde o commit `bcb3355`:** em produção é OBRIGATÓRIA (sem ela as rotas de geração respondem 503 e o Taq fica `configuracao_pendente`), e o `sintetica: true` do cliente deixa de valer em produção. Ver `servidor-documentos.md`, seção 8. |
| `DATABASE_CA` | PEM da CA da Supabase; liga a validação do certificado TLS do banco (sem ela, aviso no log a cada instância). |
| `TAQCITI_EXIGIR_HD` | `sim` exige o claim `hd` no `id_token` do login. |
| `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `GROQ_API_KEY` | Chaves dos provedores de IA. |
| `LLM_PROVIDER`, `DOCCITI_LEITOR`, `DOCCITI_AUDITOR` (`DOCCITI_PENSANTE` vale pelo Leitor) | Escolha de provedor/modelo (`provedor:modelo`). |
| `MOCK_LLM` | Força o provedor mock; só para testes. |
| `DOCCITI_DATA_POLICY` | Política de dados (ver acima). |
| `DOCCITI_MAX_TRANSCRIPT_CHARS` | Teto da transcrição por requisição (413 acima). |
| `DOCCITI_RATE_LIMIT_RETRIES`, `GROQ_TPM_LIMIT` | Espera por 429 do provedor. |
| `DOCCITI_TIMEZONE` | Fuso da data da reunião. |
| `DATABASE_URL` | Postgres do acervo sincronizado. |
| `GOOGLE_OAUTH_WEB_CLIENT_ID`, `TAQCITI_DOMINIO_PERMITIDO` | Identidade por Google e domínio aceito. |
| `TAQCITI_COTA_MB`, `TAQCITI_LIMITE_BANCO_MB` | Cotas do acervo. |
| `DOCUMENTOS_LIVE`, `DOCUMENTOS_AMOSTRAS`, `DOCUMENTOS_RACIOCINIO_GERACAO`, `DOCUMENTOS_RACIOCINIO_EDICAO`, `DOCCITI_LIVE_TESTS` | Só testes. |
| `SMOKE_BASE_URL` | Alvo do `smokePdf.mjs`. |

Há um `server/.env.example` no repositório; não foi lido ao escrever este
documento.

## 9. Armadilhas conhecidas (registradas em comentários e docs)

- **Instalador quebrado por localhost** (v2.0.0): a URL e a chave entram no
  bundle na build; sem as variáveis o padrão é `localhost:3000`. Um instalador
  errado não tem conserto, só outra release. Conferir procurando `localhost:3000`
  em `assets/*.js` da pasta instalada.
- **Windows, Pascal Script do Inno**: comentário `{ ... }` não aninha, então
  uma constante `{pf32}` dentro dele fecha o comentário (erro "Unknown
  identifier 'costuma'"); não há `const` local em função, só `var`; o
  `install-path.js` sai em ASCII (`\uXXXX`) porque a conversão por code page
  estragava acentos.
- **pdfkit em produção**: fora do bundle (`serverExternalPackages`); só a prova
  de fumaça contra `next start` pega.
- **PGlite nos testes do servidor**: boot lento em paralelo, daí os timeouts altos.
- **Prompts no servidor**: instruções de sistema são versionadas no servidor e
  a extensão pede pelo nome; versão nova (ex.: `conducao-v1`, `copilot-v2`)
  exige **publicar o servidor antes da extensão**, senão "Versão de instruções
  desconhecida". Lista de pendentes em `docs/segundo-cerebro.md`.
- **Tag com dois números** não dispara a release.
- **Drive**: `TaqCiti.zip` tem nome fixo e sobrescreve; instaladores soltos
  antigos continuam lá e param de ser atualizados.
- **Rotas de IA: identidade e cota, com ponte** (commit `09e99ab`): `autorizarIa`
  identifica quem chama pelo `id_token` do Google e conta o uso por pessoa por dia
  (`uso_de_ia`); o segredo compartilhado continua valendo só enquanto
  `DOCCITI_CHAVE_LEGADA` não for `recusar`. **Ordem de desligamento:** (1) todas as
  instalações na versão que manda o token; (2) `DOCCITI_CHAVE_LEGADA=recusar`; (3) só
  então rotacionar `DOCCITI_SHARED_KEY` (rotacionar antes quebra quem ainda não
  atualizou, porque a chave está nos instaladores entregues). Não há `middleware.ts`
  (conferido); a tranca é a chamada a `autorizarIa` em cada rota. As rotas de
  diagnóstico respondem 404 em produção.
- **Anthropic e xAI** nunca foram exercitados contra a API real, só contra os
  tipos dos SDKs (`server/docs/divida-verificacao-provedores.md`, estado de
  12/08/2026; pode ter mudado depois, não verificado).
- **PowerShell e git** (convenção local): mensagens de commit com aspas
  quebram no PowerShell 5.1; usar `git commit -F arquivo`.

## 10. Checklist antes de publicar

- [ ] `npm run typecheck`, `npm run lint`, `npm test` e `npm run build` na raiz.
- [ ] Em `server/`: `npm run typecheck`, `npm test`, `npm run build`.
- [ ] Se mexeu em PDF ou no bundle do servidor: `next start` local e
      `node scripts/smokePdf.mjs`.
- [ ] Se criou versão de instruções (prompt): servidor publicado primeiro.
- [ ] Esquema do banco aplicado antes do servidor, e servidor antes da extensão
      (ordem registrada para a sincronização). O `esquema.sql` do commit `09e99ab`
      acrescenta a tabela `uso_de_ia` e liga RLS em todas as tabelas: aplicar antes do
      servidor novo (sem a tabela a cota falha aberta, mas não conta).
- [ ] `DATABASE_CA` definida no host de produção (senão o TLS do banco segue sem
      validar o certificado).
- [ ] `DOCCITI_DATA_POLICY` declarada no host de produção (`private` só se a chave for
      paga). Sem ela o servidor de produção recusa gerar (503).
- [ ] Nenhuma build de produção da extensão sem `VITE_DOCCITI_SERVER_URL` em `https://`
      e chave que não seja a de dev (a trava do `vite.config.ts` recusa; o CI já passa
      valores fictícios no `env`, e um novo passo de build precisa repeti-los).
- [ ] Servidor de produção no ar e a prova de fumaça passa contra ele.
- [ ] `DOCCITI_SHARED_KEY` idêntica no host e no Secret do GitHub;
      `DOCCITI_SERVER_URL` com `https://`, sem `/` final.
- [ ] Versão igual em `package.json` e `manifest.config.ts`; tag `vX.Y.Z`.
- [ ] Decidir se a release deve levar os clientes OAuth (ver seção 3).
- [ ] CI verde na tag, inclusive `instalador-windows`.
- [ ] Baixar o `TaqCiti.zip`, conferir versão nos nomes dos três instaladores e
      no `COMECE_AQUI.html`; instalar e procurar `localhost:3000` no bundle
      (não pode aparecer).
- [ ] Rodar uma reunião de verdade até gerar o documento.
- [ ] Antes de ampliar a distribuição: teto de gasto nas contas dos provedores
      e decisão sobre `bench`/`smoke` (pendências de `docs/publicar-release.md`).
- [ ] Nada sensível em arquivos versionados: chaves, tokens, URLs de produção,
      IDs de conta.
