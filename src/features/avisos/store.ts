/**
 * Os AVISOS do Taq — o que ele tem a dizer sem que a pessoa tenha perguntado.
 *
 * ── De onde nascem ──────────────────────────────────────────────────────────
 *
 * Só de eventos reais: uma captura que parou, uma tarefa extraída sem
 * responsável, um documento que acabou de ser salvo, uma operação que o Taq não
 * conseguiu terminar. Nada aqui é agendado para "simular atividade": se o
 * evento não aconteceu, não há aviso.
 *
 * ── Identidade e repetição ──────────────────────────────────────────────────
 *
 * Cada aviso tem uma `chave` — o evento ou o registro a que se refere
 * (`semresp:<id do compromisso>`, `captura:<reunião>`). Emitir de novo a mesma
 * chave ATUALIZA o aviso existente (estado, texto), nunca cria outro: o mesmo
 * fato não aparece duas vezes na conversa, no popup e nas notificações.
 *
 * Um aviso DISPENSADO continua dispensado quando o mesmo evento é emitido de
 * novo — reabrir a sidebar não reapresenta tudo. Só reaparece se `reabrir` for
 * pedido, o que um produtor faz quando o fato mudou de natureza (a tarefa
 * continua sem responsável, mas agora também venceu o prazo: outra chave).
 *
 * Um aviso RESOLVIDO (o fato deixou de valer: a tarefa ganhou responsável) sai
 * da lista visível, mas fica gravado até o limite, para o histórico.
 *
 * ── Escrita ─────────────────────────────────────────────────────────────────
 *
 * Sob `comTravaLocal`, como os registros de trabalho: duas superfícies
 * emitindo o mesmo aviso ao mesmo tempo produzem um só.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { onLocalChange, readLocal, writeLocal } from '@/shared/services/storage';
import { comTravaLocal } from '@/shared/services/storageLock';

export type OrigemDoAviso = 'captura' | 'acompanhamento' | 'documento' | 'operacao' | 'comunicacao';

/** O estado da operação a que o aviso se refere, nas palavras da interface. */
export type StatusDoAviso =
  | 'aguardando'
  | 'executando'
  | 'concluido'
  | 'parcial'
  | 'cancelado'
  | 'falhou';

export const ROTULO_DO_STATUS: Record<StatusDoAviso, string> = {
  aguardando: 'Aguardando informação',
  executando: 'Executando',
  concluido: 'Concluído',
  parcial: 'Parcial',
  cancelado: 'Cancelado',
  falhou: 'Falhou',
};

/** A ação contextual: a interface a traduz em um botão. */
export type AcaoDoAviso =
  | { tipo: 'abrir_reuniao'; alvoId: string; rotulo?: string }
  | { tipo: 'abrir_documento'; alvoId: string; rotulo?: string }
  | { tipo: 'abrir_acompanhamento'; alvoId?: string; rotulo?: string }
  | { tipo: 'abrir_conversa'; alvoId: string; rotulo?: string };

export interface Aviso {
  id: string;
  /** O evento ou registro a que o aviso se refere: a identidade para deduplicar. */
  chave: string;
  origem: OrigemDoAviso;
  /** `organizador`: só interessa a quem conduz a reunião. `todos`: a qualquer um. */
  publico: 'organizador' | 'todos';
  status: StatusDoAviso;
  /** Uma linha, em linguagem simples. */
  titulo: string;
  /** Detalhe opcional (área recolhível): o que aconteceu e o que fazer. */
  detalhe?: string;
  /** Nomes técnicos (agente, ferramenta, código de erro) — recolhido na interface. */
  tecnico?: string;
  reuniaoId?: string;
  /** A operação associada (`create_document`, `registrar_compromissos`…). */
  operacao?: string;
  acao?: AcaoDoAviso;
  lido: boolean;
  dispensado: boolean;
  /** O fato deixou de valer; sai da lista visível. */
  resolvido: boolean;
  criadoEm: number;
  atualizadoEm: number;
}

export interface NovoAviso {
  chave: string;
  origem: OrigemDoAviso;
  publico?: Aviso['publico'];
  status?: StatusDoAviso;
  titulo: string;
  detalhe?: string;
  tecnico?: string;
  reuniaoId?: string;
  operacao?: string;
  acao?: AcaoDoAviso;
  /** Volta a aparecer mesmo que tenha sido dispensado. */
  reabrir?: boolean;
}

