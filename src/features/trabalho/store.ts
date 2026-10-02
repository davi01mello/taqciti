/**
 * Os registros de TRABALHO — compromissos, decisões, achados e análises.
 *
 * ── Por que são registros próprios ──────────────────────────────────────────
 *
 * Uma análise da mesma reunião feita duas vezes não pode criar duas tarefas, e
 * uma decisão revista não pode apagar a anterior: as duas coisas pedem
 * identidade estável e histórico, que texto dentro de uma resposta não tem. Por
 * isso cada item é um registro com id, revisão, evidências e histórico — e a
 * resposta do Taq só APONTA para ele.
 *
 * ── O que cada um carrega da fonte ──────────────────────────────────────────
 *
 * As EVIDÊNCIAS: registro, versão, trecho e local, copiados do livro da
 * execução que leu a fonte. Nunca o texto do modelo: quem cria um item passa os
 * `rN` que as ferramentas devolveram, e a ferramenta copia daqui. A fonte pode
 * sumir depois (reunião apagada): o item fica, e a interface diz "origem
 * indisponível" — sumir a fonte não cancela um compromisso.
 *
 * ── Escrita ──────────────────────────────────────────────────────────────────
 *
 * Toda escrita lê e grava dentro da mesma trava (`comTravaLocal`), e toda
 * edição confere a revisão que quem edita leu. Conflito volta como resultado,
 * nunca como sobrescrita silenciosa. A criação é idempotente pela `chave`:
 * a mesma tarefa da mesma reunião, reconhecida de novo, é a que já existe.
 *
 * Só as ANÁLISES são derivado exclusivo de uma reunião: apagar a reunião as
 * leva junto (`features/annotations/vinculos.ts`). O resto sobrevive.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { onLocalChange, readLocal, writeLocal } from '@/shared/services/storage';
import { comTravaLocal } from '@/shared/services/storageLock';

export const VERSAO_DO_TRABALHO = 1;

/** Trecho de uma fonte, como estava quando foi lido. */
export interface EvidenciaGuardada {
  tipo: 'reuniao' | 'documento';
  registroId: string;
  titulo: string;
  /** Reunião: `<fim>:<segmentos>`; documento: `updatedAt`. */
  versao: string;
  trecho: string;
  segmento?: number;
  offsetMs?: number;
}

/** De onde veio uma mudança. `evidencia` exige trecho; `pessoa` é o pedido dela. */
export type OrigemDaMudanca = 'pessoa' | 'taq' | 'evidencia';

export interface EventoDoHistorico {
  em: number;
  acao: string;
  detalhe?: string;
  origem: OrigemDaMudanca;
  execucaoId?: string;
  evidencia?: EvidenciaGuardada;
}

interface Base {
  id: string;
  /** Idempotência: o mesmo item reconhecido de novo é o mesmo registro. */
  chave: string;
  revisao: number;
  criadoEm: number;
  atualizadoEm: number;
  historico: EventoDoHistorico[];
  evidencias: EvidenciaGuardada[];
  /** A reunião de onde saiu, quando saiu de uma. Pode deixar de existir. */
  reuniaoId?: string;
  /** Semeado pelo conjunto de demonstração. */
  demo?: true;
}

export interface Compromisso extends Base {
  descricao: string;
  /** `null` = sem responsável definido. Nunca preenchido por suposição. */
  responsavel: { nome: string; confirmado: boolean } | null;
  /** `null` = sem prazo acordado. `data` só quando o prazo é uma data. */
  prazo: { texto: string; data?: string } | null;
  estado: 'aberto' | 'concluido' | 'cancelado';
  /** Ids de compromissos dos quais este depende. */
  dependeDe: string[];
}

export interface Decisao extends Base {
  assunto: string;
  texto: string;
  estado: 'proposta' | 'confirmada' | 'substituida';
  /** A decisão que esta substituiu. */
  substitui?: string;
  substituidaPor?: string;
  /** Por que esta substituiu a anterior — dito pela fonte ou pela pessoa. */
  motivo?: string;
}

