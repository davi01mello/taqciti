/**
 * O PERFIL DO ASSISTENTE e o BRIEFING da reunião — o que a pessoa leva para
 * todas as reuniões, e o que ela quer alcançar em uma.
 *
 * ── O que cada um é ─────────────────────────────────────────────────────────
 *
 * PERFIL: o assistente é UM SÓ para todas as reuniões e se monta ANTES delas.
 * Ou é o Padrão do CITi (fixo, igual para todos, `padrao.ts`), ou é uma cópia
 * personalizada: até 8 CONTEXTOS curtos (nome e texto em linguagem comum),
 * cada um levado ou guardado, mais dois ajustes que ligam comportamento e por
 * isso não são texto: o modo de intervenção (o apoio age sozinho ou não) e
 * "ler ao encerrar" (consentimento para enviar a reunião ao provedor). A busca
 * na internet é só a preferência por enquanto; a ferramenta não existe.
 *
 * BRIEFING: o objetivo de UMA reunião, as questões que não podem ficar sem
 * encaminhamento e o contexto escrito pela pessoa. O objetivo é informado ou
 * aprovado por ela: nunca inferido do título da reunião (`aprovado`).
 *
 * ── Regras ──────────────────────────────────────────────────────────────────
 *
 * - Só `salvarPerfil` e `salvarBriefing`, chamados pela pessoa, gravam.
 * - Toda edição confere a revisão que quem edita leu. Conflito volta como
 *   resultado, nunca como sobrescrita silenciosa. O histórico guarda cada
 *   mudança (quem fez, o quê).
 * - A reunião começa com a versão do perfil em uso e fica com ela até o fim:
 *   `fixarPerfilDaReuniao` guarda a CÓPIA resolvida quando a reunião é
 *   detectada (o background chama). Antes (até 22/10/2026) a cópia só existia
 *   quando havia briefing, e a reunião sem briefing mudava de perfil no meio,
 *   a cada leitura.
 * - O briefing é derivado exclusivo da reunião, como a nota: apagar a reunião
 *   o leva junto (`features/annotations/vinculos.ts`). O perfil não.
 *
 * ── O formato anterior (versão 1) ───────────────────────────────────────────
 *
 * O perfil tinha missão, o que observar, intervenção, contexto e preferências.
 * `doPerfilV1` converte isso em contextos da pessoa; o que não coube nas 8
 * vagas de 200 caracteres fica em `perfilV1`, intacto, e a tela avisa. A
 * conversão roda na migração do storage e em toda leitura (o que volta da
 * lixeira, ou de um teste, pode vir no formato antigo).
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { onLocalChange, readLocal, writeLocal } from '@/shared/services/storage';
import { comTravaLocal } from '@/shared/services/storageLock';
import { PADRAO_DO_CITI } from './padrao';

export const VERSAO_DA_CONDUCAO = 2;

export const MODOS_DE_INTERVENCAO = ['sob_demanda', 'discreto', 'participativo'] as const;
export type ModoDeIntervencao = (typeof MODOS_DE_INTERVENCAO)[number];

export const ROTULO_DO_MODO: Record<ModoDeIntervencao, string> = {
  sob_demanda: 'Só quando eu chamar',
  discreto: 'Discreto: uma lembrança relevante por vez',
  participativo: 'Participativo: perguntas e encaminhamentos com mais frequência',
};

export const MAX_CONTEXTOS = 8;
export const MAX_NOME_DO_CONTEXTO = 40;
export const MAX_TEXTO_DO_CONTEXTO = 200;

const MAX_TEXTO = 400;
const MAX_ITEM = 200;
const MAX_ITENS = 8;
const MAX_HISTORICO = 50;
/** Quantas reuniões guardam a cópia do perfil com que começaram. */
const MAX_EM_USO = 30;

export type AutorDaMudanca = 'pessoa' | 'taq';

export interface EventoDaConducao {
  em: number;
  acao: string;
  origem: AutorDaMudanca;
}

export type OrigemDoContexto = 'padrao' | 'seu';

/** Uma coisa que o assistente leva para as reuniões, dita como a um colega. */
export interface ContextoDoAssistente {
  id: string;
  nome: string;
  texto: string;
  /** Levado para a reunião; desligado, fica guardado e não vai ao modelo. */
  ligado: boolean;
  /** Veio do Padrão do CITi (a cópia é da pessoa) ou foi escrito por ela. */
  origem: OrigemDoContexto;
  /** O lugar no mapa, de 0 a 7. */
  vaga: number;
}

