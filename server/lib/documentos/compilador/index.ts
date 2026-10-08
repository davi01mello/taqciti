/**
 * DocumentCompiler — da ContentTree ao PDF, aplicando a variante do perfil.
 *
 * Recebe uma árvore já validada e devolve o arquivo e o RenderManifest da
 * revisão. Se a árvore tem problema estrutural, ou a variante não pode ser
 * aplicada (fonte/ativo ausente sem substituição autorizada), LANÇA: a
 * resposta certa a um insumo ruim é parar, não gerar um PDF quase certo.
 *
 * `compilarPdf` gera o PDF; `compilarDocx` (em `./docx`) gera o Word editável a
 * partir da MESMA árvore; `compilarDocumento` entrega os dois (ou um) com um
 * manifesto só, da mesma revisão — nunca um PDF antigo com um DOCX novo. O
 * `formatos` do manifesto só lista o que foi de fato gerado.
 */
import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { registrarFontes } from '../../render/fonts';
import { validarArvore, type ContentTree, type ProblemaDaArvore } from '../contentTree';
import type { ProblemaDeQualidade, RenderManifest } from '../contratos';
import {
  PERFIL_CITI_PROVISORIO,
  diagnosticarVariante,
  resolverVariante,
  varianteAplicavel,
  type PerfilDocumental,
  type VarianteVisual,
} from '../perfil';
import { desenharAta, MARGENS_ATA } from './ata';
import { desenharEditorial, finalizarEditorial, MARGENS_EDITORIAL } from './editorial';
import { compilarDocx } from './docx';
import { bufferDoAtivo } from './imagens';
import { inspecionarLayout, novoRegistro } from './inspecao';
import { registrarFontesEditorial } from './recursos';

export const RENDERER_VERSAO = 'compilador-pdf-1';

export class ErroDeCompilacao extends Error {
  constructor(
    message: string,
    readonly problemas: readonly ProblemaDaArvore[] = [],
  ) {
    super(message);
    this.name = 'ErroDeCompilacao';
  }
}

export interface OpcoesDeCompilacao {
  perfil?: PerfilDocumental;
  /** Id da variante visual. Padrão: a primeira do perfil. */
  variante?: string;
}

export interface Compilado {
  pdf: Buffer;
  manifesto: RenderManifest;
  /** O que a pessoa precisa saber: título encolhido, subtítulo omitido etc. */
  avisos: string[];
  /** Substituições de fonte aplicadas, para mostrar no relatório. */
  substituicoes: string[];
  /** Achados MEDIDOS do layout (página quase vazia, título isolado…). Vazio = nada a apontar. */
  inspecao: ProblemaDeQualidade[];
  /** Página física (1 = capa) de cada título, como paginou. É o que o sumário imprime. */
  titulos: { blockId: string; pagina: number }[];
}

/** Valida o insumo e resolve o perfil e a variante. Lança se não dá para compilar. */
function preparar(arvore: ContentTree, opcoes: OpcoesDeCompilacao) {
  const perfil = opcoes.perfil ?? PERFIL_CITI_PROVISORIO;
  const variante = resolverVariante(perfil, opcoes.variante);

  if (arvore.blocos.length === 0) {
    throw new ErroDeCompilacao('O documento não tem conteúdo para compilar.');
  }

  const problemas = validarArvore(arvore);
  if (problemas.length > 0) {
    throw new ErroDeCompilacao(
      `A árvore do documento tem ${problemas.length} problema(s): ${problemas.map((p) => p.problema).join(' ')}`,
      problemas,
    );
  }
  if (!varianteAplicavel(variante)) {
    const faltas = diagnosticarVariante(variante).filter((d) => !d.substituicao);
    throw new ErroDeCompilacao(
      `A variante "${variante.id}" não pode ser aplicada: ${faltas.map((f) => f.item).join('; ')}.`,
    );
  }
  const semArquivo = arvore.blocos.flatMap((b) =>
    b.tipo === 'imagem' && bufferDoAtivo(variante, b.ativoId) === null ? [b] : [],
  );
  if (semArquivo.length > 0) {
    throw new ErroDeCompilacao(
      `Imagem com ativo que o perfil não tem utilizável: ${semArquivo.map((b) => b.tipo === 'imagem' ? b.ativoId : '').join(', ')}.`,
      semArquivo.map((b) => ({ blockId: b.blockId, problema: 'Ativo de imagem indisponível.' })),
    );
  }
  return { perfil, variante };
}

