# Diagnóstico — a base, sem os agentes

Esta pasta tem a infraestrutura do diagnóstico assistido: a biblioteca de
fontes, a estrutura que liga um insight à fonte que o sustenta, e as decisões de
quanto gastar para produzi-lo.

**Os agentes não estão aqui, e não é por esquecimento.** Não há prompt, não há
lógica de geração e não há chamada de busca web. O que existe é a base que eles
vão usar — e ela é testável sem gastar um centavo, que é o ponto.

```
referencias/
  tipos.ts          o schema de uma referência, e a validação dele
  biblioteca.ts     CRUD + busca por texto/categoria, sobre um arquivo JSON
  dados/            as referências semeadas (todas de exemplo)
rastreabilidade.ts  o insight sugerido: trecho → fonte → pergunta
custo/
  decisoes.ts       deveConsultarBiblioteca, deveBuscarWeb, formatarQueryWeb
  cache.ts          o cache de buscas, para não pagar duas vezes
  limite.ts         o teto de buscas por diagnóstico
```

## A biblioteca de referências

Uma referência é a fonte que sustenta um insight. `link` e `autor` são
obrigatórios: sem procedência, o produto estaria emprestando autoridade a uma
opinião do modelo.

As quatro categorias são as etapas de uma consultoria, e dizem **em que momento
da conversa** a fonte serve — não sobre o que ela fala:

| Categoria | Momento |
|---|---|
| `entender_dor` | Descobrir o problema real, antes de qualquer solução. |
| `definir_produto` | Transformar a dor em escopo: o que entra e o que fica de fora. |
| `avaliar_execucao` | Julgar o que já foi feito. |
| `conduzir_projeto` | Tocar o trabalho: prazo, papéis, risco, combinados. |

`tipo` separa o peso da fonte: `documentacao_oficial`, `pesquisa`, `opiniao`.
Colapsar os três num "segundo a literatura" seria emprestar autoridade que a
fonte não tem.

### Adicionar uma referência

Pelo código:

```ts
import { abrirBiblioteca } from '@/lib/diagnostico/referencias/biblioteca';

await abrirBiblioteca().criar({
  id: 'kebab-case-estavel',           // é o que o insight guarda para citar
  titulo: 'Título da fonte',
  autor: 'Pessoa ou instituição',
  link: 'https://…',                  // http(s); javascript: e file: são recusados
  data: '2025-04-09',                 // AAAA-MM-DD, e uma data que existe
  categoria: 'avaliar_execucao',
  assunto: 'palavras pelas quais a busca deve encontrá-la',
  tipo: 'pesquisa',
  quando_aplicar: 'Em que situação de reunião esta fonte ajuda.',
});
```

Ou editando `referencias/dados/referencias.json` à mão — é uma lista JSON, e o
formato é o mesmo. A leitura valida **toda** entrada e falha alto dizendo a
posição da que estiver errada; uma referência inválida nunca é ignorada em
silêncio.

O `id` é imutável: `atualizar()` não o troca, porque ele é o que insights já
emitidos guardaram para citar a fonte.

### As referências que já estão lá

Dezesseis, quatro por categoria, **todas fictícias** — título começando com
`[EXEMPLO]` e link em `example.org`. Existem para exercitar a estrutura, e um
teste garante que continuem se anunciando como exemplo: uma fonte de mentira que
passasse por real acabaria citada para um cliente.

### A busca

Texto puro: normaliza acento e caixa, quebra em termos, conta quantos aparecem
em título, assunto, autor e `quando_aplicar`. Ordena por termos encontrados, e
desempata pela data mais nova.

Não há semântica: procurar `dor` **não** encontra "problema do cliente". É
limitação conhecida — ver as pendências.

## Rastreabilidade