export interface EntendimentoDoAchado {
  /** A área ou o lado (Comercial, Produto…), quando a fonte diz. */
  area?: string;
  texto: string;
  evidencia: EvidenciaGuardada;
}

export interface Achado extends Base {
  tipo: 'desalinhamento' | 'risco' | 'lacuna';
  assunto: string;
  entendimentos: EntendimentoDoAchado[];
  impacto?: string;
  pergunta?: string;
  /** `possivel` até haver sustentação; o Taq não diagnostica falha de ninguém. */
  classificacao: 'possivel' | 'sustentado';
  estado: 'aberto' | 'resolvido' | 'descartado';
  resolucao?: {
    texto: string;
    em: number;
    origem: OrigemDaMudanca;
    evidencia?: EvidenciaGuardada;
  };
}

export interface ItemDaAnalise {
  texto: string;
  evidencias: EvidenciaGuardada[];
  /** Corrigido pela pessoa: o texto original fica no histórico. */
  corrigido?: true;
}

export const SECOES_DA_ANALISE = [
  'visaoGeral',
  'decisoes',
  'questoes',
  'riscos',
  'proximosPassos',
] as const;
export type SecaoDaAnalise = (typeof SECOES_DA_ANALISE)[number];

export const TITULO_DA_SECAO: Record<SecaoDaAnalise, string> = {
  visaoGeral: 'Visão geral',
  decisoes: 'Decisões',
  questoes: 'Questões abertas',
  riscos: 'Riscos',
  proximosPassos: 'Próximos passos',
};

export interface Analise extends Base {
  reuniaoId: string;
  /** A versão da transcrição analisada: mudou, a análise está desatualizada. */
  versaoDaReuniao: string;
  instrucoes: string;
  /** Quantos segmentos a execução LEU, contados pelo livro — não pelo modelo. */
  cobertura: { lidos: number; total: number };
  secoes: Record<SecaoDaAnalise, ItemDaAnalise[]>;
  lacunas: string[];
}

export interface Trabalho {
  versao: number;
  compromissos: Compromisso[];
  decisoes: Decisao[];
  achados: Achado[];
  analises: Analise[];
}

export const TRABALHO_VAZIO: Trabalho = {
  versao: VERSAO_DO_TRABALHO,
  compromissos: [],
  decisoes: [],
  achados: [],
  analises: [],
};

// ---------------------------------------------------------------- utilidades

