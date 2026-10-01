/**
 * O CATÁLOGO dos especialistas futuros — todos `planned`, nenhum com executor.
 *
 * Existe para que cada responsabilidade tenha lugar, nome e fronteira ANTES de
 * ser implementada: quem pegar `meeting_analyst` amanhã sabe o que ele recebe,
 * o que devolve, o que não é problema dele e qual vizinho cuida disso.
 *
 * O que este arquivo NÃO faz: simular. Nenhuma entrada tem executor, e o
 * registro recusa marcar como `available` quem não tem. Chamar um destes pela
 * delegação devolve `agente_indisponivel` — nunca um resultado fictício. E o
 * modelo nem fica sabendo que eles existem: a ferramenta de delegação só é
 * oferecida com especialistas disponíveis, e só lista esses.
 *
 * `usaModelo: false` marca o que deve ser SERVIÇO DETERMINÍSTICO quando for
 * implementado — monitorar captura é comparar relógios, não pedir opinião a um
 * modelo. E `privacy_review`, quando existir, ajuda a APONTAR conteúdo
 * sensível; quem impede acesso continua sendo a política (`politica.ts`).
 *
 * Os schemas de entrada e saída abaixo são o contrato mínimo de cada um. Quem
 * implementar pode estreitá-los; alargá-los muda o contrato e merece revisão.
 */
import { z } from 'zod/v4';
import { IDS_DE_TIPO } from '@/features/documents/catalogo';
import type { DefinicaoDeAgente } from './tipos';

const referencia = z.object({ ref: z.string(), nota: z.string().optional() });
const reuniaoAlvo = z.object({ reuniao_id: z.string().min(1) });

type Planejado = Omit<DefinicaoDeAgente, 'estado' | 'executor' | 'versaoDasInstrucoes'>;

function planejado(a: Planejado): DefinicaoDeAgente {
  return { ...a, estado: 'planned', versaoDasInstrucoes: null };
}