/** Quantos avisos ficam gravados. Resolvidos e dispensados saem primeiro. */
export const LIMITE_DE_AVISOS = 200;

export interface Avisos {
  versao: 1;
  itens: Aviso[];
}

let contador = 0;
function novoId(): string {
  contador += 1;
  return `a${Date.now().toString(36)}${contador.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function normalizar(bruto: unknown): Avisos {
  const lista = (bruto as Partial<Avisos> | null | undefined)?.itens;
  return {
    versao: 1,
    itens: Array.isArray(lista)
      ? lista.filter(
          (a): a is Aviso =>
            !!a && typeof a === 'object' && typeof a.id === 'string' && typeof a.chave === 'string',
        )
      : [],
  };
}

export async function lerAvisos(): Promise<Aviso[]> {
  const bruto = await readLocal<unknown>(STORAGE_KEYS.avisos);
  return normalizar(bruto && typeof bruto === 'object' ? structuredClone(bruto) : bruto).itens;
}

export function observarAvisos(cb: (avisos: Aviso[]) => void): () => void {
  let vivo = true;
  let mudou = false;
  void lerAvisos().then((a) => {
    if (vivo && !mudou) cb(a);
  });
  const parar = onLocalChange<unknown>(STORAGE_KEYS.avisos, (valor) => {
    if (!vivo) return;
    mudou = true;
    cb(normalizar(valor).itens);
  });
  return () => {
    vivo = false;
    parar();
  };
}

async function transacao<R>(
  mudar: (itens: Aviso[]) => { resultado: R; mudou: boolean },
): Promise<R> {
  return comTravaLocal(STORAGE_KEYS.avisos, async () => {
    const atual = normalizar(await readLocal<unknown>(STORAGE_KEYS.avisos));
    const { resultado, mudou } = mudar(atual.itens);
    if (mudou) {
      atual.itens = podar(atual.itens);
      await writeLocal(STORAGE_KEYS.avisos, structuredClone(atual));
    }
    return resultado;
  });
}

/** Mantém os mais recentes; o que já foi resolvido ou dispensado vai primeiro. */
function podar(itens: Aviso[]): Aviso[] {
  if (itens.length <= LIMITE_DE_AVISOS) return itens;
  const ordenados = [...itens].sort((a, b) => b.atualizadoEm - a.atualizadoEm);
  const vivos = ordenados.filter((a) => !a.resolvido && !a.dispensado);
  const mortos = ordenados.filter((a) => a.resolvido || a.dispensado);
  return [...vivos, ...mortos].slice(0, LIMITE_DE_AVISOS);
}

function igual(a: Aviso, n: NovoAviso, status: StatusDoAviso): boolean {
  return (
    a.status === status &&
    a.titulo === n.titulo &&
    a.detalhe === n.detalhe &&
    a.tecnico === n.tecnico &&
    JSON.stringify(a.acao ?? null) === JSON.stringify(n.acao ?? null) &&
    !a.resolvido
  );
}

/**
 * Emite um aviso, sem duplicar. Devolve o aviso gravado e se ele é NOVO (a
 * interface só anuncia — um indicador, nunca foco — o que é novo).
 */
export async function emitirAviso(n: NovoAviso): Promise<{ aviso: Aviso; novo: boolean }> {
  return transacao((itens) => {
    const status = n.status ?? 'concluido';
    const existente = itens.find((a) => a.chave === n.chave);
    const agora = Date.now();
    if (!existente) {
      const aviso: Aviso = {
        id: novoId(),
        chave: n.chave,
        origem: n.origem,
        publico: n.publico ?? 'todos',
        status,
        titulo: n.titulo,
        ...(n.detalhe ? { detalhe: n.detalhe } : {}),
        ...(n.tecnico ? { tecnico: n.tecnico } : {}),
        ...(n.reuniaoId ? { reuniaoId: n.reuniaoId } : {}),
        ...(n.operacao ? { operacao: n.operacao } : {}),
        ...(n.acao ? { acao: n.acao } : {}),
        lido: false,
        dispensado: false,
        resolvido: false,
        criadoEm: agora,
        atualizadoEm: agora,
      };
      itens.unshift(aviso);
      return { resultado: { aviso, novo: true }, mudou: true };
    }
    if (igual(existente, n, status) && !(n.reabrir && existente.dispensado)) {
      return { resultado: { aviso: existente, novo: false }, mudou: false };
    }
    // O fato voltou a valer depois de resolvido: é de novo uma novidade. Um
    // aviso só atualizado (mesmo fato, texto novo) continua lido ou não, como estava.
    const reaberto = existente.resolvido || (n.reabrir === true && existente.dispensado);
    existente.status = status;
    existente.titulo = n.titulo;
    if (n.detalhe) existente.detalhe = n.detalhe;
    else delete existente.detalhe;
    if (n.tecnico) existente.tecnico = n.tecnico;
    else delete existente.tecnico;
    if (n.acao) existente.acao = n.acao;
    else delete existente.acao;
    existente.resolvido = false;
    if (reaberto) {
      existente.dispensado = false;
      existente.lido = false;
    }
    existente.atualizadoEm = Math.max(agora, existente.atualizadoEm + 1);
    return { resultado: { aviso: existente, novo: reaberto }, mudou: true };
  });
}

/** O fato deixou de valer. Idempotente; avisos que não existem são ignorados. */
export async function resolverAvisos(chaves: readonly string[]): Promise<number> {
  const alvo = new Set(chaves);
  return transacao((itens) => {
    let n = 0;
    for (const a of itens) {
      if (alvo.has(a.chave) && !a.resolvido) {
        a.resolvido = true;
        a.atualizadoEm = Math.max(Date.now(), a.atualizadoEm + 1);
        n += 1;
      }
    }
    return { resultado: n, mudou: n > 0 };
  });
}

export async function dispensarAviso(id: string): Promise<boolean> {
  return transacao((itens) => {
    const a = itens.find((x) => x.id === id);
    if (!a || a.dispensado) return { resultado: false, mudou: false };
    a.dispensado = true;
    a.lido = true;
    a.atualizadoEm = Math.max(Date.now(), a.atualizadoEm + 1);
    return { resultado: true, mudou: true };
  });
}

export async function marcarComoLidos(ids: readonly string[]): Promise<number> {
  const alvo = new Set(ids);
  return transacao((itens) => {
    let n = 0;
    for (const a of itens) {
      if (alvo.has(a.id) && !a.lido) {
        a.lido = true;
        n += 1;
      }
    }
    return { resultado: n, mudou: n > 0 };
  });
}

/** Conversa apagada: os avisos que a apontam (pergunta pendente, falha) saem com ela. */
export async function removerAvisosDaConversa(conversaIds: readonly string[]): Promise<number> {
  const alvo = new Set(conversaIds);
  return transacao((itens) => {
    const antes = itens.length;
    const resto = itens.filter(
      (a) =>
        !(a.acao?.tipo === 'abrir_conversa' && alvo.has(a.acao.alvoId)) &&
        !conversaIds.some((id) => a.chave === `pergunta:${id}`),
    );
    itens.splice(0, itens.length, ...resto);
    return { resultado: antes - resto.length, mudou: antes !== resto.length };
  });
}

/** Apaga os avisos de uma reunião (derivado exclusivo dela, como as análises). */
export async function removerAvisosDaReuniao(reuniaoId: string): Promise<number> {
  return transacao((itens) => {
    const antes = itens.length;
    const resto = itens.filter((a) => a.reuniaoId !== reuniaoId);
    itens.splice(0, itens.length, ...resto);
    return { resultado: antes - resto.length, mudou: antes !== resto.length };
  });
}

// ------------------------------------------------------------------- seleção

export interface FiltroDeAvisos {
  reuniaoId?: string;
  /** Verdadeiro, falso ou `null` = não foi possível identificar. */
  souOrganizador?: boolean | null;
}

/**
 * O que a pessoa vê: sem resolvidos nem dispensados, e — para itens do
 * organizador — só quando ela é, com certeza, quem conduz. Organizador
 * desconhecido NÃO é "sim".
 */
export function avisosVisiveis(avisos: readonly Aviso[], filtro: FiltroDeAvisos = {}): Aviso[] {
  return avisos
    .filter((a) => !a.resolvido && !a.dispensado)
    .filter((a) => (filtro.reuniaoId ? a.reuniaoId === filtro.reuniaoId : true))
    .filter((a) => a.publico === 'todos' || filtro.souOrganizador === true)
    .sort((a, b) => b.atualizadoEm - a.atualizadoEm);
}

export function naoLidos(avisos: readonly Aviso[]): number {
  return avisos.filter((a) => !a.lido).length;
}