function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Hash curto e estável (FNV-1a) — para chave de idempotência, não segurança. */
export function hashCurto(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** A chave do "mesmo item": a reunião e o texto, sem acento, caixa ou pontuação. */
export function chaveDoItem(tipo: string, reuniaoId: string | undefined, texto: string): string {
  const limpo = semAcento(texto).replace(/[^\p{L}\p{N} ]/gu, '');
  return `${tipo}:${reuniaoId ?? '-'}:${hashCurto(limpo)}`;
}

let contador = 0;
function novoId(prefixo: string): string {
  contador += 1;
  return `${prefixo}${Date.now().toString(36)}${contador.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function ehLista(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function comId<T>(lista: unknown): T[] {
  return ehLista(lista)
    ? (lista.filter(
        (x) => !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string',
      ) as T[])
    : [];
}

/** Lê o que estiver gravado, tolerando versão antiga ou campo faltando. */
export function normalizarTrabalho(bruto: unknown): Trabalho {
  // Listas novas sempre: as transações mudam o que leram, e o vazio é constante.
  if (!bruto || typeof bruto !== 'object')
    return { versao: VERSAO_DO_TRABALHO, compromissos: [], decisoes: [], achados: [], analises: [] };
  const b = bruto as Partial<Record<keyof Trabalho, unknown>>;
  return {
    versao: VERSAO_DO_TRABALHO,
    compromissos: comId<Compromisso>(b.compromissos).map((c) => ({
      ...c,
      dependeDe: ehLista(c.dependeDe) ? c.dependeDe : [],
      historico: ehLista(c.historico) ? c.historico : [],
      evidencias: ehLista(c.evidencias) ? c.evidencias : [],
    })),
    decisoes: comId<Decisao>(b.decisoes),
    achados: comId<Achado>(b.achados),
    analises: comId<Analise>(b.analises),
  };
}

export async function lerTrabalho(): Promise<Trabalho> {
  // Cópia própria: quem lê pode mudar o que recebeu sem mexer no que outro
  // leitor tem (o `chrome.storage` já devolve cópias; o clone garante o mesmo
  // contrato em qualquer implementação).
  const bruto = await readLocal<unknown>(STORAGE_KEYS.trabalho);
  return normalizarTrabalho(bruto && typeof bruto === 'object' ? structuredClone(bruto) : bruto);
}

export function observarTrabalho(cb: (t: Trabalho) => void): () => void {
  let vivo = true;
  let mudou = false;
  void lerTrabalho().then((t) => {
    if (vivo && !mudou) cb(t);
  });
  const parar = onLocalChange<unknown>(STORAGE_KEYS.trabalho, (valor) => {
    if (!vivo) return;
    mudou = true;
    cb(normalizarTrabalho(valor));
  });
  return () => {
    vivo = false;
    parar();
  };
}

/** Lê, muda e grava sob a trava. `mudar` devolve o resultado e se houve mudança. */
async function transacao<R>(
  mudar: (t: Trabalho) => { resultado: R; mudou: boolean },
): Promise<R> {
  return comTravaLocal(STORAGE_KEYS.trabalho, async () => {
    const atual = await lerTrabalho();
    const { resultado, mudou } = mudar(atual);
    if (mudou) await writeLocal(STORAGE_KEYS.trabalho, structuredClone(atual));
    return resultado;
  });
}

function evento(
  acao: string,
  origem: OrigemDaMudanca,
  extra: Partial<Omit<EventoDoHistorico, 'acao' | 'origem' | 'em'>> = {},
): EventoDoHistorico {
  return { em: Date.now(), acao, origem, ...extra };
}

export type ResultadoDaEdicao<T> =
  | { tipo: 'ok'; item: T }
  | { tipo: 'conflito'; atual: T }
  | { tipo: 'inexistente' }
  | { tipo: 'invalido'; motivo: string };

// ------------------------------------------------------------- compromissos

export interface NovoCompromisso {
  descricao: string;
  responsavel: Compromisso['responsavel'];
  prazo: Compromisso['prazo'];
  reuniaoId?: string;
  evidencias: EvidenciaGuardada[];
  demo?: true;
}

export interface Autoria {
  origem: OrigemDaMudanca;
  execucaoId?: string;
}

/**
 * Registra compromissos, sem duplicar: o que já existe com a mesma chave volta
 * em `jaExistiam`, intocado — reanalisar a reunião não recria tarefa nem
 * desfaz o que a pessoa já editou nela.
 */
export async function registrarCompromissos(
  novos: readonly NovoCompromisso[],
  autoria: Autoria,
): Promise<{ criados: Compromisso[]; jaExistiam: Compromisso[] }> {
  return transacao((t) => {
    const criados: Compromisso[] = [];
    const jaExistiam: Compromisso[] = [];
    for (const n of novos) {
      const descricao = n.descricao.trim();
      if (!descricao) continue;
      const chave = chaveDoItem('compromisso', n.reuniaoId, descricao);
      // O mesmo combinado dito com outras palavras ("Entregar o protótipo" ×
      // "Desenvolver o protótipo", visto ao vivo) sai da MESMA fala: a mesma
      // reunião e o mesmo trecho de origem são o mesmo compromisso.
      const mesmaFala = (c: Compromisso) =>
        !!n.reuniaoId &&
        c.reuniaoId === n.reuniaoId &&
        n.evidencias.some((e) =>
          c.evidencias.some(
            (x) => x.registroId === e.registroId && x.segmento !== undefined && x.segmento === e.segmento,
          ),
        );
      const existente =
        t.compromissos.find((c) => c.chave === chave || mesmaFala(c)) ??
        criados.find((c) => c.chave === chave || mesmaFala(c));
      if (existente) {
        if (!jaExistiam.includes(existente) && !criados.includes(existente))
          jaExistiam.push(existente);
        continue;
      }
      const agora = Date.now();
      const c: Compromisso = {
        id: novoId('k'),
        chave,
        descricao,
        responsavel: n.responsavel?.nome.trim() ? n.responsavel : null,
        prazo: n.prazo?.texto.trim() ? n.prazo : null,
        estado: 'aberto',
        dependeDe: [],
        evidencias: n.evidencias,
        revisao: 1,
        criadoEm: agora,
        atualizadoEm: agora,
        historico: [evento('registrado', autoria.origem, { execucaoId: autoria.execucaoId })],
        ...(n.reuniaoId ? { reuniaoId: n.reuniaoId } : {}),
        ...(n.demo ? { demo: true as const } : {}),
      };
      criados.push(c);
    }
    t.compromissos.unshift(...criados);
    return { resultado: { criados, jaExistiam }, mudou: criados.length > 0 };
  });
}

export interface MudancaDeCompromisso {
  descricao?: string;
  responsavel?: Compromisso['responsavel'];
  prazo?: Compromisso['prazo'];
  estado?: Compromisso['estado'];
}

/**
 * Edita SÓ na revisão lida. Mudança de estado vinda do Taq precisa de origem:
 * o pedido da pessoa, ou um trecho que a sustente — prazo vencido sozinho não
 * conclui nem cancela nada.
 */
export async function atualizarCompromisso(
  id: string,
  revisaoEsperada: number,
  mudanca: MudancaDeCompromisso,
  autoria: Autoria & { evidencia?: EvidenciaGuardada },
): Promise<ResultadoDaEdicao<Compromisso>> {
  if (autoria.origem === 'evidencia' && !autoria.evidencia)
    return { tipo: 'invalido', motivo: 'Mudança por evidência sem trecho que a sustente.' };
  return transacao<ResultadoDaEdicao<Compromisso>>((t) => {
    const atual = t.compromissos.find((c) => c.id === id);
    if (!atual) return { resultado: { tipo: 'inexistente' as const }, mudou: false };
    if (atual.revisao !== revisaoEsperada)
      return { resultado: { tipo: 'conflito' as const, atual }, mudou: false };

    const eventos: EventoDoHistorico[] = [];
    const extra = {
      execucaoId: autoria.execucaoId,
      ...(autoria.evidencia ? { evidencia: autoria.evidencia } : {}),
    };
    if (mudanca.estado && mudanca.estado !== atual.estado) {
      eventos.push(evento(`estado: ${atual.estado} → ${mudanca.estado}`, autoria.origem, extra));
      atual.estado = mudanca.estado;
    }
    if (mudanca.responsavel !== undefined) {
      const antes = atual.responsavel?.nome ?? 'sem responsável';
      const depois = mudanca.responsavel?.nome.trim() ? mudanca.responsavel : null;
      if ((depois?.nome ?? null) !== (atual.responsavel?.nome ?? null) ||
          depois?.confirmado !== atual.responsavel?.confirmado) {
        eventos.push(
          evento(`responsável: ${antes} → ${depois?.nome ?? 'sem responsável'}`, autoria.origem, extra),
        );
        atual.responsavel = depois;
      }
    }
    if (mudanca.prazo !== undefined) {
      const depois = mudanca.prazo?.texto.trim() ? mudanca.prazo : null;
      if ((depois?.texto ?? null) !== (atual.prazo?.texto ?? null)) {
        eventos.push(
          evento(
            `prazo: ${atual.prazo?.texto ?? 'sem prazo'} → ${depois?.texto ?? 'sem prazo'}`,
            autoria.origem,
            extra,
          ),
        );
        atual.prazo = depois;
      }
    }
    if (mudanca.descricao?.trim() && mudanca.descricao.trim() !== atual.descricao) {
      eventos.push(evento('descrição corrigida', autoria.origem, { ...extra, detalhe: atual.descricao }));
      atual.descricao = mudanca.descricao.trim();
    }
    if (!eventos.length) return { resultado: { tipo: 'ok' as const, item: atual }, mudou: false };
    atual.revisao += 1;
    atual.atualizadoEm = Math.max(Date.now(), atual.atualizadoEm + 1);
    atual.historico.push(...eventos);
    return { resultado: { tipo: 'ok' as const, item: atual }, mudou: true };
  });
}

/** `a` depende de `b` alcança `a` de volta? Então a nova ligação fecharia um ciclo. */
function alcanca(lista: readonly Compromisso[], de: string, alvo: string): boolean {
  const vistos = new Set<string>();
  const pilha = [de];
  while (pilha.length) {
    const id = pilha.pop()!;
    if (id === alvo) return true;
    if (vistos.has(id)) continue;
    vistos.add(id);
    pilha.push(...(lista.find((c) => c.id === id)?.dependeDe ?? []));
  }
  return false;
}

export async function vincularDependencia(
  id: string,
  dependeDe: string,
  autoria: Autoria,
): Promise<ResultadoDaEdicao<Compromisso>> {
  if (id === dependeDe) return { tipo: 'invalido', motivo: 'Um compromisso não depende de si mesmo.' };
  return transacao<ResultadoDaEdicao<Compromisso>>((t) => {
    const atual = t.compromissos.find((c) => c.id === id);
    const outro = t.compromissos.find((c) => c.id === dependeDe);
    if (!atual || !outro) return { resultado: { tipo: 'inexistente' as const }, mudou: false };
    if (atual.dependeDe.includes(dependeDe))
      return { resultado: { tipo: 'ok' as const, item: atual }, mudou: false };
    if (alcanca(t.compromissos, dependeDe, id)) {
      return {
        resultado: {
          tipo: 'invalido' as const,
          motivo: `“${outro.descricao}” já depende, direta ou indiretamente, de “${atual.descricao}”: a ligação fecharia um ciclo.`,
        },
        mudou: false,
      };
    }
    atual.dependeDe.push(dependeDe);
    atual.revisao += 1;
    atual.atualizadoEm = Math.max(Date.now(), atual.atualizadoEm + 1);
    atual.historico.push(
      evento(`passou a depender de “${outro.descricao}”`, autoria.origem, {
        execucaoId: autoria.execucaoId,
      }),
    );
    return { resultado: { tipo: 'ok' as const, item: atual }, mudou: true };
  });
}

/**
 * A situação do prazo, sem acusar ninguém: passou do dia e ninguém disse que
 * terminou é "a confirmar", nunca "atrasado".
 */
export function situacaoDoPrazo(
  c: Pick<Compromisso, 'prazo' | 'estado'>,
  hoje: string,
): 'sem_prazo' | 'no_prazo' | 'prazo_passou_a_confirmar' | 'encerrado' {
  if (c.estado !== 'aberto') return 'encerrado';
  if (!c.prazo?.data) return c.prazo ? 'no_prazo' : 'sem_prazo';
  return c.prazo.data < hoje ? 'prazo_passou_a_confirmar' : 'no_prazo';
}

// ---------------------------------------------------------------- decisões

export interface NovaDecisao {
  assunto: string;
  texto: string;
  estado: 'proposta' | 'confirmada';
  reuniaoId?: string;
  evidencias: EvidenciaGuardada[];
  /** A decisão que esta substitui — a anterior vira `substituida`, e fica. */
  substitui?: string;
  motivo?: string;
  demo?: true;
}

export async function registrarDecisao(
  nova: NovaDecisao,
  autoria: Autoria,
): Promise<
  | { tipo: 'ok'; decisao: Decisao; jaExistia: boolean; substituida?: Decisao }
  | { tipo: 'invalido'; motivo: string }
> {
  return transacao<
    | { tipo: 'ok'; decisao: Decisao; jaExistia: boolean; substituida?: Decisao }
    | { tipo: 'invalido'; motivo: string }
  >((t) => {
    const chave = chaveDoItem('decisao', nova.reuniaoId, `${nova.assunto} ${nova.texto}`);
    const existente = t.decisoes.find((d) => d.chave === chave);
    if (existente)
      return { resultado: { tipo: 'ok' as const, decisao: existente, jaExistia: true }, mudou: false };

    let anterior: Decisao | undefined;
    if (nova.substitui) {
      anterior = t.decisoes.find((d) => d.id === nova.substitui);
      if (!anterior)
        return {
          resultado: { tipo: 'invalido' as const, motivo: `Não há decisão com o id ${nova.substitui}.` },
          mudou: false,
        };
      if (anterior.estado === 'substituida')
        return {
          resultado: {
            tipo: 'invalido' as const,
            motivo: `“${anterior.texto}” já foi substituída por outra decisão.`,
          },
          mudou: false,
        };
      if (nova.estado !== 'confirmada')
        return {
          resultado: {
            tipo: 'invalido' as const,
            motivo: 'Uma proposta não substitui uma decisão: só uma decisão confirmada.',
          },
          mudou: false,
        };
    }
    const agora = Date.now();
    const decisao: Decisao = {
      id: novoId('e'),
      chave,
      assunto: nova.assunto.trim(),
      texto: nova.texto.trim(),
      estado: nova.estado,
      evidencias: nova.evidencias,
      revisao: 1,
      criadoEm: agora,
      atualizadoEm: agora,
      historico: [evento('registrada', autoria.origem, { execucaoId: autoria.execucaoId })],
      ...(nova.reuniaoId ? { reuniaoId: nova.reuniaoId } : {}),
      ...(anterior ? { substitui: anterior.id } : {}),
      ...(nova.motivo ? { motivo: nova.motivo.trim() } : {}),
      ...(nova.demo ? { demo: true as const } : {}),
    };
    if (anterior) {
      anterior.estado = 'substituida';
      anterior.substituidaPor = decisao.id;
      anterior.revisao += 1;
      anterior.atualizadoEm = agora;
      anterior.historico.push(
        evento(`substituída por “${decisao.texto}”`, autoria.origem, {
          execucaoId: autoria.execucaoId,
          ...(nova.motivo ? { detalhe: nova.motivo } : {}),
        }),
      );
    }
    t.decisoes.unshift(decisao);
    return {
      resultado: {
        tipo: 'ok' as const,
        decisao,
        jaExistia: false,
        ...(anterior ? { substituida: anterior } : {}),
      },
      mudou: true,
    };
  });
}

// ------------------------------------------------------------------ achados

export interface NovoAchado {
  tipo: Achado['tipo'];
  assunto: string;
  entendimentos: EntendimentoDoAchado[];
  impacto?: string;
  pergunta?: string;
  classificacao: Achado['classificacao'];
  demo?: true;
}

export async function guardarAchado(
  novo: NovoAchado,
  autoria: Autoria,
): Promise<{ achado: Achado; jaExistia: boolean }> {
  return transacao<{ achado: Achado; jaExistia: boolean }>((t) => {
    const fontes = [...new Set(novo.entendimentos.map((e) => e.evidencia.registroId))].sort();
    const chave = chaveDoItem('achado', fontes.join(','), `${novo.tipo} ${novo.assunto}`);
    const existente = t.achados.find((a) => a.chave === chave);
    if (existente) return { resultado: { achado: existente, jaExistia: true }, mudou: false };
    const agora = Date.now();
    const achado: Achado = {
      id: novoId('a'),
      chave,
      tipo: novo.tipo,
      assunto: novo.assunto.trim(),
      entendimentos: novo.entendimentos,
      classificacao: novo.classificacao,
      estado: 'aberto',
      evidencias: novo.entendimentos.map((e) => e.evidencia),
      revisao: 1,
      criadoEm: agora,
      atualizadoEm: agora,
      historico: [evento('registrado', autoria.origem, { execucaoId: autoria.execucaoId })],
      ...(novo.impacto ? { impacto: novo.impacto.trim() } : {}),
      ...(novo.pergunta ? { pergunta: novo.pergunta.trim() } : {}),
      ...(novo.demo ? { demo: true as const } : {}),
    };
    t.achados.unshift(achado);
    return { resultado: { achado, jaExistia: false }, mudou: true };
  });
}

/**
 * Resolve ou descarta. Resolver pelo Taq exige o trecho que resolve (a decisão
 * explícita posterior); descartar exige motivo. Reabrir volta a `aberto` e
 * guarda o porquê. Nada se perde: o histórico registra cada passagem.
 */
export async function mudarEstadoDoAchado(
  id: string,
  revisaoEsperada: number,
  mudanca: { estado: Achado['estado']; texto: string; evidencia?: EvidenciaGuardada },
  autoria: Autoria,
): Promise<ResultadoDaEdicao<Achado>> {
  if (!mudanca.texto.trim())
    return { tipo: 'invalido', motivo: 'Diga o motivo da mudança.' };
  if (mudanca.estado === 'resolvido' && autoria.origem === 'evidencia' && !mudanca.evidencia)
    return { tipo: 'invalido', motivo: 'Resolver por evidência pede o trecho que resolve.' };
  return transacao<ResultadoDaEdicao<Achado>>((t) => {
    const atual = t.achados.find((a) => a.id === id);
    if (!atual) return { resultado: { tipo: 'inexistente' as const }, mudou: false };
    if (atual.revisao !== revisaoEsperada)
      return { resultado: { tipo: 'conflito' as const, atual }, mudou: false };
    if (atual.estado === mudanca.estado)
      return { resultado: { tipo: 'ok' as const, item: atual }, mudou: false };
    const agora = Date.now();
    atual.historico.push(
      evento(`${atual.estado} → ${mudanca.estado}`, autoria.origem, {
        execucaoId: autoria.execucaoId,
        detalhe: mudanca.texto.trim(),
        ...(mudanca.evidencia ? { evidencia: mudanca.evidencia } : {}),
      }),
    );
    atual.estado = mudanca.estado;
    if (mudanca.estado === 'aberto') delete atual.resolucao;
    else
      atual.resolucao = {
        texto: mudanca.texto.trim(),
        em: agora,
        origem: autoria.origem,
        ...(mudanca.evidencia ? { evidencia: mudanca.evidencia } : {}),
      };
    if (mudanca.evidencia) atual.evidencias.push(mudanca.evidencia);
    atual.revisao += 1;
    atual.atualizadoEm = Math.max(agora, atual.atualizadoEm + 1);
    return { resultado: { tipo: 'ok' as const, item: atual }, mudou: true };
  });
}

// ----------------------------------------------------------------- análises

export interface NovaAnalise {
  reuniaoId: string;
  versaoDaReuniao: string;
  instrucoes: string;
  cobertura: Analise['cobertura'];
  secoes: Analise['secoes'];
  lacunas: string[];
}

/**
 * Uma análise por reunião: a nova substitui a anterior, com a revisão
 * seguinte. As correções que a pessoa fez na anterior ficam no histórico.
 */
export async function guardarAnalise(nova: NovaAnalise, autoria: Autoria): Promise<Analise> {
  return transacao((t) => {
    const anterior = t.analises.find((a) => a.reuniaoId === nova.reuniaoId);
    const agora = Date.now();
    const analise: Analise = {
      id: anterior?.id ?? novoId('n'),
      chave: `analise:${nova.reuniaoId}`,
      reuniaoId: nova.reuniaoId,
      versaoDaReuniao: nova.versaoDaReuniao,
      instrucoes: nova.instrucoes,
      cobertura: nova.cobertura,
      secoes: nova.secoes,
      lacunas: nova.lacunas,
      evidencias: SECOES_DA_ANALISE.flatMap((s) => nova.secoes[s].flatMap((i) => i.evidencias)),
      revisao: (anterior?.revisao ?? 0) + 1,
      criadoEm: anterior?.criadoEm ?? agora,
      atualizadoEm: agora,
      historico: [
        ...(anterior?.historico ?? []),
        evento(anterior ? 'refeita' : 'criada', autoria.origem, {
          execucaoId: autoria.execucaoId,
          detalhe: `cobertura ${nova.cobertura.lidos}/${nova.cobertura.total}`,
        }),
      ],
    };
    t.analises = [analise, ...t.analises.filter((a) => a.reuniaoId !== nova.reuniaoId)];
    return { resultado: analise, mudou: true };
  });
}

/** A pessoa corrige um item: nova revisão; a transcrição não é tocada. */
export async function corrigirItemDaAnalise(
  id: string,
  revisaoEsperada: number,
  secao: SecaoDaAnalise,
  indice: number,
  texto: string,
): Promise<ResultadoDaEdicao<Analise>> {
  if (!texto.trim()) return { tipo: 'invalido', motivo: 'O item corrigido ficou vazio.' };
  return transacao<ResultadoDaEdicao<Analise>>((t) => {
    const atual = t.analises.find((a) => a.id === id);
    if (!atual) return { resultado: { tipo: 'inexistente' as const }, mudou: false };
    if (atual.revisao !== revisaoEsperada)
      return { resultado: { tipo: 'conflito' as const, atual }, mudou: false };
    const item = atual.secoes[secao]?.[indice];
    if (!item)
      return { resultado: { tipo: 'invalido' as const, motivo: 'Item inexistente.' }, mudou: false };
    atual.historico.push(
      evento(`item corrigido em ${TITULO_DA_SECAO[secao]}`, 'pessoa', { detalhe: item.texto }),
    );
    item.texto = texto.trim();
    item.corrigido = true;
    atual.revisao += 1;
    atual.atualizadoEm = Math.max(Date.now(), atual.atualizadoEm + 1);
    return { resultado: { tipo: 'ok' as const, item: atual }, mudou: true };
  });
}

/** A análise está atrasada em relação à transcrição atual? */
export function analiseDesatualizada(a: Pick<Analise, 'versaoDaReuniao'>, versaoAtual: string | null): boolean {
  return versaoAtual !== null && a.versaoDaReuniao !== versaoAtual;
}

// -------------------------------------------------------------- manutenção

/** Tira o que o conjunto de demonstração semeou. Os registros reais ficam. */
export async function removerDemonstracao(): Promise<number> {
  return transacao((t) => {
    const antes =
      t.compromissos.length + t.decisoes.length + t.achados.length + t.analises.length;
    t.compromissos = t.compromissos.filter((c) => !c.demo);
    t.decisoes = t.decisoes.filter((d) => !d.demo);
    t.achados = t.achados.filter((a) => !a.demo);
    t.analises = t.analises.filter((a) => !a.demo);
    const depois =
      t.compromissos.length + t.decisoes.length + t.achados.length + t.analises.length;
    return { resultado: antes - depois, mudou: antes !== depois };
  });
}