export type BaseDoPerfil = 'padrao' | 'personalizado';

export interface ConteudoDoPerfil {
  base: BaseDoPerfil;
  /** A versão do Padrão do CITi de que a pessoa partiu (ou que está em uso). */
  padraoVersao: number;
  /** Vazio no perfil GUARDADO com base no padrão: o padrão vem do pacote. */
  contextos: ContextoDoAssistente[];
  /** Só a preferência: a ferramenta de busca ainda não existe. */
  buscaNaInternet: boolean;
  intervencao: { modo: ModoDeIntervencao };
  /**
   * Ao encerrar a reunião, o assistente lê os pontos uma vez (o que foi
   * decidido, o que segue em aberto) e mostra no cartão, para a pessoa revisar.
   * É uma escolha EXPLÍCITA e fica desligada por padrão: ler a reunião envia
   * trechos dela ao provedor de IA. Presente só quando ligada.
   */
  lerAoEncerrar?: true;
}

export interface PerfilDeConducao extends ConteudoDoPerfil {
  revisao: number;
  criadoEm: number;
  atualizadoEm: number;
  historico: EventoDaConducao[];
}

/** A cópia do perfil com que uma reunião começou. */
export interface PerfilEmUso {
  reuniaoId: string;
  /** `null` = o Padrão do CITi sem nada salvo. */
  perfilRevisao: number | null;
  /** Já resolvido: com os contextos do padrão da época, se era o padrão. */
  perfilUsado: ConteudoDoPerfil;
  em: number;
}

export interface BriefingDaReuniao {
  reuniaoId: string;
  revisao: number;
  criadoEm: number;
  atualizadoEm: number;
  /** O resultado que a pessoa quer alcançar. Vazio até ela informar. */
  objetivo: string;
  /** `true` só quando a pessoa escreveu ou aprovou o objetivo. */
  aprovado: boolean;
  /** O que a pessoa escreveu sobre o contexto deste encontro. */
  contexto: string;
  /** O que não pode ficar sem encaminhamento. */
  prioridades: string[];
  /**
   * Encontros anteriores que a PESSOA escolheu retomar (ids de reuniões). O
   * vínculo é confirmado por ela e por id: nome nenhum liga um encontro a outro.
   */
  retomar: string[];
  /**
   * O modo de intervenção SÓ para esta reunião. Ausente = o do perfil que ela
   * usa. É escolha explícita da pessoa: nada vira regra geral em silêncio. Só
   * vale sobre um perfil personalizado (o padrão é fixo).
   */
  modo?: ModoDeIntervencao;
  /** A revisão do perfil de quando o briefing foi preparado; `null` = o padrão. */
  perfilRevisao: number | null;
  /**
   * O CONTEÚDO do perfil de quando foi preparada (resolvido). Vale para a
   * reunião que não tem cópia de quando começou (`emUso`), como a que só
   * existe no histórico. `null` em briefing antigo, feito sem perfil: o padrão.
   */
  perfilUsado: ConteudoDoPerfil | null;
  historico: EventoDaConducao[];
}

export interface Conducao {
  versao: number;
  perfil: PerfilDeConducao | null;
  briefings: BriefingDaReuniao[];
  /** A cópia do perfil com que cada reunião recente começou. */
  emUso: PerfilEmUso[];
  /** O perfil no formato anterior, guardado como estava quando foi convertido. */
  perfilV1?: { original: unknown; coubeInteiro: boolean };
}

export type ResultadoDaEdicao<T> =
  | { tipo: 'ok'; item: T }
  | { tipo: 'conflito'; atual: T | null }
  | { tipo: 'invalido'; motivo: string };

// ---------------------------------------------------------------- utilidades

