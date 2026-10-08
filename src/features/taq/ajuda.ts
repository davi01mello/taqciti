/**
 * A REFERÊNCIA DE AJUDA do TaqCiti — a única fonte do que o `app_assistant`
 * diz sobre o aplicativo. Ele não explica o TaqCiti de memória: consulta isto
 * por `get_app_capabilities` e `get_usage_guide` (`ferramentasDeApp.ts`).
 *
 * ── Três coisas diferentes, que não se confundem ─────────────────────────────
 *
 *   FUNCIONALIDADES   o que a TELA faz hoje (`FUNCIONALIDADES`). Cada uma com o
 *                     caminho, os nomes exatos, os passos, os pré-requisitos e
 *                     as limitações — tirados do código, não do que parecia.
 *   OPERAÇÃO DO AGENTE a `ferramenta` de uma funcionalidade. Existir na tela não
 *                     quer dizer que o agente faz: sem `ferramenta`, é só
 *                     manual. E o "consegue executar" que o agente recebe não
 *                     sai daqui, sai do REGISTRO de ferramentas (ver
 *                     `capacidadesDoApp`): ferramenta que sumir do registro
 *                     some da resposta.
 *   FORA DO APP       `FORA_DO_APP`: o que é planejado (um especialista do
 *                     catálogo em `planned`) ou simplesmente não existe. É o
 *                     que deixa o agente dizer "isso não existe" em vez de
 *                     inventar caminho. Planejado NUNCA vira passo de uso.
 *
 * ── Como isto se mantém verdadeiro ───────────────────────────────────────────
 *
 * `implementacao` liga cada entrada aos arquivos que a implementam. Os testes
 * (`ajuda.test.ts`) cobram:
 *   - todo rótulo citado existe, literalmente, num dos arquivos de
 *     `implementacao` — um botão renomeado lá quebra o teste aqui;
 *   - toda `ferramenta` citada está registrada, e toda ferramenta de operação
 *     registrada tem a sua entrada (uma ferramenta nova sem ajuda quebra);
 *   - todo `agentePlanejado` continua `planned` no catálogo (ativou o
 *     especialista? a entrada tem de virar funcionalidade);
 *   - toda entrada marcada `interface` teve os rótulos vistos na tela pela
 *     volta do `scripts/verify-ajuda.cjs` (`docs/verification/ajuda/`).
 *
 * `verificacao`:
 *   interface       os rótulos foram vistos na extensão rodando (o script acima);
 *   codigo          conferido nos componentes, mas não na tela — em geral, o
 *                   que só existe dentro de um Google Meet de verdade;
 *   nao_verificada  não confirmado; o agente avisa isso ao responder.
 *
 * Mapa levantado em 23/09/2026 a partir dos componentes da HOME, da sidebar,
 * da cápsula e dos handlers do background. Ver `docs/ajuda-do-taqciti.md`.
 */
import { termosDe } from './busca';

/** Sobe quando o conteúdo muda — vai no resultado da consulta. */
export const VERSAO_DA_REFERENCIA = '2026-10-08';

export const ASSUNTOS = [
  'captura',
  'reunioes',
  'conversas',
  'documentos',
  'exportacao',
  'configuracoes',
  'navegacao',
  'acompanhamento',
] as const;
export type Assunto = (typeof ASSUNTOS)[number];

export const NOME_DO_ASSUNTO: Record<Assunto, string> = {
  captura: 'Captura de reuniões',
  reunioes: 'Reuniões guardadas',
  conversas: 'Conversas com o Taq',
  documentos: 'Documentos',
  exportacao: 'Exportar e enviar',
  configuracoes: 'Conexões e configurações',
  navegacao: 'Onde fica cada coisa',
  acompanhamento: 'Compromissos, decisões e achados',
};

export type Verificacao = 'interface' | 'codigo' | 'nao_verificada';

export interface Funcionalidade {
  id: string;
  assunto: Assunto;
  titulo: string;
  oQueFaz: string;
  /** Superfície → seção → elemento. */
  onde: string;
  passos: string[];
  preRequisitos?: string[];
  limitacoes?: string[];
  /** Nomes exatos da tela citados nos passos — conferidos contra `implementacao`. */
  rotulos: string[];
  /** Os arquivos que implementam a funcionalidade: é onde cada rótulo tem de estar. */
  implementacao: string[];
  verificacao: Verificacao;
  /** A ferramenta do agente que faz o mesmo. Ausente: só manual. */
  ferramenta?: string;
  /** Como a pessoa pede ao Taq, quando há ferramenta. */
  comoPedir?: string;
  /** Palavras que costumam aparecer na pergunta. Sem acento. */
  palavras: string[];
}

export interface ForaDoApp {
  id: string;
  titulo: string;
  situacao: 'planejado' | 'indisponivel';
  resposta: string;
  /** O especialista do catálogo que o planeja — o teste cobra que siga `planned`. */
  agentePlanejado?: string;
  palavras: string[];
}

// Arquivos citados mais de uma vez.
const CAPSULA = 'src/content/ui/Capsula.tsx';
const PERGUNTA = 'src/sidepanel/Pergunta.tsx';
const SIDEBAR = 'src/sidepanel/App.tsx';
const SELETORES = 'src/sidepanel/Seletores.tsx';
const REUNIAO_AO_VIVO = 'src/sidepanel/Reuniao.tsx';
const ACOES_AO_VIVO = 'src/sidepanel/AcoesDaReuniao.tsx';
const ABAS = 'src/sidepanel/AbasDaReuniao.tsx';
const REUNIOES_SIDEBAR = 'src/sidepanel/Reunioes.tsx';
const NOTAS_SIDEBAR = 'src/sidepanel/Notas.tsx';
const CONVERSA_SIDEBAR = 'src/sidepanel/Conversa.tsx';
const HOME = 'src/home/HomePage.tsx';
const NAV = 'src/home/SideNav.tsx';
const PAGINAS = 'src/home/Paginas.tsx';
const NOTAS_HOME = 'src/home/NotasDaReuniao.tsx';
const GERAR = 'src/home/GerarDocumento.tsx';
const DOCUMENTOS = 'src/home/Documentos.tsx';
const CONVERSAS_MENU = 'src/home/ConversasMenu.tsx';
const ASSISTENTE = 'src/home/AssistantView.tsx';
const CONEXOES = 'src/home/Conexoes.tsx';
const RESPOSTA = 'src/shared/ui/RespostaDoTaq.tsx';
const COPIAR = 'src/shared/ui/BotaoCopiar.tsx';
const CATALOGO_DOCS = 'src/features/documents/catalogo.ts';
const MARCAS = 'src/features/annotations/marks.ts';
const EXPORTAR = 'src/features/history/export.ts';
const CARTOES = 'src/shared/ui/CartoesDoTaq.tsx';
const ACOMPANHAMENTO = 'src/home/Acompanhamento.tsx';
const TRABALHO = 'src/features/trabalho/store.ts';
const CAPTURA_TAQ = 'src/features/taq/captura.ts';
const CARTAO_DE_TELA = 'src/shared/ui/CartaoDeTela.tsx';

