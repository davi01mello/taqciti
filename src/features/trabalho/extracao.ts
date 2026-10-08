/**
 * Extração INCREMENTAL de compromissos a partir da legenda consolidada.
 *
 * ── Local e sem modelo ──────────────────────────────────────────────────────
 *
 * A captura e o acompanhamento não dependem da IA estar de pé: aqui só há
 * regras sobre o texto que já está guardado neste computador. Nada sai daqui.
 *
 * ── O que entra e o que não entra ───────────────────────────────────────────
 *
 * Um trecho vira CANDIDATO quando traz um combinado explícito ("eu vou enviar",
 * "ficou combinado", "próximo passo", "Ana fica com…", "precisamos de…"). O
 * candidato nasce com `situacao: 'candidato'`: não é registro aceito até a
 * pessoa revisar. Dele só se guarda o que o trecho diz:
 *
 *   - responsável: quem falou ("eu vou…" — o falante) ou um PARTICIPANTE
 *     citado pelo primeiro nome ("Ana vai…"). Nome que não é de ninguém da
 *     reunião não vira responsável; sem os dois, fica `null`;
 *   - prazo: a expressão escrita no trecho ("até sexta", "até 15/10"). Só vira
 *     `data` quando é dia/mês explícito; "sexta" continua "sexta".
 *
 * Nada é concluído nem cancelado por inferência, e prazo vencido não acusa
 * ninguém (ver `situacaoDoPrazo`).
 *
 * ── Idempotência ────────────────────────────────────────────────────────────
 *
 * A legenda é revisada: a mesma fala chega de novo com outras palavras. Duas
 * defesas, as duas em `registrarCompromissos`: a chave do texto e, mais forte,
 * "mesma reunião + mesmo segmento". Reprocessar a reunião inteira, portanto,
 * não duplica; editar um candidato (ou excluí-lo — o descarte fica registrado)
 * não é desfeito.
 *
 * ── Frequência ──────────────────────────────────────────────────────────────
 *
 * Só falas CONSOLIDADAS: as duas últimas do ao vivo ainda podem ser revistas e
 * esperam. O extrator incremental roda no máximo uma vez por intervalo e só se
 * entrou fala nova.
 */
import type { LiveSegment, Participant } from '@/shared/types/domain';
import {
  registrarCompromissos,
  type Compromisso,
  type EvidenciaGuardada,
  type NovoCompromisso,
} from './store';

/** Quantas falas do fim ainda estão "em construção" no ao vivo. */
export const FALAS_INSTAVEIS = 2;
export const INTERVALO_DA_EXTRACAO_MS = 20_000;
const MIN_PALAVRAS = 4;
const MAX_DESCRICAO = 220;

export interface EntradaDaExtracao {
  reuniaoId: string;
  titulo: string;
  /** Epoch ms do início: dá o ano de um prazo escrito como "15/10". */
  inicio: number;
  segmentos: readonly Pick<LiveSegment, 'speaker' | 'text' | 'startOffsetMs'>[];
  participantes: readonly Pick<Participant, 'name'>[];
  /** A reunião acabou: todas as falas estão consolidadas. */
  encerrada: boolean;
  /** Dica de versão para a evidência. */
  versao?: string;
}

export interface Candidato {
  segmento: number;
  novo: NovoCompromisso;
}

// ---------------------------------------------------------------- utilidades

/** Minúsculas e sem acento, MANTENDO o comprimento (os índices valem no original). */
function plano(texto: string): string {
  let r = '';
  for (const c of texto) r += c.normalize('NFD')[0]!.toLowerCase();
  return r;
}

function primeiroNome(nome: string): string {
  return plano(nome.trim().split(/\s+/)[0] ?? '');
}

const SEM_FALANTE = /^(voce|you|eu|unknown|desconhecido|participante)$/;

/** Frases do trecho, sem perder a pontuação que as encerra. */
function frases(texto: string): string[] {
  return (texto.match(/[^.!?\n]+[.!?]?/g) ?? []).map((f) => f.trim()).filter(Boolean);
}

// ---------------------------------------------------------------- padrões

const VERBO_DE_ACAO =
  '(enviar|mandar|fazer|preparar|revisar|atualizar|criar|escrever|ligar|marcar|agendar|verificar|conferir|checar|montar|entregar|publicar|compartilhar|levantar|validar|alinhar|retornar|responder|organizar|documentar|testar|corrigir|ajustar|analisar|apresentar|resolver|cuidar|trazer|subir|abrir|fechar|definir|contratar|pagar|cobrar|fornecer|solicitar|pedir|buscar)';

/** "eu vou enviar", "vou revisar", "farei", "fico de mandar". */
const AUTO_ATRIBUICAO = new RegExp(
  `\\b(eu\\s+)?(vou|irei|fico\\s+de|ficarei\\s+de|me\\s+comprometo\\s+a)\\s+(?:\\w+\\s+){0,2}?${VERBO_DE_ACAO}\\b|\\b(farei|enviarei|mandarei|revisarei|prepararei|verificarei|atualizarei|criarei|ligarei)\\b`,
);

