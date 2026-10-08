/**
 * DOCX editável da mesma árvore que gera o PDF.
 *
 * Não é uma conversão do PDF: cada bloco vira o elemento nativo do Word —
 * título com estilo de título, lista com numeração de verdade, tabela com
 * cabeçalho que se repete entre páginas — e as medidas, cores e fontes saem do
 * mesmo perfil. É o que torna o arquivo EDITÁVEL: quem abre no Word mexe nos
 * estilos, não em caixas de texto soltas.
 *
 * Limites, ditos para quem usa:
 * - A fonte é a Barlow (substituta autorizada da Neue Haas Display). O Word só
 *   a mostra se ela estiver instalada; sem ela, usa outra e a paginação muda.
 *   O PDF embute a fonte e não tem esse problema.
 * - A capa é tipográfica: sem a arte de fundo do PDF.
 * - Edições feitas no Word NÃO voltam para o TaqCiti: a árvore continua sendo a
 *   fonte, e reimportar o arquivo editado não é suportado.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
  type ISectionOptions,
} from 'docx';
import type { Bloco, ContentTree } from '../contentTree';
import type { EstiloDoPerfil, PapelDeEstilo, VarianteVisual } from '../perfil';
import { larguraDasColunas } from './tabela';
import { segmentos, textoPlano } from './texto';

/** Largura e altura A4 em twips (1/20 de ponto). */
const A4_LARGURA_TW = 11906;
const A4_ALTURA_TW = 16838;

const tw = (pt: number): number => Math.round(pt * 20);
const meiosPontos = (pt: number): number => Math.round(pt * 2);
const semHash = (cor: string): string => cor.replace('#', '').toUpperCase();

/** Fonte do perfil → família no DOCX. Só substituições que o perfil autoriza. */
export function familiaDoDocx(nome: string): string {
  if (nome.startsWith('Neue Haas')) return 'Barlow';
  if (nome.startsWith('Monoes')) return 'JetBrains Mono';
  return nome.replace(/-Bold$/, '');
}

const ehNegrito = (nome: string): boolean => /(Medium|Bold)$/.test(nome);

function estilo(variante: VarianteVisual, papel: PapelDeEstilo): EstiloDoPerfil {
  const regra = variante.estilos[papel];
  if (!regra) throw new Error(`Papel de estilo "${papel}" ausente na variante ${variante.id}.`);
  return regra.valor;
}

const corDa = (variante: VarianteVisual, nome: string, padrao: string): string =>
  semHash(variante.cores[nome]?.valor ?? padrao);

/** Corpo do texto com **negrito**, em runs do Word. */
function runs(texto: string, base: { font: string; size: number; color: string; bold?: boolean }): TextRun[] {
  return segmentos(texto).map(
    (s) => new TextRun({ text: s.texto, font: base.font, size: base.size, color: base.color, bold: s.negrito || base.bold }),
  );
}

export interface ResultadoDocx {
  docx: Buffer;
  avisos: string[];
}

