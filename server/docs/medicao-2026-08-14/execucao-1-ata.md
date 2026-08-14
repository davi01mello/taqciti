## Identificação

- Data da reunião: 12/08/2026
- Projeto: Projeto Fênix

## Tópico geral

Atraso na integração com a API do cliente e impactos no cronograma do Projeto Fênix.

A integração travou devido a divergências na documentação do cliente, gerando retrabalho e sobrecarga da equipe técnica. Houve identificação de gargalo de performance no banco de dados, cujo plano de ação inicial foi definido. O cronograma foi revisado com adiamento da entrega, e as responsabilidades para a próxima etapa foram distribuídas.

## Participantes e cargos

- Ana – **[A preencher: Qual é o cargo/papel de Ana?]**
- Carlos – **[A preencher: Qual é o cargo/papel de Carlos?]**
- Beatriz – Arquiteta de integração

## Tópicos discutidos

1. Integração com a API de faturamento: Foi discutido o travamento na integração com a API de faturamento do cliente devido à documentação desatualizada em três endpoints. Beatriz explicou que teve que tocar o adaptador sozinha, o que a desviou do desenho do módulo de relatórios, gerando retrabalho e cinco dias de trabalho em vez dos dois estimados.
2. Gargalo de desempenho no banco de dados: Carlos relatou que a consulta de fechamento mensal leva onze segundos nos testes de carga por varrer a tabela de lançamentos inteira. Beatriz sugeriu desnormalizar a tabela, mas Carlos ponderou verificar a falta de índices e apontou a ausência de um índice composto para o par cliente mais data. Ficou decidido que Beatriz criará o índice composto e rodará os testes novamente, descartando a desnormalização por enquanto.
3. Ajustes no cronograma da entrega: Diante do atraso na integração e da sobrecarga de Beatriz, a equipe concordou que a entrega prevista para a sexta-feira seguinte não aconteceria. Ana propôs o adiamento para 28/08/2026 para fechar a integração e o desempenho juntos, proposta aceita por Carlos e Beatriz. Também foi decidido cancelar a demo marcada para sexta-feira e remarcá-la junto com a nova data de entrega.
4. Infraestrutura de homologação: Carlos levantou a necessidade de um ambiente de homologação separado para evitar confusões ocorridas nos testes feitos direto no ambiente de desenvolvimento. Ana reconheceu a boa ideia, mas argumentou falta de orçamento e sugeriu repensar o tema no próximo ciclo.

## Decisões tomadas

- Criar o índice composto e rodar os testes de carga novamente.
- Adiar a entrega para o dia 28/08/2026.
- Cancelar a demonstração de sexta-feira e remarcá-la junto com a entrega.

## Outcomes da reunião

- Entendimento compartilhado sobre as causas do atraso na integração, decorrentes de documentação desatualizada da API do cliente.
- Clareza sobre o impacto da sobrecarga de Beatriz, que estava dividida entre o adaptador de integração e o desenho do módulo de relatórios.
- Compreensão da causa raiz do gargalo de desempenho na consulta de fechamento mensal, identificada como falta de índice composto.
- Expectativas alinhadas com o cliente quanto à inviabilidade da entrega na data original e nova data realista estipulada para 28 de agosto.

## Outputs da reunião

- Lista dos três endpoints da API de faturamento que mudaram

## Conclusão

Diante de atrasos na integração com a API de faturamento e de gargalos de desempenho nos testes de carga, o cronograma do Projeto Fênix foi reavaliado e a entrega adiada para 28 de agosto de 2026, com o cancelamento da demonstração prevista para a semana. O foco imediato concentra-se na criação de um índice composto no banco de dados para correção da performance, no fechamento do adaptador de autenticação e no envio do comunicado oficial sobre o novo prazo aos envolvidos, alinhando as expectativas para os próximos passos.

## Assinatura

Atenciosamente,

**[A preencher: Qual nome deve assinar a ata?]** – **[A preencher: Qual é o cargo de quem assina?]**
