/**
 * Geração e edição de documentos personalizados.
 *
 * O modelo (papel `redator`, que usa a configuração do `leitor`) decide
 * estrutura e texto; TUDO o mais é código: a capa (cliente, autor e data vêm
 * da pessoa), os blockIds, a checagem de fontes, a compilação, a contagem de
 * páginas e o relatório. Nada que o modelo devolve vai para o arquivo sem
 * passar por `blocoDoModelo`.
 *
 * Regra central — SUSTENTAÇÃO: um bloco `fato` só entra no documento se ao
 * menos uma das citações dele existe, literalmente, numa fonte que a pessoa
 * selecionou. Citação inexistente, de fonte não selecionada ou ausente remove
 * o bloco e vira um problema no relatório. Recomendação entra como
 * recomendação, nunca como fato. Documento incompleto é melhor que documento
 * com afirmação inventada.
 */
import { complete } from '../ai';
import type { JsonSchema, CompletionUsage } from '../ai';
import { createLocator, type Locator } from '../agents/anchoring';
import { renderPrompt } from '../prompts';
import {
  aplicarPatch,
  blocoSchema,
  contentTreeSchema,
  validarArvore,
  type Bloco,
  type ContentTree,
  type LacunaDoDocumento,
  type PatchDeBlocos,
  type ReferenciaDeFonte,
} from './contentTree';
import { compilarPdf, type Compilado } from './compilador';
import type { DocumentBrief, QualityReport, RenderManifest } from './contratos';

export interface FonteDoDocumento {
  id: string;
  titulo: string;
  texto: string;
}

export interface CapaInformada {
  cliente?: string;
  autor?: string;
  data?: string;
}

export interface PedidoDeDocumento {
  pedido: string;
  /** Só estas fontes entram. Fonte de outro cliente simplesmente não chega aqui. */
  fontes: FonteDoDocumento[];
  capa?: CapaInformada;
  extensao?: DocumentBrief['extensao'];
  orientacoesEditoriais?: string[];
  variante?: string;
}

export interface ResultadoDoDocumento {
  arvore: ContentTree;
  pdf: Buffer;
  manifesto: RenderManifest;
  relatorio: QualityReport;
  avisos: string[];
  /** Perguntas que a pessoa ainda precisa responder para o documento ficar completo. */
  lacunas: LacunaDoDocumento[];
  usage?: CompletionUsage;
}

export class ErroDeGeracao extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErroDeGeracao';
  }
}

type ProblemaDeQualidade = QualityReport['problemas'][number];

// ---------------------------------------------------------------------------
// O que o modelo devolve
// ---------------------------------------------------------------------------

const FONTES_SCHEMA: JsonSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      fonteId: { type: 'string' },
      trecho: {
        type: 'string',
        description: 'Trecho copiado LITERALMENTE da fonte, caractere por caractere.',
      },
    },
    required: ['fonteId', 'trecho'],
  },
};

const BLOCO_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    tipo: { type: 'string', enum: ['paragrafo', 'lista', 'tabela', 'referencia'] },
    texto: { type: 'string', description: 'Corpo do parágrafo ou da referência. Omita em listas e tabelas.' },
    itens: { type: 'array', items: { type: 'string' }, description: 'Itens da lista.' },
    cabecalho: { type: 'array', items: { type: 'string' }, description: 'Nomes das colunas da tabela.' },
    linhas: {
      type: 'array',
      items: { type: 'array', items: { type: 'string' } },
      description: 'Linhas da tabela: uma célula por coluna.',
    },
    legenda: { type: 'string', description: 'Legenda curta da tabela (opcional).' },
    classificacao: { type: 'string', enum: ['fato', 'recomendacao'] },
    fontes: FONTES_SCHEMA,
  },
  required: ['tipo', 'classificacao', 'fontes'],
};

const LACUNAS_SCHEMA: JsonSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      campo: { type: 'string', description: 'O que falta, em poucas palavras.' },
      pergunta: { type: 'string', description: 'Pergunta objetiva à pessoa.' },
    },
    required: ['campo', 'pergunta'],
  },
};