export async function compilarDocx(arvore: ContentTree, variante: VarianteVisual): Promise<ResultadoDocx> {
  const margemPt = variante.pagina.margemPt.valor;
  const larguraUtilTw = A4_LARGURA_TW - tw(margemPt) * 2;
  const larguraUtilPt = larguraUtilTw / 20;

  const corpo = estilo(variante, 'corpo');
  const tinta = corDa(variante, 'tinta', '#000000');
  const texto = corDa(variante, 'texto', '#000000');
  const secundario = corDa(variante, 'textoSecundario', '#666666');
  const verde = corDa(variante, 'verde', '#000000');
  const filete = corDa(variante, 'filete', '#888888');
  const familiaCorpo = familiaDoDocx(corpo.fonte);
  // Na variante da Ata o texto e os títulos são pretos; na editorial, o perfil manda.
  const corTexto = variante.id === 'editorial' ? texto : tinta;

  const estiloDeTitulo = (papel: PapelDeEstilo, id: string, name: string, outline: number) => {
    const e = estilo(variante, papel);
    return {
      id,
      name,
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { font: familiaDoDocx(e.fonte), size: meiosPontos(e.tamanhoPt), bold: ehNegrito(e.fonte), color: tinta },
      paragraph: {
        keepNext: true,
        outlineLevel: outline,
        spacing: { before: tw(outline === 0 ? 14 : 10), after: tw(e.espacoDepoisPt), line: Math.round(e.entrelinha * 240) },
      },
    };
  };

  const marcador = variante.id === 'editorial' ? '■' : '•';
  const doc = new Document({
    creator: 'TaqCiti',
    title: arvore.titulo,
    styles: {
      default: {
        document: {
          run: { font: familiaCorpo, size: meiosPontos(corpo.tamanhoPt), color: corTexto },
          paragraph: { spacing: { line: Math.round(corpo.entrelinha * 240), after: tw(corpo.espacoDepoisPt) } },
        },
      },
      paragraphStyles: [
        estiloDeTitulo('titulo_secao', 'Heading1', 'Heading 1', 0),
        estiloDeTitulo('subtitulo_secao', 'Heading2', 'Heading 2', 1),
        estiloDeTitulo('rotulo', 'Heading3', 'Heading 3', 2),
      ],
    },
    numbering: {
      config: [
        {
          reference: 'marcadores',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: marcador,
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 540, hanging: 320 } },
                run: { color: variante.id === 'editorial' ? verde : tinta, size: meiosPontos(variante.id === 'editorial' ? 7 : corpo.tamanhoPt) },
              },
            },
          ],
        },
        {
          reference: 'ordenada',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 540, hanging: 360 } },
                run: { color: variante.id === 'editorial' ? verde : tinta, bold: true },
              },
            },
          ],
        },
      ],
    },
    sections: montarSecoes(),
  });

  function montarSecoes(): ISectionOptions[] {
    const capa = arvore.blocos.find((b): b is Extract<Bloco, { tipo: 'capa' }> => b.tipo === 'capa');
    const resto = arvore.blocos.filter((b) => b.tipo !== 'capa');
    const pagina = {
      size: { width: A4_LARGURA_TW, height: A4_ALTURA_TW },
      margin: { top: tw(margemPt), bottom: tw(margemPt), left: tw(margemPt), right: tw(margemPt) },
    };
    const secoes: ISectionOptions[] = [];

    if (capa) {
      const eTitulo = estilo(variante, 'titulo_documento');
      const eSub = estilo(variante, 'subtitulo_capa');
      const linhasDaCapa = [capa.cliente, capa.autor].filter(Boolean).join(' · ');
      secoes.push({
        properties: { page: pagina },
        children: [
          new Paragraph({ spacing: { before: tw(150) }, children: [] }),
          new Paragraph({
            spacing: { after: tw(14), line: 240 },
            children: [
              new TextRun({
                text: capa.titulo,
                font: familiaDoDocx(eTitulo.fonte),
                // 72 pt de capa não cabe numa página de Word editável: 38 pt.
                size: meiosPontos(variante.id === 'editorial' ? 38 : 33),
                bold: true,
                color: tinta,
              }),
            ],
          }),
          ...(capa.subtitulo
            ? [
                new Paragraph({
                  spacing: { after: tw(40) },
                  children: [
                    new TextRun({
                      text: capa.subtitulo,
                      font: familiaDoDocx(eSub.fonte),
                      size: meiosPontos(variante.id === 'editorial' ? 16 : eSub.tamanhoPt),
                      color: variante.id === 'editorial' ? secundario : tinta,
                    }),
                  ],
                }),
              ]
            : []),
          ...(linhasDaCapa
            ? [new Paragraph({ children: [new TextRun({ text: linhasDaCapa, bold: true, size: meiosPontos(10), color: tinta })] })]
            : []),
          ...(capa.data ? [new Paragraph({ children: [new TextRun({ text: capa.data, size: meiosPontos(10), color: secundario })] })] : []),
        ],
      });
    }

    let instanciaOrdenada = 0;
    const filhos: (Paragraph | Table)[] = [];
    for (const bloco of resto) {
      switch (bloco.tipo) {
        case 'titulo':
          filhos.push(
            new Paragraph({
              heading:
                bloco.nivel === 1 ? HeadingLevel.HEADING_1 : bloco.nivel === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
              children: [new TextRun({ text: textoPlano(bloco.texto) })],
            }),
          );
          break;
        case 'paragrafo':
          filhos.push(
            new Paragraph({
              children: runs(bloco.texto, { font: familiaCorpo, size: meiosPontos(corpo.tamanhoPt), color: corTexto }),
            }),
          );
          break;
        case 'lista': {
          const ordenada = bloco.ordenada;
          if (ordenada) instanciaOrdenada += 1;
          const e = estilo(variante, 'item_lista');
          for (const item of bloco.itens) {
            filhos.push(
              new Paragraph({
                numbering: ordenada
                  ? { reference: 'ordenada', level: 0, instance: instanciaOrdenada }
                  : { reference: 'marcadores', level: 0 },
                spacing: { after: tw(e.espacoDepoisPt) },
                children: runs(item, { font: familiaCorpo, size: meiosPontos(e.tamanhoPt), color: corTexto }),
              }),
            );
          }
          break;
        }
        case 'tabela': {
          filhos.push(tabelaDoWord(bloco, larguraUtilPt));
          if (bloco.legenda) {
            const leg = estilo(variante, 'legenda');
            filhos.push(
              new Paragraph({
                spacing: { before: tw(4), after: tw(10) },
                children: [new TextRun({ text: bloco.legenda, italics: true, size: meiosPontos(leg.tamanhoPt), color: secundario })],
              }),
            );
          } else {
            filhos.push(new Paragraph({ spacing: { after: tw(6) }, children: [] }));
          }
          break;
        }
        case 'quebra_de_secao':
          filhos.push(new Paragraph({ pageBreakBefore: true, children: [] }));
          break;
        default:
          throw new Error(`Bloco "${bloco.tipo}" ainda não é suportado pelo compilador.`);
      }
    }

    const mono = 'JetBrains Mono';
    const pe = estilo(variante, 'rodape');
    secoes.push({
      properties: { page: pagina },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: filete, space: 4 } },
              children: [
                new TextRun({
                  text: arvore.titulo.toUpperCase().slice(0, 60),
                  font: variante.id === 'editorial' ? mono : familiaCorpo,
                  size: meiosPontos(variante.id === 'editorial' ? 6.5 : 8),
                  color: secundario,
                  characterSpacing: variante.id === 'editorial' ? 20 : 0,
                }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              tabStops: [{ type: TabStopType.RIGHT, position: larguraUtilTw }],
              children: [
                new TextRun({
                  text: `CITi · ${arvore.titulo}`.slice(0, 70),
                  font: variante.id === 'editorial' ? mono : familiaCorpo,
                  size: meiosPontos(variante.id === 'editorial' ? 6.5 : pe.tamanhoPt),
                  color: secundario,
                }),
                new TextRun({ text: '\t' }),
                new TextRun({ children: [PageNumber.CURRENT], bold: true, size: meiosPontos(9), color: tinta }),
              ],
            }),
          ],
        }),
      },
      children: filhos.length > 0 ? filhos : [new Paragraph({ children: [] })],
    });
    return secoes;
  }

  function tabelaDoWord(bloco: Extract<Bloco, { tipo: 'tabela' }>, larguraPt: number): Table {
    const e = estilo(variante, 'tabela_celula');
    const eCab = estilo(variante, 'tabela_cabecalho');
    const linhas = bloco.linhas.map((l) => bloco.cabecalho.map((_, i) => l[i] ?? ''));
    const larguras = larguraDasColunas(bloco.cabecalho, linhas, larguraPt).map(tw);
    // Soma dos arredondamentos pode sobrar/faltar twips: o último absorve.
    larguras[larguras.length - 1]! += larguraUtilTw - larguras.reduce((a, b) => a + b, 0);

    const escuro = variante.id === 'editorial';
    const fundoCab = escuro ? corDa(variante, 'fundoDestaqueEscuro', '#081021') : null;
    const listra = escuro ? corDa(variante, 'fundoTabelaSuave', '#F6F8F9') : null;
    const nenhuma = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const margens = { top: tw(6), bottom: tw(6), left: tw(8), right: tw(8) };

    const celula = (conteudo: string, i: number, cab: boolean, par: boolean) =>
      new TableCell({
        width: { size: larguras[i]!, type: WidthType.DXA },
        margins: margens,
        shading:
          cab && fundoCab
            ? { type: ShadingType.CLEAR, color: 'auto', fill: fundoCab }
            : !cab && listra && par
              ? { type: ShadingType.CLEAR, color: 'auto', fill: listra }
              : undefined,
        borders: {
          top: nenhuma,
          left: nenhuma,
          right: nenhuma,
          bottom: { style: BorderStyle.SINGLE, size: cab && !fundoCab ? 8 : 4, color: filete },
        },
        children: [
          new Paragraph({
            spacing: { after: 0 },
            children: cab
              ? [
                  new TextRun({
                    text: escuro ? textoPlano(conteudo).toUpperCase() : textoPlano(conteudo),
                    bold: true,
                    font: escuro ? 'JetBrains Mono' : familiaCorpo,
                    size: meiosPontos(escuro ? 7.5 : eCab.tamanhoPt),
                    color: escuro ? 'FFFFFF' : tinta,
                    characterSpacing: escuro ? 20 : 0,
                  }),
                ]
              : runs(conteudo, { font: familiaCorpo, size: meiosPontos(e.tamanhoPt), color: corTexto }),
          }),
        ],
      });

    return new Table({
      width: { size: larguraUtilTw, type: WidthType.DXA },
      columnWidths: larguras,
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({ tableHeader: true, cantSplit: true, children: bloco.cabecalho.map((c, i) => celula(c, i, true, false)) }),
        ...linhas.map(
          (l, r) => new TableRow({ cantSplit: true, children: l.map((c, i) => celula(c, i, false, r % 2 === 1)) }),
        ),
      ],
    });
  }

  const avisos: string[] = [];
  if (familiaCorpo === 'Barlow') {
    avisos.push('O DOCX usa a fonte Barlow: se ela não estiver instalada, o Word a substitui e a paginação pode mudar.');
  }
  if (arvore.blocos.some((b) => b.tipo === 'capa') && variante.id === 'editorial') {
    avisos.push('A capa do DOCX é tipográfica, sem a arte de fundo do PDF.');
  }

  return { docx: await Packer.toBuffer(doc), avisos };
}
