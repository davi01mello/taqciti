/**
 * AS DECISÕES DE GASTO — o que se consulta, o que se busca, e o que sai daqui.
 *
 * ── Por que funções puras ────────────────────────────────────────────────
 *
 * Porque a decisão de gastar é a parte que precisa ser auditável. Uma função
 * que decide E executa só pode ser testada executando — e executar, aqui, é
 * chamar API paga. Separadas, a decisão é uma tabela-verdade que se verifica em
 * milissegundos, e a execução vira um detalhe de quem chama.
 *
 * Toda decisão devolve um MOTIVO junto do booleano. Não é enfeite: é o que
 * aparece no log quando alguém perguntar "por que este diagnóstico custou três
 * buscas?", e é o que impede a regra de virar um `if` que ninguém entende seis
 * meses depois.
 *
 * ── A ordem dos custos ───────────────────────────────────────────────────
 *
 * Do mais barato para o mais caro: biblioteca local (grátis, instantânea) →
 * cache de busca (grátis) → busca web (paga, lenta, e sai da máquina com
 * texto do cliente dentro). Cada degrau só é pisado quando o anterior não
 * resolveu — e o último tem ainda um limitador por diagnóstico, porque
 * "não resolveu" pode acontecer muitas vezes seguidas.
 */

/** O que se sabe da reunião no momento da decisão. */
export interface ContextoDeDiagnostico {
  /** O texto em análise — um trecho, ou o resumo do que se está examinando. */
  texto: string;
  /** O assunto que o agente identificou, quando identificou algum. */
  assunto?: string;
  /**
   * Nomes que NÃO podem sair desta máquina: participantes, cliente, empresa,
   * produto interno. Quem monta o contexto é quem sabe quais são.
   */
  nomesConfidenciais?: string[];
  /** Quantas falas a reunião tem. Reunião curta demais não tem o que diagnosticar. */
  quantidadeDeFalas?: number;
}

export interface Decisao {
  sim: boolean;
  motivo: string;
}

/**
 * Abaixo disto não há reunião o bastante para diagnosticar.
 *
 * Seis falas é "oi, bom dia, consegue me ouvir?, consigo, então tá, até" — uma
 * sala sendo testada, não uma conversa de trabalho. Consultar a biblioteca aqui
 * não custa dinheiro, mas produz insight sobre nada, e insight sobre nada é o
 * que faz alguém desligar o produto.
 */
export const MINIMO_DE_FALAS = 6;

/** Texto curto demais para ter assunto: não dá nem para formar uma consulta. */
export const MINIMO_DE_CARACTERES = 80;

/**
 * Vale consultar a biblioteca local?
 *
 * É a consulta de graça, então a régua é baixa de propósito: ela só barra o que
 * não tem conteúdo nenhum. A pergunta cara vem depois.
 */
export function deveConsultarBiblioteca(contexto: ContextoDeDiagnostico): Decisao {
  const falas = contexto.quantidadeDeFalas;
  if (falas !== undefined && falas < MINIMO_DE_FALAS) {
    return {
      sim: false,
      motivo: `reunião com ${falas} fala(s): abaixo do mínimo de ${MINIMO_DE_FALAS} para diagnosticar.`,
    };
  }
  if (contexto.texto.trim().length < MINIMO_DE_CARACTERES) {
    return {
      sim: false,
      motivo: `trecho com ${contexto.texto.trim().length} caracteres: curto demais para ter assunto.`,
    };
  }
  return { sim: true, motivo: 'há conteúdo suficiente, e a consulta local não tem custo.' };
}

/** O que a biblioteca devolveu, resumido para a decisão seguinte. */
export interface ResumoDaBiblioteca {
  /** Quantas referências casaram. */
  quantidade: number;
  /** Quantos termos da consulta o melhor resultado cobriu. */
  melhorPontuacao: number;
}

/** A partir daqui, a biblioteca respondeu — e a web não precisa ser paga. */
export const PONTUACAO_QUE_BASTA = 2;

/** O contexto extra que só a decisão da web precisa. */
export interface ContextoDaBusca {
  /** Já existe resposta em cache para esta consulta? */
  temCache?: boolean;
  /** O limitador do diagnóstico ainda permite mais uma busca? */
  buscasRestantes?: number;
}

/**
 * Vale pagar por uma busca na web?
 *
 * A regra tem quatro barreiras, e a ordem importa: as três primeiras são
 * gratuitas de verificar, e só a última olha a qualidade do que a biblioteca
 * trouxe.
 */
export function deveBuscarWeb(
  contexto: ContextoDeDiagnostico & ContextoDaBusca,
  biblioteca: ResumoDaBiblioteca,
): Decisao {
  if (contexto.temCache) {
    return { sim: false, motivo: 'já há resultado em cache válido para esta consulta.' };
  }
  if (contexto.buscasRestantes !== undefined && contexto.buscasRestantes <= 0) {
    return { sim: false, motivo: 'o limite de buscas deste diagnóstico foi atingido.' };
  }

  // Sem consulta formável não há o que buscar — e é aqui que a anonimização
  // pode ter esvaziado o texto, o que é o comportamento certo dela.
  const { query } = formatarQueryWeb(contexto);
  if (!query) {
    return { sim: false, motivo: 'não sobrou consulta depois de remover o que é confidencial.' };
  }

  if (biblioteca.quantidade > 0 && biblioteca.melhorPontuacao >= PONTUACAO_QUE_BASTA) {
    return {
      sim: false,
      motivo: `a biblioteca já respondeu (${biblioteca.quantidade} referência(s), melhor pontuação ${biblioteca.melhorPontuacao}).`,
    };
  }

  return {
    sim: true,
    motivo:
      biblioteca.quantidade === 0
        ? 'a biblioteca não tem nada sobre o assunto.'
        : `a biblioteca trouxe pouco (melhor pontuação ${biblioteca.melhorPontuacao}).`,
  };
}