const SCHEMA_DE_GERACAO: JsonSchema = {
  type: 'object',
  properties: {
    estrutura: { type: 'string', description: 'Em uma frase, o tipo de documento escolhido.' },
    sumario: {
      type: 'boolean',
      description: 'true para incluir sumário com número de página (documentos com quatro ou mais seções).',
    },
    titulo: { type: 'string' },
    subtitulo: { type: 'string' },
    secoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { titulo: { type: 'string' }, blocos: { type: 'array', items: BLOCO_SCHEMA } },
        required: ['titulo', 'blocos'],
      },
    },
    lacunas: LACUNAS_SCHEMA,
  },
  required: ['estrutura', 'titulo', 'secoes', 'lacunas'],
};

interface BlocoBruto {
  tipo?: string;
  texto?: string;
  itens?: string[];
  cabecalho?: string[];
  linhas?: string[][];
  legenda?: string;
  nivel?: number;
  subtitulo?: string;
  classificacao?: string;
  fontes?: { fonteId?: string; trecho?: string }[];
}

interface SaidaDeGeracao {
  estrutura?: string;
  sumario?: boolean;
  titulo?: string;
  subtitulo?: string;
  secoes?: { titulo?: string; blocos?: BlocoBruto[] }[];
  lacunas?: { campo?: string; pergunta?: string }[];
}

// ---------------------------------------------------------------------------
// Sustentação
// ---------------------------------------------------------------------------

/** Localizadores por fonte, criados uma vez: normalizar uma fonte longa custa. */
export function localizadoresDe(fontes: readonly FonteDoDocumento[]): Map<string, Locator> {
  return new Map(fontes.map((f) => [f.id, createLocator(f.texto)]));
}

/** As citações do bloco que existem numa fonte selecionada. */
function citacoesLocalizadas(
  bruto: BlocoBruto,
  locators: Map<string, Locator>,
): ReferenciaDeFonte[] {
  const achadas: ReferenciaDeFonte[] = [];
  for (const ref of bruto.fontes ?? []) {
    if (!ref?.fonteId || !ref.trecho) continue;
    const locator = locators.get(ref.fonteId);
    if (!locator) continue; // fonte não selecionada: não vale.
    if (locator.locate(ref.trecho)) achadas.push({ fonteId: ref.fonteId, trecho: ref.trecho });
  }
  return achadas;
}

const resumo = (texto: string): string => (texto.length > 80 ? `${texto.slice(0, 77)}…` : texto);

interface ContextoDeBloco {
  locators: Map<string, Locator>;
  /** Origem gravada no bloco: o agente cria; uma pessoa só edita à mão. */
  origem: 'agente' | 'pessoa';
}

/**
 * Um bloco bruto do modelo → bloco validado, ou o motivo de ter ficado de fora.
 * É AQUI que a regra de sustentação vive.
 */
