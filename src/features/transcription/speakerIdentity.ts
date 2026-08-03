/**
 * Identidade de falante — quem é quem na reunião, resolvido de uma vez só.
 *
 * O bug que este módulo existe para matar: uma pessoa aparecia como DUAS. O
 * Meet rotula a própria fala como "Você" enquanto o nome real ainda não está
 * no DOM, e os tiles trazem variantes decoradas ("Bernardo Belfort (Você)",
 * "Bernardo Belfort (Apresentando)"). Cada variante virava um falante novo:
 * dois avatares, "2 pessoas" no cabeçalho e "Reunião com Você" no título.
 *
 * A regra é simples: toda variante de escrita da MESMA pessoa colapsa numa
 * chave de identidade, e cada chave tem UM nome de exibição. Quando o nome
 * real aparece depois de a fala já ter sido capturada, o registro devolve o
 * rename correspondente para que a transcrição já gravada seja corrigida
 * retroativamente (evento SPEAKERS_MERGED da máquina de estados).
 */
import { formatSpeakerName, isSelfCaptionLabel } from './sanitize';

/** Um nome que passou a ser outro: o histórico já capturado precisa mudar. */
export interface SpeakerRename {
  from: string;
  to: string;
}

const DIACRITICS = /[̀-ͯ]/g;

/**
 * Sufixos que o Meet cola no nome nos tiles e na lista de participantes. Não
 * são parte do nome de ninguém e nunca podem criar uma pessoa nova.
 */
const ROLE_SUFFIXES = new Set([
  'voce', 'you', 'eu', 'me', 'host', 'anfitriao', 'organizador', 'organizer',
  'apresentando', 'presenting', 'apresentador', 'moderador', 'convidado',
  'guest', 'ausente', 'offline',
]);

/**
 * Chave de identidade de um nome: sem acento, sem pontuação, minúscula, sem
 * parênteses e sem sufixo de papel.
 *
 * "Bernardo Belfort (Você)" · "BERNARDO BELFORT" · "bernardo  belfort"
 *   → todos viram "bernardo belfort"
 */
export function identityKey(name: string): string {
  const withoutParens = name.replace(/\([^)]*\)/g, ' ');
  const words = withoutParens
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0);

  // Sufixo de papel só é descartado no FIM e nunca sozinho: "Host" como nome
  // inteiro continua sendo um falante (melhor um nome estranho que nenhum).
  while (words.length > 1 && ROLE_SUFFIXES.has(words[words.length - 1] as string)) {
    words.pop();
  }
  return words.join(' ');
}

function withoutRoleDecoration(name: string): string {
  const withoutKnownParens = name.replace(/\(([^)]*)\)/g, (whole, content: string) => {
    const roles = identityKey(content).split(' ').filter(Boolean);
    return roles.length > 0 && roles.every((role) => ROLE_SUFFIXES.has(role)) ? ' ' : whole;
  });
  const words = withoutKnownParens.trim().split(/\s+/);
  while (words.length > 1 && ROLE_SUFFIXES.has(identityKey(words[words.length - 1]!))) {
    words.pop();
  }
  return words.join(' ');
}

const REJECTED_LABELS = new Set([
  'host',
  'anfitriao',
  'organizer',
  'organizador',
  'presenting',
  'apresentando',
  'microphone off',
  'microfone desativado',
  'camera off',
  'camera desativada',
  'raise hand',
  'levantar a mao',
  'more options',
  'mais opcoes',
  'jump to latest',
  'ir ate o fim',
]);

/** Barreira antes da formatação: UI e frases nunca viram nomes truncados. */
export function isPlausibleSpeakerName(raw: string | null): boolean {
  const clean = raw?.replace(/\s+/g, ' ').trim() ?? '';
  if (clean.length === 0 || clean.length > 80) return false;
  if (isSelfCaptionLabel(clean)) return true;
  const key = identityKey(clean);
  if (key.length === 0 || REJECTED_LABELS.has(key)) return false;
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(clean)) return false;
  if (/^\d+\s+(?:participants?|participantes?|people|pessoas?)$/i.test(clean)) return false;
  if (/^https?:\/\//i.test(clean)) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return true;
  if (!/\p{L}/u.test(clean) || /[!?;:]/.test(clean)) return false;
  return clean.split(/\s+/).length <= 6;
}

export interface SpeakerEvidence {
  source: 'caption' | 'participant';
  /** Tile/roster estável: sinal adicional necessário para fundir grafias. */
  stableId?: string;
}

/**
 * O registro de quem falou na reunião. Guarda uma entrada por pessoa e devolve
 * sempre o mesmo nome de exibição para todas as variantes de escrita dela.
 *
 * Vive no content script (uma instância por sessão de captura).
 */
export class SpeakerRegistry {
  /** chave de identidade → nome de exibição em vigor. */
  private readonly names = new Map<string, string>();
  /**
   * Chaves que nasceram de um rótulo de "self" ("Você", "You"). Não se parecem
   * com o nome real, então precisam ser lembradas para colapsar nele depois.
   */
  private readonly selfLabelKeys = new Set<string>();
  private selfName: string | null = null;
  private selfKey: string | null = null;
  private readonly signalKeys = new Map<string, string>();
  /** Renames pendentes de aplicação na transcrição já capturada. */
  private pending: SpeakerRename[] = [];

