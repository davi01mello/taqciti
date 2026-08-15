# Medição de 2026-08-15 — o caminho da extensão, ponta a ponta

Esta execução mandou a `POST /api/generate` **exatamente o corpo que a
extensão monta** em `src/document/generateDocument.ts`: `transcript`, `title`,
`date` em ISO, `documentType`, e **sem** `sintetica`. É o teste do contrato do
frontend, não de um curl conveniente.

**Resultado: HTTP 200 em 165 segundos**, com os cinco campos que a extensão
consome — `title`, `content`, `documentData`, `html`, `questions`.

A transcrição é `../medicao-2026-08-14/transcricao.txt`, sintética.

| arquivo | o que é |
|---|---|
| `ata.md` | markdown, o que aparece na tela |
| `ata.html` | o que vai para o Google Docs, no estilo do modelo |
| `documentData.json` | a camada canônica de onde os dois saem |

## O que essa execução prova

- o pipeline inteiro fecha a partir do pedido da extensão;
- os três participantes sobreviveram à auditoria (Ana, Carlos e Beatriz) — a
  instabilidade da dívida 5 não apareceu desta vez;
- as duas armadilhas da transcrição continuaram fora de "Decisões tomadas".

## O que ela NÃO prova

**Não rodou na configuração ativa.** O Pensante rodou em
`gemini-3.5-flash-lite`, por override de ambiente, porque a cota diária do
`gemini-3.5-flash` já tinha sido consumida por uma tentativa anterior no mesmo
dia. A trava de política de dados também foi desligada por override, para o
corpo sem `sintetica` passar — nada disso tocou o `.env.local`.

**Acentuação: 0 de 4.** As quatro entradas de `topicsDiscussed` voltaram sem
acento. É a dívida 4, e esta execução confirma que ela é do `lite` no papel do
Pensante — o que reforça manter o Pensante no `flash`.

**Duas decisões, não três.** "Criar o índice composto" ficou de fora de novo,
como na execução 2 de 14/08. A transcrição registra a decisão explicitamente
("Cria o índice composto e roda de novo antes de qualquer coisa"), então é
omissão do Pensante, não ausência de evidência.