export function blocoDoModelo(
  bruto: BlocoBruto,
  blockId: string,
  ctx: ContextoDeBloco,
): { bloco: Bloco } | { problema: ProblemaDeQualidade } {
  // Sumário e referência não afirmam fato novo: um aponta para os títulos do
  // próprio documento, a outra é nota de fonte. Não passam pela checagem de
  // citação (que existe para afirmação), só pela validação de formato.
  //
  // Capa e título entram aqui também: são rótulos. Em produção o modelo
  // classificou o novo título da capa como `fato`, sem citação, e a troca foi
  // recusada como "afirmação sem sustentação".
  if (
    bruto.tipo === 'sumario' ||
    bruto.tipo === 'referencia' ||
    bruto.tipo === 'capa' ||
    bruto.tipo === 'titulo'
  ) {
    const candidato =
      bruto.tipo === 'sumario'
        ? { blockId, tipo: 'sumario', origem: ctx.origem }
        : bruto.tipo === 'referencia'
          ? { blockId, tipo: 'referencia', texto: bruto.texto, origem: ctx.origem }
          : bruto.tipo === 'capa'
            ? { blockId, tipo: 'capa', titulo: bruto.texto, subtitulo: bruto.subtitulo, origem: ctx.origem }
            : { blockId, tipo: 'titulo', nivel: bruto.nivel ?? 1, texto: bruto.texto, origem: ctx.origem };
    const r = blocoSchema.safeParse(candidato);
    return r.success
      ? { bloco: r.data }
      : { problema: { tipo: 'estrutural', blockId, descricao: 'Bloco inválido descartado.' } };
  }

  const classificacao = bruto.classificacao === 'recomendacao' ? 'recomendacao' : 'fato';
  const fontes = classificacao === 'fato' ? citacoesLocalizadas(bruto, ctx.locators) : [];
  const conteudo =
    bruto.texto ?? bruto.itens?.join(' ') ?? bruto.linhas?.map((l) => l.join(' ')).join(' ') ?? '';

  if (classificacao === 'fato' && fontes.length === 0) {
    return {
      problema: {
        tipo: 'sustentacao',
        blockId,
        descricao: `Afirmação sem sustentação nas fontes selecionadas foi removida: "${resumo(conteudo)}"`,
      },
    };
  }

  const comum = { blockId, classificacao, fontes, origem: ctx.origem } as const;
  let candidato: unknown;
  switch (bruto.tipo) {
    case 'paragrafo':
      candidato = { ...comum, tipo: 'paragrafo', texto: bruto.texto };
      break;
    case 'lista':
      candidato = {
        ...comum,
        tipo: 'lista',
        itens: (bruto.itens ?? []).filter((i) => i?.trim()),
      };
      break;
    case 'tabela': {
      const colunas = (bruto.cabecalho ?? []).map((c) => String(c ?? '').trim()).filter(Boolean);
      candidato = {
        ...comum,
        tipo: 'tabela',
        cabecalho: colunas,
        // Uma célula por coluna: o que sobra é descartado, o que falta fica vazio.
        linhas: (bruto.linhas ?? []).map((l) => colunas.map((_, i) => String(l?.[i] ?? ''))),
        ...(bruto.legenda?.trim() ? { legenda: bruto.legenda.trim() } : {}),
      };
      break;
    }
    case 'titulo':
      candidato = { ...comum, tipo: 'titulo', nivel: bruto.nivel ?? 1, texto: bruto.texto };
      break;
    case 'capa':
      candidato = { ...comum, tipo: 'capa', titulo: bruto.texto, subtitulo: bruto.subtitulo };
      break;
    default:
      return { problema: { tipo: 'estrutural', blockId, descricao: `Tipo de bloco "${bruto.tipo}" não é suportado.` } };
  }

  const resultado = blocoSchema.safeParse(candidato);
  if (!resultado.success) {
    return {
      problema: { tipo: 'estrutural', blockId, descricao: `Bloco inválido descartado: "${resumo(conteudo)}"` },
    };
  }
  return { bloco: resultado.data };
}