  /** Nova sala: nenhuma identidade cumulativa atravessa a fronteira. */
  reset(): void {
    this.names.clear();
    this.selfLabelKeys.clear();
    this.signalKeys.clear();
    this.selfName = null;
    this.selfKey = null;
    this.pending = [];
  }

  /**
   * Informa o nome real de quem está tocando a reunião. Chamar de novo com o
   * mesmo nome não faz nada; com um nome novo, todas as falas rotuladas como
   * "Você" passam a ser dessa pessoa (e viram rename retroativo).
   */
  setSelfName(rawName: string | null): void {
    if (!isPlausibleSpeakerName(rawName)) return;
    const name = formatSpeakerName(rawName ? withoutRoleDecoration(rawName) : null);
    if (name === null || name === this.selfName) return;

    const previousSelf = this.selfName;
    this.selfName = name;
    this.selfKey = identityKey(name);

    // O que já foi capturado como "Você" (ou como o nome antigo) é desta
    // pessoa: o histórico é corrigido no lugar.
    if (previousSelf !== null && previousSelf !== name) {
      this.rename(previousSelf, name);
    }
    for (const [key, display] of [...this.names]) {
      if (this.isSelfKey(key) && display !== name) {
        this.names.set(key, name);
        this.rename(display, name);
      }
    }
    this.names.set(this.selfKey, name);
  }

  /** O nome real de quem está na máquina, quando já conhecido. */
  getSelfName(): string | null {
    return this.selfName;
  }

  /**
   * Nome canônico de exibição de um rótulo cru vindo do DOM do Meet.
   * `null` quando não dá para saber quem falou.
   */
  resolve(
    raw: string | null,
    evidence: SpeakerEvidence = { source: 'caption' },
  ): string | null {
    if (!isPlausibleSpeakerName(raw)) return null;
    if (raw === null) return null;

    // "Você"/"You"/"Eu" é sempre a própria pessoa. Enquanto o nome real não
    // aparece, o rótulo fica; quando aparecer, setSelfName corrige o passado.
    if (isSelfCaptionLabel(raw)) {
      if (this.selfName !== null) return this.selfName;
      const fallback = formatSpeakerName(raw);
      if (fallback === null) return null;
      const key = identityKey(fallback);
      this.selfLabelKeys.add(key);
      return this.register(key, fallback, true, evidence.stableId);
    }

    const formatted = formatSpeakerName(withoutRoleDecoration(raw));
    if (formatted === null) return null;

    const key = identityKey(formatted);
    if (key.length === 0) return null;
    if (this.isSelfKey(key) && this.selfName !== null) return this.selfName;

    return this.register(key, formatted, false, evidence.stableId);
  }

  /** Nome vindo de tile/roster, acompanhado do identificador estável do Meet. */
  observeParticipant(raw: string | null, stableId: string): string | null {
    return this.resolve(raw, { source: 'participant', stableId });
  }

  /** Todos os nomes conhecidos, sem repetição, na ordem em que apareceram. */
  knownNames(): string[] {
    return [...new Set(this.names.values())];
  }

  /** É esta pessoa que está tocando a reunião? */
  isSelf(name: string): boolean {
    return this.selfKey !== null && identityKey(name) === this.selfKey;
  }

  /**
   * Renames acumulados desde a última chamada. O chamador manda para a máquina
   * de estados, que reescreve os segmentos já capturados.
   */
  drainRenames(): SpeakerRename[] {
    const renames = this.pending;
    this.pending = [];
    return renames;
  }

  // ---------- interno ----------

  private isSelfKey(key: string): boolean {
    if (this.selfLabelKeys.has(key)) return true;
    if (this.selfKey === null) return false;
    return key === this.selfKey;
  }

  /**
   * Grava (ou reaproveita) uma grafia. Um nome curto e outro longo continuam
   * pessoas distintas por padrão; uma grafia mais completa só substitui a
   * anterior quando ambas vieram do mesmo identificador estável do Meet.
   */
  private register(
    key: string,
    display: string,
    isSelfLabel: boolean,
    stableId?: string,
  ): string {
    const existing = this.names.get(key);
    if (existing !== undefined) {
      if (stableId) this.signalKeys.set(stableId, key);
      return existing;
    }

    // Prefixo curto sozinho é ambíguo (Ana Souza ≠ Ana Lima). Só o MESMO tile
    // estável autoriza atualizar a grafia e corrigir o passado.
    const signaledKey = stableId ? this.signalKeys.get(stableId) : undefined;
    if (!isSelfLabel && stableId && signaledKey) {
      const knownName = this.names.get(signaledKey);
      if (knownName) {
        const chosen = display.length > knownName.length ? display : knownName;
        this.names.set(signaledKey, chosen);
        this.names.set(key, chosen);
        this.signalKeys.set(stableId, key);
        if (chosen !== knownName) this.rename(knownName, chosen);
        return chosen;
      }
    }

    this.names.set(key, display);
    if (stableId) this.signalKeys.set(stableId, key);
    return display;
  }

  private rename(from: string, to: string): void {
    if (from === to) return;
    this.pending = this.pending
      .map((entry) => (entry.to === from ? { ...entry, to } : entry))
      .filter((entry) => entry.from !== entry.to);
    if (!this.pending.some((entry) => entry.from === from && entry.to === to)) {
      this.pending.push({ from, to });
    }
  }
}
