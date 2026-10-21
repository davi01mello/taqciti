# Redesenho dos documentos: de "bonito" para "útil e confiável"

Estado em 20/10/2026. Estudo feito sobre a reunião real de alinhamento semanal (anonimizada), com os seis tipos do catálogo e um documento personalizado, no estilo da Apostila. O visual está resolvido. Este documento trata do que falta para o conteúdo ser usável sem revisão humana.

## 1. Diagnóstico: causas, não sintomas

| # | Sintoma visto | Causa-raiz (com evidência) |
|---|---|---|
| 1 | "perfil de diretoria" na Ata; coluna "Causa" inventada no personalizado | **O Auditor só confere o que está marcado `strict`.** Na Ata são só `participantes` e `decisoes`. Tópicos, outcomes e outputs são `light`; conclusão e tópico geral são `none`. A regra "cargo não se deduz" existe no prompt do Leitor, mas só é *aplicada* em participantes. Na transcrição "diretoria"/"diretor" aparecem **0** vezes; "causa" e "permiss" também **0**. |
| 2 | Atribuições mais firmes que a reunião ("A e D farão a limpeza") | Nenhuma regra de **quem é responsável**: o Leitor não distingue "assumiu" ("eu faço", "vou ver") de "alguém comentou". |
| 3 | "vou mandar logo" virou "logomarca" | A unidade conferida é o **parágrafo inteiro** de um período do Resumo contra 3 a 5 citações. O Auditor aprova o conjunto, e uma frase sem apoio passa junto. |
| 4 | Daily, Planning e Review rasos e iguais | São **templates placeholder**: `guidance` vazio (Planning, Review) ou uma linha (Daily: "Formato ontem/hoje/bloqueios"), `audit: none`, uma seção genérica de marcadores. O modelo recebe "(sem instrução específica)" e inventa o formato. Não há estrutura, dono, nem verificação. |
| 5 | Lista de participantes sem valor | O dado guardado é só nome e cargo. A reunião raramente diz cargo; o que ela mostra é **o que cada pessoa fez ali**, e isso se descarta. |
| 6 | X1 vazio para reunião de equipe | O tipo exige entrevista 1:1, e nada avisa **antes** de gerar. O erro 422 já é honesto, mas chega depois do custo do modelo. |
| 7 | Recomendações com "Fonte: Reunião" embaixo | O redator pode pôr `referencia` depois de qualquer seção, o que atribui à fonte o que é sugestão do modelo. |
| 8 | Documentos de 1 a 2 páginas com capa inteira | O layout é o de apostila de 38 páginas. Uma daily não precisa de capa própria. |

Pano de fundo: a iteração parou na **cota diária do Gemini** (chave de plano com treinamento). Qualquer melhoria abaixo precisa de uma forma de testar que não gaste modelo (seção 5).

## 2. Princípios

1. **Afirmação é a unidade de prova.** Cada frase factual carrega a citação que a sustenta e é conferida sozinha. Parágrafo não é unidade de prova.
2. **O que o modelo concluiu é rotulado, nunca disfarçado de fato.** Hipótese e recomendação aparecem como tal, ou não aparecem.
3. **Responsável e prazo só existem se alguém os assumiu ou os disse.** Senão o campo não aparece. (Uma pendência *sem dono* é informação e vira seção; "campo vazio" não.)
4. **Cada tipo responde a uma pergunta de quem lê**, e tem estrutura própria para respondê-la.
5. **Documento curto não carrega a forma de documento longo.**
6. **Falhar cedo e dizer o porquê** (tipo errado, pouco conteúdo) em vez de entregar um PDF fraco.

## 3. Solução por camada

### 3.1 Evidência por afirmação (resolve 1, 3, 7)