/** "Ana vai enviar", "Bruno fica com", "Carla é responsável por". */
const ATRIBUICAO_A_TERCEIRO =
  /\b([a-z]{2,})\s+(vai|ficou\s+de|fica\s+com|ficara\s+com|e\s+responsavel\s+por|assume|cuida\s+d[aeo]s?|fica\s+responsavel)\b/;

/**
 * Só marcadores de ACORDO. "Precisamos de", "temos que" e "tem que" dizem uma
 * necessidade ou um desejo ("acho que precisamos de um aplicativo"), não um
 * combinado: viram pergunta ou lacuna na condução, nunca tarefa.
 */
const COMBINADO_GERAL =
  /\b(ficou\s+combinado|combinamos|proximos?\s+passos?|acao:|ficamos\s+de|ficou\s+de)\b/;

/** Hipótese, desejo ou oferta: o trecho não registra um compromisso. */
const SEM_COMPROMISSO =
  /\b(acho\s+que|talvez|quem\s+sabe|seria\s+bom|seria\s+interessante|poderia(?:mos)?|gostaria(?:mos)?|pode\s+ser\s+que|se\s+der|caso\s+\w+\s+(?:queira|precise)|e\s+se)\b/;

const DIAS = '(segunda|terca|quarta|quinta|sexta|sabado|domingo)(-feira)?';
const PRAZO = new RegExp(
  [
    '(?:ate|ate\\s+o\\s+dia|ate\\s+dia|para\\s+o\\s+dia|no\\s+dia)\\s+\\d{1,2}(?:\\/\\d{1,2}(?:\\/\\d{2,4})?)?',
    `(?:ate|para|na|no)\\s+(?:a\\s+|o\\s+)?(?:proxima\\s+|proximo\\s+)?${DIAS}`,
    '(?:ate|para)\\s+(?:amanha|hoje|depois\\s+de\\s+amanha)',
    '(?:ate|para)\\s+(?:o\\s+)?fim\\s+(?:da|do|de)\\s+(?:semana|mes|dia|ano)',
    '(?:ate|para)\\s+(?:a\\s+)?(?:semana\\s+que\\s+vem|proxima\\s+semana)',
    '(?:ate|para)\\s+(?:o\\s+)?(?:mes\\s+que\\s+vem|proximo\\s+mes)',
    'ate\\s+\\d{1,2}\\s*h(?:oras?)?',
  ].join('|'),
);

const DATA_EXPLICITA = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/;

