/**
 * Imagens do documento — só as APROVADAS no perfil.
 *
 * Um bloco de imagem aponta para um `ativoId` da variante (arte institucional,
 * marca). Não existe upload aqui: o modelo não cria nem busca imagem, e uma
 * imagem que ninguém aprovou no perfil não entra num documento com a marca do
 * CITi. Ativo ausente, ou sem arquivo, é erro de compilação — nunca um quadro
 * em branco.
 */
import { basename } from 'node:path';
import { marcaBuffer } from '../../render/brand';
import type { VarianteVisual } from '../perfil';
import { imagemEditorial } from './recursos';

type Doc = PDFKit.PDFDocument;

/** O arquivo do ativo, ou `null` se o perfil não o tem utilizável. */
export function bufferDoAtivo(variante: VarianteVisual, ativoId: string): Buffer | null {
  const ativo = variante.ativos.find((a) => a.id === ativoId);
  if (!ativo || ativo.disponibilidade !== 'presente' || !ativo.arquivo) return null;
  if (ativo.arquivo.includes('documentos/assets/editorial/')) return imagemEditorial(basename(ativo.arquivo));
  if (ativo.id === 'marca-preta') return marcaBuffer();
  return null;
}

export function ativosDeImagem(variante: VarianteVisual): string[] {
  return variante.ativos.filter((a) => bufferDoAtivo(variante, a.id) !== null).map((a) => a.id);
}

/** PNG ou JPEG, pelos primeiros bytes — o que o Word precisa saber. */
export function tipoDaImagem(buffer: Buffer): 'png' | 'jpg' {
  return buffer[0] === 0x89 && buffer[1] === 0x50 ? 'png' : 'jpg';
}

/**
 * Largura e altura em pixels, lidas do cabeçalho do arquivo (PNG: IHDR; JPEG:
 * o primeiro marcador SOF). Sem depender de biblioteca de imagem — e é a mesma
 * medida que o DOCX precisa. Arquivo que não é PNG nem JPEG válido lança.
 */
export function dimensoesDaImagem(buffer: Buffer): { largura: number; altura: number } {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    return { largura: buffer.readUInt32BE(16), altura: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buffer.length) {
      if (buffer[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marcador = buffer[i + 1]!;
      // SOF0..SOF15, menos DHT (c4), JPG (c8) e DAC (cc).
      if (marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador)) {
        return { altura: buffer.readUInt16BE(i + 5), largura: buffer.readUInt16BE(i + 7) };
      }
      i += 2 + buffer.readUInt16BE(i + 2);
    }
  }
  throw new Error('Imagem em formato que o compilador não lê (só PNG e JPEG).');
}
export interface MedidaDaImagem {
  largura: number;
  altura: number;
}

/** Cabe na caixa mantendo a proporção, sem ampliar além do tamanho natural. */
export function ajustarImagem(
  natural: MedidaDaImagem,
  caixa: { larguraMax: number; alturaMax: number },
): MedidaDaImagem {
  const escala = Math.min(caixa.larguraMax / natural.largura, caixa.alturaMax / natural.altura, 1);
  return { largura: natural.largura * escala, altura: natural.altura * escala };
}

/**
 * Desenha a imagem em `doc.y`, abrindo página se não couber. Devolve o que
 * ocupou — o chamador desenha a legenda logo abaixo.
 */
export function desenharImagem(
  doc: Doc,
  buffer: Buffer,
  caixa: { x: number; larguraMax: number; alturaMax: number },
  limiteInferior: () => number,
): MedidaDaImagem {
  const medida = ajustarImagem(dimensoesDaImagem(buffer), caixa);
  if (doc.y + medida.altura > limiteInferior()) doc.addPage();
  doc.image(buffer, caixa.x, doc.y, { width: medida.largura, height: medida.altura });
  doc.x = caixa.x;
  doc.y += medida.altura + 8;
  return medida;
}
