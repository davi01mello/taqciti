/**
 * Guardas de fidelidade, em código — o que não depende de o modelo obedecer.
 *
 * Os prompts pedem ao modelo que não invente cargo, gravidade nem causa e que
 * mantenha a dúvida como dúvida. Pedir não basta: numa geração real o Leitor
 * escreveu "perfil de diretoria" (a reunião nunca diz o cargo de ninguém),
 * "falhas críticas" (ninguém usou a palavra) e "constatou-se que a divergência
 * se deve a dados de teste" (quem falou disse "acho… pode ter contado"). O
 * Auditor só confere o que está marcado `strict`, e confere o parágrafo contra
 * um punhado de citações — uma frase sem apoio passa junto com as boas.
 *
 * Estas duas guardas rodam ANTES do Auditor, sem gastar chamada:
 *
 *  1. **Léxico fora da fonte.** Palavra de cargo/hierarquia ou de gravidade
 *     presente no texto gerado e ausente da transcrição derruba a FRASE. É a
 *     regra "cargo não se deduz", estendida a todas as seções, e a regra
 *     "gravidade não se inventa". O léxico é estreito de propósito: palavra
 *     comum de domínio dá falso positivo e apagaria texto bom.
 *
 *  2. **Certeza indevida.** Frase que afirma causa com certeza ("constatou-se",
 *     "se deve a", "é causada por") apoiada numa citação que era hipótese
 *     ("acho", "pode ter", "talvez") sobre o MESMO assunto cai. O "mesmo
 *     assunto" é medido por palavras de conteúdo em comum: sem isso, um "acho"
 *     qualquer numa reunião falada derrubaria qualquer frase causal.
 *
 * Nenhuma das duas reescreve nada: só remove. O que sobra continua sendo texto
 * do modelo, agora sem a frase que a fonte não sustenta.
 */
import type { DocumentData } from './documentData';

/** Minúsculas e sem acento — a comparação é por forma, não por grafia. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Cargo e hierarquia: a reunião raramente os diz, e o modelo os deduz de quem
 * "fala com autoridade". Gravidade e impacto: o modelo as acrescenta porque
 * "soa técnico". Padrões já sem acento, com as flexões comuns.
 */
const LEXICO: { rotulo: string; padrao: RegExp }[] = [
  { rotulo: 'diretor/diretoria', padrao: /\bdiret(or|ora|ores|oras|oria|orias)\b/ },
  { rotulo: 'gerente', padrao: /\bgerent(e|es|ial|ciais)\b/ },
  { rotulo: 'gestor', padrao: /\bgest(or|ora|ores|oras)\b/ },
  { rotulo: 'coordenador', padrao: /\bcoordenad(or|ora|ores|oras|acao)\b/ },
  { rotulo: 'supervisor', padrao: /\bsupervis(or|ora|ores|oras)\b/ },
  { rotulo: 'líder', padrao: /\blider(es)?\b/ },
  { rotulo: 'chefe', padrao: /\bchef(e|es|ia)\b/ },
  { rotulo: 'executivo', padrao: /\b(ceo|cto|cfo|coo|executiv[oa]s?)\b/ },
  { rotulo: 'sócio', padrao: /\bsoci(o|a|os|as)\b/ },
  { rotulo: 'presidente', padrao: /\bpresident(e|es|a)\b/ },
  { rotulo: 'analista', padrao: /\banalistas?\b/ },
  { rotulo: 'consultor', padrao: /\bconsultor(a|es|as)?\b/ },
  { rotulo: 'especialista', padrao: /\bespecialistas?\b/ },
  { rotulo: 'estagiário', padrao: /\bestagiari[oa]s?\b/ },
  { rotulo: 'gravidade', padrao: /\b(critic[oa]s?|gravissim[oa]s?|grave|graves|urgente|urgentes|urgencia)\b/ },
];

/** As palavras do léxico presentes no texto e ausentes da fonte. */
export function palavrasForaDaFonte(texto: string, fonte: string): string[] {
  const t = normalizar(texto);
  const f = normalizar(fonte);
  return LEXICO.filter(({ padrao }) => padrao.test(t) && !padrao.test(f)).map(({ rotulo }) => rotulo);
}

