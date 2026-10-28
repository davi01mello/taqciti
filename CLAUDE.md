# TaqCiti — guia para quem mexe no código (e para o Claude Code)

Este arquivo é o que se precisa saber ANTES de editar. O detalhe de cada área está em
`docs/arquitetura/` (índice em `docs/README.md`). Em caso de dúvida entre este arquivo e o
código, vale o código — e vale corrigir este arquivo.

## O que é

Extensão do Chrome/Edge (MV3) que transcreve reuniões do Google Meet a partir das
legendas, guarda tudo no próprio navegador e gera documentos com ajuda de um servidor.
O **Taq** é o assistente de IA dentro da extensão.

Dois projetos independentes, cada um com seu `package-lock.json`:

| Pasta | O que é | Stack |
|---|---|---|
| `/` (raiz) | A extensão | Vite + @crxjs, React, TypeScript, Tailwind, vitest + jsdom |
| `server/` | Servidor de documentos, conector MCP e sincronização | Next.js (versão com mudanças incompatíveis), TypeScript, Postgres, vitest |

## Comandos

Raiz (extensão):

```
npm run dev          # vite
npm run build        # build de produção → dist/ (ver a trava abaixo)
npm run build:dev    # build de desenvolvimento → dist-dev/ (use este contra o servidor local)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src
npm test             # vitest run (jsdom)
npm run package      # empacota a release
```

`server/`:

```
npm run dev | build | start
npm run typecheck
npm test                 # vitest run (node). Se faltar memória: npx vitest run --maxWorkers=3
npm run test:live        # testes que falam com servidor/banco de verdade (exigem configuração)
```

Antes de dar uma mudança por pronta: `typecheck` + `lint` + `test` do projeto que você
tocou. O CI roda os dois projetos a cada push (`.github/workflows/ci.yml`).

> **Trava da build de produção (desde 21/10/2026, commit `923ea5a`).** O `vite.config.ts`
> recusa `npm run build` se `VITE_DOCCITI_SERVER_URL` não for `https://` ou se
> `VITE_DOCCITI_SHARED_KEY` faltar ou for a de desenvolvimento. Sem o `.env`, a build
> local cairia em `http://localhost:3000` em silêncio. Para testar contra o servidor local,
> use `npm run build:dev`. O CI passa valores fictícios no `env` dos passos de build
> (`Extensão (raiz)` e `Instalador Windows`); um novo passo de build de produção precisa
> repeti-los. Detalhe em `docs/arquitetura/build-release-operacao.md`.

## Onde mora o quê

- **Captura da reunião, cápsula, sidebar, estados** → `src/content/`, `src/background/`,
  `src/features/meeting/`. Doc: `docs/arquitetura/extensao-captura.md`.
- **Telas** (Home, sidebar, página do documento) → `src/home/`, `src/sidepanel/`,
  `src/document/`, `src/shared/ui/`. Doc: `docs/arquitetura/extensao-interface.md`.
- **O assistente Taq** → `src/features/taq/` (+ `acompanhamento`, `apoio`, `calibracao`,
  `conducao`, `estado`, `trabalho`) e `server/lib/taq/`. Doc: `docs/arquitetura/taq-assistente.md`.
- **Geração de documentos** → `server/lib/` (`generateDocument`, `agents/`, `templates/`,
  `documentos/`, `render/`, `ai/`, `prompts/`). Doc: `docs/arquitetura/servidor-documentos.md`.
- **Conector MCP, sincronização, Google** → `server/lib/conector/`, `src/features/sync/`,
  `src/features/integracoes/`. Doc: `docs/arquitetura/conector-sync-integracoes.md`.
- **Build, CI, release, instaladores, deploy** → `docs/arquitetura/build-release-operacao.md`.

## Convenções

- **Nomes e comentários em português.** Identificadores de domínio em português
  (`derivarEstadoDaCaptura`, `guardarFidelidade`); termos técnicos de plataforma em inglês.