// ---------------------------------------------------------------------------
// A consulta que sai da máquina
// ---------------------------------------------------------------------------

/**
 * Padrões que nunca podem virar consulta, independentemente de quem os
 * escreveu. São formas, não nomes: valem mesmo quando ninguém preencheu
 * `nomesConfidenciais`.
 */
const PADROES_SENSIVEIS: ReadonlyArray<{ o_que: string; regex: RegExp }> = [
  { o_que: 'e-mail', regex: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
  { o_que: 'url', regex: /https?:\/\/\S+/g },
  // Telefone brasileiro com ou sem máscara, e qualquer sequência longa de
  // dígitos — CPF, CNPJ, número de contrato, valor. Um número de 8+ dígitos
  // numa consulta de pesquisa nunca é o assunto.
  { o_que: 'telefone', regex: /\(?\d{2}\)?[\s-]?\d{4,5}[\s-]?\d{4}/g },
  { o_que: 'documento', regex: /\b[\d.\-/]{8,}\b/g },
  { o_que: 'código de sala', regex: /\b[a-z]{3}-[a-z]{4}-[a-z]{3}\b/gi },
];

/**
 * Palavras que sobreviveriam ao filtro sem acrescentar nada à consulta. Tirá-las
 * é o que faz caber assunto de verdade no teto de termos.
 */
const VAZIAS = new Set([
  'a', 'ao', 'aos', 'as', 'com', 'como', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'essa',
  'esse', 'esta', 'este', 'eu', 'isso', 'já', 'la', 'lá', 'mais', 'mas', 'me', 'na', 'nao',
  'não', 'nas', 'no', 'nos', 'o', 'os', 'ou', 'para', 'pra', 'por', 'que', 'se', 'sem', 'ser',
  'só', 'sobre', 'te', 'tem', 'um', 'uma', 'voce', 'você', 'vou',
]);

/** Quantos termos a consulta carrega. Além disto, busca vira ruído. */
export const MAXIMO_DE_TERMOS = 12;

export interface QueryFormatada {
  /** A consulta pronta. Vazia quando não sobrou assunto. */
  query: string;
  /** O que foi tirado, por tipo — para log e para teste. */
  removidos: string[];
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Monta a consulta de busca a partir do contexto, tirando o que é confidencial.
 *
 * ── A ordem da limpeza ───────────────────────────────────────────────────
 *
 * PADRÕES primeiro, nomes depois — e a ordem inversa é um bug, não uma
 * preferência. Os padrões casam estruturas inteiras (`bruno@cliente.com`); se o
 * nome saísse antes, sobraria `@cliente.com`, que não casa mais com o padrão de
 * e-mail, e o domínio do cliente iria para o buscador. Foi exatamente o que
 * aconteceu na primeira versão desta função.
 *
 * A troca não enfraquece o filtro de nomes: ele não depende de estrutura
 * nenhuma, e continua pegando o nome solto no meio da frase.
 *
 * ── O que ela NÃO garante ────────────────────────────────────────────────
 *
 * Que nada identificável escape. Uma frase pode identificar um cliente sem
 * conter nome nenhum ("a startup de entrega de flores de Recife"). O que esta
 * função garante é que os dados ESTRUTURADOS — nome fornecido, e-mail,
 * telefone, documento, link, código de sala — não saiam; o resto é decisão de
 * produto sobre o que se manda para um buscador, e está na lista de pendências.
 */
export function formatarQueryWeb(contexto: ContextoDeDiagnostico): QueryFormatada {
  const removidos: string[] = [];
  let texto = `${contexto.assunto ?? ''} ${contexto.texto}`;

  for (const { o_que, regex } of PADROES_SENSIVEIS) {
    const antes = texto;
    texto = texto.replace(regex, ' ');
    if (texto !== antes) removidos.push(o_que);
  }

  for (const nome of contexto.nomesConfidenciais ?? []) {
    const limpo = nome.trim();
    if (!limpo) continue;
    // Cada PALAVRA do nome, e não só o nome inteiro: a transcrição cita "Ana"
    // muito mais do que "Ana Duarte", e barrar só o par completo deixaria o
    // primeiro nome passar.
    for (const parte of limpo.split(/\s+/)) {
      if (parte.length < 3) continue;
      const antes = texto;
      texto = texto.replace(new RegExp(`\\b${escaparRegex(parte)}\\b`, 'gi'), ' ');
      if (texto !== antes && !removidos.includes('nome')) removidos.push('nome');
    }
  }

  const termos = texto
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((termo) => termo.length >= 3 && !VAZIAS.has(termo));

  // Sem repetição, preservando a ordem — a primeira aparição costuma ser a
  // mais próxima do assunto, que vem na frente do texto.
  const unicos = [...new Set(termos)].slice(0, MAXIMO_DE_TERMOS);

  return { query: unicos.join(' '), removidos };
}