/** Quebra em frases, guardando o espaço depois de cada uma. */
export function frases(texto: string): string[] {
  return texto.match(/[^.!?]+[.!?]*\s*/g) ?? [texto];
}

/** Marcadores de que a frase AFIRMA uma causa ou um fato apurado. */
const AFIRMA_CAUSA = [
  /\bconstat(ou|ou-se|a-se|ado|ada)\b/,
  /\bcomprov(ou|ou-se|ado|ada)\b/,
  /\bconfirm(ou-se|ado|ada)\b/,
  /\bse deve\b/,
  /\bdeve-se\b/,
  /\bdecorre(m|nte|ntes)?\b/,
  /\b(e|foi|sao|foram) (causad[oa]s?|provocad[oa]s?|gerad[oa]s?|ocasionad[oa]s?) (por|pel[oa]s?)\b/,
  /\bpor causa d[eoa]s?\b/,
  /\bresultante d[eoa]s?\b/,
  /\bderivava?\b/,
  // "dados residuais que afetavam a taxa": afirma a causa sem dizer "se deve a".
  /\bque (afetava|afetavam|afeta|afetam|afetou|causava|causavam|causa|causam|gerava|geravam|distorcia|distorciam|impactava|impactavam|provocava|provocavam)\b/,
];

/** Marcadores de que quem falou NÃO tinha certeza. */
const HEDGE = [
  /\bacho\b/,
  /\bachar\b/,
  /\btalvez\b/,
  /\bpode ter\b/,
  /\bpode ser\b/,
  /\bdeve ter\b/,
  /\bdeve ser\b/,
  /\bparece( que)?\b/,
  /\bprovavelmente\b/,
  /\bsera que\b/,
  /\bnao sei\b/,
  /\bquem sabe\b/,
];

/** Marcadores de que a frase JÁ mantém a dúvida — não se mexe nela. */
const MANTEM_A_DUVIDA = /\b(provavel|provavelmente|possivelmente|talvez|hipotese|suposicao|sugeriu|supos|levantou a possibilidade|pode ter|poderia)\b/;

const PALAVRAS_DE_LIGACAO = new Set([
  'para', 'como', 'esta', 'este', 'esse', 'essa', 'pelo', 'pela', 'pelos', 'pelas', 'sobre',
  'entre', 'ainda', 'tambem', 'quando', 'sendo', 'onde', 'cujo', 'cuja', 'seus', 'suas', 'mais',
  'apos', 'desde', 'ate', 'bem', 'muito', 'alguns', 'algumas', 'todos', 'todas', 'foram', 'sera',
  'esta', 'estao', 'havia', 'pessoa', 'reuniao', 'equipe',
]);

const palavrasDeConteudo = (texto: string): Set<string> =>
  new Set(
    (normalizar(texto).match(/[a-z0-9]{4,}/g) ?? []).filter((p) => !PALAVRAS_DE_LIGACAO.has(p)),
  );

/**
 * A frase afirma uma causa com certeza, e a citação que a sustenta era uma
 * hipótese sobre o mesmo assunto?
 */
export function certezaIndevida(frase: string, citacoes: readonly string[]): boolean {
  const f = normalizar(frase);
  if (!AFIRMA_CAUSA.some((p) => p.test(f))) return false;
  if (MANTEM_A_DUVIDA.test(f)) return false;
  const daFrase = palavrasDeConteudo(frase);
  return citacoes.some((citacao) => {
    const c = normalizar(citacao);
    if (!HEDGE.some((p) => p.test(c))) return false;
    const emComum = [...palavrasDeConteudo(citacao)].filter((p) => daFrase.has(p));
    return emComum.length >= 2;
  });
}

export interface ConteudoDeBloco {
  tipo?: string;
  texto?: string;
  itens?: string[];
  linhas?: string[][];
}

/**
 * As mesmas guardas, para um bloco do documento personalizado (a transcrição
 * vira a soma das fontes). Parágrafo perde a frase; item de lista e linha de
 * tabela caem inteiros. `vazio` = não sobrou nada do conteúdo que o bloco
 * existe para carregar.
 */
