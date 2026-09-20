/**
 * "Quer que eu registre esta reunião?" — a pergunta que vem ANTES da captura,
 * e o canal entre quem a faz e quem a responde.
 *
 * ── A regra: a autorização vale para uma PARTICIPAÇÃO ─────────────────────
 *
 * A primeira versão guardava a decisão por CÓDIGO DE SALA, e isso estava
 * errado de um jeito perigoso: o link do Meet é reutilizado. A daily de hoje e
 * a daily de amanhã têm o mesmo endereço, e um "sim" de hoje ligaria a captura
 * sozinha amanhã — sem ninguém ter perguntado nada.
 *
 * A unidade certa não é a sala: é a PARTICIPAÇÃO, ou seja, esta vez em que se
 * entrou nesta sala. Cada participação tem um id próprio, e a autorização é
 * chaveada por ele. Os três casos que o requisito separa caem assim:
 *
 *   • re-render do Meet, recarregar a aba, a sidebar fechar e abrir
 *       → a participação ainda está ABERTA (`saiuEm === null`). Mesma
 *         participação, mesma autorização, nenhuma pergunta nova.
 *
 *   • queda curta de conexão, sair e voltar em seguida
 *       → a participação está fechada há pouco. Dentro de
 *         `REJOIN_RESUME_WINDOW_MS` ela é RETOMADA — a mesma, porque é também
 *         a mesma sessão que a máquina de estados retoma (ver machine.ts). As
 *         duas noções de "continua sendo a mesma reunião" usam a mesma janela
 *         de propósito: divergir faria a transcrição continuar enquanto a
 *         pergunta voltava, ou o contrário.
 *
 *   • entrar de novo no mesmo link horas depois, ou noutro dia
 *       → fora da janela: participação NOVA, id novo, pergunta de novo.
 *
 *   • fechar e reabrir o navegador
 *       → `storage.session` some com ele. Sem participação e sem decisão: a
 *         pergunta volta. É o comportamento pedido, e sai de graça por a
 *         decisão nunca ter sido `local`.
 *
 * O HISTÓRICO não depende disto: transcrições, notas e marcações vivem em
 * `storage.local` e não são tocados por nada aqui. O que expira é a permissão,
 * não o registro.
 *
 * ── Dois contextos, um storage ────────────────────────────────────────────
 *
 * Quem DETECTA a reunião é o content script, dentro da aba do Meet. Quem
 * pergunta pode ser a sidebar (página da extensão, sem como ser alcançada por
 * `tabs.sendMessage`) ou a própria cápsula. Os três olham para o
 * `chrome.storage.session`: o content script anuncia, quem perguntou grava a
 * resposta, o content script reage. É isso que faz a confirmação na página e a
 * confirmação na sidebar serem a MESMA decisão, sem pergunta duplicada.
 */
import { REJOIN_RESUME_WINDOW_MS, STORAGE_KEYS } from '@/shared/config/constants';
import { onSessionChange, readSession, writeSession } from '@/shared/services/storage';

export type DecisaoDeRegistro = 'aceito' | 'recusado';

// ---------- a participação ----------

export interface Participacao {
  /** A sala. Só para reconhecer que é a mesma; não é a chave da autorização. */
  meetingCode: string;
  /** A chave da autorização: ESTA vez em que se entrou nesta sala. */
  id: string;
  comecouEm: number;
  /** `null` enquanto se está dentro; o instante da saída quando se sai. */
  saiuEm: number | null;
}

function ehParticipacao(v: unknown): v is Participacao {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<Participacao>;
  return typeof p.meetingCode === 'string' && typeof p.id === 'string';
}

function novoId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function lerParticipacao(): Promise<Participacao | null> {
  const bruto = await readSession<unknown>(STORAGE_KEYS.participation);
  return ehParticipacao(bruto) ? bruto : null;
}

/**
 * Entrou numa sala. Devolve a participação que vale agora — a mesma de antes,
 * quando é a mesma; uma nova, quando não é.
 *
 * Pura o bastante para ser testável: recebe o instante em vez de olhar o
 * relógio.
 */
export async function abrirParticipacao(
  meetingCode: string,
  agora: number,
): Promise<Participacao> {
  const atual = await lerParticipacao();

  if (atual && atual.meetingCode === meetingCode) {
    // Ainda dentro: re-render, reload da aba, sidebar reabrindo.
    if (atual.saiuEm === null) return atual;
    // Saiu há pouco: a mesma participação, retomada.
    if (agora - atual.saiuEm <= REJOIN_RESUME_WINDOW_MS) {
      const retomada: Participacao = { ...atual, saiuEm: null };
      await writeSession(STORAGE_KEYS.participation, retomada);
      return retomada;
    }
  }

  const nova: Participacao = {
    meetingCode,
    id: novoId(),
    comecouEm: agora,
    saiuEm: null,
  };
  await writeSession(STORAGE_KEYS.participation, nova);
  return nova;
}