export const FUNCIONALIDADES: readonly Funcionalidade[] = [
  // ------------------------------------------------------------------ captura
  {
    id: 'registrar_reuniao',
    assunto: 'captura',
    titulo: 'Registrar (transcrever) uma reunião do Google Meet',
    oQueFaz:
      'Guarda neste computador a transcrição da reunião, lida das legendas do Google Meet.',
    onde: 'Página do Google Meet (a cápsula do TaqCiti) ou a sidebar',
    passos: [
      'Entre na reunião pelo Google Meet, no navegador com a extensão instalada.',
      'O TaqCiti pergunta “Deseja registrar esta reunião?” ao lado da cápsula: clique em “Iniciar captura”. Na sidebar, a mesma pergunta tem o botão “Registrar”.',
      'O TaqCiti liga as legendas do Meet sozinho e as esconde da tela. Enquanto isso, a sidebar mostra “Preparando a transcrição…”.',
      'As falas aparecem na sidebar, em “Reunião”, na aba “Transcrição”.',
      'Se a sala já tem uma gravação guardada, a pergunta mostra qual é e oferece “Continuar de onde parou” (as falas novas entram nela) ou “Nova gravação”.',
    ],
    preRequisitos: [
      'Reunião no Google Meet (meet.google.com).',
      'As legendas do Meet precisam produzir texto: o TaqCiti tenta ligá-las sozinho.',
    ],
    limitacoes: [
      'Não grava áudio nem vídeo: só lê as legendas.',
      'Nada é capturado antes de a pessoa aceitar.',
      'Respondendo “Agora não”, não há botão para começar depois na mesma participação; a pergunta volta ao entrar de novo na reunião depois de 10 minutos, ou depois de reiniciar o navegador.',
      'Se o TaqCiti não conseguir ligar as legendas, não há controle para ligá-las à mão pela extensão. O que a tela mostra nesse caso não está documentado.',
      'Voltar à mesma sala em até 10 minutos continua a gravação sem perguntar. Continuar uma gravação só é oferecido para gravações feitas a partir de 03/10/2026, que guardam de que sala vieram.',
    ],
    rotulos: [
      'Deseja registrar esta reunião?',
      'Continuar de onde parou',
      'Nova gravação',
      'Iniciar captura',
      'Agora não',
      'Registrar',
      'Preparando a transcrição…',
      'Reunião',
      'Transcrição',
    ],
    implementacao: [CAPSULA, PERGUNTA, REUNIAO_AO_VIVO, SELETORES],
    verificacao: 'codigo',
    palavras: [
      'comecar', 'iniciar', 'registrar', 'transcricao', 'transcrever', 'capturar',
      'captura', 'gravar', 'meet', 'legenda', 'legendas',
    ],
  },
  {
    id: 'pausar_captura',
    assunto: 'captura',
    titulo: 'Pausar e retomar a captura',
    oQueFaz: 'Para de guardar falas novas até retomar; o que já foi transcrito fica.',
    onde: 'Sidebar → “Reunião”, durante a reunião',
    passos: [
      'Na sidebar, em “Reunião”, clique em “Pausar”.',
      'Para voltar a capturar, clique em “Retomar”.',
    ],
    limitacoes: [
      'As falas ditas durante a pausa não entram na transcrição.',
      'Só funciona com a reunião em andamento.',
    ],
    rotulos: ['Pausar', 'Retomar', 'Reunião'],
    implementacao: [ACOES_AO_VIVO, SELETORES],
    verificacao: 'interface',
    palavras: ['pausar', 'pausa', 'retomar', 'parar', 'continuar'],
  },
  {
    id: 'finalizar_reuniao',
    assunto: 'captura',
    titulo: 'Encerrar a captura',
    oQueFaz: 'Encerra a captura e guarda a reunião no histórico.',
    onde: 'Sidebar → “Reunião”, durante a reunião, na ponta da linha das abas',
    passos: [
      'Na sidebar, clique em “Finalizar” e, para confirmar, de novo em “Encerrar agora”. Sair da chamada no Meet também encerra.',
      'Ao encerrar, a sidebar abre a reunião recém-salva, com a transcrição dela. Para baixar o .txt ou gerar um documento, abra a reunião na HOME, em “Reuniões”.',
    ],
    limitacoes: [
      'Reunião sem nenhuma fala captada só é guardada se tiver um print ou uma nota.',
      'Durante a reunião, a transcrição já vai sendo guardada, a cada poucos segundos.',
      'Não há, na tela, como descartar a captura em andamento.',
    ],
    rotulos: ['Finalizar', 'Encerrar agora', 'Reunião', 'Reuniões'],
    implementacao: [ACOES_AO_VIVO, SELETORES, REUNIOES_SIDEBAR],
    verificacao: 'codigo',
    palavras: ['finalizar', 'encerrar', 'terminar', 'parar', 'fim', 'acabar'],
  },
  {
    id: 'marcar_trecho',
    assunto: 'captura',
    titulo: 'Marcar um trecho da transcrição',
    oQueFaz: 'Marca uma fala como destaque, dúvida, decisão ou ação.',
    onde: 'Sidebar → “Reunião”, na reunião em andamento ou recém-encerrada',
    passos: [
      'Na sidebar, clique numa fala da transcrição.',
      'Nos botões que aparecem embaixo dela, escolha “Destaque”, “Dúvida”, “Decisão” ou “Ação”.',
      'Clicar de novo na mesma marca a remove. Cada fala tem uma marca só.',
    ],
    limitacoes: [
      'Só na tela da reunião em andamento (ou recém-encerrada) da sidebar; reuniões antigas mostram a transcrição sem marcação.',
      'As marcas não vão para o .txt exportado.',
    ],
    rotulos: ['Destaque', 'Dúvida', 'Decisão', 'Ação', 'Ações deste trecho'],
    implementacao: [MARCAS, REUNIAO_AO_VIVO],
    verificacao: 'interface',
    palavras: ['marcar', 'marcacao', 'marca', 'destaque', 'destacar', 'trecho', 'decisao', 'duvida'],
  },
  {
    id: 'prints',
    assunto: 'captura',
    titulo: 'Tirar prints da reunião',
    oQueFaz: 'Guarda uma imagem da aba do Meet junto da reunião.',
    onde: 'Sidebar → “Reunião” → “Print”',
    passos: [
      'Na sidebar, em “Reunião”, clique em “Print”: o print é tirado e guardado na hora.',
      'Logo abaixo aparece “Print guardado com a reunião.”, com “Ver” e “Desfazer” por alguns segundos.',
      'Os prints da reunião ficam na aba “Prints”. Clique num para abri-lo; ali há “Apagar” e “Fechar”.',
    ],
    preRequisitos: ['A aba da reunião tem de estar à vista na janela dela.'],
    limitacoes: [
      'Até 12 prints por reunião e 40 no total; os mais antigos saem primeiro.',
      'Os prints não vão para a IA.',
    ],
    rotulos: [
      'Print',
      'Print guardado com a reunião.',
      'Ver',
      'Desfazer',
      'Prints',
      'Apagar',
      'Fechar',
      'Reunião',
    ],
    implementacao: [ACOES_AO_VIVO, REUNIAO_AO_VIVO, ABAS, SELETORES],
    verificacao: 'codigo',
    palavras: ['print', 'prints', 'captura de tela', 'screenshot', 'imagem', 'foto', 'tela'],
  },
  {
    id: 'captura_de_tela_pelo_taq',
    assunto: 'captura',
    titulo: 'Pedir ao Taq uma captura de tela',
    oQueFaz:
      'O Taq prepara UMA captura de tela. Você escolhe a aba, a janela ou a tela, vê a prévia e decide se guarda na reunião, abre ou baixa. Nunca é gravação nem captura contínua.',
    onde: 'Conversa com o Taq → cartão “Captura de tela”',
    passos: [
      'Peça: ‘capture a tela’ ou ‘registre esta tela na reunião’.',
      'No cartão, clique em “Escolher a tela e capturar” e escolha o que compartilhar na janela do navegador. Durante a reunião há também “Capturar a aba da reunião”.',
      'Na prévia, clique em “Salvar na reunião”, “Abrir” ou “Baixar”. “Descartar” apaga a prévia sem guardar nada.',
    ],
    preRequisitos: ['O navegador mostra o seletor de tela e pede a sua confirmação: o Taq não captura sozinho.'],
    limitacoes: [
      'Sem reunião no contexto, dá para abrir e baixar, mas não guardar.',
      'Cancelar o seletor não guarda nada. Cada clique é uma imagem só.',
      'As imagens guardadas seguem o limite dos prints: 12 por reunião e 40 no total.',
    ],
    rotulos: [
      'Escolher a tela e capturar',
      'Capturar a aba da reunião',
      'Salvar na reunião',
      'Abrir',
      'Baixar',
      'Descartar',
      'Captura de tela',
    ],
    implementacao: [CARTAO_DE_TELA],
    verificacao: 'codigo',
    ferramenta: 'capture_screen',
    comoPedir: 'Peça: “capture a tela” ou “registre esta tela na reunião”.',
    palavras: ['capturar tela', 'captura de tela', 'screenshot', 'print', 'registrar tela', 'tela'],
  },
  {
    id: 'avisar_no_chat',
    assunto: 'captura',
    titulo: 'Avisar no chat do Meet que a reunião está sendo transcrita',
    oQueFaz: 'Escreve no chat do Meet: “Estou usando o TaqCiti para transcrever esta reunião.”',
    onde: 'Sidebar → “Reunião”, no primeiro minuto da captura',
    passos: [
      'Logo que a captura começa, a sidebar pergunta se quer avisar no chat.',
      'Clique em “Enviar ao chat”.',
    ],
    limitacoes: [
      'Só é oferecido no primeiro minuto da captura, e uma vez por reunião.',
      'A mensagem fica visível para todos os participantes.',
      'Se o Meet não aceitar, a sidebar oferece copiar o texto para colar à mão.',
    ],
    rotulos: ['Enviar ao chat'],
    implementacao: [REUNIAO_AO_VIVO],
    verificacao: 'codigo',
    palavras: ['avisar', 'aviso', 'chat', 'participantes', 'consentimento'],
  },
  {
    id: 'esconder_capsula',
    assunto: 'captura',
    titulo: 'Esconder a cápsula da página do Meet',
    oQueFaz: 'Esconde a cápsula flutuante do TaqCiti em todas as abas do Meet.',
    onde: 'Página do Google Meet → o “×” ao lado da cápsula (aparece ao passar o mouse)',
    passos: [
      'Passe o mouse sobre a cápsula e clique no “×” (“Esconder a cápsula do TaqCiti”).',
      'Arrastar a cápsula muda a posição dela; clicar abre a sidebar.',
    ],
    limitacoes: [
      'Não há, na interface, um caminho confirmado para trazer a cápsula de volta: ela reaparece quando o TaqCiti pergunta se deve registrar uma nova reunião.',
    ],
    rotulos: ['Esconder a cápsula do TaqCiti'],
    implementacao: [CAPSULA],
    verificacao: 'codigo',
    palavras: ['capsula', 'esconder', 'ocultar', 'sumir', 'flutuante', 'mover', 'arrastar'],
  },

  // --------------------------------------------------------------- navegação
  {
    id: 'abrir_sidebar_e_home',
    assunto: 'navegacao',
    titulo: 'Abrir a sidebar e a HOME',
    oQueFaz:
      'A sidebar é o painel lateral do Chrome (transcrição ao vivo e conversa); a HOME é a página inteira com reuniões, documentos, conversas e conexões.',
    onde: 'Ícone do TaqCiti na barra do navegador; ícone “Abrir HOME” na sidebar',
    passos: [
      'Sidebar: clique no ícone do TaqCiti na barra do navegador. No Meet, clicar na cápsula também abre.',
      'HOME: na sidebar, clique no ícone “Abrir HOME” (no topo). O ícone “Reuniões”, ao lado, abre o histórico na própria sidebar.',
      'Na HOME, as seções ficam no menu da esquerda — “Assistente”, “Reuniões”, “Documentos” e “Conexões”. O menu abre ao levar o mouse à borda esquerda, ou pelo botão “Abrir navegação”.',
    ],
    limitacoes: ['Não há atalho de teclado para abrir a sidebar ou a HOME.'],
    rotulos: [
      'Abrir HOME',
      'Assistente',
      'Reuniões',
      'Documentos',
      'Conexões',
      'Abrir navegação',
    ],
    implementacao: [SIDEBAR, REUNIOES_SIDEBAR, NAV],
    verificacao: 'codigo',
    palavras: [
      'abrir', 'home', 'sidebar', 'painel', 'lateral', 'menu', 'secao', 'secoes',
      'onde', 'icone', 'navegacao',
    ],
  },

  // ---------------------------------------------------------------- reuniões
  {
    id: 'ver_reunioes',
    assunto: 'reunioes',
    titulo: 'Ver e abrir as reuniões guardadas',
    oQueFaz: 'Lista as reuniões capturadas neste computador e abre a transcrição e as notas.',
    onde: 'HOME → “Reuniões”; sidebar → o ícone “Reuniões” no topo, ou “Reunião” fora de uma reunião',
    passos: [
      'Na HOME, abra “Reuniões” e clique na reunião.',
      'Na sidebar, o ícone “Reuniões” (no topo) abre a lista a qualquer momento, inclusive durante uma reunião, sem encerrá-la; fora de uma reunião, “Reunião” já mostra a lista.',
      'Na sidebar, abrir uma reunião mostra só a transcrição dela. Para voltar à lista, use “Reuniões”, no topo da reunião.',
    ],
    limitacoes: [
      'A lista não tem busca nem filtro. Para achar pelo conteúdo, pergunte ao Taq na conversa.',
      'Na sidebar, a reunião guardada é só leitura: notas, .txt e documentos ficam na HOME.',
      'Tudo fica guardado neste computador.',
    ],
    rotulos: ['Reuniões', 'Reunião'],
    implementacao: [PAGINAS, REUNIOES_SIDEBAR, SELETORES],
    verificacao: 'interface',
    ferramenta: 'open_meeting',
    comoPedir: 'Peça na conversa: “abra a reunião X” ou “abra a última reunião”.',
    palavras: ['onde', 'reunioes', 'reuniao', 'historico', 'lista', 'encontrar', 'ver', 'abrir', 'ficam'],
  },
  {
    id: 'renomear_reuniao',
    assunto: 'reunioes',
    titulo: 'Renomear uma reunião',
    oQueFaz: 'Troca o nome da reunião; notas, marcações, prints e documentos continuam ligados a ela.',
    onde: 'HOME → “Reuniões” → a reunião → o nome no topo',
    passos: [
      'HOME → “Reuniões” → abra a reunião.',
      'Clique no nome dela no topo (o campo “Nome da reunião”), digite o novo nome e aperte Enter (ou clique fora). Esc desfaz.',
    ],
    limitacoes: ['A sidebar não renomeia reuniões.', 'Nome vazio não é aceito.'],
    rotulos: ['Reuniões', 'Nome da reunião'],
    implementacao: [PAGINAS],
    verificacao: 'interface',
    ferramenta: 'rename_meeting',
    comoPedir: 'Peça na conversa: “renomeie a reunião X para Y”.',
    palavras: ['renomear', 'nome', 'titulo', 'mudar', 'trocar'],
  },
  {
    id: 'apagar_reuniao',
    assunto: 'reunioes',
    titulo: 'Apagar uma reunião',
    oQueFaz: 'Tira a reunião do histórico, com as notas, as marcações e os prints dela.',
    onde: 'HOME → “Reuniões” → a reunião → “Mais ações”',
    passos: [
      'HOME → “Reuniões” → abra a reunião → “Mais ações” → “Apagar reunião” → “Apagar”.',
    ],
    limitacoes: [
      'Pela tela, apagar é definitivo. Pedindo ao Taq, a reunião vai para a lixeira dele por 30 dias e dá para desfazer.',
      'Os documentos gerados dela continuam em “Documentos”, sem o vínculo.',
      'Não dá para apagar enquanto a captura dela está em andamento.',
      'A sidebar não apaga reuniões.',
    ],
    rotulos: ['Reuniões', 'Mais ações', 'Apagar reunião', 'Apagar'],
    implementacao: [PAGINAS],
    verificacao: 'interface',
    ferramenta: 'delete_meeting',
    comoPedir: 'Peça na conversa: “apague a reunião X”. Ela fica 30 dias na lixeira do Taq.',
    palavras: ['apagar', 'excluir', 'deletar', 'remover', 'reuniao'],
  },
  {
    id: 'desfazer_exclusao',
    assunto: 'reunioes',
    titulo: 'Desfazer a exclusão de uma reunião',
    oQueFaz:
      'Devolve uma reunião apagada PELO TAQ, com nota, marcações, prints e os vínculos dos documentos.',
    onde: 'Na resposta do Taq que apagou a reunião: “Desfazer”',
    passos: [
      'Na resposta do Taq que apagou a reunião, clique em “Desfazer”.',
      'Ou peça na conversa: "desfaça" ou "restaure a reunião X".',
    ],
    limitacoes: [
      'Só vale para reunião apagada pelo Taq, por até 30 dias.',
      'Reunião, documento ou conversa apagados pela tela não voltam: não há lixeira na tela.',
    ],
    rotulos: ['Desfazer'],
    implementacao: [RESPOSTA],
    verificacao: 'interface',
    ferramenta: 'restore_meeting',
    comoPedir: 'Peça na conversa: “desfaça” ou “restaure a reunião X”.',
    palavras: ['desfazer', 'restaurar', 'recuperar', 'lixeira', 'voltar', 'apagada', 'apaguei'],
  },
  {
    id: 'notas_da_reuniao',
    assunto: 'reunioes',
    titulo: 'Notas da reunião',
    oQueFaz: 'Um texto livre por reunião, guardado separado da transcrição.',
    onde: 'HOME → “Reuniões” → a reunião → “Notas da reunião”; sidebar → a aba “Notas”',
    passos: [
      'HOME: abra a reunião; as notas ficam na coluna “Notas da reunião” (em janela estreita, na aba “Notas”). É só escrever: salva sozinho.',
      'Sidebar: na reunião, abra a aba “Notas”.',
      'Para apagar as notas, na HOME, use o ícone de lixeira “Apagar as notas desta reunião” → “Apagar”.',
    ],
    limitacoes: [
      'É a mesma nota na HOME e na sidebar.',
      'As notas não vão para o .txt exportado.',
      'Apagar as notas é definitivo; a transcrição não é afetada.',
    ],
    rotulos: ['Notas da reunião', 'Notas', 'Apagar as notas desta reunião', 'Apagar'],
    implementacao: [NOTAS_HOME, PAGINAS, ABAS, NOTAS_SIDEBAR],
    verificacao: 'interface',
    palavras: ['nota', 'notas', 'anotar', 'anotacao', 'anotacoes', 'escrever'],
  },

  // --------------------------------------------------------------- conversas
  {
    id: 'conversar_com_taq',
    assunto: 'conversas',
    titulo: 'Perguntar ao Taq sobre as reuniões e os documentos',
    oQueFaz:
      'O Taq responde com base nas reuniões e documentos guardados, com as fontes, e faz as operações que tem.',
    onde: 'HOME → “Assistente”; sidebar → “Conversa”',
    passos: [
      'HOME: em “Assistente”, escreva no campo e aperte Enter (Shift+Enter quebra linha).',
      'Sidebar: abra “Conversa” e escreva.',
      'Dá para pedir: "o que ficou decidido na reunião X?", "em qual reunião falamos do prazo?", "compare as reuniões X e Y", ou retomar o que foi dito numa conversa anterior.',
      'Cada fonte citada abre em “Fontes”, embaixo da resposta: clicar abre a reunião ou o documento.',
      'Enquanto o Taq trabalha, “Cancelar” interrompe.',
    ],
    preRequisitos: [
      'O Taq conectado ao servidor do TaqCiti. Sem ele, a mensagem fica salva como rascunho e ninguém responde.',
    ],
    limitacoes: [
      'Conversa aberta a partir de uma reunião, na sidebar, enxerga só aquela reunião e os documentos dela.',
      'Abrir uma fonte abre a reunião, mas não pula para o minuto do trecho.',
      'A busca é por palavras (ignora acento), sem sinônimos: se não achar, tente outro termo.',
      'A conferência das fontes garante que o trecho citado existe onde foi citado; a leitura do trecho é do Taq.',
      'Respostas antigas do Taq não valem como fonte: ele confirma na reunião ou no documento.',
      'Os trechos que o Taq consulta são enviados ao provedor de IA pelo servidor do TaqCiti.',
    ],
    rotulos: ['Assistente', 'Conversa', 'Cancelar', 'Fontes'],
    implementacao: [NAV, SELETORES, RESPOSTA],
    verificacao: 'interface',
    ferramenta: 'search_records',
    comoPedir: 'É só perguntar: “o que foi decidido na reunião X?”.',
    palavras: [
      'perguntar', 'pergunta', 'conversa', 'assistente', 'taq', 'ia', 'responder',
      'buscar', 'procurar', 'pesquisar', 'busca',
    ],
  },
  {
    id: 'contexto_da_conversa',
    assunto: 'conversas',
    titulo: 'Escolher o contexto de uma conversa',
    oQueFaz:
      'Diz ao Taq de qual registro a pergunta trata. Ele também lembra o último registro usado na conversa, para "essa reunião" continuar valendo ao fechar e reabrir.',
    onde: 'Sidebar → “Reunião” (“Pergunta rápida” ou “Perguntar sobre o trecho”); na HOME, pelo próprio texto da pergunta',
    passos: [
      'Sidebar: na reunião, “Pergunta rápida” pergunta sobre a reunião inteira ali mesmo, e a pergunta fica numa conversa com a reunião como contexto; “Perguntar sobre o trecho”, numa fala, leva só aquele trecho para a conversa. O contexto aparece acima do campo; o “×” (“Tirar o contexto desta pergunta”) o remove.',
      'HOME: diga o nome da reunião ou do documento na pergunta ("o que ficou decidido no Planejamento da Sprint 12?").',
      'Depois disso, "essa reunião" é a de que a conversa vinha falando. Nomear outra reunião vale mais do que a lembrada.',
      'Para começar sem contexto: “Nova conversa” (na HOME) ou “Nova” (na sidebar).',
    ],
    limitacoes: [
      'Na HOME não há botão para anexar uma reunião ou um documento à pergunta.',
      'Conversa que nasceu de uma reunião, na sidebar, só enxerga aquela reunião e os documentos dela.',
      'Se o nome servir para mais de um registro parecido, o Taq pergunta qual.',
      'Registro apagado deixa de ser lembrado; renomeado aparece com o nome novo.',
    ],
    rotulos: [
      'Reunião',
      'Pergunta rápida',
      'Perguntar sobre o trecho',
      'Tirar o contexto desta pergunta',
      'Nova conversa',
      'Nova',
    ],
    implementacao: [ACOES_AO_VIVO, REUNIAO_AO_VIVO, CONVERSA_SIDEBAR, CONVERSAS_MENU, SELETORES],
    verificacao: 'interface',
    palavras: [
      'contexto', 'lembrar', 'lembra', 'memoria', 'anexar reuniao', 'escolher', 'retomar',
    ],
  },
  {
    id: 'perguntar_sobre_trecho',
    assunto: 'conversas',
    titulo: 'Perguntar sobre um trecho ou sobre a reunião em andamento',
    oQueFaz:
      'Pergunta sobre a reunião em andamento sem sair dela, ou leva um trecho como contexto para a conversa da sidebar.',
    onde: 'Sidebar → “Reunião”, na reunião em andamento',
    passos: [
      'Para a reunião inteira: clique em “Pergunta rápida”, na fila de ações, escreva e tecle Enter. A resposta aparece ali mesmo; “Continuar na conversa” abre a conversa com a pergunta e a resposta.',
      'Para um trecho: clique numa fala e escolha “Perguntar sobre o trecho”. A sidebar vai para “Conversa” com o contexto acima do campo. Escreva a pergunta e envie.',
      'Para tirar o contexto, use o “×” (“Tirar o contexto desta pergunta”).',
    ],
    limitacoes: [
      'Só na tela da reunião em andamento da sidebar.',
      'Sem o assistente conectado, a pergunta rápida fica guardada numa conversa, sem resposta.',
    ],
    rotulos: [
      'Pergunta rápida',
      'Continuar na conversa',
      'Perguntar sobre o trecho',
      'Tirar o contexto desta pergunta',
      'Conversa',
    ],
    implementacao: [REUNIAO_AO_VIVO, ACOES_AO_VIVO, CONVERSA_SIDEBAR, SELETORES],
    verificacao: 'interface',
    palavras: ['trecho', 'perguntar', 'contexto', 'fala', 'ia', 'durante'],
  },
  {
    id: 'nova_e_trocar_conversa',
    assunto: 'conversas',
    titulo: 'Começar uma conversa nova ou voltar a uma antiga',
    oQueFaz: 'As conversas ficam guardadas neste computador; HOME e sidebar veem as mesmas.',
    onde: 'HOME → ícone “Conversas” (no topo, à direita); sidebar → “Conversa”',
    passos: [
      'HOME: clique no ícone “Conversas” → “Nova conversa”, ou escolha uma conversa da lista.',
      'Sidebar: em “Conversa”, “Nova” começa outra; o seletor no topo (“Escolher conversa”) troca de conversa.',
    ],
    limitacoes: [
      'O nome da conversa sai da primeira mensagem e não dá para renomear.',
      'Ficam guardadas as 60 conversas mais recentes.',
    ],
    rotulos: ['Conversas', 'Nova conversa', 'Nova', 'Escolher conversa', 'Conversa'],
    implementacao: [CONVERSAS_MENU, CONVERSA_SIDEBAR, SELETORES],
    verificacao: 'interface',
    palavras: ['nova', 'conversa', 'conversas', 'antiga', 'anterior', 'trocar', 'historico', 'voltar'],
  },
  {
    id: 'apagar_conversa',
    assunto: 'conversas',
    titulo: 'Apagar uma conversa',
    oQueFaz: 'Tira a conversa e as mensagens dela deste computador.',
    onde: 'HOME → ícone “Conversas” → a lixeira ao lado da conversa',
    passos: [
      'HOME: clique no ícone “Conversas”, depois no ícone de lixeira (“Apagar esta conversa”) ao lado da conversa → “Apagar”.',
      'Ou peça na conversa: "apague esta conversa" ou "apague a conversa Planejamento".',
    ],
    limitacoes: [
      'É definitivo: conversa apagada não volta.',
      'Saem as mensagens e o que o Taq lembrava daquela conversa. Reuniões e documentos continuam guardados; um documento gerado nela fica em “Documentos”, só sem o vínculo com a conversa.',
      'Se era a conversa aberta, a tela passa para uma conversa nova e avisa que ela foi apagada. Uma resposta do Taq que estava a caminho nela é cancelada.',
      'Pedindo ao Taq um nome que casa com mais de uma conversa, ele pergunta qual antes de apagar.',
      'A sidebar não tem botão de apagar conversa, e não há seleção de várias conversas: para apagar várias, diga os nomes.',
    ],
    rotulos: ['Conversas', 'Apagar esta conversa', 'Apagar'],
    implementacao: [CONVERSAS_MENU],
    ferramenta: 'delete_conversation',
    comoPedir: 'Peça na conversa: "apague esta conversa" ou "apague a conversa X".',
    verificacao: 'interface',
    palavras: ['apagar', 'excluir', 'deletar', 'remover', 'conversa', 'conversas', 'mensagens'],
  },
  {
    id: 'anexar_arquivo',
    assunto: 'conversas',
    titulo: 'Anexar imagem ou documento a uma mensagem',
    oQueFaz: 'Guarda o NOME do arquivo junto da mensagem. O conteúdo não é lido nem enviado.',
    onde: 'HOME → “Assistente” → o “+” ao lado do campo',
    passos: [
      'Clique no botão de mais, ao lado do campo (“Anexar imagem ou documento”), e escolha “Imagem” ou “Documento”.',
    ],
    limitacoes: [
      'Só o nome do arquivo acompanha a mensagem: o Taq não lê o arquivo.',
      'Não há como anexar uma reunião ou um documento do TaqCiti por aqui; cite o nome na pergunta.',
    ],
    rotulos: ['Anexar imagem ou documento', 'Imagem', 'Documento'],
    implementacao: [ASSISTENTE],
    verificacao: 'interface',
    palavras: ['anexar', 'anexo', 'arquivo', 'upload', 'pdf', 'imagem', 'enviar arquivo'],
  },
  {
    id: 'copiar_resposta',
    assunto: 'conversas',
    titulo: 'Copiar uma resposta ou uma mensagem',
    oQueFaz: 'Copia o texto da resposta do Taq (sem as marcas de fonte) ou da sua mensagem.',
    onde: 'Embaixo de cada mensagem da conversa',
    passos: ['Clique em “Copiar”, embaixo da resposta ou da sua mensagem.'],
    rotulos: ['Copiar', 'Copiar a resposta', 'Copiar sua mensagem'],
    implementacao: [COPIAR, RESPOSTA, ASSISTENTE],
    verificacao: 'interface',
    palavras: ['copiar', 'resposta', 'mensagem', 'colar', 'texto'],
  },
  {
    id: 'texto_para_claude',
    assunto: 'conversas',
    titulo: 'Texto para levar ao Claude',
    oQueFaz:
      'Para o que o TaqCiti não produz (relatório, slides, e-mail…), o Taq prepara um texto com o contexto para copiar e colar no Claude.',
    onde: 'Na resposta do Taq: “Copiar texto”',
    passos: [
      'Peça ao Taq o que precisa; quando for algo fora do que o TaqCiti gera, ele entrega um texto pronto.',
      'Clique em “Copiar texto” e cole no Claude.',
    ],
    limitacoes: ['Nada é enviado ao Claude: é só copiar e colar.'],
    rotulos: ['Copiar texto'],
    implementacao: [RESPOSTA],
    verificacao: 'interface',
    ferramenta: 'prepare_external_brief',
    comoPedir: 'Peça na conversa: “prepare um texto para eu levar ao Claude sobre a reunião X”.',
    palavras: ['claude', 'levar', 'externo', 'copiar texto', 'relatorio', 'slides', 'apresentacao'],
  },
  {
    id: 'fontes_do_contexto',
    assunto: 'conversas',
    titulo: 'Escolher o que vale como contexto da conversa',
    oQueFaz:
      'Fixa uma reunião ou um documento como fonte escolhida DESTA conversa: o Taq a confere a cada pergunta, e ela volta ao reabrir a conversa.',
    onde: 'Só pela conversa com o Taq: não há botão na tela para isso',
    passos: [
      'Peça na conversa: "use esta reunião como contexto" ou "adicione o documento X ao contexto".',
    ],
    limitacoes: [
      'Só o Taq faz isso: a tela não tem botão nem lista de fontes do contexto.',
      'Vale só para a conversa em que foi pedido; outras conversas não enxergam.',
      'No máximo 6 fontes por conversa.',
      'Se a reunião ou o documento mudar, o Taq avisa que mudou e lê de novo; se for apagado, a fonte sai sozinha do contexto.',
      'É um ponteiro: o conteúdo continua na reunião ou no documento, e só sai do computador o trecho que uma pergunta precisar.',
    ],
    rotulos: [],
    implementacao: [CONVERSA_SIDEBAR],
    verificacao: 'codigo',
    ferramenta: 'add_context_source',
    comoPedir: 'Peça na conversa: “adicione esta reunião ao contexto”.',
    palavras: ['contexto', 'fonte', 'fontes', 'fixar', 'adicionar', 'usar', 'reuniao', 'documento'],
  },
  {
    id: 'tirar_fonte_do_contexto',
    assunto: 'conversas',
    titulo: 'Tirar uma fonte do contexto da conversa',
    oQueFaz: 'Tira uma reunião ou um documento do contexto da conversa. O registro não é apagado.',
    onde: 'Só pela conversa com o Taq: não há botão na tela para isso',
    passos: ['Peça na conversa: "tire a reunião X do contexto".'],
    limitacoes: ['Só o Taq faz isso.', 'A reunião ou o documento continuam guardados.'],
    rotulos: [],
    implementacao: [CONVERSA_SIDEBAR],
    verificacao: 'codigo',
    ferramenta: 'remove_context_source',
    comoPedir: 'Peça na conversa: “tire esta reunião do contexto”.',
    palavras: ['contexto', 'fonte', 'fontes', 'tirar', 'remover', 'retirar', 'reuniao', 'documento'],
  },

  // -------------------------------------------------------------- documentos
  {
    id: 'gerar_documento',
    assunto: 'documentos',
    titulo: 'Gerar uma ata ou um Doc Conversa (X1)',
    oQueFaz: 'Gera um documento a partir da transcrição e o salva em “Documentos”.',
    onde: 'HOME → “Reuniões” → a reunião → “Criar documento”',
    passos: [
      'HOME → “Reuniões” → abra a reunião → “Criar documento” → escolha “Ata de Reunião” ou “Doc Conversa (X1)”.',
      'O documento é salvo sozinho em “Documentos”. O que a reunião não deixou claro fica marcado para preencher.',
      'Se ficarem perguntas, elas vão para uma conversa nova com o Taq, em “Assistente”: responda lá e ele atualiza o documento.',
      'No quadro do resultado: “Abrir documento”, “Baixar” e, quando disponível, “Enviar ao Google Docs”.',
    ],
    preRequisitos: ['O servidor do TaqCiti tem de estar no ar.', 'A reunião precisa ter transcrição.'],
    limitacoes: ['Só estes dois tipos existem: “Ata de Reunião” e “Doc Conversa (X1)”.'],
    rotulos: [
      'Criar documento',
      'Ata de Reunião',
      'Doc Conversa (X1)',
      'Abrir documento',
      'Baixar',
      'Enviar ao Google Docs',
      'Reuniões',
      'Documentos',
      'Assistente',
    ],
    implementacao: [GERAR, CATALOGO_DOCS, NAV],
    verificacao: 'interface',
    ferramenta: 'create_document',
    comoPedir: 'Peça na conversa: “crie uma ata da reunião X” (ou “um X1”).',
    palavras: ['gerar', 'gero', 'gere', 'ata', 'x1', 'documento', 'criar', 'crio', 'resumo'],
  },
  {
    id: 'ver_documentos',
    assunto: 'documentos',
    titulo: 'Ver e abrir os documentos',
    oQueFaz: 'Lista os documentos gerados e guardados neste computador.',
    onde: 'HOME → “Documentos”',
    passos: [
      'HOME → “Documentos” → clique no documento.',
      'Para voltar à lista, use “Documentos”, no topo do documento.',
    ],
    limitacoes: ['A lista não tem busca nem filtro.'],
    rotulos: ['Documentos'],
    implementacao: [DOCUMENTOS, NAV],
    verificacao: 'interface',
    ferramenta: 'open_document',
    comoPedir: 'Peça na conversa: “abra o documento X” ou “abra o último documento”.',
    palavras: ['documentos', 'documento', 'onde', 'lista', 'abrir', 'ver', 'ficam'],
  },
  {
    id: 'editar_documento',
    assunto: 'documentos',
    titulo: 'Editar ou renomear um documento',
    oQueFaz: 'Edita o texto (Markdown) e o nome do documento.',
    onde: 'HOME → “Documentos” → o documento',
    passos: [
      'HOME → “Documentos” → abra o documento.',
      'Edite o texto e o nome (campo “Nome do documento”) direto na tela: salva sozinho. “Salvar” força o salvamento.',
    ],
    limitacoes: ['O editor é de texto simples (Markdown), sem formatação visual.'],
    rotulos: ['Documentos', 'Nome do documento', 'Salvar'],
    implementacao: [DOCUMENTOS],
    verificacao: 'interface',
    ferramenta: 'update_document',
    comoPedir: 'Peça na conversa: “no documento X, acrescente…” ou “corrija…”.',
    palavras: ['editar', 'alterar', 'mudar', 'documento', 'texto', 'corrigir', 'renomear', 'nome'],
  },
  {
    id: 'apagar_documento',
    assunto: 'documentos',
    titulo: 'Apagar um documento',
    oQueFaz: 'Tira o documento deste computador.',
    onde: 'HOME → “Documentos” → a lixeira do item, ou o documento → “Mais ações”',
    passos: [
      'HOME → “Documentos” → ícone de lixeira ao lado do documento → “Apagar”.',
      'Ou, dentro do documento: “Mais ações” → “Apagar documento” → “Apagar”.',
    ],
    limitacoes: ['É definitivo: não há lixeira.', 'A reunião de origem não é afetada.'],
    rotulos: ['Documentos', 'Mais ações', 'Apagar documento', 'Apagar'],
    implementacao: [DOCUMENTOS],
    verificacao: 'interface',
    palavras: ['apagar', 'excluir', 'deletar', 'remover', 'documento'],
  },

  // --------------------------------------------------------------- exportação
  {
    id: 'exportar_transcricao',
    assunto: 'exportacao',
    titulo: 'Baixar ou copiar a transcrição',
    oQueFaz: 'Baixa a transcrição em .txt, com título, data e participantes, ou copia o texto.',
    onde: 'HOME → “Reuniões” → a reunião; sidebar → a reunião',
    passos: [
      'HOME → “Reuniões” → abra a reunião → “Baixar .txt” (ou “Copiar”).',
      'Sidebar: na reunião encerrada, ou numa reunião da lista, “Baixar .txt”.',
      'Em “Conexões”, “Sem conectar: o caminho manual” também lista reuniões para baixar.',
    ],
    limitacoes: [
      'Só .txt. Marcas, notas e prints não entram.',
      'Reunião sem fala captada não tem o que baixar.',
    ],
    rotulos: ['Reuniões', 'Baixar .txt', 'Copiar', 'Conexões', 'Sem conectar: o caminho manual'],
    implementacao: [PAGINAS, REUNIOES_SIDEBAR, CONEXOES, EXPORTAR, NAV],
    verificacao: 'interface',
    ferramenta: 'export_transcript',
    comoPedir: 'Peça na conversa: “exporte a transcrição da reunião X”.',
    palavras: ['exportar', 'baixar', 'download', 'txt', 'transcricao', 'arquivo'],
  },
  {
    id: 'copiar_transcricao',
    assunto: 'exportacao',
    titulo: 'Copiar a transcrição pela conversa',
    oQueFaz:
      'O Taq prepara o texto da transcrição na resposta, para a pessoa copiar. Diz se a transcrição é parcial (reunião em andamento) ou final.',
    onde: 'Na resposta do Taq: “Copiar texto”. Pela tela: HOME → “Reuniões” → a reunião → “Copiar”',
    passos: [
      'Peça ao Taq: "copie a transcrição da reunião X".',
      'Clique em “Copiar texto” na resposta e cole onde quiser.',
    ],
    limitacoes: [
      'O Taq não copia sozinho para a área de transferência: quem copia é a pessoa, pelo botão.',
      'Só traz nome de quem falou e horário quando a captura os registrou.',
      'Textos muito longos vêm cortados, com aviso; “Baixar .txt” leva a transcrição inteira.',
      'Nada é enviado a ninguém.',
    ],
    rotulos: ['Copiar texto', 'Copiar', 'Reuniões', 'Baixar .txt'],
    implementacao: [RESPOSTA, PAGINAS, EXPORTAR],
    verificacao: 'codigo',
    ferramenta: 'copy_transcript',
    comoPedir: 'Peça na conversa: “copie a transcrição da reunião X”.',
    palavras: ['copiar', 'copie', 'transcricao', 'colar', 'texto'],
  },
  {
    id: 'baixar_documento',
    assunto: 'exportacao',
    titulo: 'Baixar um documento',
    oQueFaz: 'Baixa o documento como arquivo de texto (.md, ou .txt nos documentos de texto).',
    onde: 'HOME → “Documentos” → o documento → “Baixar .md”',
    passos: [
      'HOME → “Documentos” → abra o documento → “Baixar .md” (ou “Baixar .txt”, conforme o documento). Baixa a versão salva.',
      'Logo depois de gerar pela tela da reunião, o “Baixar” do resultado baixa a versão gerada (em PDF, quando o servidor a devolve).',
    ],
    limitacoes: [
      'No editor, só arquivo de texto: não há PDF nem Word.',
      '“Baixar rascunho” só aparece quando o salvamento falhou: baixa o texto que ainda não foi salvo.',
    ],
    rotulos: ['Documentos', 'Baixar o documento como arquivo de texto', 'Baixar', 'Baixar rascunho'],
    implementacao: [DOCUMENTOS, GERAR],
    verificacao: 'interface',
    ferramenta: 'download_document',
    comoPedir:
      'Peça na conversa: “baixe o documento X”. O Taq baixa o .md salvo (ou o .html da geração); PDF só pelo “Baixar” do resultado.',
    palavras: ['baixar', 'download', 'documento', 'arquivo', 'exportar', 'pdf', 'md', 'markdown', 'word'],
  },
  {
    id: 'enviar_google_docs',
    assunto: 'exportacao',
    titulo: 'Enviar ao Google Docs',
    oQueFaz: 'Cria um Google Doc com o documento recém-gerado e o abre numa aba nova.',
    onde: 'HOME → “Reuniões” → a reunião → “Criar documento” → no resultado, “Enviar ao Google Docs”',
    passos: [
      'Gere o documento pela tela da reunião.',
      'No quadro do resultado, clique em “Enviar ao Google Docs”. Na primeira vez, o Google pede permissão.',
    ],
    preRequisitos: [
      'O botão só aparece se esta instalação tiver o acesso ao Google configurado.',
      'A conta Google do perfil do Chrome.',
    ],
    limitacoes: [
      'Só logo depois de gerar: o editor de “Documentos” não envia ao Google Docs.',
      'Vai a versão gerada, não as edições feitas depois.',
      'Se o envio falhar, a tela não mostra aviso.',
    ],
    rotulos: ['Enviar ao Google Docs', 'Criar documento'],
    implementacao: [GERAR],
    verificacao: 'interface',
    palavras: ['google', 'docs', 'drive', 'enviar', 'google docs'],
  },

  // ------------------------------------------------------------ configurações
  {
    id: 'sincronizar_e_conectar',
    assunto: 'configuracoes',
    titulo: 'Sincronizar e conectar o Claude ou o ChatGPT',
    oQueFaz:
      'Envia reuniões, documentos, conversas e notas para o servidor do TaqCiti, e gera um endereço para o Claude ou o ChatGPT consultarem esse acervo.',
    onde: 'HOME → “Conexões”',
    passos: [
      'HOME → “Conexões” → “Ligar sincronização” e escolha a conta Google na tela de login.',
      'Depois, “Gerar endereço” e clique em “Copiar” — o endereço não aparece de novo.',
      'Siga o passo a passo de “Conectar na Claude” ou “Conectar no ChatGPT”, na mesma página.',
      'Para parar de enviar: “Desligar”. Para tirar o acesso de um assistente: “Revogar”, no endereço.',
    ],
    preRequisitos: [
      'Uma conta Google.',
      'Esta instalação precisa ter o login do Google e o servidor configurados; sem isso, a página avisa.',
    ],
    limitacoes: [
      'Sem sincronizar, tudo continua funcionando neste computador.',
      'O assistente só enxerga o que já subiu.',
      'O endereço vale como senha: quem tiver o link alcança o acervo.',
      'A tela não mostra quando foi a última sincronização nem se ela falhou.',
      'Os menus do Claude e do ChatGPT são deles e podem mudar.',
    ],
    rotulos: [
      'Conexões',
      'Ligar sincronização',
      'Gerar endereço',
      'Copiar',
      'Conectar na Claude',
      'Conectar no ChatGPT',
      'Desligar',
      'Revogar',
    ],
    implementacao: [CONEXOES, NAV],
    verificacao: 'codigo',
    palavras: [
      'sincronizar', 'sincronizacao', 'conectar', 'conector', 'claude', 'chatgpt',
      'mcp', 'conexoes', 'conexao', 'servidor', 'nuvem', 'endereco',
    ],
  },
  {
    id: 'aparencia',
    assunto: 'configuracoes',
    titulo: 'Efeitos visuais do fundo',
    oQueFaz: 'Liga e desliga as brasas do fundo e pausa o movimento da onda.',
    onde: 'Ícones no topo da HOME',
    passos: ['HOME: no topo, “Desligar brasas do fundo” e “Pausar movimento”.'],
    limitacoes: [
      'A escolha não fica guardada: volta ao padrão ao recarregar.',
      'A sidebar não tem brasas: o fundo dela é a onda, que para sozinha com o movimento reduzido do sistema.',
      'Não há tela de configurações, tema claro/escuro nem troca de idioma.',
    ],
    rotulos: ['Desligar brasas do fundo', 'Pausar movimento'],
    implementacao: [HOME],
    verificacao: 'interface',
    palavras: ['brasas', 'fundo', 'animacao', 'movimento', 'efeito', 'visual', 'aparencia'],
  },
  {
    id: 'capacidades_do_taq',
    assunto: 'configuracoes',
    titulo: 'Ver o que dá para conectar e o que já está conectado',
    oQueFaz:
      'Mostra, em “Para conectar”, cada ferramenta com o que ela faz — as que ainda não existem nesta versão aparecem como “Em breve” — e, em “Conectadas”, o que já está ligado.',
    onde: 'HOME → Conexões',
    passos: [
      'Na HOME, abra “Conexões”.',
      'Em “Para conectar”, “Conectar” abre o caminho daquela ferramenta ali mesmo; “Conectadas” lista o que já está ligado.',
    ],
    limitacoes: [
      'Gmail, Google Agenda e WhatsApp ainda não existem nesta versão: aparecem como “Em breve”, sem botão.',
    ],
    rotulos: ['Conexões', 'Para conectar', 'Conectar', 'Em breve', 'Conectadas'],
    implementacao: [CONEXOES, NAV],
    verificacao: 'codigo',
    palavras: ['capacidades', 'o que o taq faz', 'funcoes do taq', 'recursos do taq'],
  },
  // ------------------------------------------------------------ acompanhamento
  {
    id: 'analisar_reuniao',
    assunto: 'reunioes',
    titulo: 'Analisar uma reunião (decisões, questões, riscos, próximos passos)',
    oQueFaz:
      'O Taq lê a transcrição e guarda uma análise com visão geral, decisões, questões abertas, riscos e próximos passos, cada item com o trecho de origem.',
    onde: 'Conversa com o Taq, na HOME ou na sidebar',
    passos: [
      'Na conversa, peça: ‘analise a reunião’ e o nome dela (ou abra a conversa a partir da reunião).',
      'A análise aparece num cartão com “Visão geral”, “Decisões”, “Questões abertas”, “Riscos” e “Próximos passos”. Cada item abre o trecho de onde saiu.',
      'Para corrigir um item, clique em “Corrigir” ao lado dele. A transcrição não muda.',
    ],
    preRequisitos: ['O Taq precisa estar conectado ao servidor de IA.'],
    limitacoes: [
      'A análise diz quantos segmentos foram lidos; em reunião longa a cobertura pode ser parcial.',
      'Se a transcrição mudar depois, o cartão marca a análise como desatualizada.',
      'Apagar a reunião apaga a análise dela.',
    ],
    rotulos: ['Visão geral', 'Decisões', 'Questões abertas', 'Riscos', 'Próximos passos', 'Corrigir'],
    implementacao: [CARTOES, TRABALHO],
    verificacao: 'codigo',
    ferramenta: 'save_analysis',
    comoPedir: 'Peça na conversa: “analise a reunião X”.',
    palavras: ['analisar', 'analise', 'riscos', 'questoes abertas', 'estruturar', 'pontos principais'],
  },
  {
    id: 'registrar_compromissos',
    assunto: 'acompanhamento',
    titulo: 'Registrar os compromissos e próximos passos de uma reunião',
    oQueFaz:
      'Guarda o que foi combinado — o que, quem e até quando — como compromissos, sem duplicar o que já estava registrado.',
    onde: 'Conversa com o Taq; os registrados ficam em HOME → Acompanhamento',
    passos: [
      'Peça ao Taq: ‘organize os próximos passos da reunião X’. Ele mostra o cartão “Compromissos sugeridos”, ainda sem gravar nada.',
      'Desmarque o que não quiser e clique em “Registrar selecionados”.',
      'Se você já pedir ‘registre os próximos passos’, o Taq registra direto.',
      'Os registrados aparecem em “Acompanhamento”.',
    ],
    limitacoes: [
      'Responsável e prazo só entram quando aparecem no trecho da reunião; sem isso, ficam “Sem responsável definido” e “Sem prazo acordado”.',
      'Não há lembrete nem cobrança automática.',
    ],
    rotulos: ['Compromissos sugeridos', 'Registrar selecionados', 'Acompanhamento'],
    implementacao: [CARTOES, ACOMPANHAMENTO, NAV],
    verificacao: 'codigo',
    ferramenta: 'register_commitments',
    comoPedir: 'Peça: “registre os próximos passos da reunião X”.',
    palavras: ['compromissos', 'compromisso', 'tarefas', 'tarefa', 'proximos passos', 'pendencias', 'combinado', 'registrar tarefas'],
  },
  {
    id: 'acompanhar_compromissos',
    assunto: 'acompanhamento',
    titulo: 'Acompanhar compromissos e marcar como concluído',
    oQueFaz: 'Mostra os compromissos registrados, com responsável, prazo, estado e histórico, e permite concluir ou reabrir.',
    onde: 'HOME → Acompanhamento → Compromissos',
    passos: [
      'Na HOME, abra “Acompanhamento”.',
      'Filtre por “Abertos”, “Prazo passou — a confirmar” ou “Todos”, e pelo nome do responsável.',
      'Em cada compromisso, use “Marcar como concluído” ou “Reabrir”. Pelo Taq: ‘marque como concluído o envio do relatório’.',
    ],
    limitacoes: [
      'Prazo vencido não vira “atrasado”: aparece como “Prazo passou — situação a confirmar”, porque ninguém disse se terminou.',
    ],
    rotulos: ['Acompanhamento', 'Abertos', 'Prazo passou — a confirmar', 'Todos', 'Marcar como concluído', 'Reabrir'],
    implementacao: [ACOMPANHAMENTO, CARTOES, NAV],
    verificacao: 'codigo',
    ferramenta: 'update_commitment',
    comoPedir: 'Peça: “marque como concluído o compromisso X” ou “a Ana assumiu Y”.',
    palavras: ['concluido', 'concluir', 'acompanhar', 'atrasado', 'prazo', 'responsavel', 'quem ficou de'],
  },
  {
    id: 'registrar_decisao',
    assunto: 'acompanhamento',
    titulo: 'Registrar uma decisão, inclusive uma decisão revista',
    oQueFaz:
      'Guarda decisões com a fonte. Uma decisão revista substitui a anterior, que fica no histórico ligada à nova e ao motivo.',
    onde: 'Conversa com o Taq; as decisões ficam em HOME → Acompanhamento → Decisões',
    passos: [
      'Peça ao Taq: ‘registre a decisão: …’ — ou, para uma mudança, ‘o PDF ficou para a fase 2, registre’.',
      'Em “Acompanhamento”, a seção “Decisões” mostra as vigentes; marque “Mostrar também as substituídas” para ver o histórico.',
    ],
    rotulos: ['Acompanhamento', 'Decisões', 'Mostrar também as substituídas'],
    implementacao: [ACOMPANHAMENTO, NAV],
    verificacao: 'codigo',
    ferramenta: 'record_decision',
    comoPedir: 'Peça: ‘registre a decisão: …’.',
    palavras: ['decisao', 'decisoes', 'decidimos', 'mudou a decisao', 'substituir decisao', 'registrar decisao'],
  },
  {
    id: 'preparar_assistente',
    assunto: 'navegacao',
    titulo: 'Dizer como quer ser ajudado e o que quer alcançar em uma reunião',
    oQueFaz:
      'Guarda, neste computador, o seu perfil de condução (em que o Taq ajuda, o que observa, como intervém) e, por reunião, o resultado que você quer alcançar e o que não pode ficar sem encaminhamento. O Taq passa a considerar isso nas respostas.',
    onde: 'HOME → Preparar',
    passos: [
      'Na HOME, abra “Preparar”.',
      'Conte com suas palavras como conduz reuniões e clique em “Organizar o que entendi”. Corrija qualquer frase do resumo; nada vale até você clicar em “Usar este assistente”.',
      'Mais abaixo, escolha uma reunião, escreva o resultado que querem alcançar e clique em “Salvar a preparação”.',
    ],
    limitacoes: [
      'O resumo também pode ser escrito à mão, sem o assistente conectado; só “Organizar o que entendi” depende dele.',
      'O Taq não supõe um objetivo: sem um objetivo escrito por você, a reunião fica sem objetivo.',
      'Uma reunião já preparada continua com a versão do assistente que usava, até você pedir “Usar a versão atual”.',
    ],
    rotulos: [
      'Preparar',
      'Organizar o que entendi',
      'Usar este assistente',
      'Salvar a preparação',
      'Usar a versão atual',
    ],
    implementacao: ['src/home/Preparar.tsx', NAV],
    verificacao: 'codigo',
    palavras: ['preparar', 'perfil', 'objetivo', 'conduzir', 'assistente', 'briefing', 'preparacao', 'como quero ser ajudado'],
  },
  {
    id: 'perguntas_prontas_da_reuniao',
    assunto: 'reunioes',
    titulo: 'Perguntas prontas para conduzir a reunião',
    oQueFaz:
      'Na sidebar, atalhos que fazem ao Taq uma pergunta comum sobre a reunião: o que falta esclarecer, o que foi decidido, ajuda para fechar e sugestão de acompanhamentos. A resposta cita as falas; nada vira decisão ou compromisso sozinho.',
    onde: 'Sidebar → Reunião → Pergunta rápida',
    passos: [
      'Na sidebar, na reunião, clique em “Pergunta rápida”.',
      'Escolha “O que falta esclarecer?”, “O que foi decidido?”, “Me ajude a fechar” ou “Sugerir acompanhamentos”.',
    ],
    preRequisitos: ['O assistente conectado: sem ele os atalhos não aparecem.'],
    limitacoes: [
      '“Sugerir acompanhamentos” mostra os compromissos para você revisar; registrar é uma escolha sua em cada um.',
      'Se a captura estiver incompleta, a resposta diz até onde ela foi.',
    ],
    rotulos: [
      'Pergunta rápida',
      'O que falta esclarecer?',
      'O que foi decidido?',
      'Me ajude a fechar',
      'Sugerir acompanhamentos',
    ],
    implementacao: [REUNIAO_AO_VIVO, ACOES_AO_VIVO],
    verificacao: 'codigo',
    palavras: ['falta esclarecer', 'o que foi decidido', 'fechar a reuniao', 'encerrar reuniao', 'acompanhamentos', 'pergunta rapida', 'conduzir'],
  },
  {
    id: 'comparar_fontes',
    assunto: 'acompanhamento',
    titulo: 'Comparar fontes e apontar possíveis desalinhamentos entre áreas',
    oQueFaz:
      'O Taq compara o que reuniões e documentos dizem sobre promessa, escopo, prazo e dependências, e registra cada possível desalinhamento com as duas fontes.',
    onde: 'Conversa com o Taq; os achados ficam em HOME → Acompanhamento → Achados',
    passos: [
      'Peça: ‘compare o que o comercial prometeu com o escopo do produto’ (ou nomeie as reuniões e documentos).',
      'O cartão “Achados” mostra o entendimento de cada fonte, o impacto como hipótese e uma pergunta para alinhar.',
    ],
    limitacoes: [
      'É possível desalinhamento até haver sustentação: o Taq não decide quem está certo nem julga pessoas.',
    ],
    rotulos: ['Achados', 'Acompanhamento'],
    implementacao: [CARTOES, ACOMPANHAMENTO, NAV],
    verificacao: 'codigo',
    ferramenta: 'save_finding',
    comoPedir: 'Peça: “compare as fontes X e Y e aponte desalinhamentos”.',
    palavras: ['desalinhamento', 'divergencia', 'comparar', 'passagem', 'handoff', 'escopo', 'prometido', 'alinhamento'],
  },
  {
    id: 'resolver_achado',
    assunto: 'acompanhamento',
    titulo: 'Resolver, descartar ou reabrir um achado',
    oQueFaz: 'Muda o estado de um achado guardando o motivo no histórico.',
    onde: 'HOME → Acompanhamento → Achados (ou o cartão na conversa)',
    passos: [
      'No achado, clique em “Marcar resolvido” ou “Descartar com motivo”.',
      'Escreva o motivo e clique em “Confirmar”.',
      'Para ver os já resolvidos, marque “Mostrar também os resolvidos e descartados”.',
    ],
    rotulos: ['Marcar resolvido', 'Descartar com motivo', 'Confirmar', 'Mostrar também os resolvidos e descartados'],
    implementacao: [CARTOES, ACOMPANHAMENTO],
    verificacao: 'codigo',
    ferramenta: 'resolve_finding',
    comoPedir: 'Peça: “o desalinhamento do PDF foi resolvido: ficou para a fase 2”.',
    palavras: ['resolver achado', 'resolvido', 'descartar', 'achado'],
  },
  {
    id: 'rascunho_de_mensagem',
    assunto: 'exportacao',
    titulo: 'Preparar o rascunho de uma mensagem ou e-mail',
    oQueFaz:
      'O Taq escreve um rascunho a partir das reuniões, confere os nomes contra os participantes e aponta dado sensível. Você edita e copia; com a conta do CITi conectada, o cartão do e-mail tem o botão “Enviar”, e é só por ele que um e-mail sai.',
    onde: 'Conversa com o Taq',
    passos: [
      'Peça: ‘prepare um e-mail para a Ana sobre o prazo da entrega’.',
      'O rascunho aparece num cartão editável. Use “Copiar”; com a conta do CITi conectada, o cartão do e-mail tem o botão “Enviar”.',
    ],
    limitacoes: [
      'Sem a conta do CITi conectada o TaqCiti não envia nada: só prepara o rascunho. Com ela, ver “Enviar um e-mail, com a ata ou a transcrição anexada”.',
      'Nome com mais de uma pessoa nos participantes aparece como ambíguo.',
    ],
    rotulos: ['Copiar', 'Enviar'],
    implementacao: [CARTOES, COPIAR],
    verificacao: 'codigo',
    ferramenta: 'prepare_message',
    comoPedir: 'Peça: “prepare um e-mail para X sobre Y”.',
    palavras: ['email', 'e-mail', 'mensagem', 'rascunho', 'mandar', 'enviar', 'recado', 'escrever para'],
  },
  {
    id: 'sugerir_horario',
    assunto: 'exportacao',
    titulo: 'Sugerir horários para um encontro',
    oQueFaz:
      'O Taq converte "amanhã às 14h" no seu fuso e monta sugestões de horário; cada uma abre o formulário do Google Agenda preenchido, sem convidados.',
    onde: 'Conversa com o Taq',
    passos: [
      'Peça: ‘sugira horários amanhã à tarde para revisar o escopo com a Ana’.',
      'O cartão “Sugestão de horário — disponibilidade não verificada” traz as opções; “Abrir no Google Agenda” abre o formulário para você criar o evento lá.',
    ],
    limitacoes: [
      'Esta sugestão não consulta a agenda de ninguém nem cria evento ou convite. Com a conta do CITi conectada, o Taq também consulta agendas e cria eventos — ver “Criar um evento na agenda, com convidados”.',
    ],
    rotulos: ['Sugestão de horário — disponibilidade não verificada', 'Abrir no Google Agenda'],
    implementacao: [CARTOES],
    verificacao: 'codigo',
    ferramenta: 'prepare_event',
    comoPedir: 'Peça: “sugira horários para …”.',
    palavras: ['agendar', 'horario', 'agenda', 'calendario', 'marcar reuniao', 'proxima reuniao', 'convite'],
  },
  {
    id: 'estado_da_captura',
    assunto: 'captura',
    titulo: 'Saber se a captura de uma reunião está confiável',
    oQueFaz:
      'Mostra o estado da captura e os sinais que a extensão consegue verificar: trechos descartados, reconexões, legenda ilegível e intervalos sem fala.',
    onde: 'Conversa com o Taq',
    passos: [
      'Pergunte ao Taq: ‘a captura da reunião X está ok?’.',
      'O cartão mostra a situação (“Capturando”, “Pausada”, “Aguardando legendas”, “Problema na captura” ou “Encerrada”) e os sinais encontrados.',
    ],
    limitacoes: [
      'Intervalo sem fala pode ser silêncio: não é tratado como perda.',
      '“Nenhum problema detectado” não garante que cada palavra foi transcrita certo.',
    ],
    rotulos: ['Capturando', 'Pausada', 'Aguardando legendas', 'Problema na captura', 'Encerrada'],
    implementacao: [CAPTURA_TAQ, CARTOES],
    verificacao: 'codigo',
    ferramenta: 'get_capture_state',
    comoPedir: 'Pergunte: “a captura desta reunião está ok?”.',
    palavras: ['captura ok', 'confiavel', 'falhou a captura', 'perdeu', 'lacuna', 'legenda parou'],
  },
  {
    id: 'revisar_documento',
    assunto: 'documentos',
    titulo: 'Revisar a estrutura e as fontes de um documento',
    oQueFaz:
      'Aponta seção obrigatória ausente ou vazia, pontos “A confirmar”, repetições, notas sem fonte e fontes que mudaram ou não existem mais.',
    onde: 'Conversa com o Taq',
    passos: ['Peça: ‘revise a ata X’.', 'O cartão lista os problemas por gravidade; “Abrir documento” leva ao editor.'],
    limitacoes: ['Confere forma e fontes; não diz se o conteúdo está correto.'],
    rotulos: ['Abrir documento'],
    implementacao: [CARTOES],
    verificacao: 'codigo',
    ferramenta: 'check_document',
    comoPedir: 'Peça: “revise o documento X”.',
    palavras: ['revisar', 'revisao', 'conferir documento', 'faltando', 'fontes do documento', 'qualidade'],
  },
  {
    id: 'revisar_exposicao',
    assunto: 'exportacao',
    titulo: 'Revisar um texto antes de compartilhar',
    oQueFaz:
      'Aponta o que parece dado pessoal ou segredo (e-mail, telefone, CPF, CNPJ, cartão, senha) e prepara uma cópia com esses trechos ocultados.',
    onde: 'Conversa com o Taq',
    passos: [
      'Cole o texto e peça: ‘revise isto antes de eu compartilhar’.',
      'A cópia com os trechos ocultados aparece com “Copiar texto”.',
    ],
    limitacoes: ['Reconhece formatos, não contexto: não garante que o texto esteja limpo.'],
    rotulos: ['Copiar texto'],
    implementacao: [RESPOSTA],
    verificacao: 'codigo',
    ferramenta: 'review_privacy',
    comoPedir: 'Peça: “revise este texto antes de eu compartilhar: …”.',
    palavras: ['privacidade', 'dados pessoais', 'sensivel', 'ocultar', 'anonimizar', 'cpf', 'lgpd'],
  },
  {
    id: 'conectar_conta_citi',
    assunto: 'configuracoes',
    titulo: 'Conectar a conta do CITi (colegas, e-mail e agenda)',
    oQueFaz:
      'Liga o Taq à sua conta Google do CITi. Com ela, o Taq acha colegas da organização, envia e-mail por você e consulta agendas e cria eventos — só quando você pede.',
    onde: 'HOME → Conexões → Conta do CITi',
    passos: [
      'Abra “Conexões” na barra lateral da HOME.',
      'No cartão “Conta do CITi”, clique em “Conectar”.',
      'Na janela do Google, escolha a conta do CITi e aceite todas as permissões.',
      'Para parar, clique em “Desconectar” na linha da conta.',
    ],
    preRequisitos: [
      'O cliente OAuth do Google registrado para a extensão (docs/integracoes-google-workspace.md).',
      'Uma conta Google do CITi (Workspace): conta pessoal não tem diretório da organização.',
    ],
    limitacoes: [
      'Sem a conta conectada, o Taq só prepara rascunho e sugere horário: não envia nem cria nada.',
      'O Taq não lê a sua caixa de entrada.',
      'Cada capacidade (colegas, e-mail, agendas) pode ser desligada na linha da conta.',
    ],
    rotulos: ['Conexões', 'Conta do CITi', 'Conectar', 'Desconectar'],
    implementacao: [CONEXOES, 'src/home/ContaDoCiti.tsx', NAV],
    verificacao: 'codigo',
    palavras: ['conta citi', 'conectar conta', 'gmail', 'google workspace', 'diretorio', 'permissao', 'oauth', 'organizacao'],
  },
  {
    id: 'enviar_email',
    assunto: 'exportacao',
    titulo: 'Enviar um e-mail, com a ata ou a transcrição anexada',
    oQueFaz:
      'Com a conta do CITi conectada, o Taq prepara o e-mail a colegas da organização e você o envia pelo botão do cartão. Os nomes são resolvidos no diretório; documento ou transcrição vão como anexo.',
    onde: 'Conversa com o Taq',
    passos: [
      'Peça: ‘prepare um e-mail com a ata da sprint para a Ana Souza’.',
      'O Taq mostra o rascunho num cartão e NADA é enviado. Confira para quem vai, o assunto e os anexos.',
      'Clique em “Enviar” para mandar exatamente aquele rascunho (ou em “Descartar”). Escrever ‘envie’ no chat não envia nada: só o botão.',
      'O resultado aparece como um cartão novo: “Aceito pelo Google”, “Resultado desconhecido” ou “Não foi feito”.',
    ],
    preRequisitos: ['A conta do CITi conectada em “Conexões” (ver “Conectar a conta do CITi”).'],
    limitacoes: [
      '“Aceito pelo Google” quer dizer que o Google recebeu o pedido; o Taq não sabe se o destinatário recebeu ou leu.',
      'Se o envio der “Resultado desconhecido”, o Taq NÃO reenvia sozinho: confira a pasta Enviados e, se não saiu, use “Reenviar mesmo assim” no cartão.',
      'Só colegas do diretório da organização, ou um endereço que você mesmo escreveu.',
      'O texto do rascunho não se edita no cartão antes de enviar: para mudar, peça um rascunho novo.',
      'Anexos até 3 MB no total. Transcrição de reunião em andamento vai marcada como parcial.',
      'Sem a conta conectada o Taq só prepara o rascunho.',
    ],
    rotulos: ['Enviar', 'Descartar', 'Reenviar mesmo assim', 'Aguardando você', 'Aceito pelo Google', 'Resultado desconhecido', 'Não foi feito'],
    implementacao: [CARTOES],
    verificacao: 'codigo',
    ferramenta: 'send_email',
    comoPedir: 'Peça: “prepare um e-mail com a ata X para Fulana” (ou a transcrição) e clique em “Enviar”.',
    palavras: ['enviar email', 'mandar email', 'enviar ata', 'enviar transcricao', 'mandar ata', 'mandar para', 'encaminhar', 'email para'],
  },
  {
    id: 'procurar_colega',
    assunto: 'exportacao',
    titulo: 'Procurar um colega da organização',
    oQueFaz: 'Acha o nome e o e-mail reais de um colega do CITi no diretório do Google Workspace.',
    onde: 'Conversa com o Taq',
    passos: ['Pergunte: ‘qual o e-mail da Ana Souza?’ — se houver mais de uma, o Taq pergunta qual.'],
    preRequisitos: ['A conta do CITi conectada em “Conexões”.'],
    limitacoes: ['Só quem está no diretório do domínio da sua conta. O Taq nunca supõe um endereço.'],
    rotulos: [],
    implementacao: ['src/features/integracoes/diretorio.ts'],
    verificacao: 'codigo',
    ferramenta: 'search_directory',
    comoPedir: 'Pergunte: “qual o e-mail da Fulana?”.',
    palavras: ['email do colega', 'quem e', 'diretorio', 'achar pessoa', 'procurar colega', 'contato'],
  },
  {
    id: 'consultar_agenda',
    assunto: 'exportacao',
    titulo: 'Consultar a disponibilidade de colegas e a sua agenda',
    oQueFaz:
      'Mostra quando os colegas estão ocupados e sugere horários livres para todos os que têm agenda visível. Lista os seus eventos, com o que é preciso para remarcar ou cancelar.',
    onde: 'Conversa com o Taq',
    passos: ['Pergunte: ‘quando a Ana Souza e o Bruno estão livres na quinta?’.'],
    preRequisitos: ['A conta do CITi conectada em “Conexões”.'],
    limitacoes: [
      'Quem a sua conta não enxerga fica como “sem acesso”: a disponibilidade dessa pessoa é desconhecida, nunca “livre”.',
      'É ocupado/livre do calendário principal, em horário comercial.',
    ],
    rotulos: [],
    implementacao: ['src/features/integracoes/calendario.ts'],
    verificacao: 'codigo',
    ferramenta: 'list_availability',
    comoPedir: 'Pergunte: “quando X e Y estão livres?”.',
    palavras: ['disponibilidade', 'livre', 'ocupado', 'horario livre', 'quando esta livre', 'minha agenda'],
  },
  {
    id: 'criar_evento',
    assunto: 'exportacao',
    titulo: 'Criar um evento na agenda, com convidados',
    oQueFaz:
      'Prepara o evento na sua agenda do Google, no seu fuso; ao clicar em “Marcar”, o Google cria o evento e envia os convites. Uma fala na reunião sobre marcar outro encontro não cria nada: só o seu clique.',
    onde: 'Conversa com o Taq',
    passos: [
      'Peça: ‘marque a retro na quinta às 14h com a Ana Souza’.',
      'O cartão fica “Aguardando você” e nada é criado até você clicar em “Marcar” (ou em “Descartar”). Escrever ‘pode marcar’ no chat não cria nada.',
      'Com o evento criado, o cartão traz “Abrir no Google Agenda”.',
    ],
    preRequisitos: ['A conta do CITi conectada em “Conexões”.'],
    limitacoes: [
      'Não dá para criar evento no passado.',
      'Toda criação passa pela prévia: só o botão cria.',
      'O Taq não diz que alguém aceitou o convite.',
    ],
    rotulos: ['Marcar', 'Descartar', 'Aguardando você', 'Abrir no Google Agenda'],
    implementacao: [CARTOES],
    verificacao: 'codigo',
    ferramenta: 'create_event',
    comoPedir: 'Peça: “marque X dia Y às Zh com Fulana”.',
    palavras: ['marcar reuniao', 'criar evento', 'agendar', 'convite', 'marcar call', 'marcar retro'],
  },
  {
    id: 'remarcar_evento',
    assunto: 'exportacao',
    titulo: 'Remarcar um evento que você organiza',
    oQueFaz: 'Muda o dia e a hora de um evento seu; o Google avisa os convidados.',
    onde: 'Conversa com o Taq',
    passos: ['Peça: ‘remarque o alinhamento de escopo para sexta às 10h’ — o Taq acha o evento na sua agenda e mostra a prévia com o botão “Remarcar”.'],
    preRequisitos: ['A conta do CITi conectada em “Conexões”.'],
    limitacoes: ['Só eventos que você organiza.', 'O Taq só mostra a prévia; o botão “Remarcar” é que remarca.'],
    rotulos: ['Remarcar'],
    implementacao: [CARTOES, 'src/features/integracoes/calendario.ts'],
    verificacao: 'codigo',
    ferramenta: 'reschedule_event',
    comoPedir: 'Peça: “remarque o evento X para Y às Zh”.',
    palavras: ['remarcar', 'reagendar', 'mudar horario', 'adiar reuniao', 'passar para'],
  },
  {
    id: 'cancelar_evento',
    assunto: 'exportacao',
    titulo: 'Cancelar um evento que você organiza',
    oQueFaz: 'Cancela o evento; o Google avisa os convidados. Não tem volta pelo Taq.',
    onde: 'Conversa com o Taq',
    passos: ['Peça: ‘cancele o alinhamento de escopo’ — o Taq mostra a prévia com o botão “Cancelar o evento”.'],
    preRequisitos: ['A conta do CITi conectada em “Conexões”.'],
    limitacoes: ['Só eventos que você organiza.', 'Sempre passa por prévia: o botão “Cancelar o evento” é que cancela, e o Google avisa os convidados.'],
    rotulos: ['Cancelar o evento'],
    implementacao: [CARTOES, 'src/features/integracoes/calendario.ts'],
    verificacao: 'codigo',
    ferramenta: 'cancel_event',
    comoPedir: 'Peça: “cancele o evento X”.',
    palavras: ['cancelar evento', 'cancelar reuniao', 'desmarcar', 'cancelar convite'],
  },
];