interface Renderizado extends Compilado {
  /** Página física de cada título — alimenta a segunda passada do sumário. */
  paginaDoTitulo: ReadonlyMap<string, number>;
}

/** Uma passada de renderização. `paginasDosTitulos` preenche o sumário, se houver. */
async function renderizar(
  arvore: ContentTree,
  perfil: PerfilDocumental,
  variante: VarianteVisual,
  paginasDosTitulos?: ReadonlyMap<string, number>,
): Promise<Renderizado> {
  const margens = variante.id === 'editorial' ? MARGENS_EDITORIAL : MARGENS_ATA;
  const doc = new PDFDocument({
    size: 'A4',
    autoFirstPage: false,
    bufferPages: true,
    // Mesma razão de `render/pdf.ts`: nada de Helvetica padrão.
    font: null as unknown as string,
    margins: { ...margens },
  });
  registrarFontes(doc);
  doc.info.Title = arvore.titulo;

  const pedacos: Buffer[] = [];
  doc.on('data', (pedaco: Buffer) => pedacos.push(pedaco));
  const pronto = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(pedacos)));
    doc.on('error', reject);
  });

  const avisos: string[] = [];
  const recursosUsados = new Set<string>();
  const layout = novoRegistro();
  // Onde o corpo começa e termina, por variante — a geometria de quem desenha.
  const limites =
    variante.id === 'editorial'
      ? { topo: MARGENS_EDITORIAL.top, base: 841.89 - MARGENS_EDITORIAL.bottom }
      : { topo: MARGENS_ATA.top, base: 841.89 - MARGENS_ATA.bottom };
  try {
    if (variante.id === 'editorial') {
      registrarFontesEditorial(doc);
      const ctx = {
        doc,
        arvore,
        variante,
        avisos,
        secaoPorPagina: [] as string[],
        recursosUsados,
        layout,
        ...(paginasDosTitulos ? { paginasDosTitulos } : {}),
      };
      desenharEditorial(ctx);
      finalizarEditorial(ctx);
    } else {
      desenharAta({ doc, arvore, avisos, recursosUsados, layout, variante, ...(paginasDosTitulos ? { paginasDosTitulos } : {}) });
    }
    // Sem nenhuma página, o pdfkit produz um arquivo inválido.
    if (doc.bufferedPageRange().count === 0) {
      throw new ErroDeCompilacao('O documento não tem conteúdo para compilar.');
    }
  } catch (erro) {
    doc.end();
    return pronto.then(
      () => Promise.reject(erro),
      () => Promise.reject(erro),
    );
  }

  const paginas = doc.bufferedPageRange().count;
  const inspecao = inspecionarLayout(layout, paginas, limites);
  doc.end();

  return pronto.then((pdf) => ({
    paginaDoTitulo: layout.paginaDoTitulo,
    titulos: [...layout.paginaDoTitulo].map(([blockId, pagina]) => ({ blockId, pagina })),
    pdf,
    avisos,
    inspecao,
    substituicoes: diagnosticarVariante(variante).map(
      (d) => `${d.item} → ${d.substituicao}`,
    ),
    manifesto: {
      revisaoDoConteudo: arvore.revisao,
      perfilId: perfil.id,
      perfilVersao: perfil.versao,
      perfilEstado: perfil.estado,
      rendererVersao: RENDERER_VERSAO,
      ativosEFontes: [...recursosUsados].sort(),
      formatos: [{ formato: 'pdf' as const, hash: createHash('sha256').update(pdf).digest('hex') }],
      // Medido nesta renderização — não estimado.
      paginas,
    },
  }));
}

