# Gabarito — `reuniao-longa-ruidosa.txt`

Fixture sintética, escrita para medir o pipeline contra uma reunião que se
parece com reunião de verdade: gente falando por cima, palavra trocada,
assunto que morre, piada, número dito errado, e decisão que é revertida vinte
minutos depois.

**Sem este arquivo a fixture não vale nada**, porque "o modelo acertou?" só tem
resposta se alguém escreveu antes qual era o acerto.

## As armadilhas plantadas

### 1. Decisão revertida — SÓ A ÚLTIMA VALE

A reunião decide contratar dois estagiários ("Então fechado, dois estagiários.
Eu abro a vaga essa semana"), e depois volta atrás explicitamente ("Vamos
voltar atrás. A gente não contrata estagiário agora").

- ✅ **certo:** "Não contratar estagiários agora; revisitar em outubro"
- ❌ **errado:** listar "Contratar dois estagiários" como decisão
- ❌ **errado:** listar as duas

### 2. Decisão por INSTRUÇÃO aceita

"Rafael: Bruno, sobe o monitoramento até quarta." / "Bruno: Pode deixar."

Não é proposta aceita — é ordem aceita. É decisão do mesmo jeito, e foi o caso
que o prompt `v2` perdia (ver dívida do handoff sobre o índice composto).

- ✅ **certo:** aparece como decisão
- ❌ **errado:** omitir por não ter a forma "proposta + concordância"

### 3. Proposta NÃO aceita

Kubernetes. Todos acham interessante, ninguém fecha: "Eu não diria não. Eu
diria não agora." / "Vamos deixar como possibilidade pro ano que vem."

- ✅ **certo:** não é decisão
- ❌ **errado:** virar "Migrar para Kubernetes"

Cuidado extra: a palavra aparece escrita errada ("cubernetes") na primeira
menção, corrigida na fala seguinte. Uma citação copiada da forma errada
**deve** falhar a ancoragem — é o comportamento correto.

### 4. Contradição NÃO resolvida

Letícia diz que o banco aguenta 500 req/s; Bruno mediu 200. Descobrem que os
ambientes são diferentes, chegam a 400, e encerram sem resolver: "Alguma coisa
tá errada numa das duas medições." / "Não sei." / "Também não sei."

- ✅ **certo:** não apresentar nenhum número como acordado; se registrar, é
  como divergência em aberto
- ❌ **errado:** afirmar "o banco suporta 500" ou "o banco suporta 200"

### 5. Número dito errado e corrigido

"O orçamento do trimestre pro Atlas é de oitenta mil." → "ah não, desculpa.
Cento e oitenta mil. Eu falei errado."

- ✅ **certo:** 180 mil, se o número aparecer
- ❌ **errado:** 80 mil

### 6. Assunto que MORRE

Letícia levanta LGPD. Rafael responde "Deixa eu ver isso" e o assunto acaba.

- ✅ **certo:** no máximo uma pendência; nunca uma decisão
- ❌ **errado:** virar tópico com conclusão

### 7. Ruído puro

Café, o pênalti, "eu abri" / "abrir não conta", o `if` do CNPJ que ninguém
entende, `[inaudível]`, `[ruído]`, fala cortada ("cortou").

- ✅ **certo:** nada disso vira tópico nem decisão
- ⚠️ o `if` do CNPJ é limítrofe: é anedota, mas ilustra o problema real de
  documentação. Aceitável dentro de um tópico; ruim como tópico próprio.

### 8. Erro de reconhecimento de voz

"cubernetes" (corrigido em seguida), "diploi" por deploy. O Pensante deve
copiar a citação **como está** — inclusive o erro — se for citar aquele
trecho.

## Decisões que a ata DEVE conter

O próprio Rafael recapitula no fim, o que dá um gabarito dentro da própria
transcrição:

1. Adiar o go-live de 10/09 para 24/09
2. Não contratar estagiários agora; revisitar em outubro
3. Bruno sobe o monitoramento até quarta
4. Tema escuro fora do escopo do go-live
5. Bruno e Letícia dividem o code review a partir de amanhã
6. Bruno envia a planilha dos onze casos de borda

**Seis.** Menos que isso é omissão; mais que isso provavelmente é proposta
promovida a decisão.

## Participantes e cargos

| pessoa | cargo | de onde vem |
|---|---|---|
| Rafael | Coordenador de produto | dito na reunião ("O coordenador de produto." / "Exatamente, coordenador.") |
| Letícia | — | nunca dito; **deve virar lacuna** |
| Bruno | — | nunca dito; **deve virar lacuna** |
| Sandra | — | trabalha com orçamento, mas o cargo nunca é dito; **lacuna** |
| Diego | — | fala de design, mas o cargo nunca é dito; **lacuna** |

Marcelo aparece citado ("gerente de operações") mas **não participou da
reunião** — é do cliente. Incluí-lo como participante é erro.

## Em aberto ao fim da reunião

- ambiente de homologação de verdade (~3 mil/mês, depende da Sandra)
- a divergência do teste de carga
- LGPD / retenção de log de acesso
- o impacto financeiro do adiamento, que a Sandra ia levantar

## Por que ela também serve para medir cache

~24 mil caracteres, ~6 mil tokens — bem acima do piso de cache implícito do
provedor (2.048 na família 2.5 do Gemini). É a primeira fixture do repo grande
o bastante para a dívida do cache ser mensurável: com a transcrição indo como
`cacheablePrefix` nas nove chamadas do Pensante, `cachedInputTokens` **precisa**
sair diferente de zero a partir da segunda seção.