/** A árvore a partir da saída do modelo + o que a pessoa informou. */
export function construirArvore(
  saida: SaidaDeGeracao,
  fontes: readonly FonteDoDocumento[],
  capa: CapaInformada = {},
): { arvore: ContentTree; problemas: ProblemaDeQualidade[]; lacunas: LacunaDoDocumento[] } {
  const locators = localizadoresDe(fontes);
  const problemas: ProblemaDeQualidade[] = [];
  const blocos: Bloco[] = [];

  const titulo = saida.titulo?.trim() || 'Documento';
  blocos.push(
    blocoSchema.parse({
      tipo: 'capa',
      blockId: 'capa',
      titulo,
      ...(saida.subtitulo?.trim() ? { subtitulo: saida.subtitulo.trim() } : {}),
      // Estes três vêm da pessoa — nunca do modelo.
      ...(capa.cliente ? { cliente: capa.cliente } : {}),
      ...(capa.autor ? { autor: capa.autor } : {}),
      ...(capa.data ? { data: capa.data } : {}),
    }),
  );

  (saida.secoes ?? []).forEach((secao, indice) => {
    const id = `s${indice + 1}`;
    const doCorpo: Bloco[] = [];
    (secao.blocos ?? []).forEach((bruto, j) => {
      const r = blocoDoModelo(bruto, `${id}-b${j + 1}`, { locators, origem: 'agente' });
      if ('bloco' in r) doCorpo.push(r.bloco);
      else problemas.push(r.problema);
    });
    // Seção que perdeu todo o conteúdo some inteira, com o título.
    if (doCorpo.length === 0 || !secao.titulo?.trim()) return;
    blocos.push(blocoSchema.parse({ tipo: 'titulo', blockId: `${id}-titulo`, nivel: 1, texto: secao.titulo.trim() }), ...doCorpo);
  });

  // Sumário só quando o modelo pediu E há seções suficientes para valer a página.
  const secoesFinais = blocos.filter((b) => b.tipo === 'titulo').length;
  if (saida.sumario === true && secoesFinais >= 2) {
    blocos.splice(1, 0, blocoSchema.parse({ tipo: 'sumario', blockId: 'sumario' }));
  }

  const lacunas = (saida.lacunas ?? [])
    .filter((l) => l?.campo?.trim() && l.pergunta?.trim())
    .map((l) => ({ campo: l.campo!.trim(), pergunta: l.pergunta!.trim() }));

  return {
    arvore: contentTreeSchema.parse({ revisao: 1, titulo, blocos, lacunas }),
    problemas,
    lacunas,
  };
}

// ---------------------------------------------------------------------------
// Qualidade
// ---------------------------------------------------------------------------

function relatorioDe(
  arvore: ContentTree,
  compilado: Compilado,
  problemas: ProblemaDeQualidade[],
  extensao: DocumentBrief['extensao'],
): QualityReport {
  // Os achados medidos do layout entram ao lado dos de sustentação.
  const todos = [...problemas, ...compilado.inspecao];
  const paginas = compilado.manifesto.paginas;
  if (extensao && paginas && paginas > extensao.paginas) {
    todos.push({
      tipo: 'visual',
      descricao:
        extensao.tipo === 'firme'
          ? `O documento tem ${paginas} páginas e o limite pedido é ${extensao.paginas}. Nada foi cortado: ajuste o pedido ou aceite a extensão.`
          : `O documento tem ${paginas} páginas; a preferência era cerca de ${extensao.paginas}.`,
    });
  }
  return {
    problemas: todos,
    verificacoesRealizadas: [
      'Estrutura da árvore (ids únicos, capa no início, blocos suportados)',
      'Citações dos fatos localizadas nas fontes selecionadas',
      `Páginas contadas na renderização: ${paginas ?? '?'}`,
      'Layout medido por código: página quase vazia, título no pé da página e sobra na última página',
    ],
    limitacoes: [
      'As páginas renderizadas não foram inspecionadas visualmente por um revisor; só o layout foi medido por código (sobreposição, contraste e glifos não são checados).',
      ...(arvore.blocos.some((b) => b.classificacao === 'recomendacao')
        ? ['Há recomendações do agente no texto; elas não são decisões.']
        : []),
    ],
    fontesCitadas: arvore.blocos.flatMap((b) => b.fontes),
  };
}

// ---------------------------------------------------------------------------
// Geração
// ---------------------------------------------------------------------------

type Raciocinio = 'low' | 'medium' | 'high';
const NIVEIS: readonly Raciocinio[] = ['low', 'medium', 'high'];

/**
 * O esforço de raciocínio de cada chamada. Gerar o documento é o que decide
 * estrutura e o que entra, então tem o padrão mais alto; alterar um bloco é
 * trabalho pontual. `DOCUMENTOS_RACIOCINIO_GERACAO` e `..._EDICAO` trocam o
 * nível sem recompilar — existem para medir tempo × qualidade, e valor
 * inválido cai no padrão em vez de falhar.
 */
