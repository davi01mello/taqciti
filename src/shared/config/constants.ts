/**
 * Constantes de comportamento da extensão — um único lugar para ajustar
 * thresholds, chaves de storage e timings.
 */

export const STORAGE_KEYS = {
  /** chrome.storage.session — estado vivo, sobrevive a restart do service worker. */
  state: 'taq:state',
  /** chrome.storage.local — histórico de reuniões (fonte da verdade das transcrições). */
  history: 'taq:history',
  /** chrome.storage.local — mantido só por compatibilidade de migração; nada escreve aqui nesta versão. */
  outbox: 'taq:outbox',
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

export const MAX_HISTORY_RECORDS = 100;

export const PROVIDER_GOOGLE_MEET = 'google-meet';

/** Idioma que a extensão espera nas legendas. Fixo por ora — sem preferência de usuário nesta versão. */
export const EXPECTED_CAPTION_LANGUAGE = 'pt' as const;

/** Chunks aplicados entre cada nova checagem da heurística de idioma da legenda. */
export const LANGUAGE_DETECTION_CHUNK_INTERVAL = 8;

/** Janela de texto (chars) que a heurística de idioma examina — só a fala recente. */
export const LANGUAGE_DETECTION_WINDOW_CHARS = 800;
