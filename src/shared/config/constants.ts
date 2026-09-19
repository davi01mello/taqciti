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
   * por código de sala.
   *
   * `session`, e não `local`, de propósito: a decisão vale para ESTA reunião.
   * Guardá-la para sempre faria um "não" de terça-feira silenciar a pergunta
   * numa sala recorrente meses depois, sem ninguém entender por quê. Sobreviver
   * ao service worker dormir e à aba recarregar é exatamente o alcance certo —
   * é isso que impede a pergunta de voltar a cada re-render ou reconexão curta.
   */
  meetingConsent: 'taq:meetingConsent',
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
