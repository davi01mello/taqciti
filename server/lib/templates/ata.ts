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
 *
 * 28/10/2026 — a Ata passou a responder "o que foi decidido e o que ficou
 * combinado?" para quem faltou (`docs/redesenho-dos-documentos.md`, 3.3):
 * - RESUMO EXECUTIVO no topo, frase a frase com citação, no lugar da
 *   Conclusão: a Conclusão era o mesmo texto no fim, `audit: 'none'`, e quem lê
 *   para no começo. Documentos salvos com `conclusion` continuam a mostrá-la.
 * - PARTICIPANTES com a atuação de cada um na reunião ("apresentou", "validou"):
 *   a reunião quase nunca diz cargo, e a lista de nomes soltos não informava.
 * - ENCAMINHAMENTOS com responsável e prazo SÓ quando ditos, e EM ABERTO.
 * Campo ausente continua não entrando (sem `[A preencher]`): ação sem dono vai
 * para "Sem responsável definido", que é informação, não lacuna.
 */
export const ata: DocumentTemplate = {
  documentType: 'ata',
  label: 'Ata de Reunião',
  // Idêntico ao que já estava hardcoded em blocoDeAbertura() de
  // render/html.ts — minúsculas em "reunião" de propósito, para o HTML da
  // Ata sair byte a byte igual ao de antes desta mudança.
  documentTitle: 'Ata de reunião',
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
      id: 'resumo_executivo',
      title: 'Resumo executivo',
      order: 2,
      required: true,
      audit: 'strict',
      omitWhenEmpty: true,
      needs: ['o que aconteceu de mais importante, para quem não esteve na reunião'],
      guidance: [
        'Duas ou três frases que contam a quem NÃO esteve na reunião o que importa:',
        'o assunto, o que foi decidido ou combinado e o que ficou em aberto.',
        'Cada frase é um item separado, com as citações literais que a sustentam; a',
        'frase sem citação localizável cai sozinha.',
        'Afirme só o que foi dito: sem avaliação ("reunião produtiva"), sem causa e sem',
        'cargo que a reunião não trouxe, e proposta não vira decisão.',
      ].join(' '),
      askWhenMissing: [],
    },

    {
      id: 'topico_geral',
      title: 'Tópico geral',
      order: 3,
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
      title: 'Participantes',
      order: 4,
      required: true,
      audit: 'strict',
      omitWhenEmpty: false,
      needs: [
        'nomes das pessoas que participaram',
        'cargo de cada participante, só quando dito',
        'o que cada participante fez na reunião',
      ],
      guidance: [
        'Os nomes devem ser extraídos automaticamente.',
        'Os cargos só devem ser preenchidos quando a reunião os disser. Sem evidência,',
        'OMITA o cargo — nunca um chute.',
        'ATUAÇÃO: o que a pessoa fez nesta reunião, em poucas palavras, com verbos no',
        'passado e por evidência nas falas dela ("apresentou o cronograma; levantou a',
        'dúvida sobre os acessos; validou a proposta de adiamento"). A atuação NÃO é',
        'cargo: quem conduziu a conversa não vira "gerente" nem "líder". Sem nada além',
        'de presença, omita a atuação. As citações devem cobrir a atuação também.',
        'Exemplo: de "João explicou..." extrai-se apenas o nome; de "Maria, gerente de',
        'dados, respondeu..." extrai-se nome e cargo. Resultado: João – cargo desconhecido;',
        'Maria – Gerente de Dados.',
        'Registrar a origem de cada cargo: meeting, user ou unknown.',
        'Não perguntar novamente informação já conhecida.',
        'Todo participante listado precisa vir com pelo menos uma citação literal que',
        'comprove a presença dele na reunião — o momento em que ele fala, é chamado pelo',
        'nome, ou é mencionado como presente. Um participante sem nenhuma citação',
        'localizável é descartado inteiro da ata pelo auditor, mesmo tendo participado de',
        'verdade. Procure ativamente esse trecho antes de desistir de citar alguém.',
        '"Você", "You" e "Eu" NÃO são nomes: é como o Google Meet rotula a própria pessoa',
        'que gravou, quando o nome real dela não apareceu na tela. Liste essa pessoa',
        'normalmente — ela participou —, mas mantenha o rótulo como veio, sem inventar um',
        'nome e sem tentar adivinhar quem é a partir do assunto. O código transforma esse',
        'rótulo em pergunta ao usuário. Quando o nome vier decorado ("Ana Souza (Você)"),',
        'use só o nome real: "Ana Souza".',
      ].join(' '),
      askWhenMissing: ['Qual é o cargo/papel de {nome}?'],
    },

    {
      id: 'topicos_discutidos',
      title: 'Tópicos discutidos',
      order: 5,
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
      order: 6,
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
      id: 'encaminhamentos',
      title: 'Encaminhamentos',
      order: 7,
      required: false,
      audit: 'strict',
      omitWhenEmpty: true,
      needs: ['ações combinadas', 'quem assumiu cada ação', 'prazos ditos'],
      guidance: [
        'As ações que ficaram combinadas para depois da reunião, com verbo no infinitivo',
        '("Enviar a lista de acessos ao cliente").',
        'RESPONSÁVEL só quando a pessoa ASSUMIU a ação ("eu faço", "deixa comigo", "vou',
        'ver isso", "fico com essa") ou foi designada e ACEITOU. "Alguém deveria", "a',
        'gente pode", "seria bom" não definem responsável: omita o campo, e a ação sai',
        'como sem responsável definido — isso também é informação.',
        'PRAZO só quando foi dito ("até sexta", "dia 12", "semana que vem"); copie como',
        'foi dito, sem converter em data.',
        'Cite a fala que combina a ação e, quando houver, a que a assume e a do prazo.',
        'Uma decisão não precisa ser repetida aqui se não houver ação a fazer depois dela.',
        'Não invente ação para preencher a seção.',
      ].join(' '),
      askWhenMissing: [],
    },

    {
      id: 'outcomes',
      title: 'Outcomes da reunião',
      order: 8,
      required: false,
      audit: 'strict',
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
      order: 9,
      required: false,
      audit: 'strict',
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
      id: 'em_aberto',
      title: 'Em aberto',
      order: 10,
      required: false,
      audit: 'strict',
      omitWhenEmpty: true,
      needs: ['perguntas sem resposta, pendências sem encaminhamento, assuntos adiados'],
      guidance: [
        'O que a reunião deixou EXPLICITAMENTE sem resposta: pergunta feita e não',
        'respondida, pendência reconhecida sem encaminhamento, assunto adiado sem data.',
        'Uma frase por item, com a citação de onde ficou em aberto.',
        'Não crie pendência por dedução, e não repita aqui um encaminhamento que já',
        'tem ação combinada.',
      ].join(' '),
      askWhenMissing: [],
    },

    {
      id: 'assinatura',
      title: 'Assinatura',
      order: 11,
      required: true,
      audit: 'none',
      // Sem nome de quem assina, a seção some: a transcrição não diz quem
      // assina, e a pessoa não é mais perguntada por isso (só dúvida extrema
      // vira pergunta). Um "Atenciosamente" sobre um campo vazio é pior que
      // nenhum fecho.
      omitWhenEmpty: true,
      fromUserOnly: true,
      needs: ['nome de quem assina', 'cargo de quem assina'],
      guidance: [
        'Fechamento no formato: "Atenciosamente," seguido de [Nome] – [Cargo].',
        'Essas informações podem ser solicitadas ao usuário caso não estejam disponíveis.',
      ].join(' '),
      askWhenMissing: ['Qual nome deve assinar a ata?', 'Qual é o cargo de quem assina?'],
    },
  ],
};
