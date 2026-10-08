/**
 * Constantes de comportamento da extensão — um único lugar para ajustar
 * thresholds, chaves de storage e timings.
 */

export const STORAGE_KEYS = {
  /** chrome.storage.session — estado vivo, sobrevive a restart do service worker. */
  state: 'taq:state',
  /** chrome.storage.local — histórico de reuniões (fonte da verdade das transcrições). */
  history: 'taq:history',
  /** chrome.storage.local — métricas locais de observabilidade. */
  metrics: 'taq:metrics',
  /** chrome.storage.local — preferências do painel (borda, posição, legendas). */
  prefs: 'taq:prefs',
  /** chrome.storage.session — abas com o painel injetado, para endereçar o broadcast. */
  panelTabs: 'taq:panelTabs',
  /** chrome.storage.local — conversas do Assistente (a HOME em aba inteira). */
  conversations: 'taq:conversations',
  /**
   * chrome.storage.session — a resposta à pergunta "registrar esta reunião?",
   * por PARTICIPAÇÃO (ver `participation` abaixo e features/meeting/consent.ts).
   *
   * `session`, e não `local`: a autorização vale para esta vez. Guardá-la para
   * sempre faria um "sim" de hoje ligar a captura sozinha na daily de amanhã,
   * que tem o mesmo link — captura sem ninguém ter perguntado nada.
   */
  meetingConsent: 'taq:meetingConsent',
  /**
   * chrome.storage.session — a participação atual: esta vez em que se entrou
   * nesta sala. É a chave da autorização, e não o código da sala, porque o link
   * do Meet é reutilizado entre reuniões diferentes.
   */
  participation: 'taq:participation',
  /**
   * chrome.storage.session — a reunião detectada nesta sessão do navegador,
   * anunciada pelo content script para o painel lateral poder perguntar.
   *
   * O content script sabe que há uma reunião; quem pergunta é o painel, que
   * vive noutro contexto. `sendMessage` não liga os dois sem alguém saber o id
   * da aba do outro — o storage liga, e de quebra sobrevive ao painel abrir
   * depois de a reunião já ter começado.
   */
  pendingMeeting: 'taq:pendingMeeting',

  /*
   * ── Os anexos de uma reunião ─────────────────────────────────────────────
   *
   * Três chaves separadas, e NENHUMA delas dentro do registro da reunião.
   *
   * A transcrição é o que a extensão capturou; nota, marcação e print são o
   * que a PESSOA acrescentou. Misturá-los no mesmo objeto faria toda escrita de
   * nota reescrever o registro inteiro da reunião — com a captura correndo e
   * gravando esse mesmo registro a cada trecho, as duas escritas se
   * atropelariam e a última a chegar apagaria a outra. Separados, cada um tem
   * um dono e um ritmo.
   *
   * É também o que garante o requisito literal: o .txt exportado continua
   * sendo o texto original, porque as marcações nunca estiveram dentro dele.
   */
  /** chrome.storage.local — notas escritas à mão, por reunião. */
  notes: 'taq:notes',
  /** chrome.storage.local — ícone associado a um trecho, por captionId. */
  marks: 'taq:marks',
  /** chrome.storage.local — prints da aba da reunião. */
  shots: 'taq:shots',
  /** chrome.storage.local — aviso no chat do Meet já enviado, por reunião. */
  chatNotice: 'taq:chatNotice',

  /**
   * chrome.storage.local — os DOCUMENTOS guardados.
   *
   * Coleção própria, e não um campo dentro do registro da reunião, pelo mesmo
   * motivo das anotações acima: a captura reescreve o registro da reunião a
   * cada trecho, e um documento guardado lá dentro seria atropelado por uma
   * escrita da transcrição. Aqui ele tem dono e ritmo próprios, e o vínculo
   * com a reunião (ou com a conversa) é um id, não um aninhamento.
   *
   * Só entra aqui documento cujo CONTEÚDO a extensão tem. Um arquivo que foi
   * apenas baixado num passado sem esta coleção não vira registro: listá-lo
   * seria oferecer "abrir" e "editar" para algo que não existe mais aqui.
   */
  documents: 'taq:documents',

  /**
   * chrome.storage.local — as VERSÕES dos documentos personalizados.
   *
   * Uma coleção ao lado de `documents`, e não dentro dele: o registro do
   * documento é o que a seção "Documentos" lista e edita como texto, e a
   * árvore de blocos com o histórico de revisões tem outro ritmo e outro
   * tamanho. O vínculo é o id do documento. Só a árvore é guardada — o PDF é
   * derivado dela pelo servidor, sob demanda.
   */
  documentVersions: 'taq:documentVersions',

  /**
   * chrome.storage.local — o estado da sincronização com o servidor.
   *
   * `local` e não `session`: é uma decisão que vale até ser desfeita, não uma
   * autorização por vez como `participation`. A diferença é proposital — dizer
   * "sim, sincronize" uma vez por reunião seria atrito diário para uma
   * pergunta que só faz sentido uma vez.
   *
   * O que mora aqui é o SIM, não a credencial. O token do Google é do Chrome e
   * fica no cache dele; guardar uma cópia nossa só criaria um segredo a mais
   * para vazar, com validade pior que a do original.
   */
  sync: 'taq:sync',

  /**
   * chrome.storage.local — o que JÁ foi aceito pelo servidor.
   *
   * Um resumo curto por item (`tipo:id` → assinatura), e não um "sincronizei
   * até tal data": as coisas mudam para trás. Renomear uma reunião de março,
   * editar um documento antigo ou apagar uma nota são invisíveis para um
   * marcador temporal, e visíveis para uma assinatura que deixou de bater.
   *
   * Separado de `sync` porque tem outro ciclo de vida: o "sim" é da pessoa e
   * dura até ela desfazer; isto é cache de progresso, e apagá-lo só custa um
   * reenvio.
   */
  syncEstado: 'taq:syncEstado',

  /**
   * chrome.storage.local — o registro das execuções do Taq (o assistente).
   *
   * Operação, não conteúdo: ids, estado, ferramentas usadas, duração, falhas e o
   * consumo que o provedor informou. Nenhum trecho de reunião ou documento,
   * nenhum raciocínio do modelo. Limitado às últimas 50 execuções. Ver
   * `features/taq/execucoes.ts`.
   */
  taqExecucoes: 'taq:execucoes',

  /**
   * chrome.storage.local — a lixeira das exclusões feitas pelo Taq: um retrato de
   * cada reunião apagada (registro, nota, marcações, prints, vínculos), por 30
   * dias, para "Desfazer". Ver `features/taq/lixeira.ts`.
   */
  taqLixeira: 'taq:lixeira',

  /**
   * chrome.storage.local — os registros de TRABALHO: compromissos, decisões,
   * achados e análises de reunião. Registros próprios, ligados às fontes por id
   * e versão; apagar a reunião leva só as análises dela (derivado exclusivo).
   * Ver `features/trabalho/store.ts`.
   */
  trabalho: 'taq:trabalho',

  /**
   * chrome.storage.local — a conexão da conta Google do CITi com as integrações
   * (e-mail, diretório, agenda): e-mail, domínio e escopos concedidos. NUNCA o
   * token: ele vive no cache do Chrome (`chrome.identity`). Ver
   * `features/integracoes/estado.ts`.
   */
  integracoes: 'taq:integracoes',

  /**
   * chrome.storage.local — o registro das ações externas (e-mails e eventos): o
   * rascunho que espera confirmação e o desfecho de cada envio, com a chave de
   * idempotência. É o que impede reenviar às cegas. Ver
   * `features/integracoes/registroDeAcoes.ts`.
   */
  integracoesAcoes: 'taq:acoes-externas',

  /**
   * chrome.storage.local — avisos que o Taq produziu a partir de eventos reais
   * (captura, acompanhamento, documento, operação). Ver `features/avisos`.
   */
  avisos: 'taq:avisos',

  /**
   * chrome.storage.local — quem, pelo NOME, já foi reconhecido (ou descartado)
   * como gente do CITi no diretório. O Meet entrega o nome do falante, não o
   * e-mail; este cache evita buscar o mesmo nome a cada fala. Ver
   * `features/integracoes/colegas.ts`.
   */
  colegasDoCiti: 'taq:colegas-citi',

  /**
   * chrome.storage.local — o perfil de condução (como a pessoa quer ser
   * ajudada) e o briefing de cada reunião (o objetivo que ela quer alcançar).
   * Apagar a reunião leva só o briefing dela. Ver `features/conducao/store.ts`.
   */
  conducao: 'taq:conducao',

  /**
   * chrome.storage.local — as sugestões de condução (privadas, para quem
   * conduz) e o feedback sobre elas. Derivados da reunião: apagá-la leva as
   * dela. Ver `features/apoio/store.ts`.
   */
  apoio: 'taq:apoio',

  /**
   * chrome.storage.local — o estado dos pontos de cada reunião (a esclarecer,
   * discutido, a confirmar, decidido, adiado), com a fala que sustenta cada um.
   * Derivado da reunião: apagá-la leva o dela. Ver `features/estado/store.ts`.
   */
  estado: 'taq:estado',
} as const;

