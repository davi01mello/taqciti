## Identificação

- Data da reunião: 12/08/2026
- Projeto: Projeto Fênix

## Tópico geral

O tema central da reunião foi o atraso na integração e a revisão do cronograma do Projeto Fênix. A entrega prevista para a semana seguinte foi adiada devido a problemas na documentação da API de faturamento do cliente e a gargalos de desempenho no banco de dados. Ficou decidido o adiamento da entrega para 28 de agosto de 2026, com foco na correção da integração, criação de índice composto para otimização de consultas e realinhamento com o cliente.

## Participantes e cargos

- Beatriz – Arquiteta de Integração
- Ana – **[A preencher: Qual é o cargo/papel de Ana?]**
- Carlos – **[A preencher: Qual é o cargo/papel de Carlos?]**
- **[A preencher: A afirmação "Ana participou da reunião." não foi confirmada pela transcrição. Ela deve constar na ata? Se sim, com que redação?]**
- **[A preencher: A afirmação "Carlos participou da reunião." não foi confirmada pela transcrição. Ela deve constar na ata? Se sim, com que redação?]**

## Tópicos discutidos

1. Integração com a API de faturamento: Foi discutida a integração com a API de faturamento do cliente, que apresentou problemas devido a documentação desatualizada, com três endpoints alterados e mudança no endpoint de token sem aviso prévio. Beatriz assumiu sozinha o adaptador, o que acumulou retrabalho e comprometeu o desenho do módulo de relatórios. Carlos enviará por e-mail a lista dos três endpoints que mudaram.

2. Gargalo de desempenho no banco de dados: Foram constatados em testes de carga gargalos na consulta de fechamento mensal, que levava onze segundos para executar por varredura na tabela. Foi avaliada a desnormalização da tabela, mas a alternativa foi descartada para evitar alterações permanentes no modelo. Ficou decidido que Beatriz criará um índice composto de cliente e data e rodará novos testes.

3. Revisão do cronograma e adiamento da entrega: Diante do atraso na integração e da sobrecarga de Beatriz, a entrega prevista para a sexta-feira seguinte foi considerada inviável pela equipe. Ficou decidido adiar a entrega para 28 de agosto de 2026, com o cancelamento da demonstração marcada para sexta-feira e remarcação conjunta com a nova entrega. Ana enviará o comunicado ao cliente Rodrigo.

4. Proposta de ambiente de homologação separado: Carlos sugeriu a criação de um ambiente de homologação separado para evitar as confusões geradas pelos testes diretos no ambiente de desenvolvimento. A ideia foi reconhecida como útil, mas adiada para o próximo ciclo devido a custos de infraestrutura e falta de orçamento aprovado.

## Decisões tomadas

- Adiar a entrega para 28 de agosto de 2026.
- Cancelar a demonstração prevista para sexta-feira.

## Outcomes da reunião

- Alinhamento sobre a causa do atraso na integração, decorrente de documentação desatualizada da API de faturamento do cliente.
- Entendimento compartilhado sobre o gargalo de desempenho na consulta de fechamento mensal devido à ausência de índice composto.
- Alinhamento de expectativas sobre a inviabilidade da entrega na data originalmente prevista e a necessidade de reajustar o cronograma.
- Clareza sobre a sobrecarga de Beatriz ao acumular a arquitetura de integração e a execução do adaptador.

## Outputs da reunião

- Lista dos três endpoints que mudaram na documentação da API de faturamento.

## Conclusão

Diante de atrasos na integração com a API de faturamento e de gargalos de desempenho no banco de dados, o Projeto Fênix teve sua entrega adiada para o dia 28 de agosto de 2026, com o cancelamento da demonstração prevista. O foco imediato da equipe concentra-se na finalização do adaptador de autenticação e na criação de um índice composto para a otimização de consultas. Como próximos movimentos, a equipe realizará novos testes de carga, enviará o comunicado do reajuste de cronograma ao cliente e manterá alinhamento interno para o próximo encontro na quinta-feira.

## Assinatura

Atenciosamente,

**[A preencher: Qual nome deve assinar a ata?]** – **[A preencher: Qual é o cargo de quem assina?]**