import type { DocumentTemplate } from './types';

/**
 * As nove seções vêm do `Modelo_Ata_de_Reunião.pdf` e da especificação do
 * DocCiti (anexos da rodada de Fase B) — `needs`/`guidance` são extraídos
 * dos dois documentos, não inventados. Onde os documentos não dizem nada,
 * a lacuna fica registrada abaixo em vez de preenchida por inferência.
 *
 * Cabeçalho, capa e rodapé pertencem à camada de renderização, não à
 * estrutura de seções — ficam fora deste template de propósito. Os dois
 * anexos divergem sobre o formato (especificação pede
 * "CITI | 30 ANOS" no topo; o PDF traz capa + logo + rodapé fixo em toda
 * página) — divergência não resolvida aqui, decisão do autor.
 *
 * Lacunas que os dois documentos não cobrem (não inventadas):
 * - Ordenação de `topicos_discutidos` — cronológica, por relevância, ou livre?
 * - Limite de participantes listados quando a reunião tem muita gente.
 * - Comportamento de `decisoes` quando não há nenhuma: a seção é
 *   `required: true` e `omitWhenEmpty: false`, hoje apareceria vazia. Um
 *   texto padrão tipo "Nenhuma decisão formal foi tomada nesta reunião"
 *   é plausível, mas é escolha do autor, não implementada aqui.
 * - Fuso e formato de hora — o JSON intermediário prevê `meeting_time`,
 *   nem o PDF nem a especificação dizem se a hora entra no documento.
 *
 * Blocos "O que escrever aqui" do PDF (Narrativa Resumida, O Veredito,
 * Ação Concreta, Alinhamentos Abstratos, Diferença para Decisões, Produtos
 * Gerados, Resumo Executivo) são instrução de autoria pra humano — viram
 * guidance abaixo, nunca conteúdo do documento gerado. O mesmo vale pros
 * placeholders de forma do PDF ([Nome do Tópico], [Decisão A], [Nome] –
 * [Cargo] etc.): são forma, não texto a copiar.
 */