function limpar(texto: unknown, max: number): string {
  return typeof texto === 'string' ? texto.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function limparLista(itens: unknown, max = MAX_ITENS): string[] {
  if (!Array.isArray(itens)) return [];
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const i of itens) {
    const t = limpar(i, MAX_ITEM);
    const chave = t.toLocaleLowerCase('pt-BR');
    if (!t || vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(t);
    if (saida.length >= max) break;
  }
  return saida;
}

const MAX_RETOMAR = 5;

/**
 * Ids de reuniões escolhidas para retomar: textos não vazios, sem repetição, sem
 * a própria reunião e COM teto — o teto vale depois de tirar a própria reunião.
 */
function limparIds(itens: unknown, excluir?: string): string[] {
  if (!Array.isArray(itens)) return [];
  return [
    ...new Set(
      itens
        .filter((i): i is string => typeof i === 'string' && i.trim() !== '')
        .map((i) => i.trim())
        .filter((i) => i !== excluir),
    ),
  ].slice(0, MAX_RETOMAR);
}

const modoValido = (m: unknown): ModoDeIntervencao | undefined => MODOS_DE_INTERVENCAO.find((x) => x === m);

/** A primeira vaga livre do mapa, ou `null` com as 8 ocupadas. */
export function vagaLivre(contextos: readonly Pick<ContextoDoAssistente, 'vaga'>[]): number | null {
  for (let v = 0; v < MAX_CONTEXTOS; v += 1) if (!contextos.some((c) => c.vaga === v)) return v;
  return null;
}

/** Contextos limpos: nome e texto no limite, ids e vagas únicos, no máximo 8. */
function limparContextos(itens: unknown): ContextoDoAssistente[] {
  if (!Array.isArray(itens)) return [];
  const saida: ContextoDoAssistente[] = [];
  for (const i of itens) {
    if (saida.length >= MAX_CONTEXTOS) break;
    if (!i || typeof i !== 'object') continue;
    const b = i as Partial<Record<keyof ContextoDoAssistente, unknown>>;
    const nome = limpar(b.nome, MAX_NOME_DO_CONTEXTO);
    const texto = limpar(b.texto, MAX_TEXTO_DO_CONTEXTO);
    if (!nome && !texto) continue;
    let id = typeof b.id === 'string' && b.id.trim() ? b.id.trim() : `contexto-${saida.length + 1}`;
    while (saida.some((c) => c.id === id)) id = `${id}-2`;
    const pedida = Number.isInteger(b.vaga) ? (b.vaga as number) : -1;
    const vaga =
      pedida >= 0 && pedida < MAX_CONTEXTOS && !saida.some((c) => c.vaga === pedida) ? pedida : vagaLivre(saida)!;
    saida.push({
      id,
      nome,
      texto,
      ligado: b.ligado !== false,
      origem: b.origem === 'padrao' ? 'padrao' : 'seu',
      vaga,
    });
  }
  return saida;
}

/** Quebra um texto em pedaços que cabem num contexto, sem partir palavras. */
function partir(texto: string, max = MAX_TEXTO_DO_CONTEXTO): string[] {
  const pedacos: string[] = [];
  let atual = '';
  for (const palavra of texto.split(' ')) {
    const junto = atual ? `${atual} ${palavra}` : palavra;
    if (junto.length <= max) atual = junto;
    else {
      if (atual) pedacos.push(atual);
      atual = palavra.slice(0, max);
    }
  }
  if (atual) pedacos.push(atual);
  return pedacos;
}

/**
 * O perfil da versão 1 em contextos da pessoa, na ordem em que a tela antiga
 * os mostrava. Texto maior que 200 caracteres segue num contexto "(continua)"
 * enquanto houver vaga; `coubeInteiro` diz se algo ficou de fora.
 */
export function doPerfilV1(bruto: unknown): { conteudo: ConteudoDoPerfil; coubeInteiro: boolean } | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const b = bruto as Record<string, unknown>;
  const missao = limpar(b.missao, MAX_TEXTO);
  if (!missao) return null;
  const i = (b.intervencao ?? {}) as { modo?: unknown; estilo?: unknown };
  const lista = (x: unknown) => limparLista(x).join('; ');
  const partes: Array<[string, string, string]> = [
    ['v1-missao', 'Em que ajudar', missao],
    ['v1-observar', 'O que observar', lista(b.observar)],
    ['v1-intervir', 'Como intervir', limpar(i.estilo, MAX_ITEM)],
    ['v1-contexto', 'Contexto que indiquei', lista(b.contexto)],
    ['v1-jeito', 'Jeito de trabalhar', lista(b.preferencias)],
  ];
  const contextos: ContextoDoAssistente[] = [];
  let coubeInteiro = true;
  for (const [id, nome, texto] of partes) {
    if (!texto) continue;
    partir(texto).forEach((pedaco, n) => {
      if (contextos.length >= MAX_CONTEXTOS) {
        coubeInteiro = false;
        return;
      }
      contextos.push({
        id: n === 0 ? id : `${id}-${n + 1}`,
        nome: n === 0 ? nome : `${nome} (continua)`,
        texto: pedaco,
        ligado: true,
        origem: 'seu',
        vaga: contextos.length,
      });
    });
  }
  return {
    conteudo: {
      base: 'personalizado',
      padraoVersao: PADRAO_DO_CITI.versao,
      contextos,
      buscaNaInternet: false,
      intervencao: { modo: modoValido(i.modo) ?? 'discreto' },
      ...(b.lerAoEncerrar === true ? { lerAoEncerrar: true as const } : {}),
    },
    coubeInteiro,
  };
}