export function guardarConteudo<T extends ConteudoDeBloco>(
  bruto: T,
  evidencias: readonly string[],
  fonte: string,
): { bruto: T; caiu: { texto: string; motivo: string }[]; vazio: boolean } {
  const caiu: { texto: string; motivo: string }[] = [];
  const checar = (texto: string): boolean => {
    const r = filtrarFrases({ texto, citacoes: evidencias }, fonte);
    for (const c of r.caiu) caiu.push({ texto: c.frase, motivo: c.motivo });
    return r.caiu.length === 0;
  };

  if (bruto.tipo === 'lista' && bruto.itens) {
    const itens = bruto.itens.filter((i) => checar(i));
    return { bruto: { ...bruto, itens }, caiu, vazio: itens.length === 0 };
  }
  if (bruto.tipo === 'tabela' && bruto.linhas) {
    const linhas = bruto.linhas.filter((linha) => checar(linha.join('. ')));
    return { bruto: { ...bruto, linhas }, caiu, vazio: linhas.length === 0 };
  }
  if (bruto.tipo === 'paragrafo' && bruto.texto) {
    const r = filtrarFrases({ texto: bruto.texto, citacoes: evidencias }, fonte);
    for (const c of r.caiu) caiu.push({ texto: c.frase, motivo: c.motivo });
    return { bruto: { ...bruto, texto: r.texto }, caiu, vazio: r.texto === '' };
  }
  return { bruto, caiu, vazio: false };
}

export interface DescarteDeFidelidade {
  sectionId: string;
  path: string;
  /** O que saiu do documento (a frase, ou o item inteiro). */
  texto: string;
  motivo: string;
}

export interface Campo {
  /** Texto atual do campo. */
  texto: string;
  citacoes: readonly string[];
}

/**
 * Os TURNOS de fala da fonte, com a posição de cada um. Um turno começa numa
 * linha que abre com um carimbo (`[09:55] Pessoa D: …`) e inclui as linhas de
 * continuação: a mesma fala, quebrada pela captura. Sem carimbo, cada linha é um
 * turno.
 */