```ts
{
  id: 'insight-1',
  trecho_reuniao: { meetingId, captionId?, texto, falante?, offsetMs? },
  referencia_usada: 'id-da-referencia-na-biblioteca',
  pergunta_sugerida: 'O que perguntar ao cliente',
  tipo: 'hipotese' | 'confirmado',
  criado_em: '2026-09-21T00:00:00.000Z',
}
```

`hipotese` e `confirmado` não medem confiança do modelo, e sim **evidência**:
`confirmado` quer dizer que o trecho diz literalmente o que o insight afirma, e
`citacaoConfere()` verifica isso. A maioria dos insights será hipótese, e é
honesto que seja.

`referencia_usada` guarda o **id**, não uma cópia: um link corrigido na
biblioteca não pode continuar quebrado dentro de insights já emitidos. O preço é
que a fonte pode sumir, e `resolverFonte()` devolve uma falha explícita nesse
caso — nunca `undefined` — porque a interface promete um botão "Ver fonte" e um
insight sem procedência não pode ser desenhado como se tivesse uma.

## Controle de custo

Do mais barato para o mais caro: biblioteca local (grátis) → cache (grátis) →
busca web (paga, lenta, e sai da máquina com texto do cliente dentro).

```ts
const podeConsultar = deveConsultarBiblioteca(contexto);
const achados = podeConsultar.sim ? await biblioteca.buscar({ texto: contexto.assunto }) : [];

const podeBuscar = deveBuscarWeb(
  { ...contexto, temCache: cache.tem(query), buscasRestantes: limitador.restantes() },
  { quantidade: achados.length, melhorPontuacao: achados[0]?.termosEncontrados ?? 0 },
);
```

Toda decisão devolve `{ sim, motivo }`. O motivo é o que responde "por que este
diagnóstico custou três buscas?" — e o que impede a regra de virar um `if` que
ninguém entende depois.

### A consulta que sai da máquina

`formatarQueryWeb()` tira, nesta ordem: e-mail, URL, telefone, documento
(CPF/CNPJ/contrato), código de sala do Meet — e **depois** os nomes que o
chamador declarou em `nomesConfidenciais`, palavra por palavra. A ordem importa:
tirar o nome antes quebraria `bruno@cliente.com` em `@cliente.com`, que não casa
mais com o padrão de e-mail, e o domínio do cliente iria para o buscador.

**O que ela não garante:** que nada identificável escape. "A startup de entrega
de flores de Recife" não contém nome nenhum e identifica o cliente. O filtro
cobre o dado estruturado; o resto é decisão de produto — ver as pendências.

## O que depende de decisão sua

1. **Banco da biblioteca.** Hoje é um arquivo JSON, com `abrirBiblioteca(caminho)`
   como interface. Trocar por SQLite/Postgres é escrever outra implementação do
   mesmo objeto, sem tocar em chamador nenhum. Decidir quando — e se o conteúdo
   das fontes (não só o metadado) passa a ser guardado.
2. **Embeddings / RAG.** A busca é textual. Semântica muda o schema (vetor por
   referência), o armazenamento (banco vetorial ou extensão) e o custo (gerar
   embedding é chamada de modelo). Fora do escopo desta fase de propósito.
3. **Provedor de busca web.** Nenhum foi escolhido nem integrado. O limitador e
   o cache existem; o executor, não.
4. **O teto de buscas.** `3` por diagnóstico é palpite pelo formato do problema,
   não medição. Configurável em `DIAGNOSTICO_MAX_BUSCAS`.
5. **Até onde vai a anonimização.** Hoje: dado estruturado + nomes declarados.
   A decisão pendente é se texto de reunião pode ir para um buscador de
   terceiros **de qualquer forma** — e, se puder, se o cliente precisa consentir.
6. **Onde os insights são guardados.** `rastreabilidade.ts` define o tipo; não
   há armazenamento. Provavelmente junto da reunião, mas isso é decisão de
   produto (eles vivem com a reunião? com o diagnóstico? por quanto tempo?).
7. **Modelos e preços da OpenAI.** Ver as pendências em `lib/ai/README.md`.