const eDoFormatoV1 = (b: Record<string, unknown>) => b.base === undefined && typeof b.missao === 'string';

/**
 * Normaliza o conteúdo que a pessoa (ou uma leitura) trouxe. `null` = inválido.
 *
 * `congelado`: é uma CÓPIA já resolvida (de uma reunião); com base no padrão,
 * ela guarda os contextos do padrão daquela época em vez de descartá-los.
 */
export function normalizarConteudoDoPerfil(bruto: unknown, opcoes: { congelado?: boolean } = {}): ConteudoDoPerfil | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const b = bruto as Record<string, unknown>;
  if (eDoFormatoV1(b)) return doPerfilV1(b)?.conteudo ?? null;
  if (b.base !== 'padrao' && b.base !== 'personalizado') return null;
  const i = (b.intervencao ?? {}) as { modo?: unknown };
  const ler = b.lerAoEncerrar === true ? { lerAoEncerrar: true as const } : {};
  const padraoVersao =
    Number.isInteger(b.padraoVersao) && (b.padraoVersao as number) > 0 ? (b.padraoVersao as number) : PADRAO_DO_CITI.versao;
  if (b.base === 'padrao' && !opcoes.congelado)
    return {
      base: 'padrao',
      padraoVersao,
      contextos: [],
      buscaNaInternet: false,
      intervencao: { modo: PADRAO_DO_CITI.modo },
      ...ler,
    };
  return {
    base: b.base,
    padraoVersao,
    contextos: limparContextos(b.contextos),
    buscaNaInternet: b.buscaNaInternet === true,
    intervencao: { modo: modoValido(i.modo) ?? PADRAO_DO_CITI.modo },
    ...ler,
  };
}

/** O Padrão do CITi como conteúdo: todos os contextos levados, sem edição. */
export function conteudoDoPadrao(): ConteudoDoPerfil {
  return {
    base: 'padrao',
    padraoVersao: PADRAO_DO_CITI.versao,
    contextos: PADRAO_DO_CITI.contextos.map((c) => ({ ...c, ligado: true, origem: 'padrao' as const })),
    buscaNaInternet: false,
    intervencao: { modo: PADRAO_DO_CITI.modo },
  };
}

/**
 * O conteúdo como o assistente o usa: com base no padrão, os contextos e o
 * modo vêm do pacote de AGORA (só "ler ao encerrar", que é consentimento, vem
 * da pessoa). Personalizado volta como está.
 */
export function resolverPerfil(c: ConteudoDoPerfil): ConteudoDoPerfil {
  if (c.base !== 'padrao') return c;
  return { ...conteudoDoPadrao(), ...(c.lerAoEncerrar ? { lerAoEncerrar: true as const } : {}) };
}

/** O perfil em uso hoje, resolvido: sem nada salvo, é o Padrão do CITi. */
export function perfilAtual(c: Conducao): ConteudoDoPerfil {
  return c.perfil ? resolverPerfil(conteudoDe(c.perfil)) : conteudoDoPadrao();
}

/** "Padrão do CITi · v1" / "Personalizado · v3": a versão como a pessoa a vê. */
export function nomeDaVersao(conteudo: Pick<ConteudoDoPerfil, 'base' | 'padraoVersao'>, revisao: number | null): string {
  return conteudo.base === 'padrao'
    ? `Padrão do CITi · v${conteudo.padraoVersao}`
    : `Personalizado · v${revisao ?? 1}`;
}

function eventoDe(acao: string, origem: AutorDaMudanca): EventoDaConducao {
  return { em: Date.now(), acao, origem };
}

