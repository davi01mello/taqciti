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
npm run build        # build de produção → dist/
npm run build:dev    # build de desenvolvimento → dist-dev/
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
  layout curto): `docs/redesenho-dos-documentos.md`. A fase de fidelidade está
  implementada; as demais estão desenhadas e não começaram.
- Documentos personalizados: `docs/documentos-personalizados.md`.
- Release e instaladores: `docs/publicar-release.md`.
