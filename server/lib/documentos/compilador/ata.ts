/**
 * Variante "ata" — o visual do modelo da Ata (`example.pdf`): capa com marca
 * preta e gráfico, marca no cabeçalho, rodapé institucional, texto em Barlow.
 *
 * Não redesenha nada: reaproveita as funções de layout de `render/pdf.ts`, o
 * mesmo código que produz a Ata e o X1. Um documento de estrutura nova nesta
 * variante sai, portanto, com a mesma moldura de uma Ata — e uma mudança no
 * modelo da Ata vale para os dois.
 */
import {
  CAPA_SUBTITULO_BASE_PT,
  desenharCapa,
  desenharCentralizado,
  desenharItemDeLista,
  desenharMoldura,
  desenharTituloSecao,
  fluxoDeItem,
  fluxoDeParagrafo,
} from '../../render/pdf';
import { FONTE_NEGRITO, FONTE_REGULAR } from '../../render/fonts';
import {
  COR_SUBTITULO_CAPA,
  GAP_PARAGRAFO_PT,
  TAMANHO_CORPO_PT,
  TAMANHO_ITEM_PT,
  TAMANHO_SUBTITULO_CAPA_PT,
  TAMANHO_TITULO_PT,
  TINTA,
} from '../../render/typography';
import type { Bloco, ContentTree } from '../contentTree';
import { escreverRico, textoPlano } from './texto';

type Doc = PDFKit.PDFDocument;

export interface ContextoAta {
  doc: Doc;
  arvore: ContentTree;
  avisos: string[];
  recursosUsados: Set<string>;
}

/** Margens do documento nesta variante: as da Ata. */
export const MARGENS_ATA = { top: 72, bottom: 140, left: 72, right: 72 } as const;

function desenharCapaDaAta(ctx: ContextoAta, capa: Extract<Bloco, { tipo: 'capa' }>): void {
  const { doc } = ctx;
  doc.addPage();
  desenharCapa(doc, capa.titulo, {}, [], false);
  ctx.recursosUsados.add('marca-preta');
  ctx.recursosUsados.add('capa-grafico');

  if (!capa.subtitulo) return;
  // O subtítulo mora numa linha de base fixa do modelo. Título que quebra em
  // duas linhas invadiria essa linha: melhor omitir o subtítulo e avisar do
  // que sobrepor texto sobre texto.
  doc.font(FONTE_NEGRITO).fontSize(TAMANHO_TITULO_PT);
  if (doc.widthOfString(capa.titulo) > doc.page.width - 144) {
    ctx.avisos.push(
      'O título é longo demais para a capa da Ata e o subtítulo foi omitido para não sobrepor o texto.',
    );
    return;
  }
  desenharCentralizado(doc, capa.subtitulo, TAMANHO_SUBTITULO_CAPA_PT, CAPA_SUBTITULO_BASE_PT, COR_SUBTITULO_CAPA);
}

function desenharCorpo(ctx: ContextoAta, bloco: Bloco): void {
  const { doc } = ctx;
  switch (bloco.tipo) {
    case 'titulo':
      if (bloco.nivel === 1) {
        desenharTituloSecao(doc, textoPlano(bloco.texto));
      } else {
        doc.font(FONTE_NEGRITO).fontSize(TAMANHO_CORPO_PT).fillColor(TINTA);
        doc.text(textoPlano(bloco.texto), fluxoDeParagrafo(doc, TAMANHO_CORPO_PT));
        doc.y += 4;
      }
      return;
    case 'paragrafo':
      doc.font(FONTE_REGULAR).fontSize(TAMANHO_CORPO_PT).fillColor(TINTA);
      escreverRico(doc, bloco.texto, FONTE_REGULAR, FONTE_NEGRITO, fluxoDeParagrafo(doc, TAMANHO_CORPO_PT));
      doc.y += GAP_PARAGRAFO_PT;
      return;
    case 'lista':
      bloco.itens.forEach((item, indice) => {
        desenharItemDeLista(doc, bloco.ordenada ? `${indice + 1}.` : '•', textoPlano(item), () => {
          doc.font(FONTE_REGULAR).fontSize(TAMANHO_ITEM_PT).fillColor(TINTA);
          escreverRico(doc, item, FONTE_REGULAR, FONTE_NEGRITO, fluxoDeItem(doc));
        });
      });
      doc.y += GAP_PARAGRAFO_PT;
      return;
    case 'quebra_de_secao':
      doc.addPage();
      return;
    default:
      throw new Error(`Bloco "${bloco.tipo}" ainda não é suportado pelo compilador.`);
  }
}

export function desenharAta(ctx: ContextoAta): void {
  const { doc, arvore } = ctx;
  // A moldura vale só depois da capa: `pageAdded` dispara também para ela.
  let molduraAtiva = false;
  doc.on('pageAdded', () => {
    if (molduraAtiva) desenharMoldura(doc);
  });

  const [primeiro, ...resto] = arvore.blocos;
  if (primeiro?.tipo === 'capa') {
    desenharCapaDaAta(ctx, primeiro);
    molduraAtiva = true;
    doc.addPage();
    resto.forEach((bloco) => desenharCorpo(ctx, bloco));
  } else {
    molduraAtiva = true;
    doc.addPage();
    arvore.blocos.forEach((bloco) => desenharCorpo(ctx, bloco));
  }
  ctx.recursosUsados.add('marca-preta');
}
