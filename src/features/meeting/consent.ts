/**
 * "Quer que eu registre esta reunião?" — a pergunta que vem ANTES da captura,
 * e o canal entre quem a faz e quem a responde.
 *
 * ── Dois contextos, um storage ────────────────────────────────────────────
 *
 * Quem DETECTA a reunião é o content script, dentro da aba do Meet. Quem
 * PERGUNTA é o painel lateral, que é página da extensão e não tem como ser
 * alcançado por `tabs.sendMessage` nem sabe o id daquela aba. Os dois olham
 * para o `chrome.storage.session`: o content script anuncia a reunião
 * pendente, o painel lê e mostra a pergunta, o painel grava a resposta, o
 * content script reage.
 *
 * Isso também resolve a ordem: o painel pode abrir dez minutos depois de a
 * reunião começar e ainda encontrar a pergunta de pé, porque ela é um ESTADO
 * guardado, não um evento que passou.
 *
 * ── Por que a decisão é guardada, e por que só na sessão ──────────────────
 *
 * A sidebar e a página do Meet morrem e renascem o tempo todo (navegação do
 * Meet, painel fechado, service worker dormindo). Se a resposta vivesse em
 * memória, a pergunta reapareceria a cada um desses momentos — e reperguntar
 * depois de um "não" é pior do que nunca ter perguntado.
 *
 * `session`, e não `local`: a decisão vale para ESTA reunião. Guardá-la para
 * sempre faria um "não" de terça-feira silenciar a pergunta numa sala
 * recorrente meses depois, sem ninguém entender por quê.
 *
 * ── O que "recusar" significa ─────────────────────────────────────────────
 *
 * Captura desligada, e nada mais. Não é um bloqueio: a sidebar continua com o
 * botão de começar, porque mudar de ideia no meio da conversa é comum e não
 * deveria exigir sair e voltar da sala.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { onSessionChange, readSession, writeSession } from '@/shared/services/storage';

export type DecisaoDeRegistro = 'aceito' | 'recusado';

type Registro = Record<string, DecisaoDeRegistro>;

/** Teto de salas lembradas. A sessão do navegador pode durar dias. */
const MAX_SALAS = 40;

async function ler(): Promise<Registro> {
  const guardado = await readSession<Registro>(STORAGE_KEYS.meetingConsent);
  return guardado && typeof guardado === 'object' && !Array.isArray(guardado)
    ? guardado
    : {};
}

/** O que já foi decidido para esta sala, ou `null` se ainda não perguntamos. */
export async function decisaoDe(meetingCode: string): Promise<DecisaoDeRegistro | null> {
  const valor = (await ler())[meetingCode];
  return valor === 'aceito' || valor === 'recusado' ? valor : null;
}

export async function guardarDecisao(
  meetingCode: string,
  decisao: DecisaoDeRegistro,
): Promise<void> {
  const registro = await ler();
  const chaves = Object.keys(registro);
  // Poda pela ordem de inserção: as salas mais antigas são as que menos
  // importam, e um objeto sem teto cresce em silêncio.
  const podado: Registro =
    chaves.length >= MAX_SALAS
      ? Object.fromEntries(
          chaves.slice(chaves.length - MAX_SALAS + 1).map((k) => [k, registro[k]!]),
        )
      : registro;
  await writeSession(STORAGE_KEYS.meetingConsent, { ...podado, [meetingCode]: decisao });
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

// ---------- a reunião detectada, anunciada para o painel ----------

export interface ReuniaoDetectada {
  meetingCode: string;
  title: string;
  /** A aba do Meet. O painel usa para saber se está olhando a aba certa. */
  tabId: number | null;
  /** Quando a detecção aconteceu — não é o início da captura. */
  at: number;
}

function ehDetectada(v: unknown): v is ReuniaoDetectada {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<ReuniaoDetectada>;
  return typeof r.meetingCode === 'string' && typeof r.title === 'string';
}

export async function anunciarReuniao(reuniao: ReuniaoDetectada): Promise<void> {
  await writeSession(STORAGE_KEYS.pendingMeeting, reuniao);
}

/** A sala acabou (ou a aba fechou): não há mais reunião para perguntar sobre. */
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