/**
 * Saiu da sala. A participação não é APAGADA — fica fechada, para uma volta em
 * seguida poder retomá-la. Apagar aqui faria toda queda de conexão virar uma
 * reunião nova, com pergunta nova e transcrição partida em duas.
 */
export async function fecharParticipacao(agora: number): Promise<void> {
  const atual = await lerParticipacao();
  if (!atual || atual.saiuEm !== null) return;
  await writeSession(STORAGE_KEYS.participation, { ...atual, saiuEm: agora });
}

// ---------- a decisão, por participação ----------

type Registro = Record<string, DecisaoDeRegistro>;

/** Teto de participações lembradas. A sessão do navegador pode durar dias. */
const MAX_LEMBRADAS = 40;

async function ler(): Promise<Registro> {
  const guardado = await readSession<Registro>(STORAGE_KEYS.meetingConsent);
  return guardado && typeof guardado === 'object' && !Array.isArray(guardado)
    ? guardado
    : {};
}

/** O que já foi decidido para ESTA participação, ou `null` se ninguém decidiu. */
export async function decisaoDe(
  participacaoId: string,
): Promise<DecisaoDeRegistro | null> {
  const valor = (await ler())[participacaoId];
  return valor === 'aceito' || valor === 'recusado' ? valor : null;
}

export async function guardarDecisao(
  participacaoId: string,
  decisao: DecisaoDeRegistro,
): Promise<void> {
  const registro = await ler();
  const chaves = Object.keys(registro);
  const podado: Registro =
    chaves.length >= MAX_LEMBRADAS
      ? Object.fromEntries(
          chaves.slice(chaves.length - MAX_LEMBRADAS + 1).map((k) => [k, registro[k]!]),
        )
      : registro;
  await writeSession(STORAGE_KEYS.meetingConsent, {
    ...podado,
    [participacaoId]: decisao,
  });
}

/** Avisa quando QUALQUER decisão muda — é assim que o content script reage. */
export function observarDecisoes(cb: (registro: Registro) => void): () => void {
  let vivo = true;
  void ler().then((r) => {
    if (vivo) cb(r);
  });
  const parar = onSessionChange<Registro>(STORAGE_KEYS.meetingConsent, (valor) => {
    if (!vivo) return;
    cb(valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {});
  });
  return () => {
    vivo = false;
    parar();
  };
}

// ---------- a reunião detectada, anunciada para quem pergunta ----------

export interface ReuniaoDetectada {
  meetingCode: string;
  title: string;
  /** A participação a que a pergunta se refere — e a chave da resposta. */
  participacaoId: string;
  /** A aba do Meet. */
  tabId: number | null;
  /** Quando a detecção aconteceu — não é o início da captura. */
  at: number;
}

function ehDetectada(v: unknown): v is ReuniaoDetectada {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<ReuniaoDetectada>;
  return (
    typeof r.meetingCode === 'string' &&
    typeof r.title === 'string' &&
    typeof r.participacaoId === 'string'
  );
}

export async function anunciarReuniao(reuniao: ReuniaoDetectada): Promise<void> {
  await writeSession(STORAGE_KEYS.pendingMeeting, reuniao);
}

/** A sala acabou (ou a decisão saiu): não há mais o que perguntar. */
export async function esquecerReuniao(): Promise<void> {
  await writeSession(STORAGE_KEYS.pendingMeeting, null);
}

export async function lerReuniaoDetectada(): Promise<ReuniaoDetectada | null> {
  const bruto = await readSession<unknown>(STORAGE_KEYS.pendingMeeting);
  return ehDetectada(bruto) ? bruto : null;
}

export function observarReuniaoDetectada(
  cb: (reuniao: ReuniaoDetectada | null) => void,
): () => void {
  let vivo = true;
  void lerReuniaoDetectada().then((r) => {
    if (vivo) cb(r);
  });
  const parar = onSessionChange<unknown>(STORAGE_KEYS.pendingMeeting, (valor) => {
    if (vivo) cb(ehDetectada(valor) ? valor : null);
  });
  return () => {
    vivo = false;
    parar();
  };
}
