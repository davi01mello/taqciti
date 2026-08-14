# Medição de 2026-08-14 — primeiras Atas geradas de ponta a ponta

Artefatos de **duas execuções da mesma transcrição, com o mesmo modelo**. Estão
versionados porque as ressalvas se perdem se ficarem só na conversa, e porque a
diferença entre as duas é a evidência de uma instabilidade real.

**Nada aqui é registro de reunião real.** `transcricao.txt` foi inventada para
esta medição.

| arquivo | o que é |
|---|---|
| `transcricao.txt` | a entrada, sintética, 3.358 caracteres |
| `execucao-1-ata.md` | a Ata em markdown da primeira execução |
| `execucao-1-secao.json` | resposta de `/api/ai/secao` em quatro seções: métricas de citação, custo, descartes |
| `execucao-2-ata.md` | a Ata em markdown da segunda execução |
| `execucao-2-ata.html` | o **HTML**, renderizado do `DocumentData` — regerado em 15/08 com o estilo do modelo institucional, a partir do mesmo `documentData` |
| `execucao-2-documentData.json` | o JSON intermediário — a camada canônica de onde HTML e PDF saem |

Só a execução 2 tem HTML e `documentData` porque só ela rodou depois de eles
serem expostos na resposta de `/api/generate`.

## O que a transcrição testa

Duas armadilhas plantadas, as duas de proposta-que-não-virou-decisão:

- **desnormalizar a tabela de lançamentos** — proposta pela Beatriz e
  explicitamente descartada ("vamos deixar de lado por enquanto");
- **ambiente de homologação separado** — pedido pelo Carlos e adiado por falta
  de orçamento ("vamos pensar nisso no próximo ciclo").

**Nenhuma das duas entrou em "Decisões tomadas" em nenhuma das execuções.** As
concordâncias registradas na execução 2 estão ancoradas e são as certas — "Por
mim está fechado. 28 me parece realista." é o Carlos aceitando *aquela*
proposta, não uma concordância vizinha.

## O que muda entre as duas execuções, e por quê importa

Mesma transcrição, mesmo modelo, resultados diferentes:

| | execução 1 | execução 2 |
|---|---|---|
| Participantes | Ana, Carlos e Beatriz | **só Beatriz** |
| Decisões | 3 | 2 (falta "criar o índice composto") |
| Acentuação em `topicsDiscussed` | correta | **toda perdida** |

**Participantes.** Na execução 2 o Pensante devolveu Ana e Carlos sem nenhuma
citação, e o Auditor os descartou corretamente ("Nenhuma citação localizável
sustenta esta afirmação"). Duas pessoas que obviamente participaram sumiram da
seção — e no HTML dá para ver o resultado: uma lista com um nome só, seguida de
quatro marcadores de lacuna. O Auditor está certo; quem falha é o Pensante, ao
não citar. É a dívida 5 do [handoff](../HANDOFF.md).

**Acentuação.** Na execução 2, as quatro entradas de `topicsDiscussed` voltaram
sem nenhum acento ("integracao", "documentacao", "modulo"). É a dívida 4 — a
mesma corrupção que devolveu "gesto" por "gestão" no bench — e ela acontece
também no `flash-lite`.

Mas com uma ressalva que muda o tamanho do problema: **na mesma chamada, as 20
citações vieram acentuadas e todas as 20 localizaram.** O modelo corrompeu a
paráfrase que ele escreve e preservou a citação que ele copia. Isso é bom para
a âncora e ruim para o documento: a ata sai sem acento no corpo do texto, o que
é problema de qualidade voltado ao cliente, não de auditoria.

## Três ressalvas sobre as duas

1. **Não rodou na configuração ativa.** Pensante e Escritor rodaram em
   `gemini-3.5-flash-lite`, via `DOCCITI_PENSANTE` e `DOCCITI_ESCRITOR`, porque
   a cota diária do free tier no `gemini-3.5-flash` (20 requisições por dia)
   acabou na primeira tentativa. As gerações levaram 99s e 123s.

2. **O cache não deu hit.** `cachedInputTokens: 0` em `execucao-1-secao.json`.
   A transcrição tem ~1.000 tokens, abaixo do piso de cache implícito do
   provedor — o mesmo motivo que derrubava o cache no contexto compactado. O
   ganho que motivou o corte da compactação continua **não medido**, e só sai
   com uma fixture de 30 mil caracteres para cima.

3. **A Conclusão da execução 2 traz citações literais da transcrição dentro da
   prosa.** Elas vieram do Pensante, dentro do campo `conclusion.text` — o
   Escritor só redigiu o que recebeu. O `guidance` pede "um único parágrafo
   executivo", e transcrever fala não é isso. Não corrigido.

## Se for reaproveitar como fixture

`transcricao.txt` serve como fixture do harness da Fase 8: é sintética, tem as
armadilhas plantadas, e as duas execuções acima dão a faixa de variação
esperada. Para medir cache ela não serve.