export const ESPECIALISTAS: readonly DefinicaoDeAgente[] = [
  planejado({
    id: 'capture_monitor',
    nome: 'Monitor de captura',
    descricao: 'Detecta interrupções e lacunas na captura da transcrição.',
    finalidade:
      'Dizer, com base em relógios e contadores, onde a transcrição tem buraco.',
    entradas: ['reunião (id)', 'estado vivo da captura', 'métricas de captura'],
    saidas: ['intervalos sem legenda', 'reconexões', 'grau de confiança da transcrição'],
    capacidades: ['comparar instantes de segmentos', 'ler contadores de degradação'],
    limites: ['não reconstrói o que não foi capturado', 'não interpreta o conteúdo'],
    fronteiras: [
      'Não é o `continuity`: aponta buracos na captura, não mudanças no trabalho.',
      'Serviço determinístico sobre `metadata` e instantes — não precisa de modelo.',
    ],
    usaModelo: false,
    ferramentasPermitidas: ['read_meeting'],
    schemaDeEntrada: reuniaoAlvo,
    schemaDeSaida: z.object({
      lacunas: z.array(
        z.object({ deMs: z.number(), ateMs: z.number(), motivo: z.string() }),
      ),
      confianca: z.enum(['alta', 'media', 'baixa']),
    }),
  }),
  planejado({
    id: 'context',
    nome: 'Preparador de contexto',
    descricao: 'Prepara o contexto relevante para um pedido ou uma reunião.',
    finalidade: 'Montar o pacote mínimo de registros e trechos que um pedido precisa.',
    entradas: ['pedido', 'registros selecionados', 'escopo'],
    saidas: ['lista de registros com trechos e referências', 'o que não foi encontrado'],
    capacidades: ['buscar', 'ler fatias', 'ordenar por relevância'],
    limites: ['não responde o pedido', 'não conclui nada sobre o conteúdo'],
    fronteiras: [
      'Não é o `organizational_memory`: trabalha dentro do pedido atual, não entre projetos.',
      'Hoje o próprio orquestrador faz isto com search_records/read_meeting.',
    ],
    usaModelo: true,
    ferramentasPermitidas: ['search_records', 'read_meeting', 'read_document'],
    schemaDeEntrada: z.object({ pedido: z.string().min(1) }),
    schemaDeSaida: z.object({
      referencias: z.array(referencia),
      ausentes: z.array(z.string()),
    }),
  }),
  planejado({
    id: 'meeting_copilot',
    nome: 'Copiloto de reunião',
    descricao: 'Apoia a pessoa durante a reunião ao vivo.',
    finalidade: 'Responder, durante a captura, o que foi dito até agora.',
    entradas: ['reunião em andamento (id)', 'pergunta', 'trecho selecionado'],
    saidas: ['resposta curta com referências aos segmentos recentes'],
    capacidades: ['ler a janela recente da transcrição'],
    limites: [
      'não fala na reunião',
      'não envia mensagem no chat do Meet sem pedido explícito',
    ],
    fronteiras: [
      'Não é o `meeting_analyst`: responde no calor da reunião; a análise estruturada vem depois.',
    ],
    usaModelo: true,
    ferramentasPermitidas: ['read_meeting'],
    schemaDeEntrada: reuniaoAlvo.extend({ pergunta: z.string().min(1) }),
    schemaDeSaida: z.object({ resposta: z.string(), referencias: z.array(referencia) }),
  }),
  planejado({
    id: 'meeting_analyst',
    nome: 'Analista de reunião',
    descricao: 'Estrutura assuntos, decisões, dúvidas e riscos de uma reunião.',
    finalidade: 'Transformar a transcrição em itens estruturados, cada um com fonte.',
    entradas: ['reunião (id)', 'decisões anteriores relacionadas (opcional)'],
    saidas: [
      'assuntos',
      'propostas',
      'decisões confirmadas/substituídas',
      'dúvidas',
      'riscos',
    ],
    capacidades: ['ler a transcrição por fatias', 'distinguir proposta de decisão'],
    limites: [
      'não atribui responsável ou prazo que não esteja dito',
      'não redige documento',
    ],
    fronteiras: [
      'Não é o `commitments`: identifica decisões; compromissos com dono e prazo são dele.',
      'Não é o `documents`: entrega estrutura, não texto final.',
    ],
    usaModelo: true,
    ferramentasPermitidas: ['read_meeting', 'search_records'],
    schemaDeEntrada: reuniaoAlvo,
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
    descricao: 'Revisa se as afirmações de uma resposta são sustentadas pelas fontes.',
    finalidade:
      'Julgar, afirmação por afirmação, se o trecho citado diz o que se afirma.',
    entradas: ['texto com citações', 'referências'],
    saidas: ['veredito por afirmação: sustentada, parcial, não sustentada'],
    capacidades: ['comparar afirmação e trecho'],
    limites: ['não reescreve a resposta', 'não busca fontes novas'],
    fronteiras: [
      'O runtime já confere se a referência EXISTE e está no lugar (determinístico). Este ' +
        'agente julgaria o SENTIDO — é trabalho de modelo e continuará sendo julgamento.',
      'Não é o `quality_review`: olha sustentação, não forma nem completude.',
    ],
    usaModelo: true,
    ferramentasPermitidas: ['read_meeting', 'read_document'],
    schemaDeEntrada: z.object({ texto: z.string().min(1), refs: z.array(z.string()) }),
    schemaDeSaida: z.object({
      afirmacoes: z.array(
        z.object({
          texto: z.string(),
          veredito: z.enum(['sustentada', 'parcial', 'nao_sustentada']),
        }),
      ),
    }),
  }),
  planejado({
    id: 'commitments',
    nome: 'Compromissos',
    descricao: 'Extrai e acompanha compromissos e dependências.',
    finalidade: 'Listar quem ficou de fazer o quê, até quando, e o que depende do quê.',
    entradas: ['reuniões (ids)', 'documentos relacionados'],
    saidas: ['compromissos com responsável, prazo e fonte — ou o campo em aberto'],
    capacidades: ['ler transcrições', 'cruzar reuniões'],
    limites: [
      'não declara atraso por ausência de atualização',
      'não inventa responsável nem prazo',
    ],
    fronteiras: [
      'Não é o `continuity`: registra compromissos; o que mudou desde a última vez é dele.',
      'Não é o `scheduling`: não marca nada na agenda.',
    ],
    usaModelo: true,
    ferramentasPermitidas: ['search_records', 'read_meeting', 'read_document'],
    schemaDeEntrada: z.object({ reunioes: z.array(z.string()).min(1) }),
    schemaDeSaida: z.object({
      compromissos: z.array(
        z.object({
          descricao: z.string(),
          responsavel: z.string().nullable(),
          prazo: z.string().nullable(),
          refs: z.array(z.string()),
        }),
      ),
    }),
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
    capacidades: ['seguir a estrutura de cada tipo do catálogo'],
    limites: [
      'só tipos do catálogo; fora dele, orienta a usar o Claude',
      'só grava quando a pessoa pediu',
      'sem tipo dito pela pessoa, pergunta o tipo e não cria nada',
      'o resto não pergunta: gera com o que tem, marca "A confirmar", e o Taq pergunta na conversa depois',
      'compartilhar ou enviar é ação separada, fora deste agente',
    ],
    fronteiras: [
      'HOJE quem conduz o fluxo é o orquestrador, com as MESMAS ferramentas listadas aqui e o ' +
        'MESMO catálogo. Ativar este agente é mover a condução, sem mudar contrato nem catálogo.',
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
      'exportar a transcrição em .txt',
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
      'get_app_capabilities',
      'get_usage_guide',
    ],
    schemaDeEntrada: z.object({}).passthrough(),
    schemaDeSaida: z.never(),
  }),  planejado({
    id: 'communication',
    nome: 'Comunicação',
    descricao: 'Prepara mensagens e comunicações contextualizadas.',
    finalidade: 'Rascunhar e-mails, recados e avisos a partir dos registros.',
    entradas: ['destinatário', 'objetivo da mensagem', 'fontes'],
    saidas: ['rascunho de mensagem'],
    capacidades: ['adequar tom e tamanho'],
    limites: [
      'NÃO ENVIA nada: enviar é ação externa e exige autorização para o destinatário e o conteúdo',
    ],
    fronteiras: [
      'Não é o `documents`: mensagem curta com destinatário, não documento de registro.',
    ],
    usaModelo: true,
    ferramentasPermitidas: ['search_records', 'read_meeting', 'read_document'],
    schemaDeEntrada: z.object({ destinatario: z.string(), objetivo: z.string().min(1) }),
    schemaDeSaida: z.object({ rascunho: z.string() }),
  }),
  planejado({
    id: 'scheduling',
    nome: 'Agendamento',
    descricao: 'Trabalha com disponibilidade e agendamento.',
    finalidade: 'Sugerir horários e preparar convites.',
    entradas: ['participantes', 'janela de datas', 'duração'],
    saidas: ['opções de horário', 'rascunho de convite'],
    capacidades: ['ler disponibilidade — quando houver integração de agenda'],
    limites: [
      'não cria evento sem autorização explícita',
      'sem integração de agenda nesta versão',
    ],
    fronteiras: ['Não é o `commitments`: agenda encontros, não acompanha entregas.'],
    usaModelo: true,
    ferramentasPermitidas: [],
    schemaDeEntrada: z.object({
      participantes: z.array(z.string()),
      duracaoMin: z.number().int(),
    }),
    schemaDeSaida: z.object({ opcoes: z.array(z.string()) }),
  }),
  planejado({
    id: 'organizational_memory',
    nome: 'Memória organizacional',
    descricao: 'Recupera conhecimento entre registros e projetos.',
    finalidade:
      'Responder "já discutimos isso?" atravessando reuniões e documentos antigos.',
    entradas: ['tema', 'período'],
    saidas: ['linha do tempo do tema com referências'],
    capacidades: ['busca ampla', 'agrupamento por tema'],
    limites: [
      'só o que está no escopo da pessoa',
      'não conclui estado atual por falta de registro',
    ],
    fronteiras: [
      'Não é o `context`: atravessa projetos e meses; o `context` serve um pedido.',
    ],
    usaModelo: true,
    ferramentasPermitidas: ['search_records', 'read_meeting', 'read_document'],
    schemaDeEntrada: z.object({ tema: z.string().min(1) }),
    schemaDeSaida: z.object({
      eventos: z.array(
        z.object({ data: z.string(), texto: z.string(), refs: z.array(z.string()) }),
      ),
    }),
  }),
  planejado({
    id: 'continuity',
    nome: 'Continuidade',
    descricao: 'Identifica mudanças e prepara a retomada do trabalho.',
    finalidade: 'Dizer o que mudou desde a última vez e por onde retomar.',
    entradas: ['último ponto conhecido (reunião ou documento)', 'registros posteriores'],
    saidas: ['mudanças com fonte', 'pendências conhecidas', 'o que não tem atualização'],
    capacidades: ['comparar registros no tempo'],
    limites: ['"sem atualização" não é "atrasado"'],
    fronteiras: [
      'Não é o `capture_monitor`: fala do trabalho, não da captura.',
      'Não é o `commitments`: consome os compromissos dele, não os extrai.',
    ],
    usaModelo: true,
    ferramentasPermitidas: ['search_records', 'read_meeting', 'read_document'],
    schemaDeEntrada: z.object({ desde: z.string() }),
    schemaDeSaida: z.object({
      mudancas: z.array(z.object({ texto: z.string(), refs: z.array(z.string()) })),
    }),
  }),
  planejado({
    id: 'handoff_analysis',
    nome: 'Análise de passagem',
    descricao: 'Compara promessas, escopo e entendimento entre áreas.',
    finalidade:
      'Achar onde o que foi prometido a um lado difere do que o outro entendeu.',
    entradas: ['registros de cada lado (ids)'],
    saidas: ['divergências lado a lado, com as duas fontes'],
    capacidades: ['comparar afirmações de fontes diferentes'],
    limites: [
      'não decide qual lado está certo',
      'preserva a divergência quando não há como resolver',
    ],
    fronteiras: [
      'Não é o `evidence_verifier`: compara fontes entre si, não resposta contra fonte.',
    ],
    usaModelo: true,
    ferramentasPermitidas: ['search_records', 'read_meeting', 'read_document'],
    schemaDeEntrada: z.object({ ladoA: z.array(z.string()), ladoB: z.array(z.string()) }),
    schemaDeSaida: z.object({
      divergencias: z.array(
        z.object({
          tema: z.string(),
          refsA: z.array(z.string()),
          refsB: z.array(z.string()),
        }),
      ),
    }),
  }),
  planejado({
    id: 'quality_review',
    nome: 'Revisão de qualidade',
    descricao: 'Revisa consistência, completude e qualidade das saídas.',
    finalidade:
      'Apontar contradição interna, seção faltando e texto confuso antes de entregar.',
    entradas: ['saída a revisar', 'o pedido original'],
    saidas: ['problemas encontrados, por gravidade'],
    capacidades: ['ler a saída inteira'],
    limites: ['não altera a saída; sugere'],
    fronteiras: ['Não é o `evidence_verifier`: forma e completude, não sustentação.'],
    usaModelo: true,
    ferramentasPermitidas: ['read_document'],
    schemaDeEntrada: z.object({ texto: z.string().min(1), pedido: z.string() }),
    schemaDeSaida: z.object({
      problemas: z.array(
        z.object({ gravidade: z.enum(['alta', 'media', 'baixa']), texto: z.string() }),
      ),
    }),
  }),
  planejado({
    id: 'privacy_review',
    nome: 'Revisão de privacidade',
    descricao: 'Auxilia na identificação de conteúdo sensível.',
    finalidade: 'Apontar dado pessoal ou confidencial antes de algo sair do computador.',
    entradas: ['conteúdo a revisar', 'destino pretendido'],
    saidas: ['trechos sensíveis com o motivo'],
    capacidades: ['reconhecer padrões de dado pessoal'],
    limites: [
      'NÃO é controle de acesso: não libera nem bloqueia nada — quem bloqueia é a política',
    ],
    fronteiras: [
      'Os controles de acesso e escopo continuam em `politica.ts`, em código, e não dependem ' +
        'deste agente existir.',
    ],
    usaModelo: true,
    ferramentasPermitidas: [],
    schemaDeEntrada: z.object({ conteudo: z.string().min(1) }),
    schemaDeSaida: z.object({
      trechos: z.array(z.object({ texto: z.string(), motivo: z.string() })),
    }),
  }),
];