function nivel(variavel: string, padrao: Raciocinio): Raciocinio {
  const valor = process.env[variavel]?.trim().toLowerCase();
  return NIVEIS.find((n) => n === valor) ?? padrao;
}
export const raciocinioDoRedator = (): Raciocinio => nivel('DOCUMENTOS_RACIOCINIO_GERACAO', 'medium');
export const raciocinioDaEdicao = (): Raciocinio => nivel('DOCUMENTOS_RACIOCINIO_EDICAO', 'low');

const serializarFontes = (fontes: readonly FonteDoDocumento[]): string =>
  fontes.map((f) => `### FONTE ${f.id} — ${f.titulo}\n${f.texto}`).join('\n\n');

function validarEntrada(entrada: PedidoDeDocumento): void {
  if (!entrada.pedido?.trim()) throw new ErroDeGeracao('O pedido está vazio.');
  const fontes = entrada.fontes ?? [];
  if (fontes.length === 0 || fontes.every((f) => !f.texto?.trim())) {
    throw new ErroDeGeracao('Nenhuma fonte com conteúdo foi selecionada para o documento.');
  }
  const ids = new Set<string>();
  for (const f of fontes) {
    if (!f.id?.trim()) throw new ErroDeGeracao('Toda fonte precisa de um id.');
    if (ids.has(f.id)) throw new ErroDeGeracao(`Fonte "${f.id}" repetida.`);
    ids.add(f.id);
  }
}

const orientacoesEPedido = (entrada: PedidoDeDocumento): string =>
  [
    '# Pedido',
    entrada.pedido.trim(),
    ...(entrada.extensao
      ? [
          '',
          `# Extensão — ${entrada.extensao.tipo === 'firme' ? 'limite' : 'preferência'}`,
          `Cerca de ${entrada.extensao.paginas} página(s)${entrada.extensao.incluiCapa === false ? ', sem contar a capa' : ''}.`,
        ]
      : []),
    ...(entrada.orientacoesEditoriais?.length
      ? ['', '# Orientações editoriais', ...entrada.orientacoesEditoriais.map((o) => `- ${o}`)]
      : []),
  ].join('\n');

export async function gerarDocumentoPersonalizado(
  entrada: PedidoDeDocumento,
): Promise<ResultadoDoDocumento> {
  validarEntrada(entrada);

  const resposta = await complete('leitor', {
    system: renderPrompt('redator', 'v1'),
    messages: [{ role: 'user', content: orientacoesEPedido(entrada) }],
    maxTokens: 12000,
    jsonSchema: SCHEMA_DE_GERACAO,
    // As fontes vão no prefixo: é o que o provedor pode reaproveitar entre
    // geração e edições seguintes.
    cacheablePrefix: serializarFontes(entrada.fontes),
    reasoning: raciocinioDoRedator(),
  });

  const saida = (resposta.parsed ?? {}) as SaidaDeGeracao;
  const { arvore, problemas, lacunas } = construirArvore(saida, entrada.fontes, entrada.capa);

  if (arvore.blocos.length <= 1) {
    throw new ErroDeGeracao(
      'Nenhum trecho do documento ficou sustentado pelas fontes selecionadas, então não há o que gerar.',
    );
  }

  const compilado = await compilarPdf(arvore, entrada.variante ? { variante: entrada.variante } : {});
  return {
    arvore,
    pdf: compilado.pdf,
    manifesto: compilado.manifesto,
    avisos: compilado.avisos,
    lacunas,
    relatorio: relatorioDe(arvore, compilado, problemas, entrada.extensao),
    usage: resposta.usage,
  };
}

// ---------------------------------------------------------------------------
// Edição por patch
// ---------------------------------------------------------------------------

export interface PedidoDeEdicao {
  arvore: ContentTree;
  /** A revisão que a pessoa estava vendo. Diferente da atual → conflito. */
  revisaoEsperada: number;
  pedido: string;
  fontes: FonteDoDocumento[];
  /** Blocos selecionados na tela. Ausente = o pedido vale para o documento. */
  escopo?: string[];
  variante?: string;
}

interface OperacaoBruta {
  op?: string;
  blockId?: string;
  bloco?: BlocoBruto;
}

