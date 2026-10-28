# Exemplos de documentos: Ata e Resumo

Dois documentos gerados pelo TaqCiti de verdade (Leitor e Auditor no Gemini, render de produção) a partir de uma
reunião **inventada**: a de [`server/docs/fixtures/reuniao-longa-ruidosa.txt`](../../server/docs/fixtures/reuniao-longa-ruidosa.txt),
"Planejamento — Projeto Atlas", escrita com armadilhas e um [gabarito](../../server/docs/fixtures/reuniao-longa-ruidosa.gabarito.md).
Nenhum nome, número ou fala vem de reunião real.

| Documento | PDF | Para quem |
|---|---|---|
| Ata de reunião | [ata-exemplo.pdf](ata-exemplo.pdf) | Quem faltou e precisa saber o que foi decidido e o que ficou combinado |
| Resumo completo | [resumo-exemplo.pdf](resumo-exemplo.pdf) | Quem tem dois minutos e quer saber o que aconteceu, trecho a trecho |

Gerados em 28/10/2026. Para gerar de novo (gasta 2 chamadas de IA por documento; só com reunião inventada):

```
cd server
ATA_LIVE=1 DOCUMENTOS_AMOSTRAS=<pasta> npx vitest run lib/documentos/ataResumo.live.test.ts
```

## O modelo de cada documento

Os colchetes abaixo mostram **onde cada informação entra**. Eles existem só nesta página. No documento de verdade,
uma informação que a reunião não trouxe simplesmente não aparece: sem `[A preencher]`, sem campo vazio, sem chute.
O motivo é a fidelidade: um documento que o cliente lê não pode afirmar cargo, dono ou prazo que ninguém disse.

### Ata de reunião

| Parte | O que entra | Se a reunião não disse |
|---|---|---|
| Capa | Ata de reunião · [Projeto, ou o título da reunião] · [Data da reunião] | A linha some |
| Tópico / Andamento | [Tema central] · [Estado geral do assunto] | Some |
| **Resumo executivo** | [Duas ou três frases: o assunto, o que foi decidido ou combinado, o que ficou em aberto] | Some |
| **Participantes** | [Nome] – [Cargo, só se foi dito]: [o que a pessoa fez na reunião] | Sem cargo, sai só o nome; sem atuação, nada depois dele |
| Tópicos discutidos | 1. [Assunto]: [o que foi tratado, com contexto e argumentos] | — |
| Decisões tomadas | [O que foi decidido, com verbo no infinitivo] | Proposta sem aceite não entra |
| **Encaminhamentos** | Tabela: [Ação] · [Quem assumiu] · [Prazo dito] | Sem prazo: "—". Sem dono: a ação vai para **Sem responsável definido** |
| **Em aberto** | [Pergunta sem resposta, pendência sem encaminhamento, assunto adiado] | Some |
| Outcomes / Outputs | [Alinhamentos produzidos] / [Artefatos produzidos] | Somem |
| Assinatura | Atenciosamente, [Nome] – [Cargo] | Some (a reunião não diz quem assina) |

Em **negrito**, o que entrou em 28/10/2026 (ver [`redesenho-dos-documentos.md`](../redesenho-dos-documentos.md), 3.3).
A Conclusão do fim saiu: era o mesmo resumo, no lugar onde ninguém lê, e sem conferência.

### Resumo completo

| Parte | O que entra | Se a reunião não disse |
|---|---|---|
| Capa | Resumo completo da reunião · [Projeto ou título] · [Data] | A linha some |
| **Resumo executivo** | [Duas ou três frases] | Some |
| Trechos | 1. [Assunto do trecho] · [HH:MM:SS – HH:MM:SS] · [O que foi dito, em prosa] | Sem carimbo de hora na transcrição, sai sem horário |
| **Pontos de atenção** | [Dúvida, preocupação ou risco levantado e que ficou sem resposta] | Some |

## Como cada afirmação é conferida

- Cada frase do resumo executivo, cada encaminhamento, cada ponto em aberto e a atuação de cada participante levam a
  citação literal da fala que os sustenta, e o Auditor confere um por um. O que não se sustenta cai sozinho.
- Antes do Auditor, código sem IA tira do encaminhamento o **dono** cujo nome não aparece nas falas citadas e o
  **prazo** que ninguém disse ali (`server/lib/guardaDeFidelidade.ts`). A ação continua, sem dono ou sem prazo.
- Palavras de cargo e de gravidade que a reunião não usa ("gerente", "crítico") derrubam a frase onde aparecem.

No exemplo da Ata isso aparece assim: só o Rafael tem cargo (foi o único dito na reunião); o Marcelo, citado mas do
cliente, não está entre os participantes; o Kubernetes, discutido e não aceito, não virou decisão; e o "Bruno, sobe o
monitoramento até quarta" / "Pode deixar" virou encaminhamento do Bruno com prazo "até quarta".