const VAZIO = (): Conducao => ({ versao: VERSAO_DA_CONDUCAO, perfil: null, briefings: [], emUso: [] });

export function normalizarConducao(bruto: unknown): Conducao {
  if (!bruto || typeof bruto !== 'object') return VAZIO();
  const b = bruto as Partial<Record<keyof Conducao, unknown>>;
  const p = b.perfil as (Partial<PerfilDeConducao> & Record<string, unknown>) | null | undefined;
  const v1 = p && typeof p === 'object' && eDoFormatoV1(p) ? doPerfilV1(p) : null;
  const conteudo = v1?.conteudo ?? (p && typeof p === 'object' ? normalizarConteudoDoPerfil(p) : null);
  const guardadoV1 = b.perfilV1 as Conducao['perfilV1'] | undefined;
  const perfilV1 =
    guardadoV1 && typeof guardadoV1 === 'object' && 'original' in guardadoV1
      ? { original: guardadoV1.original, coubeInteiro: guardadoV1.coubeInteiro !== false }
      : v1
        ? { original: structuredClone(p), coubeInteiro: v1.coubeInteiro }
        : undefined;
  return {
    versao: VERSAO_DA_CONDUCAO,
    perfil:
      conteudo && p
        ? {
            ...conteudo,
            revisao: Number.isInteger(p.revisao) && (p.revisao as number) > 0 ? (p.revisao as number) : 1,
            criadoEm: typeof p.criadoEm === 'number' ? p.criadoEm : 0,
            atualizadoEm: typeof p.atualizadoEm === 'number' ? p.atualizadoEm : 0,
            historico: Array.isArray(p.historico) ? p.historico : [],
          }
        : null,
    briefings: Array.isArray(b.briefings)
      ? (b.briefings as BriefingDaReuniao[])
          .filter((x) => !!x && typeof x === 'object' && typeof x.reuniaoId === 'string')
          .map((x) => ({
            ...x,
            objetivo: limpar(x.objetivo, MAX_TEXTO),
            contexto: limpar(x.contexto, MAX_TEXTO * 2),
            prioridades: limparLista(x.prioridades),
            retomar: limparIds(x.retomar),
            ...(modoValido(x.modo) ? { modo: x.modo as ModoDeIntervencao } : {}),
            aprovado: x.aprovado === true,
            perfilRevisao: typeof x.perfilRevisao === 'number' ? x.perfilRevisao : null,
            perfilUsado: normalizarConteudoDoPerfil(x.perfilUsado, { congelado: true }),
            historico: Array.isArray(x.historico) ? x.historico : [],
          }))
      : [],
    emUso: Array.isArray(b.emUso)
      ? (b.emUso as PerfilEmUso[]).flatMap((x) => {
          if (!x || typeof x !== 'object' || typeof x.reuniaoId !== 'string') return [];
          const usado = normalizarConteudoDoPerfil(x.perfilUsado, { congelado: true });
          if (!usado) return [];
          return [
            {
              reuniaoId: x.reuniaoId,
              perfilRevisao: typeof x.perfilRevisao === 'number' ? x.perfilRevisao : null,
              perfilUsado: usado,
              em: typeof x.em === 'number' ? x.em : 0,
            },
          ];
        })
      : [],
    ...(perfilV1 ? { perfilV1 } : {}),
  };
}

// ------------------------------------------------------------------- leitura

export async function lerConducao(): Promise<Conducao> {
  const bruto = await readLocal<unknown>(STORAGE_KEYS.conducao);
  return normalizarConducao(bruto && typeof bruto === 'object' ? structuredClone(bruto) : bruto);
}

export function observarConducao(cb: (c: Conducao) => void): () => void {
  let vivo = true;
  let mudou = false;
  void lerConducao().then((c) => {
    if (vivo && !mudou) cb(c);
  });
  const parar = onLocalChange<unknown>(STORAGE_KEYS.conducao, (valor) => {
    if (!vivo) return;
    mudou = true;
    cb(normalizarConducao(valor));
  });
  return () => {
    vivo = false;
    parar();
  };
}

async function transacao<R>(mudar: (c: Conducao) => { resultado: R; mudou: boolean }): Promise<R> {
  return comTravaLocal(STORAGE_KEYS.conducao, async () => {
    const atual = await lerConducao();
    const { resultado, mudou } = mudar(atual);
    if (mudou) await writeLocal(STORAGE_KEYS.conducao, structuredClone(atual));
    return resultado;
  });
}