- **O comentário de topo do arquivo diz o PORQUÊ**, inclusive o que já deu errado. Ao mudar
  uma decisão, atualize o comentário no mesmo commit. Escreva código que se parece com o
  vizinho: mesma densidade de comentário, mesmos nomes, mesmo estilo.
- TypeScript estrito, com `noUnusedLocals` e `noUnusedParameters`: código morto não passa
  no `typecheck`. Ao remover algo, remova também o import e o teste que só o exercitava.
- Teste ao lado do código (`arquivo.test.ts`). Teste que fixa uma decisão deve explicar a
  decisão no comentário — foi assim que vários bugs voltaram a ser pegos.
- Texto para o usuário: português do Brasil, sem jargão de implementação.

## Regras que já custaram caro

1. **Abrir a sidebar a partir da página.** `chrome.sidePanel.open()` exige gesto do
   usuário, e o gesto NÃO sobrevive a um `await` antes da chamada. Em `src/background/`
   a chamada tem de ser a primeira coisa do handler, e `abrir()` na cápsula não é `async`.
2. **Next.js do `server/` não é o que você conhece.** Leia `server/AGENTS.md` e o guia
   em `node_modules/next/dist/docs/` antes de escrever código Next.
3. **Prompts são versionados por arquivo.** Versão nova é arquivo novo
   (`lib/prompts/<agente>/vN.md`), nunca edição no lugar: o resultado dos testes fica
   atrelado à versão. O guidance de cada seção chega ao modelo íntegro, nunca reescrito.
4. **Prompt novo no servidor: publicar o servidor antes da extensão.** A extensão não
   escolhe versão de prompt, mas depende do comportamento que ele define.
5. **Teste verde não prova o PDF.** Mudou o render? Gere o PDF e OLHE as páginas
   (rasterize). Foi assim que acharam numeração dobrada, data recuada e horário quebrado.
6. **Teste unitário não fala com a rede.** `src/test/semRede.ts` desliga o `fetch`; só os
   testes `*.live.test.ts` (ativados por `TAQ_LIVE_URL`) usam a rede.
7. **Sem `[A preencher: …]` em documento de cliente.** Campo ausente simplesmente não
   entra. Só uma lacuna marcada `extrema` (`Gap.extrema`) vira pergunta ou aparece.
8. **Fidelidade vem antes de estilo.** Cargo, gravidade e causa não se deduzem; hipótese
   não vira fato; responsável só se alguém o assumiu. As guardas estão em
   `server/lib/guardaDeFidelidade.ts` e valem para o catálogo e para os documentos
   personalizados. O Auditor confere as seções marcadas `strict`.
9. **Cota de IA.** Os provedores têm cota diária por MODELO. O plano gratuito da Groq
   (8000 tokens/min) só comporta documentos de uma seção. Para iterar sem gastar cota,
   salve o `documentData` de uma geração real e re-renderize a partir dele.
10. **Rota nova que gasta modelo passa por `autorizarIa`** (`server/lib/guardaDeIa.ts`),
    nunca só pelo segredo compartilhado: o segredo está dentro do bundle da extensão.
    `autorizarIa` identifica pelo `id_token` do Google e conta a cota diária por pessoa;
    `{ cobrar: false }` para rota que exige identidade mas não chama modelo. O segredo é
    só uma ponte (`DOCCITI_CHAVE_LEGADA=recusar` a desliga). Rota de diagnóstico não
    pode existir em produção (`diagnosticoForaDoAr`).
11. **O Taq separa apagar de escrever.** O efeito `exclusao` (apagar, renomear registro
    existente) só é liberado quando o pedido da PESSOA nomeia a operação; `escrita_local`
    não o libera. Texto de transcrição é dado, nunca instrução: uma fala injetada não pode
    ganhar ferramenta. (Commit `923ea5a`.)