/** Chaves da era "CITi Flow Companion" — migradas uma única vez no boot. */
export const LEGACY_STORAGE_KEYS = {
  history: 'cfc:history',
  outbox: 'cfc:outbox',
  metrics: 'cfc:metrics',
  activeSnapshot: 'cfc:activeSnapshot',
  state: 'cfc:state',
} as const;

/** Intervalo do poll de detecção de reunião/legendas no content script. */
export const MEET_POLL_INTERVAL_MS = 1500;
/** Polls consecutivos sem UI de chamada antes de considerar a reunião encerrada. */
export const MEET_END_CONFIRM_POLLS = 2;

/** Tentativas de ligar as legendas automaticamente antes de pedir ajuda ao usuário. */
export const AUTO_CAPTIONS_MAX_ATTEMPTS = 6;

/**
 * Intervalo mínimo entre varreduras da região de legendas. O Meet reescreve
 * essa região dezenas de vezes por segundo; varrer a cada mutação torrava CPU
 * na aba da reunião sem capturar uma palavra a mais.
 */
export const CAPTION_SCAN_INTERVAL_MS = 120;

/**
 * Legendas ligadas, legenda visível na tela e nenhum chunk chegando por este
 * tempo = a captura morreu em silêncio. O watchdog reata o observer e o painel
 * avisa, em vez de continuar dizendo "gravando".
 */