/** O que o TaqCiti NÃO faz, ou ainda não faz — para dizer isso em vez de inventar. */
export const FORA_DO_APP: readonly ForaDoApp[] = [
  {
    id: 'audio_video',
    titulo: 'Gravar áudio ou vídeo',
    situacao: 'indisponivel',
    resposta: 'O TaqCiti não grava áudio nem vídeo: ele só lê as legendas do Google Meet.',
    palavras: ['audio', 'video', 'gravacao', 'microfone', 'mp3', 'mp4'],
  },
  {
    id: 'outras_plataformas',
    titulo: 'Capturar fora do Google Meet',
    situacao: 'indisponivel',
    resposta: 'A captura funciona só no Google Meet — não no Zoom, no Teams nem em reunião presencial.',
    palavras: ['zoom', 'teams', 'webex', 'presencial', 'skype', 'discord'],
  },
  {
    id: 'lixeira_da_tela',
    titulo: 'Recuperar o que foi apagado pela tela',
    situacao: 'indisponivel',
    resposta:
      'Reunião, documento ou conversa apagados pela tela não voltam. Só a reunião apagada pedindo ao Taq fica 30 dias na lixeira dele.',
    palavras: ['lixeira', 'recuperar', 'restaurar', 'desfazer'],
  },
  {
    id: 'descartar_captura',
    titulo: 'Descartar a captura em andamento',
    situacao: 'indisponivel',
    resposta:
      'Não há, na tela, como descartar a captura em andamento. Dá para pausar, ou encerrar e depois apagar a reunião.',
    palavras: ['descartar', 'cancelar captura', 'jogar fora', 'limpar transcricao'],
  },
  {
    id: 'busca_na_lista',
    titulo: 'Buscar ou filtrar a lista de reuniões e documentos',
    situacao: 'indisponivel',
    resposta:
      'As listas de reuniões e documentos não têm busca nem filtro. Para achar pelo conteúdo, pergunte ao Taq na conversa.',
    palavras: ['filtrar', 'filtro', 'ordenar', 'campo de busca', 'barra de busca'],
  },
  {
    id: 'renomear_conversa',
    titulo: 'Renomear uma conversa',
    situacao: 'indisponivel',
    resposta: 'Não dá para renomear conversas: o nome sai da primeira mensagem.',
    palavras: ['renomear conversa', 'nome da conversa'],
  },
  {
    id: 'selecionar_conversas',
    titulo: 'Selecionar várias conversas de uma vez',
    situacao: 'indisponivel',
    resposta:
      'A tela não tem seleção de várias conversas. Para apagar mais de uma, diga ao Taq os nomes delas.',
    palavras: ['selecionei', 'selecionar varias', 'selecionadas', 'marcar varias'],
  },
  {
    id: 'ler_anexo',
    titulo: 'Ler arquivos anexados',
    situacao: 'indisponivel',
    resposta: 'O Taq não lê arquivos anexados: só o nome do arquivo acompanha a mensagem.',
    palavras: ['ler arquivo', 'ler anexo', 'ler o pdf', 'analisar arquivo'],
  },
  {
    id: 'outros_tipos_de_documento',
    titulo: 'Outros tipos de documento (relatório, slides, e-mail…)',
    situacao: 'indisponivel',
    resposta:
      'O TaqCiti gera só “Ata de Reunião” e “Doc Conversa (X1)”. Para outros formatos, o Taq prepara um texto para você levar ao Claude.',
    palavras: ['relatorio', 'slides', 'apresentacao', 'powerpoint', 'planilha', 'word', 'docx'],
  },
  {
    id: 'configuracoes',
    titulo: 'Tela de configurações, tema ou idioma',
    situacao: 'indisponivel',
    resposta:
      'O TaqCiti não tem tela de configurações, tema claro/escuro nem troca de idioma. O que dá para ajustar fica em “Conexões” e nos ícones do topo.',
    palavras: ['configuracao', 'configuracoes', 'preferencias', 'tema', 'escuro', 'claro', 'idioma', 'ingles', 'ajustes'],
  },
  {
    id: 'atalhos',
    titulo: 'Atalhos de teclado',
    situacao: 'indisponivel',
    resposta:
      'Não há atalho de teclado para abrir o TaqCiti. Na conversa, Enter envia e Shift+Enter quebra linha.',
    palavras: ['atalho', 'atalhos', 'teclado', 'tecla'],
  },
  {
    id: 'enviar_mensagens',
    titulo: 'Enviar ou compartilhar por e-mail ou mensagem',
    situacao: 'indisponivel',
    resposta:
      'O Taq prepara o e-mail e quem envia é você, no botão “Enviar” do cartão, só pela conta do CITi conectada em “Conexões”. Sem a conta conectada não há envio: ele prepara um rascunho, que você copia ou abre no seu programa de e-mail. Não há integração com WhatsApp, Slack nem chat.',
    palavras: ['email', 'e-mail', 'enviar', 'mandar', 'compartilhar', 'whatsapp', 'slack', 'mensagem para'],
  },
  {
    id: 'agenda',
    titulo: 'Consultar agendas ou criar eventos no calendário',
    situacao: 'indisponivel',
    resposta:
      'Com a conta do CITi conectada em “Conexões”, o Taq consulta ocupado/livre dos colegas e cria, remarca e cancela eventos na sua agenda, quando você pede. Sem a conta conectada, o Taq não consulta a agenda de ninguém nem cria eventos ou convites: sugere horários no seu fuso e abre o formulário do Google Agenda preenchido, sem convidados — quem cria o evento é você.',
    palavras: ['agendar', 'agenda', 'calendario', 'convite', 'marcar reuniao', 'proxima reuniao', 'disponibilidade', 'livre'],
  },
  {
    id: 'lembretes',
    titulo: 'Lembretes e cobranças automáticas de compromissos',
    situacao: 'indisponivel',
    resposta:
      'O TaqCiti não manda lembretes nem cobranças: não há nada rodando com o navegador fechado. Os compromissos ficam em “Acompanhamento”, e o Taq os mostra quando você pergunta.',
    palavras: ['lembrete', 'lembrar', 'cobrar', 'cobranca', 'notificacao', 'avisar'],
  },
  {
    id: 'copiloto_automatico',
    titulo: 'Sugestões automáticas durante a reunião ao vivo',
    situacao: 'indisponivel',
    resposta:
      'Não há sugestões automáticas durante a reunião. Pergunte ao Taq na conversa da reunião (por exemplo, "o que perdi?") ou leve um trecho com “Perguntar sobre o trecho”.',
    palavras: ['copiloto', 'ao vivo', 'tempo real', 'sugestoes durante', 'automatico'],
  },
];

