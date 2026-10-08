/**
 * O CATÁLOGO dos especialistas — ficha, fronteiras, ferramentas e contratos.
 *
 * Toda entrada nasce `planned` aqui, sem executor. Quem a torna executável é
 * `especialistas.ts` (`ativar`), e o registro recusa marcar como `available`
 * quem não tem executor. Chamar pela delegação um especialista que não foi
 * ativado devolve `agente_indisponivel` — nunca um resultado fictício. E o
 * modelo só fica sabendo dos disponíveis: a ferramenta de delegação lista só
 * esses.
 *
 * `usaModelo: false` marca SERVIÇO DETERMINÍSTICO: monitorar captura, conferir
 * fontes, revisar a estrutura de um documento e apontar dado sensível são
 * contas, não opiniões. Eles respondem sem chamar modelo nenhum.
 *
 * Os schemas de entrada são deliberadamente lenientes (tudo opcional): quem
 * resolve "essa reunião" é a ferramenta, pela conversa — exigir o id na
 * delegação só faria o modelo inventar um.
 */
import { z } from 'zod/v4';
import { IDS_DE_TIPO } from '@/features/documents/catalogo';
import type { DefinicaoDeAgente } from './tipos';

type Planejado = Omit<DefinicaoDeAgente, 'estado' | 'executor' | 'versaoDasInstrucoes'>;

function planejado(a: Planejado): DefinicaoDeAgente {
  return { ...a, estado: 'planned', versaoDasInstrucoes: null };
}

const reuniaoOpcional = z.object({ reuniao_id: z.string().min(1).optional() }).passthrough();
const livre = z.object({}).passthrough();
/** Quem responde em texto (o ciclo do runtime) não devolve `saida`. */
const semSaida = z.never();

