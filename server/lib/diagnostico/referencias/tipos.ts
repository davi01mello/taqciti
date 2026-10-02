/**
 * O QUE É UMA REFERÊNCIA — o schema, e a validação dele.
 *
 * ── Para que isto existe ─────────────────────────────────────────────────
 *
 * Uma referência é a fonte que sustenta um insight. O produto vai dizer
 * "reparei nisto na sua reunião, e é isto que a literatura diz a respeito" — e
 * essa segunda metade só vale se houver COMO CHEGAR à fonte. Daí `link` e
 * `autor` serem obrigatórios: uma referência sem procedência é uma opinião com
 * ares de autoridade, que é o pior resultado possível aqui.
 *
 * ── Por que validação escrita à mão, e não um zod ────────────────────────
 *
 * O servidor não tem zod entre as dependências, e o resto da casa já valida
 * assim (ver `lib/ai/jsonSchema.ts`). Uma dependência nova para checar sete
 * campos pagaria mais em peso do que economiza em linhas — e a função abaixo
 * devolve TODOS os problemas de uma vez, que é o que um formulário precisa e o
 * que um `safeParse` também daria.
 *
 * ── O que NÃO está aqui ──────────────────────────────────────────────────
 *
 * O conteúdo da fonte. Esta fase modela METADADO: o que a referência é, onde
 * ela está e quando aplicá-la. Baixar, resumir ou indexar o texto — e, mais
 * tarde, gerar embeddings dele — é decisão que ainda não foi tomada; ver o
 * README da pasta.
 */

/**
 * As quatro categorias do diagnóstico. São as etapas de uma consultoria, na
 * ordem em que acontecem, e a categoria de uma referência diz em QUE MOMENTO da
 * conversa ela tem serventia — não sobre o que ela fala.
 */
export const CATEGORIAS = [
  /** Descobrir o problema real do cliente, antes de qualquer solução. */
  'entender_dor',
  /** Transformar a dor em escopo: o que se constrói, e o que fica de fora. */
  'definir_produto',
  /** Olhar para o que já foi feito e julgar se está funcionando. */
  'avaliar_execucao',
  /** Tocar o trabalho: prazo, papéis, risco, combinados. */
  'conduzir_projeto',
] as const;

export type Categoria = (typeof CATEGORIAS)[number];

/**
 * O peso da fonte. Existe para o produto poder dizer a diferença entre "a
 * documentação oficial afirma" e "um artigo de opinião defende" — colapsar os
 * dois num "segundo a literatura" seria emprestar autoridade que a fonte não
 * tem.
 */
export const TIPOS = ['documentacao_oficial', 'pesquisa', 'opiniao'] as const;

export type TipoDeReferencia = (typeof TIPOS)[number];

export interface Referencia {
  /** Estável e legível: é o que a rastreabilidade guarda para citar a fonte. */
  id: string;
  titulo: string;
  /** Pessoa ou instituição. Sem isto, não há procedência. */
  autor: string;
  /** URL de onde a fonte pode ser lida. */
  link: string;
  /** Data da PUBLICAÇÃO, em ISO `AAAA-MM-DD`. Ver `ehDataIso`. */
  data: string;
  categoria: Categoria;
  /** Assunto em texto livre — é por aqui que a busca simples pega. */
  assunto: string;
  tipo: TipoDeReferencia;
  /** Uma frase: em que situação de reunião esta fonte ajuda. */
  quando_aplicar: string;
}

export function ehCategoria(valor: unknown): valor is Categoria {
  return typeof valor === 'string' && (CATEGORIAS as readonly string[]).includes(valor);
}

export function ehTipo(valor: unknown): valor is TipoDeReferencia {
  return typeof valor === 'string' && (TIPOS as readonly string[]).includes(valor);
}

/**
 * Data ISO, e uma data que EXISTE.
 *
 * `new Date('2025-02-30')` não é inválido em JavaScript: ele rola para 2 de
 * março. Comparar o que voltou com o que entrou é o que pega o dia 30 de
 * fevereiro em vez de aceitá-lo calado.
 */
export function ehDataIso(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const data = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valor;
}

/**
 * Link utilizável.
 *
 * Só `http`/`https`. Um `javascript:` ou um `file:` numa lista que a interface
 * vai transformar em link clicável é superfície de ataque, não metadado —
 * mesmo com a biblioteca sendo local hoje.
 */
export function ehLink(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !valor.trim()) return false;
  try {
    const url = new URL(valor);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export type ResultadoDaValidacao =
  | { ok: true; valor: Referencia }
  | { ok: false; erros: string[] };

const TEXTOS_OBRIGATORIOS = ['id', 'titulo', 'autor', 'assunto', 'quando_aplicar'] as const;

/**
 * Valida um candidato a referência.
 *
 * Devolve TODOS os erros, e não o primeiro: quem está cadastrando uma fonte
 * quer a lista inteira de uma vez, não descobrir um problema por tentativa.
 */
export function validarReferencia(bruto: unknown): ResultadoDaValidacao {
  const erros: string[] = [];

  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) {
    return { ok: false, erros: ['a referência precisa ser um objeto.'] };
  }
  const candidato = bruto as Record<string, unknown>;

  for (const campo of TEXTOS_OBRIGATORIOS) {
    const valor = candidato[campo];
    if (typeof valor !== 'string' || !valor.trim()) {
      erros.push(`"${campo}" é obrigatório e precisa ser um texto não vazio.`);
    }
  }
  if (!ehLink(candidato.link)) {
    erros.push('"link" precisa ser uma URL http(s).');
  }
  if (!ehDataIso(candidato.data)) {
    erros.push('"data" precisa estar em AAAA-MM-DD e ser uma data que existe.');
  }
  if (!ehCategoria(candidato.categoria)) {
    erros.push(`"categoria" precisa ser uma de: ${CATEGORIAS.join(', ')}.`);
  }
  if (!ehTipo(candidato.tipo)) {
    erros.push(`"tipo" precisa ser um de: ${TIPOS.join(', ')}.`);
  }

  if (erros.length > 0) return { ok: false, erros };

  // Só os campos do schema atravessam. Um objeto vindo de JSON pode carregar
  // qualquer coisa a mais, e guardá-la de volta faria o arquivo crescer com
  // lixo que ninguém declarou.
  return {
    ok: true,
    valor: {
      id: (candidato.id as string).trim(),
      titulo: (candidato.titulo as string).trim(),
      autor: (candidato.autor as string).trim(),
      link: candidato.link as string,
      data: candidato.data as string,
      categoria: candidato.categoria as Categoria,
      assunto: (candidato.assunto as string).trim(),
      tipo: candidato.tipo as TipoDeReferencia,
      quando_aplicar: (candidato.quando_aplicar as string).trim(),
    },
  };
}