function dataDoPrazo(texto: string, inicio: number): string | undefined {
  const m = DATA_EXPLICITA.exec(texto);
  if (!m) return undefined;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return undefined;
  let ano = m[3] ? Number(m[3]) : new Date(inicio).getFullYear();
  if (ano < 100) ano += 2000;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  // 31/02 vira março: não é uma data.
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return undefined;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- extração

/**
 * Candidatos de UMA frase. Perguntas não são combinados, e frases curtas demais
 * não dizem o que fazer.
 */
function candidatoDaFrase(
  frase: string,
  falante: string | null,
  participantes: readonly Pick<Participant, 'name'>[],
  inicio: number,
): Pick<NovoCompromisso, 'descricao' | 'responsavel' | 'prazo'> | null {
  if (frase.trim().endsWith('?')) return null;
  if (frase.split(/\s+/).length < MIN_PALAVRAS) return null;
  const p = plano(frase);
  if (SEM_COMPROMISSO.test(p)) return null;

  const auto = AUTO_ATRIBUICAO.test(p);
  const terceiro = ATRIBUICAO_A_TERCEIRO.exec(p);
  const geral = COMBINADO_GERAL.test(p);

  // Um terceiro só conta se for alguém DA REUNIÃO, pelo primeiro nome único.
  let responsavel: NovoCompromisso['responsavel'] = null;
  if (terceiro) {
    const nome = terceiro[1]!;
    const casam = participantes.filter((x) => primeiroNome(x.name) === nome);
    if (casam.length === 1) responsavel = { nome: casam[0]!.name, confirmado: false };
  }
  const citouTerceiro = !!terceiro && responsavel !== null;

  if (!auto && !citouTerceiro && !geral) return null;

  if (!responsavel && auto && falante && !SEM_FALANTE.test(plano(falante).trim())) {
    // "Eu vou…" na boca de quem falou: a atribuição é dele mesmo.
    responsavel = { nome: falante, confirmado: true };
  }

  const m = PRAZO.exec(p);
  const prazoTexto = m ? frase.slice(m.index, m.index + m[0].length).trim() : '';
  const data = prazoTexto ? dataDoPrazo(prazoTexto, inicio) : undefined;

  return {
    descricao: frase.length > MAX_DESCRICAO ? `${frase.slice(0, MAX_DESCRICAO - 1)}…` : frase,
    responsavel,
    prazo: prazoTexto ? { texto: prazoTexto, ...(data ? { data } : {}) } : null,
  };
}

/** As falas que já não vão mudar. */
export function falasConsolidadas(total: number, encerrada: boolean): number {
  return encerrada ? total : Math.max(0, total - FALAS_INSTAVEIS);
}

/** Pura: dado o que está guardado, quem são os candidatos. */
export function extrairCandidatos(entrada: EntradaDaExtracao, desde = 0): Candidato[] {
  const ate = falasConsolidadas(entrada.segmentos.length, entrada.encerrada);
  const versao = entrada.versao ?? `${entrada.inicio}:${entrada.segmentos.length}`;
  const saida: Candidato[] = [];
  for (let i = Math.max(0, desde); i < ate; i += 1) {
    const seg = entrada.segmentos[i]!;
    for (const frase of frases(seg.text)) {
      const c = candidatoDaFrase(frase, seg.speaker, entrada.participantes, entrada.inicio);
      if (!c) continue;
      const evidencia: EvidenciaGuardada = {
        tipo: 'reuniao',
        registroId: entrada.reuniaoId,
        titulo: entrada.titulo,
        versao,
        trecho: frase,
        segmento: i,
        offsetMs: seg.startOffsetMs,
      };
      saida.push({
        segmento: i,
        novo: {
          ...c,
          reuniaoId: entrada.reuniaoId,
          evidencias: [evidencia],
          situacao: 'candidato',
        },
      });
    }
  }
  return saida;
}

/** Grava os candidatos. Reprocessar a mesma reunião devolve só `jaExistiam`. */
export async function registrarCandidatos(
  entrada: EntradaDaExtracao,
  desde = 0,
): Promise<{ criados: Compromisso[]; jaExistiam: Compromisso[] }> {
  const candidatos = extrairCandidatos(entrada, desde);
  if (!candidatos.length) return { criados: [], jaExistiam: [] };
  return registrarCompromissos(
    candidatos.map((c) => c.novo),
    { origem: 'taq' },
  );
}

// -------------------------------------------------------------- incremental

export interface ExtratorIncremental {
  /** Avisa que a reunião mudou. Rápido: decide sozinho se é hora de processar. */
  aoMudar(entrada: EntradaDaExtracao): void;
  /** Cancela o que estiver agendado. */
  parar(): void;
}

/**
 * Processa só quando entrou fala nova e no máximo uma vez por `intervaloMs`;
 * mudanças dentro do intervalo viram UMA execução ao fim dele. `agora` e os
 * temporizadores são injetáveis para os testes.
 */
export function criarExtratorIncremental(
  opcoes: {
    intervaloMs?: number;
    agora?: () => number;
    aoCriar?: (criados: Compromisso[], entrada: EntradaDaExtracao) => void;
    registrar?: typeof registrarCandidatos;
  } = {},
): ExtratorIncremental {
  const intervalo = opcoes.intervaloMs ?? INTERVALO_DA_EXTRACAO_MS;
  const agora = opcoes.agora ?? Date.now;
  const registrar = opcoes.registrar ?? registrarCandidatos;
  let ultimaExecucao = Number.NEGATIVE_INFINITY;
  let ultimoTotal = -1;
  let ultimaEncerrada = false;
  let ultimaReuniao = '';
  /** Texto de cada fala já processada: fala revisada é reprocessada, idempotente. */
  const vistos = new Map<number, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendente: EntradaDaExtracao | null = null;
  let emVoo = false;

  const rodar = async (entrada: EntradaDaExtracao) => {
    if (emVoo) {
      pendente = entrada;
      return;
    }
    emVoo = true;
    ultimaExecucao = agora();
    try {
      const ate = falasConsolidadas(entrada.segmentos.length, entrada.encerrada);
      let desde = ate;
      for (let i = 0; i < ate; i += 1) {
        if (vistos.get(i) !== entrada.segmentos[i]!.text) {
          desde = i;
          break;
        }
      }
      if (desde < ate) {
        const r = await registrar(entrada, desde);
        for (let i = desde; i < ate; i += 1) vistos.set(i, entrada.segmentos[i]!.text);
        if (r.criados.length) opcoes.aoCriar?.(r.criados, entrada);
      }
    } catch {
      // A extração é conveniência local: falhar não pode derrubar a captura.
    } finally {
      emVoo = false;
      if (pendente) {
        const p = pendente;
        pendente = null;
        agendar(p);
      }
    }
  };

  function agendar(entrada: EntradaDaExtracao) {
    pendente = entrada;
    if (timer) return;
    const espera = Math.max(0, ultimaExecucao + intervalo - agora());
    timer = setTimeout(() => {
      timer = null;
      const p = pendente;
      pendente = null;
      if (p) void rodar(p);
    }, espera);
  }

  return {
    aoMudar(entrada) {
      if (entrada.reuniaoId !== ultimaReuniao) {
        ultimaReuniao = entrada.reuniaoId;
        ultimoTotal = -1;
        vistos.clear();
      }
      const ate = falasConsolidadas(entrada.segmentos.length, entrada.encerrada);
      const mudou = ate !== ultimoTotal || entrada.encerrada !== ultimaEncerrada;
      ultimoTotal = ate;
      ultimaEncerrada = entrada.encerrada;
      if (!mudou || ate === 0) return;
      agendar(entrada);
    },
    parar() {
      if (timer) clearTimeout(timer);
      timer = null;
      pendente = null;
    },
  };
}