/**
 * Grava no storage o formato atual, convertendo o anterior. É a migração do
 * storage (`background/storageMigrations.ts`, versão 4); idempotente.
 */
export async function migrarConducao(): Promise<void> {
  await comTravaLocal(STORAGE_KEYS.conducao, async () => {
    const bruto = await readLocal<unknown>(STORAGE_KEYS.conducao);
    if (bruto === null || bruto === undefined) return;
    await writeLocal(STORAGE_KEYS.conducao, normalizarConducao(structuredClone(bruto)));
  });
}

// -------------------------------------------------------------------- perfil

/**
 * Grava o perfil que a pessoa aprovou. `revisaoEsperada`: `0` para o primeiro
 * perfil, ou a revisão que ela leu. Igual ao que já está salvo não cria revisão.
 */
export async function salvarPerfil(
  conteudo: unknown,
  revisaoEsperada: number,
  autor: AutorDaMudanca = 'pessoa',
  /** O que o histórico diz sobre esta mudança. Padrão: "perfil criado" ou "perfil atualizado". */
  acao?: string,
): Promise<ResultadoDaEdicao<PerfilDeConducao>> {
  const novo = normalizarConteudoDoPerfil(conteudo);
  if (!novo) return { tipo: 'invalido', motivo: 'Esse assistente não está num formato que dê para guardar.' };
  const semTexto = novo.contextos.find((c) => !c.nome || !c.texto);
  if (semTexto)
    return {
      tipo: 'invalido',
      motivo: semTexto.nome
        ? `“${semTexto.nome}” está sem texto. Escreva o que o assistente precisa saber, ou remova o contexto.`
        : 'Há um contexto sem nome. Dê um nome a ele, ou remova o contexto.',
    };
  return transacao<ResultadoDaEdicao<PerfilDeConducao>>((c) => {
    const atual = c.perfil;
    if ((atual?.revisao ?? 0) !== revisaoEsperada)
      return { resultado: { tipo: 'conflito' as const, atual }, mudou: false };
    const agora = Date.now();
    if (atual && JSON.stringify(conteudoDe(atual)) === JSON.stringify(novo))
      return { resultado: { tipo: 'ok' as const, item: atual }, mudou: false };
    const perfil: PerfilDeConducao = {
      ...novo,
      revisao: (atual?.revisao ?? 0) + 1,
      criadoEm: atual?.criadoEm ?? agora,
      atualizadoEm: Math.max(agora, (atual?.atualizadoEm ?? 0) + 1),
      historico: [
        ...(atual?.historico ?? []),
        eventoDe(acao ?? (atual ? 'perfil atualizado' : 'perfil criado'), autor),
      ].slice(-MAX_HISTORICO),
    };
    c.perfil = perfil;
    return { resultado: { tipo: 'ok' as const, item: perfil }, mudou: true };
  });
}

export function conteudoDe(p: PerfilDeConducao): ConteudoDoPerfil {
  return {
    base: p.base,
    padraoVersao: p.padraoVersao,
    contextos: p.contextos,
    buscaNaInternet: p.buscaNaInternet,
    intervencao: p.intervencao,
    ...(p.lerAoEncerrar ? { lerAoEncerrar: true as const } : {}),
  };
}

/**
 * A reunião começa com a versão do perfil em uso e fica com ela até o fim.
 * Chamado quando a reunião é detectada; chamar de novo (a mesma reunião
 * retomada) não troca a cópia. Mudanças feitas durante a reunião valem a
 * partir da próxima.
 */
export async function fixarPerfilDaReuniao(reuniaoId: string): Promise<PerfilEmUso | null> {
  if (!reuniaoId) return null;
  return transacao((c) => {
    const ja = c.emUso.find((x) => x.reuniaoId === reuniaoId);
    if (ja) return { resultado: ja, mudou: false };
    const fixado: PerfilEmUso = {
      reuniaoId,
      perfilRevisao: c.perfil?.revisao ?? null,
      perfilUsado: structuredClone(perfilAtual(c)),
      em: Date.now(),
    };
    c.emUso = [fixado, ...c.emUso].slice(0, MAX_EM_USO);
    return { resultado: fixado, mudou: true };
  });
}

export function perfilEmUsoDaReuniao(c: Conducao, reuniaoId: string): PerfilEmUso | null {
  return c.emUso.find((x) => x.reuniaoId === reuniaoId) ?? null;
}

