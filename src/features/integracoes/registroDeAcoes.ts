/**
 * O registro das ações externas — o que impede reenviar às cegas.
 *
 * Cada e-mail e cada evento tem uma CHAVE de idempotência (calculada em código
 * a partir do conteúdo, nunca escolhida pelo modelo) e um estado:
 *
 *   rascunho     — preparado e mostrado; espera a pessoa confirmar
 *   enviando     — a chamada ao Google começou e ainda não terminou
 *   aceito       — o Google aceitou (não é "entregue": ver `gmail.ts`)
 *   falhou       — o Google RECUSOU: nada foi feito, dá para tentar de novo
 *   desconhecido — a chamada pode ter chegado e não sabemos: NÃO reenviar sozinho
 *   cancelado    — a pessoa desistiu do rascunho
 *
 * `enviando` é gravado ANTES da chamada, sob trava: uma segunda tentativa
 * (duplo clique, retry, outra aba) encontra o estado e não envia. Se a página
 * morrer no meio, o `enviando` velho vira `desconhecido` na leitura seguinte.
 *
 * Guarda o que a pessoa viu na prévia (para enviar EXATAMENTE isso ao
 * confirmar), o desfecho e o erro — nunca token nem cabeçalho de resposta.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { readLocal, writeLocal } from '@/shared/services/storage';
import { comTravaLocal } from '@/shared/services/storageLock';
import { dependencias } from './google';

export type TipoDeAcao = 'email' | 'evento_criar' | 'evento_remarcar' | 'evento_cancelar';
export type EstadoDaAcao = 'rascunho' | 'enviando' | 'aceito' | 'falhou' | 'desconhecido' | 'cancelado';

export interface RegistroDeAcao {
  chave: string;
  tipo: TipoDeAcao;
  estado: EstadoDaAcao;
  /** A execução que PREPAROU o rascunho. Confirmar na mesma execução não vale. */
  execucaoId: string;
  conversaId: string;
  criadoEm: number;
  atualizadoEm: number;
  payload: Record<string, unknown>;
  resultado?: Record<string, unknown>;
  erro?: { codigo: string; mensagem: string };
}

/** Passado este tempo, um `enviando` sem desfecho é tratado como desconhecido. */
export const ENVIANDO_VENCE_EM_MS = 2 * 60_000;
const MAX_REGISTROS = 200;

type Mapa = Record<string, RegistroDeAcao>;

async function ler(): Promise<Mapa> {
  const bruto = await readLocal<unknown>(STORAGE_KEYS.integracoesAcoes);
  return bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? structuredClone(bruto as Mapa) : {};
}

function vencerEnviando(mapa: Mapa, agora: number): void {
  for (const r of Object.values(mapa)) {
    if (r.estado === 'enviando' && agora - r.atualizadoEm > ENVIANDO_VENCE_EM_MS) {
      r.estado = 'desconhecido';
      r.atualizadoEm = agora;
      r.erro = {
        codigo: 'interrompido',
        mensagem: 'O envio foi interrompido antes de o Google responder. Não se sabe se saiu.',
      };
    }
  }
}

async function transacao<R>(mudar: (m: Mapa, agora: number) => R): Promise<R> {
  return comTravaLocal(STORAGE_KEYS.integracoesAcoes, async () => {
    const agora = dependencias().agora();
    const mapa = await ler();
    vencerEnviando(mapa, agora);
    const resultado = mudar(mapa, agora);
    const recentes = Object.values(mapa)
      .sort((a, b) => b.atualizadoEm - a.atualizadoEm)
      .slice(0, MAX_REGISTROS);
    await writeLocal(STORAGE_KEYS.integracoesAcoes, Object.fromEntries(recentes.map((r) => [r.chave, r])));
    return resultado;
  });
}

/**
 * A conversa foi apagada: os rascunhos dela (destinatários e texto, às vezes
 * derivado de uma reunião) não têm mais como ser confirmados e não têm tela para
 * apagá-los. Saem só `rascunho` e `cancelado`. As ações que JÁ aconteceram ou
 * ficaram incertas (`enviando`, `aceito`, `falhou`, `desconhecido`) ficam: elas
 * são a trava que impede reenviar às cegas. Devolve quantos saíram.
 */
export async function removerRascunhosDasConversas(conversaIds: readonly string[]): Promise<number> {
  const alvo = new Set(conversaIds);
  return transacao((mapa) => {
    let n = 0;
    for (const [chave, r] of Object.entries(mapa)) {
      if (alvo.has(r.conversaId) && (r.estado === 'rascunho' || r.estado === 'cancelado')) {
        delete mapa[chave];
        n += 1;
      }
    }
    return n;
  });
}