export const ESPECIALISTAS: readonly DefinicaoDeAgente[] = [
  planejado({
    id: 'capture_monitor',
    nome: 'Monitor de captura',
    descricao: 'Diz o estado e a confiabilidade da captura de uma reunião, por sinais verificáveis.',
    finalidade: 'Tornar visível onde a transcrição pode ter falhado, sem confundir silêncio com perda.',
    entradas: ['reunião (id), ou a da conversa, ou a que está em andamento'],
    saidas: ['situação da captura', 'sinais verificáveis', 'intervalos sem fala transcrita'],
    capacidades: ['ler os contadores da captura', 'comparar os tempos dos segmentos', 'ler o estado vivo do background'],
    limites: [
      'não reconstrói o que não foi capturado',
      'não chama intervalo sem fala de perda',
      'não inventa instante de lacuna',
    ],
    fronteiras: [
      'Não é o `continuity`: aponta buracos na captura, não mudanças no trabalho.',
      'Serviço determinístico (`captura.ts`) — não usa modelo.',
    ],
    usaModelo: false,
    ferramentasPermitidas: ['get_capture_state'],
    schemaDeEntrada: reuniaoOpcional,
    schemaDeSaida: z.object({
      situacao: z.string(),
      avaliacao: z.string(),
      sinais: z.array(z.string()),
    }),
  }),
  planejado({
    id: 'context',
    nome: 'Preparador de contexto',
    descricao: 'Prepara a pessoa para uma reunião ou tarefa: decisões anteriores, pendências e perguntas.',
    finalidade: 'Montar, a partir dos registros, o que importa saber antes de um encontro.',
    entradas: ['o pedido', 'a reunião ou o tema', 'os registros selecionados'],
    saidas: ['objetivo conhecido', 'decisões e pendências relacionadas, com fonte', 'perguntas sugeridas'],
    capacidades: ['buscar e ler registros', 'consultar compromissos, decisões e análises'],
    limites: [
      'não inventa participante nem objetivo ausente',
      'pergunta sugerida é marcada como sugestão',
      'não cria documento',
    ],
    fronteiras: [
      'Não é o `organizational_memory`: serve um encontro ou tarefa, não uma linha do tempo.',
      'Não é o `continuity`: usa o que mudou, não compara versões.',
    ],
    usaModelo: true,
    ferramentasPermitidas: [
      'search_records',
      'read_meeting',
      'read_document',
      'read_analysis',
      'list_commitments',
      'list_decisions',
      'list_findings',
    ],
    schemaDeEntrada: livre,
    schemaDeSaida: semSaida,
  }),
  planejado({
    id: 'meeting_copilot',
    nome: 'Copiloto de reunião',
    descricao: 'Responde, durante a reunião ao vivo, sobre o que já foi capturado ("o que perdi?").',
    finalidade: 'Dar apoio curto e discreto sobre o trecho capturado até agora.',
    entradas: ['reunião em andamento', 'pergunta'],
    saidas: ['resposta curta, com fontes, dizendo até onde a captura vai'],
    capacidades: ['ler a transcrição capturada', 'ver o estado da captura', 'recuperar decisões registradas'],
    limites: [
      'não fala na reunião nem manda mensagem aos participantes',
      'não altera decisões',
      'só sob pedido: não há sugestão automática nesta versão',
    ],
    fronteiras: [
      'Não é o `meeting_analyst`: responde no calor da reunião; a análise estruturada vem depois.',
    ],
    usaModelo: true,
    ferramentasPermitidas: ['read_meeting', 'get_capture_state', 'list_decisions', 'search_records'],
    schemaDeEntrada: reuniaoOpcional,
    schemaDeSaida: semSaida,
  }),
  planejado({
    id: 'meeting_analyst',
    nome: 'Analista de reunião',
    descricao: 'Estrutura uma reunião em visão geral, decisões, questões abertas, riscos e próximos passos.',
    finalidade: 'Transformar a transcrição em itens estruturados, cada um com fonte, e salvar a análise.',
    entradas: ['reunião (id), ou a da conversa'],
    saidas: ['análise salva (cartão)', 'cobertura e lacunas'],
    capacidades: ['ler a transcrição por partes', 'distinguir proposta, decisão e pergunta', 'salvar a análise'],
    limites: [
      'não atribui responsável que só foi mencionado',
      'não declara consenso a partir de uma sugestão isolada',
      'declara a cobertura real (contada pelo código)',
    ],
    fronteiras: [
      'Não é o `commitments`: aponta próximos passos; registrar compromisso é com ele.',
      'Não é o `documents`: entrega estrutura, não documento.',
    ],
    usaModelo: true,
    ferramentasPermitidas: ['read_meeting', 'search_records', 'read_analysis', 'save_analysis', 'get_capture_state'],
    schemaDeEntrada: reuniaoOpcional,
    // O executor de modelo responde em texto e salva pela ferramenta; este é o
    // contrato de quem devolver a análise como dado estruturado.
    schemaDeSaida: z.object({
      decisoes: z.array(
        z.object({
          texto: z.string(),
          estado: z.enum(['proposta', 'confirmada', 'substituida']),
          refs: z.array(z.string()),
        }),
      ),
      duvidas: z.array(z.object({ texto: z.string(), refs: z.array(z.string()) })),
      riscos: z.array(z.object({ texto: z.string(), refs: z.array(z.string()) })),
    }),
  }),
  planejado({
    id: 'evidence_verifier',
    nome: 'Verificador de evidências',
    descricao: 'Confere se as fontes de um documento ainda existem e contêm os trechos citados.',
    finalidade: 'Achar fonte inexistente, fonte que mudou e nota sem fonte.',
    entradas: ['documento (id)'],
    saidas: ['situação de cada fonte: conferida, alterada, indisponível'],
    capacidades: ['comparar o trecho citado com a fonte atual'],
    limites: [
      'confere existência e trecho; não julga se a frase interpreta bem o trecho',
      'não inventa citação para preencher lacuna',
    ],
    fronteiras: [
      'O runtime já confere as citações de cada RESPOSTA; este agente confere as de um DOCUMENTO salvo.',
      'Não é o `quality_review`: olha as fontes, não a forma.',
      'Serviço determinístico (`revisao.ts`) — não usa modelo.',
    ],
    usaModelo: false,
    ferramentasPermitidas: ['check_document'],
    schemaDeEntrada: z.object({ documento_id: z.string().min(1).optional() }).passthrough(),
    schemaDeSaida: z.object({ fontes: z.array(z.object({ numero: z.number(), situacao: z.string() })) }),
  }),
  planejado({
    id: 'commitments',
    nome: 'Compromissos',
    descricao: 'Extrai, registra e acompanha compromissos: o que, quem, até quando e o que depende do quê.',
    finalidade: 'Listar quem ficou de fazer o quê, sem confundir sugestão com acordo nem inventar dono ou prazo.',
    entradas: ['reunião (id), ou a da conversa', 'o pedido da pessoa'],
    saidas: ['sugestões revisáveis (cartão)', 'compromissos registrados', 'atualizações com origem'],
    capacidades: [
      'ler a transcrição',
      'sugerir compromissos para revisão',
      'registrar sem duplicar',
      'atualizar estado, responsável e prazo com origem',
      'ligar dependências sem ciclo',
    ],
    limites: [
      'não declara atraso por falta de atualização',
      'não inventa responsável nem prazo (o código descarta o que não está no trecho)',
      'registrar só quando a pessoa pediu',
    ],
    fronteiras: [
      'Não é o `continuity`: registra compromissos; o que mudou desde a última vez é dele.',
      'Não é o `scheduling`: não marca nada na agenda.',
    ],
    usaModelo: true,
    ferramentasPermitidas: [
      'search_records',
      'read_meeting',
      'read_analysis',
      'list_commitments',
      'suggest_commitments',
      'register_commitments',
      'update_commitment',
      'link_dependency',
    ],
    schemaDeEntrada: reuniaoOpcional,
    schemaDeSaida: semSaida,
  }),
  planejado({
    id: 'documents',
    nome: 'Documentos',
    descricao: 'Produz e revisa documentos dos tipos do catálogo do TaqCiti.',
    finalidade:
      'Aplicar os modelos do catálogo (`features/documents/catalogo.ts`) ao conteúdo das reuniões.',
    entradas: [
      'tipo do catálogo',
      'reunião de origem (id)',
      'campos já informados pela pessoa',
    ],
    saidas: ['documento salvo e editável', 'pendências'],
    capacidades: ['seguir a estrutura de cada tipo do catálogo', 'revisar a estrutura e as fontes de um documento'],
    limites: [
      'só tipos do catálogo; fora dele, orienta a usar o Claude',
      'só grava quando a pessoa pediu',
      'sem tipo dito pela pessoa, pergunta o tipo e não cria nada',
      'o resto não pergunta: gera com o que tem, marca "A confirmar", e o Taq pergunta na conversa depois',
      'compartilhar ou enviar é ação separada, fora deste agente',
    ],
    fronteiras: [
      'A geração de ata pelo servidor (`/api/generate`) continua sendo o pipeline próprio da ' +
        'tela "Gerar documento".',
    ],
    usaModelo: true,
    ferramentasPermitidas: [
      'search_records',
      'read_meeting',
      'read_document',
      'list_document_types',
      'create_document',
      'update_document',
      'prepare_external_brief',
      'check_document',
      'ask_user',
    ],
    schemaDeEntrada: z.object({
      tipo: z.enum(IDS_DE_TIPO).optional(),
      reuniao_id: z.string().min(1).optional(),
      campos: z.record(z.string(), z.string()).optional(),
    }),
    schemaDeSaida: z.object({
      documento_id: z.string(),
      pendencias: z.array(z.string()),
    }),
  }),
  planejado({
    id: 'app_assistant',
    nome: 'Operações e ajuda',
    descricao:
      'Executa operações do aplicativo (abrir, renomear, apagar ou exportar reuniões; apagar conversas) e tira dúvidas de uso.',
    finalidade:
      'Fazer, pelos mesmos caminhos da interface, o que a pessoa pediu sobre um registro; e explicar como o TaqCiti funciona.',
    entradas: ['o pedido da pessoa', 'a reunião da conversa, quando houver'],
    saidas: ['resposta curta', 'o resultado da operação', 'o registro afetado'],
    capacidades: [
      'abrir reunião ou documento',
      'renomear reunião',
      'apagar reunião (vai para a lixeira do Taq por 30 dias, com Desfazer)',
      'restaurar reunião da lixeira',
      'apagar conversas (definitivo; reuniões e documentos ficam; pergunta quando o nome é ambíguo)',
      'exportar a transcrição em .txt (parcial ou final, dito no resultado)',
      'preparar a transcrição para a pessoa copiar (nada é copiado nem enviado)',
      'baixar um documento (.md salvo; .html da geração quando existir)',
      'adicionar e tirar reuniões e documentos do contexto desta conversa',
      'responder pela referência de ajuda (`ajuda.ts`): o que existe, os passos verificados e o que ele mesmo executa',
    ],
    limites: [
      'só operações que o aplicativo já tem',
      'não pergunta: age no alvo mais provável e diz o que fez; o que tem volta é desfazível',
      'exceção: apagar conversa não tem volta, então nome ambíguo vira pergunta, e nada é apagado antes',
      'ajuda só com o que está na referência; o resto é "não disponível"',
    ],
    fronteiras: [
      'Não cria nem edita documentos: isso é do `documents`.',
      'Não responde sobre o CONTEÚDO das reuniões: isso é do orquestrador.',
    ],
    usaModelo: true,
    ferramentasPermitidas: [
      'search_records',
      'open_meeting',
      'open_document',
      'rename_meeting',
      'delete_meeting',
      'restore_meeting',
      'delete_conversation',
      'export_transcript',
      'capture_screen',
      'copy_transcript',
      'download_document',
      'add_context_source',
      'remove_context_source',
      'get_app_capabilities',
      'get_usage_guide',
    ],
    schemaDeEntrada: livre,
    schemaDeSaida: semSaida,
  }),
  planejado({
    id: 'communication',
    nome: 'Comunicação',
    descricao:
      'Prepara rascunhos de mensagem e, com a conta do CITi conectada, prepara o e-mail a colegas da organização, com documento ou transcrição anexados; quem envia é a pessoa, pelo botão do cartão.',
    finalidade: 'Rascunhar mensagens adequadas ao destinatário e deixá-las prontas para a pessoa enviar pelo botão, sem reenviar às cegas.',
    entradas: ['destinatários', 'objetivo da mensagem', 'público (interno/externo)', 'fontes', 'documento ou transcrição a anexar'],
    saidas: ['rascunho editável e copiável (cartão)', 'prévia do envio', 'desfecho do envio (aceito, recusado ou desconhecido)'],
    capacidades: [
      'ler registros',
      'conferir nomes contra os participantes',
      'apontar conteúdo sensível',
      'procurar colegas no diretório da organização',
      'preparar o envio de e-mail pela conta do CITi (só com a integração disponível); o envio é do botão',
    ],
    limites: [
      'sem a conta do CITi conectada, NÃO ENVIA: só rascunho para copiar',
      'endereço vem do diretório ou do que a pessoa escreveu — nunca inventado',
      'nome ambíguo vira pergunta antes de qualquer uso',
      'o modelo nunca envia: guarda a prévia, e só o clique no botão Enviar executa (nenhuma frase confirma)',
      '"aceito pelo Google" não é "entregue"; tempo esgotado é "desconhecido" e não se reenvia sozinho',
    ],
    fronteiras: [
      'Não é o `documents`: mensagem curta com destinatário, não documento de registro.',
      'Não é o `privacy_review`: usa a mesma revisão, mas quem decide o que sai é a pessoa.',
    ],
    usaModelo: true,
    ferramentasPermitidas: [
      'search_records',
      'read_meeting',
      'read_document',
      'list_findings',
      'prepare_message',
      'search_directory',
      'send_email',
    ],
    schemaDeEntrada: livre,
    schemaDeSaida: semSaida,
  }),
  planejado({
    id: 'scheduling',
    nome: 'Agendamento',
    descricao:
      'Sugere horários com fuso explícito e, com a conta do CITi conectada, consulta agendas, cria, remarca e cancela eventos.',
    finalidade: 'Converter "amanhã às 14h" em horários corretos e deixar o evento pronto para a pessoa marcar pelo botão.',
    entradas: ['participantes', 'janela de datas', 'duração', 'assunto'],
    saidas: [
      'sugestões de horário (cartão) com link para o formulário do Google Agenda',
      'prévia com botão; o evento criado, remarcado ou cancelado só aparece depois do clique',
    ],
    capacidades: [
      'resolver datas relativas no fuso de quem usa',
      'consultar compromissos relacionados',
      'consultar ocupado/livre dos colegas (só das agendas visíveis)',
      'preparar a criação, a remarcação e o cancelamento de eventos (só com a integração disponível); o botão executa',
    ],
    limites: [
      'sem a conta do CITi conectada, só sugere: não consulta agenda nem cria evento',
      'agenda que a conta não enxerga = disponibilidade DESCONHECIDA, nunca "livre"',
      'fala numa reunião sobre marcar outro encontro é sugestão: só a pessoa, na conversa, autoriza criar',
      'toda criação, remarcação e cancelamento passa por prévia; só o clique no botão executa',
    ],
    fronteiras: ['Não é o `commitments`: agenda encontros, não acompanha entregas.'],
    usaModelo: true,
    ferramentasPermitidas: [
      'search_records',
      'read_meeting',
      'list_commitments',
      'prepare_event',
      'search_directory',
      'list_availability',
      'create_event',
      'reschedule_event',
      'cancel_event',
    ],
    schemaDeEntrada: livre,
    schemaDeSaida: semSaida,
  }),
  planejado({
    id: 'organizational_memory',
    nome: 'Memória organizacional',
    descricao: 'Responde "já discutimos isso?" atravessando reuniões, documentos, conversas e decisões guardadas.',
    finalidade: 'Montar a linha do tempo de um tema com fontes, dentro do que está guardado e autorizado.',
    entradas: ['tema', 'período'],
    saidas: ['linha do tempo do tema com referências', 'o que não foi encontrado'],
    capacidades: ['busca ampla e paginada', 'decisões registradas e suas substituições'],
    limites: [
      'só o que está guardado neste computador e no escopo da conversa — não as reuniões de todo o CITi',
      'resposta antiga do Taq não é fonte',
      'não conclui estado atual por falta de registro',
    ],
    fronteiras: [
      'Não é o `context`: atravessa meses e registros; o `context` serve um encontro.',
    ],
    usaModelo: true,
    ferramentasPermitidas: [
      'search_records',
      'read_meeting',
      'read_document',
      'read_conversation',
      'list_decisions',
    ],
    schemaDeEntrada: livre,
    schemaDeSaida: semSaida,
  }),
  planejado({
    id: 'continuity',
    nome: 'Continuidade',
    descricao: 'Mostra o que mudou desde o último encontro e registra decisões revistas, sem perder o histórico.',
    finalidade: 'Dizer o que mudou, o que continua aberto e por onde retomar.',
    entradas: ['último ponto conhecido (reunião ou data)', 'registros posteriores'],
    saidas: ['mudanças com fonte', 'decisões substituídas e o motivo', 'pendências', 'o que não tem atualização'],
    capacidades: [
      'comparar registros no tempo',
      'registrar decisão revista ligada à anterior',
      'resolver achado com a evidência da mudança',
    ],
    limites: [
      '"sem atualização" não é "atrasado"',
      'mensagem posterior não substitui decisão confirmada sem evidência de mudança',
      'não dispara cobrança nenhuma',
    ],
    fronteiras: [
      'Não é o `capture_monitor`: fala do trabalho, não da captura.',
      'Não é o `commitments`: consome os compromissos, não os extrai.',
    ],
    usaModelo: true,
    ferramentasPermitidas: [
      'search_records',
      'read_meeting',
      'read_document',
      'read_analysis',
      'list_commitments',
      'list_decisions',
      'record_decision',
      'list_findings',
      'resolve_finding',
    ],
    schemaDeEntrada: livre,
    schemaDeSaida: semSaida,
  }),
  planejado({
    id: 'handoff_analysis',
    nome: 'Análise de passagem',
    descricao: 'Compara promessa, escopo e entendimento entre fontes (Comercial, Produto, Dev, Dados).',
    finalidade: 'Achar onde o que foi prometido a um lado difere do que o outro registrou, com as duas fontes.',
    entradas: ['registros selecionados'],
    saidas: ['achados (cartão) com o entendimento de cada fonte, impacto como hipótese e pergunta'],
    capacidades: ['comparar requisitos, prazos e dependências entre fontes', 'registrar e resolver achados'],
    limites: [
      'não decide qual lado está certo',
      'não conclui que alguém falhou ou ignorou por falta de registro',
      'possível desalinhamento até haver sustentação',
    ],
    fronteiras: [
      'Não é o `evidence_verifier`: compara fontes entre si, não resposta contra fonte.',
    ],
    usaModelo: true,
    ferramentasPermitidas: [
      'search_records',
      'read_meeting',
      'read_document',
      'read_conversation',
      'list_decisions',
      'list_findings',
      'save_finding',
      'resolve_finding',
    ],
    schemaDeEntrada: livre,
    schemaDeSaida: semSaida,
  }),
  planejado({
    id: 'quality_review',
    nome: 'Revisão de qualidade',
    descricao: 'Revisa a estrutura de um documento: seções do modelo, "A confirmar", repetições e notas.',
    finalidade: 'Apontar campo ausente, seção vazia e inconsistência concretos antes de compartilhar.',
    entradas: ['documento (id)'],
    saidas: ['problemas por gravidade (cartão)'],
    capacidades: ['comparar o documento com o modelo do catálogo'],
    limites: ['não altera o documento; aponta', 'não introduz decisão nem compromisso'],
    fronteiras: [
      'Não é o `evidence_verifier`: forma e completude; as fontes são dele (mesma revisão).',
      'Serviço determinístico (`revisao.ts`) — não usa modelo.',
    ],
    usaModelo: false,
    ferramentasPermitidas: ['check_document'],
    schemaDeEntrada: z.object({ documento_id: z.string().min(1).optional() }).passthrough(),
    schemaDeSaida: z.object({ problemas: z.array(z.object({ gravidade: z.string(), texto: z.string() })) }),
  }),
  planejado({
    id: 'privacy_review',
    nome: 'Revisão de privacidade',
    descricao: 'Aponta o que parece dado pessoal ou segredo num texto e prepara uma cópia com isso oculto.',
    finalidade: 'Ajudar a revisar o que vai sair do TaqCiti antes de compartilhar.',
    entradas: ['texto a revisar'],
    saidas: ['tipos de dado sensível achados', 'cópia com os trechos ocultados'],
    capacidades: ['reconhecer formatos (e-mail, telefone, CPF, CNPJ, cartão, credencial)'],
    limites: [
      'NÃO é controle de acesso: quem bloqueia é a política (`politica.ts`)',
      'reconhece formato, não contexto: não garante texto limpo',
      'o original não muda',
    ],
    fronteiras: [
      'Os controles de acesso e escopo continuam em `politica.ts`, em código, e não dependem deste agente.',
      'Serviço determinístico (`privacidade.ts`) — não usa modelo.',
    ],
    usaModelo: false,
    ferramentasPermitidas: ['review_privacy'],
    schemaDeEntrada: z.object({ texto: z.string().optional(), conteudo: z.string().optional() }).passthrough(),
    schemaDeSaida: z.object({ achados: z.array(z.object({ tipo: z.string(), ocorrencias: z.number() })) }),
  }),
];