interface SaidaDeEdicao {
  operacoes?: OperacaoBruta[];
  lacunas?: { campo?: string; pergunta?: string }[];
  observacao?: string;
}

const SCHEMA_DE_EDICAO: JsonSchema = {
  type: 'object',
  properties: {
    operacoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['substituir', 'remover', 'inserir_depois'] },
          blockId: { type: 'string', description: 'Bloco alvo. Vazio em inserir_depois = no começo.' },
          bloco: {
            type: 'object',
            properties: {
              tipo: { type: 'string', enum: ['paragrafo', 'lista', 'tabela', 'referencia', 'sumario', 'titulo', 'capa'] },
              texto: { type: 'string' },
              subtitulo: { type: 'string' },
              nivel: { type: 'number' },
              itens: { type: 'array', items: { type: 'string' } },
              cabecalho: { type: 'array', items: { type: 'string' } },
              linhas: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
              legenda: { type: 'string' },
              classificacao: { type: 'string', enum: ['fato', 'recomendacao'] },
              fontes: FONTES_SCHEMA,
            },
            required: ['tipo', 'classificacao', 'fontes'],
          },
        },
        required: ['op'],
      },
    },
    lacunas: LACUNAS_SCHEMA,
    observacao: { type: 'string' },
  },
  required: ['operacoes', 'lacunas'],
};

/** O documento como o modelo o lê: um item por bloco, com id e conteúdo. */
export function descreverBlocos(arvore: ContentTree): string {
  return arvore.blocos
    .map((b) => {
      const corpo =
        b.tipo === 'lista'
          ? b.itens.map((i) => `  - ${i}`).join('\n')
          : b.tipo === 'tabela'
            ? [b.cabecalho.join(' | '), ...b.linhas.map((l) => l.join(' | '))].join('\n')
            : b.tipo === 'capa'
            ? `${b.titulo}${b.subtitulo ? ` | ${b.subtitulo}` : ''}`
            : 'texto' in b
              ? b.texto
              : '';
      return `[${b.blockId}] (${b.tipo}${b.origem === 'pessoa' ? ', escrito por uma pessoa' : ''})\n${corpo}`;
    })
    .join('\n\n');
}

export interface ResultadoDaEdicao extends ResultadoDoDocumento {
  aplicadas: number;
  recusadas: string[];
  observacao?: string;
}