// ----------------------------------------------------------------- briefing

export interface MudancaDoBriefing {
  objetivo?: string;
  contexto?: string;
  prioridades?: string[];
  /** Ids dos encontros anteriores a retomar. */
  retomar?: string[];
  /** O modo só para esta reunião; `null` volta ao do perfil. */
  modo?: ModoDeIntervencao | null;
}

export function briefingDaReuniao(c: Conducao, reuniaoId: string): BriefingDaReuniao | null {
  return c.briefings.find((b) => b.reuniaoId === reuniaoId) ?? null;
}

/**
 * Grava o briefing de uma reunião. Quem chama é a pessoa: `aprovado` fica
 * verdadeiro quando ela informa o objetivo, e volta a falso se ele for
 * apagado. `revisaoEsperada`: `0` para o primeiro briefing daquela reunião.
 */
export async function salvarBriefing(
  reuniaoId: string,
  mudanca: MudancaDoBriefing,
  revisaoEsperada: number,
  autor: AutorDaMudanca = 'pessoa',
): Promise<ResultadoDaEdicao<BriefingDaReuniao>> {
  if (!reuniaoId) return { tipo: 'invalido', motivo: 'Falta a reunião.' };
  return transacao<ResultadoDaEdicao<BriefingDaReuniao>>((c) => {
    const atual = briefingDaReuniao(c, reuniaoId);
    if ((atual?.revisao ?? 0) !== revisaoEsperada)
      return { resultado: { tipo: 'conflito' as const, atual }, mudou: false };
    const agora = Date.now();
    const objetivo = mudanca.objetivo !== undefined ? limpar(mudanca.objetivo, MAX_TEXTO) : (atual?.objetivo ?? '');
    const contexto =
      mudanca.contexto !== undefined ? limpar(mudanca.contexto, MAX_TEXTO * 2) : (atual?.contexto ?? '');
    const prioridades =
      mudanca.prioridades !== undefined ? limparLista(mudanca.prioridades) : (atual?.prioridades ?? []);
    const retomar = mudanca.retomar !== undefined ? limparIds(mudanca.retomar, reuniaoId) : (atual?.retomar ?? []);
    // `undefined` mantém o que estava; `null` volta ao modo do perfil.
    const modo: ModoDeIntervencao | undefined =
      mudanca.modo === undefined ? atual?.modo : mudanca.modo === null ? undefined : modoValido(mudanca.modo);
    if (
      atual &&
      atual.objetivo === objetivo &&
      atual.contexto === contexto &&
      JSON.stringify(atual.prioridades) === JSON.stringify(prioridades) &&
      JSON.stringify(atual.retomar) === JSON.stringify(retomar) &&
      atual.modo === modo
    )
      return { resultado: { tipo: 'ok' as const, item: atual }, mudou: false };
    const briefing: BriefingDaReuniao = {
      reuniaoId,
      revisao: (atual?.revisao ?? 0) + 1,
      criadoEm: atual?.criadoEm ?? agora,
      atualizadoEm: Math.max(agora, (atual?.atualizadoEm ?? 0) + 1),
      objetivo,
      aprovado: objetivo !== '',
      contexto,
      prioridades,
      retomar,
      ...(modo ? { modo } : {}),
      // Primeira preparação: guarda o perfil de agora, resolvido.
      perfilRevisao: atual ? atual.perfilRevisao : (c.perfil?.revisao ?? null),
      perfilUsado: atual ? atual.perfilUsado : structuredClone(perfilAtual(c)),
      historico: [
        ...(atual?.historico ?? []),
        eventoDe(atual ? 'briefing atualizado' : 'briefing criado', autor),
      ].slice(-MAX_HISTORICO),
    };
    c.briefings = [briefing, ...c.briefings.filter((b) => b.reuniaoId !== reuniaoId)];
    return { resultado: { tipo: 'ok' as const, item: briefing }, mudou: true };
  });
}

/** Apagar a reunião leva o briefing dela. Devolve quantos saíram. */
export function semBriefingDaReuniao(c: Conducao, reuniaoId: string): { conducao: Conducao; removidos: number } {
  const ficam = c.briefings.filter((b) => b.reuniaoId !== reuniaoId);
  return { conducao: { ...c, briefings: ficam }, removidos: c.briefings.length - ficam.length };
}