// ----------------------------------------------------------------- consulta

/**
 * Duas palavras "são a mesma" quando dividem o radical: "começo" e "começar",
 * "apague" e "apagar", "reunião" e "reuniões". Prefixo comum de 4+ letras que
 * cubra a palavra menor, tirando no máximo as duas últimas.
 */
function mesmaPalavra(a: string, b: string): boolean {
  if (a === b) return true;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i >= 4 && i >= Math.min(a.length, b.length) - 2;
}

/** Cada termo da pergunta conta uma vez; uma expressão inteira ("ao vivo") vale 2. */
function pontuar(palavras: readonly string[], pergunta: string): number {
  const texto = ` ${termosDe(pergunta).join(' ')} `;
  const termos = termosDe(pergunta);
  // Expressão que, sem as palavras vazias, sobra com um termo só ("essa
  // reunião" → "reuniao") não é expressão: vale como palavra solta.
  const partes = palavras.map((p) => termosDe(p));
  const soltas = partes.filter((t) => t.length < 2).flat();
  const expressoes = partes.filter((t) => t.length >= 2).map((t) => t.join(' '));
  const porTermo = termos.filter((t) => soltas.some((p) => mesmaPalavra(p, t))).length;
  const porExpressao = expressoes.filter((e) => e && texto.includes(` ${e} `)).length * 2;
  return porTermo + porExpressao;
}