- Os campos de prosa deixam de ser `summary: string` e passam a **lista de afirmações**: `pontos: [{ texto, citacoes[] }]`. Vale para tópicos, períodos do Resumo, outcomes, outputs, conclusão.
- O Auditor confere **todas** as afirmações num lote único (o `auditar` já é em lote; o custo é tokens, num modelo `lite`). Ele continua com o critério "o trecho diz, não sugere", julgando cada frase só contra o próprio trecho. É o que pegaria "logomarca".
- **Guarda lexical determinística, em código**, antes do Auditor: um léxico de cargo e hierarquia (diretor, diretoria, gerente, coordenador, CEO, sócio…) e de marcadores causais ("devido a", "causa", "porque" quando é nova). Palavra do léxico presente no texto gerado e ausente na transcrição derruba a frase sem chamar modelo. É a regra "cargo não se deduz" estendida a todas as seções.
- Renderização: os pontos de um tópico viram parágrafo corrido (a prosa continua boa); a estrutura fica nos dados.
- `referencia` só pode vir depois de blocos `fato`; recomendação ganha o rótulo "Recomendação", e hipótese "Hipótese do redator" (ou é descartada).

### 3.2 Um objeto comum: o encaminhamento

Hoje os encaminhamentos estão espalhados (Decisões, Outputs, Conclusão). Criamos um tipo único usado por Ata, Daily, Planning e Review:

```
Encaminhamento {
  acao: string                  // verbo no infinitivo
  responsavel?: string          // só se alguém assumiu ou foi designado e aceitou
  prazo?: string                // só se dito (data, "semana que vem")
  estado: 'combinado' | 'em_andamento' | 'concluido' | 'bloqueado'
  citacoes: Citacao[]           // obrigatório; sem citação, não existe
}
```

Regra de responsável, no prompt e na auditoria: vale "eu faço", "vou ver", "fica comigo", ou designação seguida de aceite. "Alguém deveria", "a gente pode" não valem. Sem responsável, a ação sai na seção **"Sem responsável definido"**, que é a melhor entrega de um Planning.

### 3.3 Contrato de cada tipo

| Tipo | Pergunta de quem lê | Estrutura | Observações |
|---|---|---|---|
| **Ata** | "O que foi decidido e o que ficou combinado?" (quem faltou, cliente) | Resumo executivo (3 linhas) · Participantes e **o que cada um fez na reunião** · Tópicos · Decisões (com quem concordou) · **Encaminhamentos** (tabela) · Em aberto | Sem assinatura sem nome. Em vez de cargo, "papel na reunião" por evidência ("apresentou", "validou"). |
| **Resumo** | "Em 2 minutos, o que aconteceu?" | Resumo executivo · Trechos com horário em linha própria · "Pontos de atenção" (dúvida levantada e não resolvida) | Cada frase com citação. Horário como âncora de navegação. |
| **Daily** | "Como está cada frente? O que trava?" | Por pessoa/frente: Feito · Em andamento · **Bloqueios** (destacados) | Se a reunião não tem forma de daily, agrupa por frente em vez de forçar "ontem/hoje". |
| **Planning** | "Quem faz o quê, até quando?" | Prioridades · **Tabela de ações** (Ação · Responsável · Prazo · Depende de) · Riscos e dependências ditos · Sem responsável definido | Prazo só se dito. Dependência só se citada. |
| **Review** | "O que foi mostrado, o que está errado, o que muda?" | Entregas apresentadas · **Problemas encontrados** (Item · Sintoma · Encaminhamento) · Aceito / pendente de ajuste | **Causa só se alguém a disse.** Sem severidade inventada: usa o impacto que a reunião citou. Esta reunião foi um Review típico. |
| **X1** | "O que foi perguntado e respondido?" | Pares P/R | Ver 3.5. |
| **Personalizado** | O pedido da pessoa | Livre | Ver 3.6. |

Todos os tipos ganham, no topo, um **resumo executivo** de 2 a 3 frases (também com citação). É o que mais aumenta a utilidade e o que o leitor realmente lê.

### 3.4 Layout (resolve 8)

