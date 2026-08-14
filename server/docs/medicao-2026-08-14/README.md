# Medição de 2026-08-14 — primeira Ata completa gerada de ponta a ponta

Artefatos da execução que fechou a Fase 5. Estão versionados porque são a
única prova de que o pipeline gerou um documento inteiro, e porque as três
ressalvas abaixo se perdem se ficarem só na conversa.

**Nada aqui é registro de reunião real.** `transcricao.txt` foi inventada para
esta medição, e `ata.md` é o que o pipeline fez com ela.

| arquivo | o que é |
|---|---|
| `transcricao.txt` | a transcrição sintética de entrada, 3.358 caracteres |
| `ata.md` | a Ata gerada, nove seções, markdown |
| `ata.json` | a resposta crua de `POST /api/generate` (`title` + `content`) |
| `secao.json` | a resposta de `POST /api/ai/secao` em quatro seções, com as métricas de citação, o custo e o que foi descartado |

## O que a transcrição testa

Duas armadilhas plantadas de propósito, as duas de proposta-que-não-virou-decisão:

- **desnormalizar a tabela de lançamentos** — proposta pela Beatriz e
  explicitamente descartada na conversa ("vamos deixar de lado por enquanto");
- **ambiente de homologação separado** — pedido pelo Carlos e adiado por falta
  de orçamento ("vamos pensar nisso no próximo ciclo").

Nenhuma das duas aparece em "Decisões tomadas" na `ata.md`. As três decisões
reais (índice composto, adiamento para 28/08, cancelamento da demo) aparecem.

Cargo sem evidência na reunião virou `**[A preencher: ...]**` visível — Ana e
Carlos não dizem o que fazem; a Beatriz diz ("como eu sou a arquiteta de
integração aqui") e o cargo dela foi preenchido.

## Três ressalvas, e elas importam

1. **Não rodou na configuração ativa.** Pensante e Escritor rodaram em
   `gemini-3.5-flash-lite`, via `DOCCITI_PENSANTE` e `DOCCITI_ESCRITOR`, porque
   a cota diária do free tier no `gemini-3.5-flash` (20 requisições por dia)
   tinha acabado na primeira tentativa. A geração levou 99 segundos.

2. **O cache não deu hit.** `cachedInputTokens: 0` em `secao.json`. A
   transcrição tem ~1.000 tokens, abaixo do piso de cache implícito do
   provedor — o mesmo motivo que derrubava o cache no contexto compactado. O
   ganho de cache que motivou o corte da compactação continua **não medido**, e
   só sai com uma fixture sintética longa (30 mil caracteres para cima).

3. **`secao.json` registra uma falha real.** Naquela execução o Pensante
   devolveu Ana e Carlos sem nenhuma citação, e o Auditor os descartou
   corretamente ("Nenhuma citação localizável sustenta esta afirmação"). Duas
   pessoas que obviamente participaram sumiram da seção. Na execução que gerou
   `ata.md`, com a mesma transcrição e o mesmo modelo, elas apareceram. É
   intermitente, e o comportamento do Auditor está certo — quem falha é o
   Pensante, ao não citar. Ver a dívida 5 do [handoff](../HANDOFF.md).

Taxa de âncoras nas seções medidas: 100% (1/1, 11/11, 8/8, 0/0). Quando o
Pensante cita, a citação existe na transcrição.

## Se for reaproveitar como fixture

`transcricao.txt` serve como fixture do harness da Fase 8 — é sintética, tem as
armadilhas plantadas e o resultado esperado está descrito acima. O que ela
**não** serve é para medir cache, pelo motivo 2.