export async function obterAcao(chave: string): Promise<RegistroDeAcao | null> {
  const mapa = await ler();
  vencerEnviando(mapa, dependencias().agora());
  return mapa[chave] ?? null;
}

/**
 * Guarda (ou atualiza) um rascunho. Não mexe numa ação que já passou de
 * rascunho: um envio feito não volta a ser prévia.
 */
export async function guardarRascunho(p: {
  chave: string;
  tipo: TipoDeAcao;
  execucaoId: string;
  conversaId: string;
  payload: Record<string, unknown>;
}): Promise<RegistroDeAcao> {
  return transacao((mapa, agora) => {
    const atual = mapa[p.chave];
    if (atual && atual.estado !== 'rascunho' && atual.estado !== 'cancelado') return atual;
    const registro: RegistroDeAcao = {
      chave: p.chave,
      tipo: p.tipo,
      estado: 'rascunho',
      // A primeira execução que preparou continua sendo a "que preparou".
      execucaoId: atual?.estado === 'rascunho' ? atual.execucaoId : p.execucaoId,
      conversaId: p.conversaId,
      criadoEm: atual?.criadoEm ?? agora,
      atualizadoEm: agora,
      payload: p.payload,
    };
    mapa[p.chave] = registro;
    return registro;
  });
}

/**
 * A pessoa desistiu do rascunho ("Descartar"). Só atua em `rascunho`: o que já
 * foi enviado, está em curso ou tem resultado desconhecido não volta atrás.
 * `conversaId`: o rascunho tem de ser desta conversa.
 */
export async function cancelarRascunho(chave: string, conversaId: string): Promise<boolean> {
  return transacao((mapa, agora) => {
    const atual = mapa[chave];
    if (!atual || atual.estado !== 'rascunho' || atual.conversaId !== conversaId) return false;
    atual.estado = 'cancelado';
    atual.atualizadoEm = agora;
    return true;
  });
}

export type Reserva =
  | { tipo: 'reservado'; registro: RegistroDeAcao }
  /** Outra chamada está em curso. */
  | { tipo: 'em_andamento'; registro: RegistroDeAcao }
  /** Já foi aceito pelo Google: não repetir. */
  | { tipo: 'ja_feito'; registro: RegistroDeAcao }
  /** Pode ter saído: só repete com pedido explícito da pessoa. */
  | { tipo: 'desconhecido'; registro: RegistroDeAcao };

/**
 * Marca `enviando` sob trava, ou diz por que não. `permitirDesconhecido`: a
 * pessoa pediu EXPLICITAMENTE para reenviar mesmo sem saber se saiu.
 */
export async function reservarExecucao(p: {
  chave: string;
  tipo: TipoDeAcao;
  execucaoId: string;
  conversaId: string;
  payload: Record<string, unknown>;
  permitirDesconhecido?: boolean;
}): Promise<Reserva> {
  return transacao((mapa, agora): Reserva => {
    const atual = mapa[p.chave];
    if (atual) {
      if (atual.estado === 'enviando') return { tipo: 'em_andamento', registro: atual };
      if (atual.estado === 'aceito') return { tipo: 'ja_feito', registro: atual };
      if (atual.estado === 'desconhecido' && !p.permitirDesconhecido) return { tipo: 'desconhecido', registro: atual };
    }
    const registro: RegistroDeAcao = {
      chave: p.chave,
      tipo: p.tipo,
      estado: 'enviando',
      execucaoId: atual?.execucaoId ?? p.execucaoId,
      conversaId: p.conversaId,
      criadoEm: atual?.criadoEm ?? agora,
      atualizadoEm: agora,
      payload: p.payload,
    };
    mapa[p.chave] = registro;
    return { tipo: 'reservado', registro };
  });
}

export async function concluirAcao(
  chave: string,
  desfecho:
    | { estado: 'aceito'; resultado: Record<string, unknown> }
    | { estado: 'falhou' | 'desconhecido'; erro: { codigo: string; mensagem: string } },
): Promise<RegistroDeAcao | null> {
  return transacao((mapa, agora) => {
    const atual = mapa[chave];
    if (!atual) return null;
    atual.estado = desfecho.estado;
    atual.atualizadoEm = agora;
    if (desfecho.estado === 'aceito') {
      atual.resultado = desfecho.resultado;
      delete atual.erro;
    } else {
      atual.erro = desfecho.erro;
    }
    return atual;
  });
}