- Documentos de até 2 ou 3 páginas (Daily, Planning, Review, Resumo curto) usam o **banner de abertura de capítulo da Apostila** (página 4: faixa em degradê com título e subtítulo) no topo da primeira página, e o conteúdo começa nela. Sem capa inteira.
- Ata e documentos longos mantêm a capa. A decisão é automática por tamanho, com tabela e lista de ações em largura total.
- Tabela no padrão já existente (cabeçalho escuro, linhas listradas) para encaminhamentos e problemas.
- Bloqueios e "sem responsável" em caixa de destaque, como a "FÓRMULA" da Apostila.

### 3.5 Adequação do tipo à reunião (resolve 6)

- **Verificação barata antes do modelo**: número de falantes e proporção de turnos pergunta/resposta (X1 pede 2 falantes e perguntas curtas). Falha com 422 e **sugere o tipo certo** ("Parece uma reunião de equipe: use Ata, Review ou Resumo"). A extensão pode desabilitar o X1 na reunião de equipe antes do clique.
- Nenhum tipo gera documento vazio: abaixo de um mínimo de conteúdo, falha com motivo (já feito para X1).

### 3.6 Documento personalizado

- Prompt do redator (`redator/v3`): "causa, motivo e diagnóstico só entram se alguém os disse; hipótese sua vai como `recomendacao`, rotulada". Tabela com **citação por linha**, e não uma para a tabela toda.
- Proibido `referencia` depois de recomendação.
- Regra de responsável do 3.2 também vale aqui.

## 4. Plano em fases

| Fase | Entrega | Esforço | Risco | Pronto quando |
|---|---|---|---|---|
| **A. Fidelidade** | Pontos com citação por frase (3.1) · auditoria de todas as seções · guarda lexical · regras de responsável · `redator/v3` | Alto (schema, prompts, Auditor, testes) | Médio: o Auditor pode derrubar frases boas; calibrar com os fixtures | No fixture desta reunião: "diretoria", "causa de e-mail", "logomarca" **não** aparecem; ≥ 95% das frases com citação localizada |
| **B. Estrutura dos tipos** | Specs reais de Daily, Planning, Review; objeto Encaminhamento; resumo executivo; papel na reunião | Alto | Baixo: é conteúdo novo, sem quebrar o existente | Cada tipo gera a estrutura da tabela 3.3 no fixture |
| **C. Layout curto** | Banner de abertura para docs curtos; caixas de destaque | Médio | Baixo | Daily/Planning/Review em 1 página sem capa; Ata e Resumo inalterados |
| **D. Adequação** | Verificação de tipo antes do modelo + dica na extensão | Baixo | Baixo | X1 em reunião de equipe falha em < 1 s com tipo sugerido |

Ordem recomendada: **A → B → C → D.** A é o que torna os documentos defensáveis; sem ela, B e C só embelezam o risco.

## 5. Como medir e iterar sem gastar cota

- **Fixtures**: três transcrições reais anonimizadas (equipe/review, daily, 1:1) e o `DocumentData` de cada resposta do modelo salvo em JSON. O render e as regras de código rodam sobre o JSON, sem modelo. (O script de geração já passou a gravar esse JSON.)
- **Métricas automáticas por documento**: % de frases com citação localizada; nº de palavras de cargo/causa ausentes da transcrição (meta: 0); nº de frases derrubadas pelo Auditor; tempo; tokens.
- **Revisão cega por pessoa** em amostra pequena, com a pergunta "você assinaria isto?", comparando antes e depois de cada fase.
- **Chave paga** para o ensaio com modelo: a de treinamento limita e mistura reuniões reais.

## 6. Decisões que precisam de você

1. **"Sem responsável definido" como seção** (3.2): conta como conteúdo útil, ou você prefere omitir qualquer coisa sem dono? (Conflita com "sem campo faltante" se lido ao pé da letra; eu defendo a seção.)
2. **Papel na reunião no lugar de cargo** (3.3): aceitável para a Ata?
3. **Banner no lugar da capa** para documentos curtos (3.4): é a identidade que você quer para Daily/Planning/Review?
4. **Custo de auditar tudo**: mais tokens por documento, de ordem pequena com modelo `lite`, mas não zero. Aceitável?
5. **Ordem das fases**: começar pela A (fidelidade)?