function turnos(fonte: string): { texto: string; inicio: number; fim: number }[] {
  const linhas = fonte.split('\n');
  const marcado = linhas.some((l) => /^\[\d/.test(l));
  const saida: { texto: string; inicio: number; fim: number }[] = [];
  let deslocamento = 0;
  for (const linha of linhas) {
    const inicio = deslocamento;
    deslocamento += linha.length + 1;
    const ultimo = saida[saida.length - 1];
    if (!marcado || /^\[\d/.test(linha) || !ultimo) {
      saida.push({ texto: linha, inicio, fim: inicio + linha.length });
    } else {
      ultimo.texto += ` ${linha}`;
      ultimo.fim = inicio + linha.length;
    }
  }
  return saida;
}

/**
 * O turno da citação e os vizinhos (três antes, três depois), cada um separado.
 *
 * O Leitor cita as falas que dizem O QUE aconteceu, e a hipótese sobre o porquê
 * costuma vir de OUTRA pessoa nas falas em volta ("…eu acho que pode ter
 * ficado no banco"). Olhar só a fala citada deixava a frase "se deve a dados de
 * teste" passar. Na geração real a hipótese estava três falas ANTES da citada, e
 * contar LINHAS não alcançava: a fala das 09:55 tem três. Cada vizinho é medido
 * sozinho: o assunto em comum com a frase é exigido por turno, não pelo bloco todo.
 */
export function turnosEmVolta(
  fonte: string,
  anchor: { start: number; end: number },
  antes = 3,
  depois = 3,
): string[] {
  const lista = turnos(fonte);
  const achado = lista.findIndex((t) => anchor.start >= t.inicio && anchor.start <= t.fim);
  const indice = achado === -1 ? 0 : achado;
  return lista
    .slice(Math.max(0, indice - antes), indice + depois + 1)
    .map((t) => t.texto)
    .filter((texto) => texto.trim());
}
/** Passa o texto por frases: devolve o que sobra e o que caiu, com o motivo. */
export function filtrarFrases(
  campo: Campo,
  fonte: string,
): { texto: string; caiu: { frase: string; motivo: string }[] } {
  const caiu: { frase: string; motivo: string }[] = [];
  const ficou = frases(campo.texto).filter((frase) => {
    const fora = palavrasForaDaFonte(frase, fonte);
    if (fora.length > 0) {
      caiu.push({ frase: frase.trim(), motivo: `usa "${fora.join('", "')}", que a reunião não traz` });
      return false;
    }
    if (certezaIndevida(frase, campo.citacoes)) {
      caiu.push({ frase: frase.trim(), motivo: 'afirma como certo o que a reunião tratou como hipótese' });
      return false;
    }
    return true;
  });
  return { texto: ficou.join('').trim(), caiu };
}

/**
 * Aplica as guardas ao `DocumentData` que o Leitor devolveu, no lugar. Item de
 * lista (decisão, outcome, output, ponto genérico) é UMA afirmação: cai inteiro.
 * Campo de prosa (tópico, período, conclusão) perde só a frase.
 */
export function guardarFidelidade(data: DocumentData, transcricao: string): DescarteDeFidelidade[] {
  const descartes: DescarteDeFidelidade[] = [];

  /**
   * O que sustenta uma afirmação, para medir a certeza: o turno da transcrição
   * onde cada citação foi ancorada e os vizinhos (`turnosEmVolta`), e não só o
   * trecho citado. O Leitor cita o mínimo, e o mínimo raramente carrega a
   * dúvida. Sem âncora, vale o próprio trecho.
   */
  const quotes = (
    lista: readonly { quote: string; anchor?: { start: number; end: number } | null }[] | undefined,
  ): string[] =>
    [
      ...new Set(
        (lista ?? []).flatMap((q) => {
          if (!q.quote) return [];
          return q.anchor ? turnosEmVolta(transcricao, q.anchor) : [q.quote];
        }),
      ),
    ];

  const prosa = (
    sectionId: string,
    path: string,
    texto: string,
    citacoes: readonly string[],
  ): string => {
    const r = filtrarFrases({ texto, citacoes }, transcricao);
    for (const c of r.caiu) descartes.push({ sectionId, path, texto: c.frase, motivo: c.motivo });
    return r.texto;
  };

  // --- prosa: perde a frase -------------------------------------------------
  if (data.generalTopic) {
    const progress = prosa('topico_geral', 'generalTopic.progress', data.generalTopic.progress, []);
    if (progress) data.generalTopic = { ...data.generalTopic, progress };
    else delete data.generalTopic;
  }

  if (data.topicsDiscussed) {
    data.topicsDiscussed = data.topicsDiscussed.flatMap((t, i) => {
      const summary = prosa('topicos_discutidos', `topicsDiscussed[${i}]`, t.summary, quotes(t.quotes));
      return summary ? [{ ...t, summary }] : [];
    });
  }

  if (data.periods) {
    data.periods = data.periods.flatMap((p, i) => {
      const summary = prosa('resumo_por_periodo', `periods[${i}]`, p.summary, quotes(p.quotes));
      return summary ? [{ ...p, summary }] : [];
    });
  }

  if (data.conclusion) {
    const text = prosa('conclusao', 'conclusion', data.conclusion.text, []);
    if (text) data.conclusion = { text };
    else delete data.conclusion;
  }

  // --- itens: caem inteiros -------------------------------------------------
  const itens = <T extends { text: string; quotes: { quote: string }[] }>(
    sectionId: string,
    chave: string,
    lista: T[] | undefined,
  ): T[] | undefined =>
    lista?.filter((item, i) => {
      const r = filtrarFrases({ texto: item.text, citacoes: quotes(item.quotes) }, transcricao);
      if (r.caiu.length === 0) return true;
      descartes.push({
        sectionId,
        path: `${chave}[${i}]`,
        texto: item.text,
        motivo: r.caiu[0]!.motivo,
      });
      return false;
    });

  if (data.decisions) data.decisions = itens('decisoes', 'decisions', data.decisions)!;
  if (data.outcomes) data.outcomes = itens('outcomes', 'outcomes', data.outcomes)!;
  if (data.outputs) data.outputs = itens('outputs', 'outputs', data.outputs)!;
  if (data.generic) {
    for (const [secao, lista] of Object.entries(data.generic)) {
      data.generic[secao] = itens(secao, `generic.${secao}`, lista)!;
    }
  }

  return descartes;
}
