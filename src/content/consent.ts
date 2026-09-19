/**
 * "Quer que eu registre esta reunião?" — a pergunta que vem ANTES da captura.
 *
 * ── Por que a decisão é guardada, e não só lembrada ────────────────────────
 *
 * A sidebar é um content script: ela morre a cada navegação do Meet, e o Meet
 * navega sozinho (entrar na sala, sair para a tela de fim, voltar). Se a
 * resposta vivesse na memória do componente, a pergunta reapareceria em cada
 * um desses momentos — e reperguntar depois de um "não" é pior do que nunca ter
 * perguntado: a pessoa já decidiu, e a interface está insistindo.
 *
 * Por isso a decisão vai para `chrome.storage.session`, por código de sala.
 * Sobrevive a re-render, a recarregar a aba e ao service worker dormir; não
 * sobrevive a fechar o navegador, que é quando "esta reunião" deixa de ser esta
 * reunião. Ver `STORAGE_KEYS.meetingConsent`.
 *
 * ── O que "recusar" significa ──────────────────────────────────────────────
 *
 * Captura desligada, e nada mais. Não é um bloqueio: a sidebar continua na tela
 * com o botão de começar, porque mudar de ideia no meio da conversa é comum e
 * não deveria exigir sair e voltar da sala. O que não acontece é a extensão
 * decidir sozinha.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { readSession, writeSession } from '@/shared/services/storage';

export type DecisaoDeRegistro = 'aceito' | 'recusado';

type Registro = Record<string, DecisaoDeRegistro>;

/** Teto de salas lembradas. A sessão do navegador pode durar dias. */
const MAX_SALAS = 40;

async function ler(): Promise<Registro> {
  const guardado = await readSession<Registro>(STORAGE_KEYS.meetingConsent);
  return guardado && typeof guardado === 'object' ? guardado : {};
}

/** O que já foi decidido para esta sala, ou `null` se ainda não perguntamos. */
export async function decisaoDe(meetingCode: string): Promise<DecisaoDeRegistro | null> {
  const registro = await ler();
  const valor = registro[meetingCode];
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