/**
 * O PDF da árvore. Com sumário, são DUAS passadas (ver `./sumario`): a
 * primeira mede em que página cada título caiu, a segunda desenha o sumário
 * com esses números. Sem sumário, uma só.
 */
export async function compilarPdf(
  arvore: ContentTree,
  opcoes: OpcoesDeCompilacao = {},
): Promise<Compilado> {
  const { perfil, variante } = preparar(arvore, opcoes);
  const primeira = await renderizar(arvore, perfil, variante);
  if (!arvore.blocos.some((b) => b.tipo === 'sumario')) return primeira;

  const segunda = await renderizar(arvore, perfil, variante, primeira.paginaDoTitulo);
  // O sumário ocupa o mesmo espaço nas duas passadas; se mesmo assim a
  // paginação andou, os números impressos estariam errados — e isso se diz.
  const moveu = [...primeira.paginaDoTitulo].some(([id, pagina]) => segunda.paginaDoTitulo.get(id) !== pagina);
  return moveu
    ? {
        ...segunda,
        avisos: [...segunda.avisos, 'A paginação mudou ao preencher o sumário: confira os números de página.'],
      }
    : segunda;
}
export type FormatoDeSaida = 'pdf' | 'docx';

export interface DocumentoCompilado {
  pdf?: Buffer;
  docx?: Buffer;
  /** Um manifesto só: os dois arquivos são da mesma revisão. */
  manifesto: RenderManifest;
  avisos: string[];
  substituicoes: string[];
  inspecao: ProblemaDeQualidade[];
}

/**
 * Os formatos pedidos, todos da MESMA árvore. O número de páginas só é medido
 * quando o PDF é gerado — o Word pagina sozinho, e dizer um número para ele
 * seria inventá-lo.
 */
export async function compilarDocumento(
  arvore: ContentTree,
  opcoes: OpcoesDeCompilacao & { formatos: readonly FormatoDeSaida[] },
): Promise<DocumentoCompilado> {
  const formatos = [...new Set(opcoes.formatos)];
  if (formatos.length === 0) throw new ErroDeCompilacao('Nenhum formato de saída foi pedido.');

  const { perfil, variante } = preparar(arvore, opcoes);
  const { formatos: _formatos, ...doCompilador } = opcoes;

  const pdf = formatos.includes('pdf') ? await compilarPdf(arvore, doCompilador) : undefined;
  const word = formatos.includes('docx') ? await compilarDocx(arvore, variante) : undefined;

  const hashes: RenderManifest['formatos'] = [
    ...(pdf ? [{ formato: 'pdf' as const, hash: createHash('sha256').update(pdf.pdf).digest('hex') }] : []),
    ...(word ? [{ formato: 'docx' as const, hash: createHash('sha256').update(word.docx).digest('hex') }] : []),
  ];
  const base: RenderManifest = pdf?.manifesto ?? {
    revisaoDoConteudo: arvore.revisao,
    perfilId: perfil.id,
    perfilVersao: perfil.versao,
    perfilEstado: perfil.estado,
    rendererVersao: RENDERER_VERSAO,
    ativosEFontes: [],
    formatos: [],
  };

  return {
    ...(pdf ? { pdf: pdf.pdf } : {}),
    ...(word ? { docx: word.docx } : {}),
    manifesto: { ...base, formatos: hashes },
    avisos: [...(pdf?.avisos ?? []), ...(word?.avisos ?? [])],
    // O Word pagina sozinho: sem PDF, não há layout a medir.
    inspecao: pdf?.inspecao ?? [],
    substituicoes: pdf?.substituicoes ?? diagnosticarVariante(variante).map((d) => `${d.item} → ${d.substituicao}`),
  };
}