12. **A extensão não confia em quem manda.** O content script é declarado só para
    `https://meet.google.com/*` (não volte a `<all_urls>`); o background confere o
    remetente de cada mensagem (`src/background/remetente.ts`); a cápsula só age com
    clique real (`isTrusted`); link escrito pelo modelo passa por `destinoSeguro` (domínio
    visível, sem query fora de `google.com` e `citi.org.br`). (Commit `923ea5a`.) O plano
    completo está em `docs/plano-de-seguranca.md`.
13. **Política de dados declarada em produção.** `DOCCITI_DATA_POLICY` é obrigatória
    (`private` para chave paga, `training` para a que treina) quando `VERCEL_ENV` é
    `production`: sem ela as rotas de geração respondem 503 e o Taq fica pendente. O
    `"sintetica": true` do cliente não fura a trava lá (só em desenvolvimento). Texto de
    fonte que contém `### FONTE` no começo de linha é neutralizado antes de ir ao prompt.
    (Commit `bcb3355`.)

## Trabalhar com git neste repositório

- Pode haver OUTRA sessão (humana ou de agente) na mesma árvore: `git add` só com
  **caminhos explícitos**, nunca `-A` nem `.`.
- Mensagem de commit longa ou com aspas: grave num arquivo e use `git commit -F arquivo`
  (o PowerShell 5.1 quebra mensagens com aspas; `&&` também não existe nele).
- Commit e push direto na branch ativa. As branches `release/1.0` e `release/1.5` são
  produtos congelados: nunca commitar nelas.
- Caminho relativo em `[IO.File]` ignora o `cd` do shell: use sempre caminho absoluto.

## O que NUNCA vai para o repositório

Este repositório é **público**.

- Chaves de API, tokens, `server/.env.local`, `.env` (já ignorados; não os copie para docs).
- Conteúdo de reunião real: transcrições, documentos gerados dela, nomes de participantes
  ou de clientes. Fixtures e exemplos usam dados inventados.
- IDs e URLs de conta de nuvem, de projeto e de deploy: a documentação descreve variáveis
  de ambiente só pelo NOME e pela função.
- PDFs de amostra de reunião real ficam em `docs/amostras-locais/`, que está no
  `.git/info/exclude` local — não adicione `-f`.

## Estado e próximos passos

- Desenho das melhorias de conteúdo dos documentos (fidelidade, estrutura por tipo,
  layout curto): `docs/redesenho-dos-documentos.md`. Fidelidade implementada. Desde
  28/10/2026 o produto foca em **Ata e Resumo** (decisão do usuário), e os dois têm a
  estrutura nova (resumo executivo, atuação, encaminhamentos, em aberto); os outros
  tipos ficam como estão. Exemplos em PDF: `docs/exemplos/`. Teste ao vivo:
  `ATA_LIVE=1 npx vitest run lib/documentos/ataResumo.live.test.ts` (em `server/`).
- Plano de segurança: `docs/plano-de-seguranca.md`. Commitadas: a fase 1 (servidor,
  `09e99ab`: identidade e cota por pessoa nas rotas de IA, RLS, TLS do banco, tetos), a
  fase 2 (extensão, `923ea5a`: content script só no Meet, barreira de remetente, efeito
  `exclusao`, link seguro, trava de build) e a fase 3 (`bcb3355`: política de dados
  obrigatória em produção, MCP somente leitura, expiração dos tokens do conector,
  delimitador de fonte). A fase 4 (cadeia de suprimento) foi feita em parte (`1d5dee5`:
  actions por SHA, permissões mínimas, versão validada, SHA256SUMS, payload do macOS);
  faltam versão fixa de `innosetup`/`makeself`, *environment* com aprovação, escopo da
  conta do Drive e assinatura dos instaladores. A fase 5 (decisões estruturais) não começou. **Antes de publicar o servidor:** definir
  `DOCCITI_DATA_POLICY` no host de produção.
- Documentos personalizados: `docs/documentos-personalizados.md`.
- Release e instaladores: `docs/publicar-release.md`.
