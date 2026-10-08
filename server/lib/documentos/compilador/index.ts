/**
 * DocumentCompiler — da ContentTree ao PDF, aplicando a variante do perfil.
 *
 * Recebe uma árvore já validada e devolve o arquivo e o RenderManifest da
 * revisão. Se a árvore tem problema estrutural, ou a variante não pode ser
 * aplicada (fonte/ativo ausente sem substituição autorizada), LANÇA: a
 * resposta certa a um insumo ruim é parar, não gerar um PDF quase certo.
 *
 * Só o PDF é produzido nesta etapa. O DOCX é um formato à parte, com o seu
 * próprio compilador — e `formatos` do manifesto só lista o que existe.
 */
import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { registrarFontes } from '../../render/fonts';
import { validarArvore, type ContentTree, type ProblemaDaArvore } from '../contentTree';
import type { RenderManifest } from '../contratos';
import {
  PERFIL_CITI_PROVISORIO,
  diagnosticarVariante,
  resolverVariante,
  varianteAplicavel,
  type PerfilDocumental,
} from '../perfil';
import { desenharAta, MARGENS_ATA } from './ata';
import { desenharEditorial, finalizarEditorial, MARGENS_EDITORIAL } from './editorial';
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
}

export async function compilarPdf(
  arvore: ContentTree,
  opcoes: OpcoesDeCompilacao = {},
): Promise<Compilado> {
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
      };
      desenharEditorial(ctx);
      finalizarEditorial(ctx);
    } else {
      desenharAta({ doc, arvore, avisos, recursosUsados });
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
  doc.end();

  return pronto.then((pdf) => ({
    pdf,
    avisos,
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