export const CAPTURE_STALL_TIMEOUT_MS = 25_000;

/**
 * Agrupamento das gravações do estado vivo. Uma legenda chega a cada poucos
 * centésimos; persistir e retransmitir o estado INTEIRO a cada uma fazia o
 * custo crescer com o quadrado da duração da reunião.
 */
export const STATE_FLUSH_INTERVAL_MS = 250;

/**
 * Janela para retomar a MESMA sessão ao reentrar na mesma sala (queda de
 * conexão, reload da aba, "Finalizar" por engano): a transcrição continua
 * de onde parou em vez de nascer uma reunião nova.
 */
export const REJOIN_RESUME_WINDOW_MS = 10 * 60 * 1000;

/** Throttle do salvamento contínuo da reunião ao vivo no histórico. */
export const LIVE_SAVE_THROTTLE_MS = 4000;

/** Workspace local atualmente materializado nas chaves taq:* legadas. */
export const ACTIVE_IDENTITY_NAMESPACE_KEY = 'taq:activeIdentityNamespace';
/** Versão global das migrações locais; não pertence a um usuário. */
export const LOCAL_STORAGE_SCHEMA_VERSION_KEY = 'taq:storageSchemaVersion';
export const LOCAL_STORAGE_SCHEMA_VERSION = 2;
export const ANONYMOUS_IDENTITY_NAMESPACE = 'anonymous';

export const PROVIDER_GOOGLE_MEET = 'google-meet';

/** Chunks aplicados entre cada nova checagem da heurística de idioma da legenda. */
export const LANGUAGE_DETECTION_CHUNK_INTERVAL = 8;

/** Janela de texto (chars) que a heurística de idioma examina — só a fala recente. */
export const LANGUAGE_DETECTION_WINDOW_CHARS = 800;
