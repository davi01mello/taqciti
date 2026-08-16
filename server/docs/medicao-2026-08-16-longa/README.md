# Medição de 2026-08-16 — reunião longa e ruidosa, na configuração ativa

Primeira execução do pipeline contra uma reunião que se parece com reunião de
verdade, **no `gemini-3.5-flash`** (Pensante) e com o prompt `v3`.

Entrada: [`../fixtures/reuniao-longa-ruidosa.txt`](../fixtures/reuniao-longa-ruidosa.txt),
13.943 caracteres, com as armadilhas descritas no
[gabarito](../fixtures/reuniao-longa-ruidosa.gabarito.md).

Cinco seções (`identificacao`, `participantes`, `topicos_discutidos`,
`decisoes`, `conclusao`) em **202 segundos**. O documento completo não fechou:
a cota diária do free tier acabou na tentativa seguinte.

## Decisões: 6 de 6, e zero falso positivo

O gabarito prevê exatamente seis. Saíram exatamente seis, todas com a
concordância **ancorada**:

| decisão | concordância citada |
|---|---|
| Adiar o go-live de 10/09 para 24/09 | "Por mim tá ótimo. Vinte e quatro dá." |
| Cancelar a contratação de estagiários, reavaliar em outubro | "Perfeito." |
| Subir o monitoramento até quarta | "Pode deixar. Quarta tá tranquilo." |
| Tema escuro fora do escopo do go-live | "Fechado." |
| Dividir o code review entre Letícia e Bruno | "Fechado." |
| Enviar a planilha dos casos de borda | "Mando hoje." |

**As três armadilhas principais foram barradas:**

1. **Reversão respeitada.** A reunião decide contratar dois estagiários e volta
   atrás vinte minutos depois. Só a última posição entrou. "Contratar dois
   estagiários" **não** aparece.
2. **Decisão por instrução aceita capturada.** "Bruno, sobe o monitoramento até
   quarta" / "Pode deixar" não tem a forma proposta+concordância, e era
   exatamente o caso que o prompt `v2` perdia. O `v3` pegou.
3. **Kubernetes não virou decisão.** Foi discutido, todos acharam interessante,
   ninguém fechou — e ficou fora.

Também ficaram fora, corretamente: LGPD (assunto que morre), o ambiente de
homologação (depende de quem saiu da call) e a divergência do teste de carga
(contradição não resolvida).

## Participantes: os cinco certos, e o sexto que não entrou

| pessoa | cargo | origem |
|---|---|---|
| Rafael | Coordenador de produto | `meeting` |
| Letícia | — | `unknown` → lacuna |
| Bruno | — | `unknown` → lacuna |
| Sandra | — | `unknown` → lacuna |
| Diego | — | `unknown` → lacuna |

**Marcelo não foi incluído.** Ele é citado na reunião com cargo explícito
("gerente de operações"), mas é do cliente e não participou. Incluí-lo seria o
erro fácil, e o pipeline não caiu nele.

A seção `participantes` gastou **duas passadas**: o Auditor rejeitou algo na
primeira e a segunda corrigiu, sem nada descartado.

## Âncoras: 37 de 37

100% em todas as seções, zero citação não localizada, zero afirmação
descartada. Inclusive com "cubernetes" e "diploi" na transcrição — os erros de
reconhecimento de voz plantados de propósito.

## Cache: o primeiro número diferente de zero

```
inputTokens 47.521 | outputTokens 20.652 | cachedInputTokens 1.899
```

**É a primeira vez que `cachedInputTokens` sai de zero.** A dívida 2 do handoff
existia porque toda transcrição de teste anterior era pequena demais para o
piso de cache implícito do provedor; esta, com ~3.500 tokens, passou.

Mas o número é **muito menor que o esperado**. Com a transcrição indo como
prefixo idêntico em cinco chamadas, o teto teórico seria ~4 × 3.500 = 14.000
tokens cacheados. Vieram 1.899 — 13% disso, e 4% do input total.

O cache **funciona**; o ganho não é o que a arquitetura assumiu. Não trate a
dívida como fechada.

## Custo: a saída domina

Com preço de `flash` ($1,50 / $7,50 por MTok):

| | tokens | custo |
|---|---|---|
| entrada | 47.521 | $0,071 |
| **saída** | 20.652 | **$0,155** |

**Dois terços do custo são tokens de SAÍDA**, e a saída custa 5× a entrada.
Extrapolando para nove seções, um documento fica na casa de **$0,45**.

O que gera essa saída é o `thinkingLevel: HIGH` do Pensante. E ele está ligado
igual em todas as seções — inclusive em `identificacao`, que só extrai uma data
e um nome de projeto. **É aqui que está a próxima economia**, e é maior que
qualquer coisa do lado da entrada.

## O que esta medição NÃO prova

- **O documento completo não fechou.** Cinco seções de nove; as quatro
  restantes (`topico_geral`, `outcomes`, `outputs`, `assinatura`) não foram
  exercitadas nesta rodada, nem o HTML final.
- **Uma execução só.** As armadilhas foram barradas uma vez. A dívida de
  instabilidade (participante sumindo) não apareceu aqui, mas uma amostra não a
  desmente.
- **Acentuação.** Não houve perda nesta execução — o que é consistente com a
  hipótese de que o defeito é do `lite`, já que o Pensante rodou em `flash`.
  Ainda é uma amostra.