/** Quem tem a ferramenta DE VERDADE: registrada, não só citada aqui. */
function oAgenteExecuta(f: Funcionalidade, registradas: ReadonlySet<string>): boolean {
  return !!f.ferramenta && registradas.has(f.ferramenta);
}

function operacao(f: Funcionalidade, registradas: ReadonlySet<string>) {
  const executa = oAgenteExecuta(f, registradas);
  return {
    o_agente_executa: executa,
    ...(executa ? { ferramenta: f.ferramenta, como_pedir: f.comoPedir } : {}),
  };
}

export function capacidadesDoApp(registradas: ReadonlySet<string>, assunto?: Assunto) {
  const lista = FUNCIONALIDADES.filter((f) => !assunto || f.assunto === assunto);
  return {
    versao_da_referencia: VERSAO_DA_REFERENCIA,
    assuntos: ASSUNTOS.map((a) => ({ id: a, nome: NOME_DO_ASSUNTO[a] })),
    funcionalidades: lista.map((f) => ({
      id: f.id,
      assunto: f.assunto,
      titulo: f.titulo,
      o_que_faz: f.oQueFaz,
      onde: f.onde,
      verificacao: f.verificacao,
      ...operacao(f, registradas),
    })),
    fora_do_app: assunto
      ? []
      : FORA_DO_APP.map((x) => ({ titulo: x.titulo, situacao: x.situacao, resposta: x.resposta })),
    lembrete:
      'Funcionalidade sem o_agente_executa é só manual: explique os passos (get_usage_guide), não diga que fez.',
  };
}