export async function editarDocumentoPersonalizado(entrada: PedidoDeEdicao): Promise<ResultadoDaEdicao> {
  if (!entrada.pedido?.trim()) throw new ErroDeGeracao('O pedido de alteração está vazio.');
  const { arvore } = entrada;
  const escopo = entrada.escopo?.length ? new Set(entrada.escopo) : null;
  if (escopo) {
    for (const id of escopo) {
      if (!arvore.blocos.some((b) => b.blockId === id)) {
        throw new ErroDeGeracao(`O bloco "${id}" selecionado não existe nesta revisão.`);
      }
    }
  }

  const resposta = await complete('leitor', {
    system: renderPrompt('redator', 'v2'),
    messages: [
      {
        role: 'user',
        content: [
          '# Documento atual',
          descreverBlocos(arvore),
          '',
          escopo ? `# Blocos em escopo\n${[...escopo].join(', ')}` : '# Escopo\nO documento todo.',
          '',
          '# Pedido de alteração',
          entrada.pedido.trim(),
        ].join('\n'),
      },
    ],
    maxTokens: 8000,
    jsonSchema: SCHEMA_DE_EDICAO,
    ...(entrada.fontes.length > 0 ? { cacheablePrefix: serializarFontes(entrada.fontes) } : {}),
    reasoning: raciocinioDaEdicao(),
  });

  const saida = (resposta.parsed ?? {}) as SaidaDeEdicao;
  const locators = localizadoresDe(entrada.fontes);
  const existentes = new Map(arvore.blocos.map((b) => [b.blockId, b]));
  const problemas: ProblemaDeQualidade[] = [];
  const recusadas: string[] = [];
  const patches: PatchDeBlocos[] = [];
  let sequencia = 0;
  const novoId = () => `e${arvore.revisao + 1}-${++sequencia}`;

  for (const op of saida.operacoes ?? []) {
    const alvo = op.blockId ? existentes.get(op.blockId) : undefined;
    const descricao = `${op.op} ${op.blockId ?? '(início)'}`;

    if (op.blockId && !alvo) {
      recusadas.push(`${descricao}: o bloco não existe.`);
      continue;
    }
    if (escopo && op.blockId && !escopo.has(op.blockId)) {
      recusadas.push(`${descricao}: fora do escopo selecionado.`);
      continue;
    }
    if (escopo && !op.blockId) {
      recusadas.push(`${descricao}: inserção no começo fora do escopo selecionado.`);
      continue;
    }
    // Edição humana sobrevive: só se mexe nela quando o pedido a nomeia.
    if (alvo?.origem === 'pessoa' && !escopo?.has(alvo.blockId)) {
      recusadas.push(`${descricao}: o bloco foi escrito por uma pessoa e não foi selecionado.`);
      continue;
    }

    if (op.op === 'remover') {
      if (alvo?.tipo === 'capa') {
        recusadas.push(`${descricao}: a capa não pode ser removida.`);
        continue;
      }
      patches.push({ op: 'remover', blockId: op.blockId! });
      continue;
    }

    if ((op.op !== 'substituir' && op.op !== 'inserir_depois') || !op.bloco) {
      recusadas.push(`${descricao}: operação inválida.`);
      continue;
    }

    const id = op.op === 'substituir' ? op.blockId! : novoId();
    const r = blocoDoModelo(op.bloco, id, { locators, origem: 'agente' });
    if (!('bloco' in r)) {
      problemas.push(r.problema);
      continue;
    }
    let bloco = r.bloco;
    // Capa: cliente, autor e data são da pessoa e sobrevivem à troca do título.
    if (op.op === 'substituir' && alvo?.tipo === 'capa' && bloco.tipo === 'capa') {
      bloco = { ...bloco, cliente: alvo.cliente, autor: alvo.autor, data: alvo.data };
    }
    if (op.op === 'substituir' && alvo && alvo.tipo !== bloco.tipo) {
      recusadas.push(`${descricao}: a troca mudaria o tipo do bloco.`);
      continue;
    }
    patches.push(
      op.op === 'substituir'
        ? { op: 'substituir', blockId: id, bloco }
        : { op: 'inserir_depois', blockId: op.blockId ?? null, bloco },
    );
  }

  const nova = patches.length > 0 ? aplicarPatch(arvore, entrada.revisaoEsperada, patches) : arvore;
  if (patches.length === 0 && arvore.revisao !== entrada.revisaoEsperada) {
    // Sem mudança, mas a pessoa estava olhando outra revisão: avisa igual.
    aplicarPatch(arvore, entrada.revisaoEsperada, []);
  }

  const estruturais = validarArvore(nova);
  if (estruturais.length > 0) {
    throw new ErroDeGeracao(
      `A alteração deixaria o documento inválido: ${estruturais.map((p) => p.problema).join(' ')}`,
    );
  }

  const lacunas = (saida.lacunas ?? [])
    .filter((l) => l?.campo?.trim() && l.pergunta?.trim())
    .map((l) => ({ campo: l.campo!.trim(), pergunta: l.pergunta!.trim() }));
  const arvoreFinal = { ...nova, lacunas: [...nova.lacunas, ...lacunas] };

  const compilado = await compilarPdf(arvoreFinal, entrada.variante ? { variante: entrada.variante } : {});
  return {
    arvore: arvoreFinal,
    pdf: compilado.pdf,
    manifesto: compilado.manifesto,
    avisos: compilado.avisos,
    lacunas,
    relatorio: relatorioDe(arvoreFinal, compilado, problemas, undefined),
    usage: resposta.usage,
    aplicadas: patches.length,
    recusadas,
    ...(saida.observacao?.trim() ? { observacao: saida.observacao.trim() } : {}),
  };
}