export const ata: DocumentTemplate = {
  documentType: 'ata',
  label: 'Ata de Reunião',
  sections: [
    {
      id: 'identificacao',
      title: 'Identificação',
      order: 1,
      required: true,
      audit: 'light',
      omitWhenEmpty: false,
      needs: ['data em que a reunião ocorreu', 'nome do projeto'],
      guidance: [
        'DATA no formato DD/MM/AAAA, representando a data em que a reunião ocorreu.',
        'Prioridade para determinar a data, nesta ordem: (1) data/horário explicitamente',
        'associado à reunião; (2) metadados da reunião ou da transcrição, quando confiáveis;',
        '(3) data disponível no ambiente da conversa, caso corresponda à reunião.',
        'Nunca inventar uma data.',
        'NOME DO PROJETO extraído do contexto compactado. Se puder ser identificado com',
        'segurança, preencher automaticamente; caso contrário, perguntar ao usuário.',
      ].join(' '),
      askWhenMissing: ['Qual é a data em que esta reunião ocorreu?', 'Qual é o nome do projeto?'],
    },

    {
      id: 'topico_geral',
      title: 'Tópico geral',
      order: 2,
      required: true,
      audit: 'none',
      omitWhenEmpty: false,
      needs: ['tema central da reunião', 'estado geral do assunto tratado'],
      guidance: [
        'TÓPICO: nome do tema central da reunião.',
        'Exemplo: "Alinhamento de Cronograma e Validação do Tratamento".',
        'ANDAMENTO: descrever de forma objetiva o estado geral do assunto tratado.',
        'Exemplo: "Continuidade do desenvolvimento técnico da plataforma, com foco na',
        'estrutura interna do sistema e no banco de dados, além do alinhamento dos',
        'próximos passos."',
        'O texto deve ser produzido a partir do contexto compactado. Não fazer uma',
        'simples transcrição.',
      ].join(' '),
      askWhenMissing: [],
    },

    {
      id: 'participantes',
      title: 'Participantes e cargos',
      order: 3,
      required: true,
      audit: 'strict',
      omitWhenEmpty: false,
      needs: [
        'nomes das pessoas que participaram',
        'cargo ou papel de cada participante',
        'origem da informação de cargo',
      ],
      guidance: [
        'Formato: [Nome] – [Cargo/Papel], um por linha.',
        'Os nomes devem ser extraídos automaticamente.',
        'Os cargos só devem ser preenchidos automaticamente quando houver evidência',
        'suficiente na reunião. Sem evidência, o cargo é DESCONHECIDO e vira pergunta,',
        'nunca um chute.',
        'Exemplo: de "João explicou..." extrai-se apenas o nome; de "Maria, gerente de',
        'dados, respondeu..." extrai-se nome e cargo. Resultado: João – cargo desconhecido;',
        'Maria – Gerente de Dados.',
        'Registrar a origem de cada cargo: meeting, user ou unknown.',
        'Não perguntar novamente informação já conhecida.',
      ].join(' '),
      askWhenMissing: ['Qual é o cargo/papel de {nome}?'],
    },

    {
      id: 'topicos_discutidos',
      title: 'Tópicos discutidos',
      order: 4,
      required: true,
      audit: 'light',
      omitWhenEmpty: false,
      needs: [
        'tópicos reais tratados na reunião',
        'contexto e argumentos de cada tópico',
        'problemas identificados e alternativas consideradas',
      ],
      guidance: [
        'Identificar os principais tópicos reais da reunião e separá-los semanticamente.',
        'Formato: [Nome do Tópico]: [resumo da discussão], numerados para facilitar',
        'referência futura.',
        'Cada tópico deve conter: assunto debatido, contexto, argumentos principais,',
        'problemas identificados, alternativas consideradas e informações relevantes.',
        'Narrativa condensada preservando o significado — não reproduzir a conversa',
        'literalmente.',
        'Exemplo de tom: "Foi discutida a integração com a API da Conta Azul. A equipe',
        'explicou que a documentação enviada pelo cliente estava desatualizada, o que',
        'gerou atraso na implementação."',
        'Não criar tópicos artificiais apenas para aumentar a quantidade.',
      ].join(' '),
      askWhenMissing: [],
    },

    {
      id: 'decisoes',
      title: 'Decisões tomadas',
      order: 5,
      required: true,
      audit: 'strict',
      omitWhenEmpty: false,
      needs: [
        'o que foi efetivamente decidido, acordado ou aprovado',
        'evidência na reunião que sustenta cada decisão',
        'concordância explícita do cliente, quando houver',
      ],
      guidance: [
        'Identificar somente aquilo que efetivamente foi decidido, acordado ou aprovado',
        'durante a reunião. É o veredito: o que foi batido o martelo.',
        'Usar verbos no infinitivo ou imperativo: Manter, Iniciar, Cancelar, Adiar.',
        'Exemplos: "Manter o cronograma atual."; "Adiar a entrega para 20/08/2026.";',
        '"Iniciar a integração após a validação da API."',
        'Distinguir discussão de proposta, de possibilidade e de decisão. Frases como',
        '"podemos fazer", "talvez seja melhor" e "vamos pensar nisso" NÃO são decisões.',
        'Se houve concordância explícita do cliente, preservar essa informação — por',
        'exemplo, "O cliente concordou com o adiamento da entrega."',
        'Seção de alta importância jurídica e processual. Nunca criar uma decisão que',
        'não esteja sustentada pela reunião.',
      ].join(' '),
      askWhenMissing: [],
    },

    {
      id: 'outcomes',
      title: 'Outcomes da reunião',
      order: 6,
      required: false,
      audit: 'light',
      omitWhenEmpty: true,
      needs: ['alinhamentos e entendimentos compartilhados produzidos pela conversa'],
      guidance: [
        'Resultados estratégicos ou alinhamentos produzidos pela conversa — o que foi',
        'conquistado com ela.',
        'Representam: alinhamentos, entendimento compartilhado, clareza obtida,',
        'prioridades estabelecidas, expectativas alinhadas, problemas esclarecidos.',
        'Não confundir com decisões. Decisão é "vamos fazer X"; outcome é "agora todos',
        'entendem por que X é importante".',
        'Exemplos: "Definição clara das prioridades da próxima sprint"; "Alinhamento de',
        'expectativas sobre a entrega final".',
        'Gerar apenas quando houver evidência suficiente.',
      ].join(' '),
      askWhenMissing: [],
    },

    {
      id: 'outputs',
      title: 'Outputs da reunião',
      order: 7,
      required: false,
      audit: 'light',
      omitWhenEmpty: true,
      needs: ['artefatos e resultados concretos produzidos ou estabelecidos na reunião'],
      guidance: [
        'Resultados concretos produzidos ou estabelecidos durante a reunião — coisas que',
        'se pode apontar e que agora existem ou estão claras.',
        'Exemplos: novo cronograma atualizado; lista de acessos pendentes enviada ao',
        'cliente; documento técnico validado; responsabilidades definidas.',
        'Diferença: outcome é resultado estratégico ou entendimento; output é resultado',
        'concreto, artefato ou informação produzida.',
        'Não inventar entregáveis. Se não houver outputs identificáveis, não criar',
        'artificialmente.',
      ].join(' '),
      askWhenMissing: [],
    },

    {
      id: 'conclusao',
      title: 'Conclusão',
      order: 8,
      required: true,
      audit: 'none',
      omitWhenEmpty: false,
      needs: ['situação atual, principais decisões, andamento e foco imediato'],
      guidance: [
        'Um único parágrafo executivo.',
        'Deve permitir que alguém que não leia a ata inteira entenda: situação atual,',
        'principais decisões, andamento do projeto, foco imediato e próximos movimentos.',
        'Objetiva e profissional. Não repetir integralmente os tópicos anteriores.',
      ].join(' '),
      askWhenMissing: [],
    },

    {
      id: 'assinatura',
      title: 'Assinatura',
      order: 9,
      required: true,
      audit: 'none',
      omitWhenEmpty: false,
      needs: ['nome de quem assina', 'cargo de quem assina'],
      guidance: [
        'Fechamento no formato: "Atenciosamente," seguido de [Nome] – [Cargo].',
        'Essas informações podem ser solicitadas ao usuário caso não estejam disponíveis.',
      ].join(' '),
      askWhenMissing: ['Qual nome deve assinar a ata?', 'Qual é o cargo de quem assina?'],
    },
  ],
};