export function guiaDeUso(
  pergunta: string,
  registradas: ReadonlySet<string>,
  assunto?: Assunto,
) {
  // O assunto que o modelo escolhe só DESEMPATA, nunca exclui: "gerar ata" com
  // assunto "exportacao" (visto ao vivo) sumia com a resposta certa, e o
  // agente dizia à pessoa que aquilo não estava documentado.
  const candidatas = FUNCIONALIDADES;
  const achadas = candidatas
    .map((f) => {
      const base = pontuar([...f.palavras, ...termosDe(f.titulo)], pergunta);
      return { f, pontos: base > 0 && f.assunto === assunto ? base + 0.5 : base };
    })
    .filter((x) => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos);
  const melhor = achadas[0]?.pontos ?? 0;
  // Só as empatadas com a melhor: uma palavra solta ("apagar") não traz meio app.
  const guias = achadas.filter((x) => x.pontos >= Math.floor(melhor)).slice(0, 3);

  // O que não existe só entra quando casa tão bem quanto o que existe: "enviar
  // ao Google Docs" não deve responder com "o TaqCiti não envia e-mail".
  const fora = FORA_DO_APP.map((x) => ({ x, pontos: pontuar(x.palavras, pergunta) }))
    .filter((y) => y.pontos > 0 && y.pontos >= Math.floor(melhor))
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, 2)
    .map(({ x }) => ({ titulo: x.titulo, situacao: x.situacao, resposta: x.resposta }));

  return {
    encontrou: guias.length > 0 || fora.length > 0,
    guias: guias.map(({ f }) => ({
      titulo: f.titulo,
      assunto: NOME_DO_ASSUNTO[f.assunto],
      o_que_faz: f.oQueFaz,
      onde: f.onde,
      passos: f.passos,
      pre_requisitos: f.preRequisitos ?? [],
      limitacoes: f.limitacoes ?? [],
      verificacao: f.verificacao,
      ...operacao(f, registradas),
    })),
    fora_do_app: fora,
    ...(guias.length || fora.length
      ? {}
      : {
          aviso:
            'Nada na referência trata disso. Diga que não está documentado no TaqCiti; não complete com suposições.',
          assuntos_documentados: candidatas.map((f) => f.titulo),
        }),
  };
}
