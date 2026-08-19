import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  marcaBuffer,
  MARCA_ALTURA_PX,
  MARCA_CABECALHO_ALTURA_PT,
  MARCA_CABECALHO_LARGURA_PT,
  MARCA_CAPA_ALTURA_PT,
  MARCA_CAPA_LARGURA_PT,
  MARCA_LARGURA_PX,
} from './brand';

/**
 * Decodifica o PNG RGBA de 8 bits o suficiente pra INSPECIONAR COR. Não é um
 * decodificador de PNG de uso geral — assume o que `citi-preto.png` é (cor 6,
 * 8 bits, sem entrelaçamento), e o teste abaixo confere essa premissa antes
 * de usar os pixels. Escrever isto à mão evita uma dependência nova só pra
 * um teste, e são só os cinco filtros da especificação.
 */
function decodificarPngRgba(png: Buffer): { largura: number; altura: number; pixels: Buffer } {
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

  let largura = 0;
  let altura = 0;
  const idat: Buffer[] = [];
  let cursor = 8;
  while (cursor < png.length) {
    const tamanho = png.readUInt32BE(cursor);
    const tipo = png.subarray(cursor + 4, cursor + 8).toString('latin1');
    const dados = png.subarray(cursor + 8, cursor + 8 + tamanho);
    if (tipo === 'IHDR') {
      largura = dados.readUInt32BE(0);
      altura = dados.readUInt32BE(4);
      expect({ bits: dados[8], cor: dados[9], entrelacado: dados[12] }).toEqual({
        bits: 8,
        cor: 6, // RGBA
        entrelacado: 0,
      });
    }
    if (tipo === 'IDAT') idat.push(Buffer.from(dados));
    cursor += 12 + tamanho;
  }

  const bruto = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const passo = largura * bpp;
  const pixels = Buffer.alloc(altura * passo);
  for (let y = 0; y < altura; y++) {
    const filtro = bruto[y * (passo + 1)];
    const linha = bruto.subarray(y * (passo + 1) + 1, (y + 1) * (passo + 1));
    for (let i = 0; i < passo; i++) {
      const a = i >= bpp ? pixels[y * passo + i - bpp] : 0;
      const b = y > 0 ? pixels[(y - 1) * passo + i] : 0;
      const c = y > 0 && i >= bpp ? pixels[(y - 1) * passo + i - bpp] : 0;
      let valor = linha[i];
      if (filtro === 1) valor += a;
      else if (filtro === 2) valor += b;
      else if (filtro === 3) valor += (a + b) >> 1;
      else if (filtro === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        valor += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * passo + i] = valor & 0xff;
    }
  }
  return { largura, altura, pixels };
}

describe('marca do documento', () => {
  it('tem as dimensões que as constantes de layout declaram', () => {
    const { largura, altura } = decodificarPngRgba(marcaBuffer());
    expect({ largura, altura }).toEqual({ largura: MARCA_LARGURA_PX, altura: MARCA_ALTURA_PX });
  });

  it('é PRETA e monocromática — a versão verde não pode voltar', () => {
    // A regressão que este teste existe pra pegar: alguém repõe a marca
    // comemorativa "citi 30 anos" (verde) ou tinge a preta pelo tema. O
    // documento institucional é preto, branco e cinza; uma marca colorida faz
    // a ata parecer de outra campanha — e o defeito só apareceria com o
    // arquivo já na mão do cliente.
    const { pixels } = decodificarPngRgba(marcaBuffer());

    let visiveis = 0;
    let maiorSaturacao = 0;
    let maiorClaro = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b, alfa] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
      if (alfa < 200) continue; // borda antisserrilhada não conta
      visiveis++;
      maiorSaturacao = Math.max(maiorSaturacao, Math.max(r, g, b) - Math.min(r, g, b));
      maiorClaro = Math.max(maiorClaro, Math.max(r, g, b));
    }

    expect(visiveis).toBeGreaterThan(1000);
    expect(maiorSaturacao).toBeLessThanOrEqual(8); // neutro: r ≈ g ≈ b
    expect(maiorClaro).toBeLessThanOrEqual(40); // e escuro, não um cinza médio
  });

  it('nunca distorce: capa e cabeçalho mantêm a proporção do arquivo', () => {
    const proporcao = MARCA_ALTURA_PX / MARCA_LARGURA_PX;
    expect(MARCA_CAPA_ALTURA_PT / MARCA_CAPA_LARGURA_PT).toBeCloseTo(proporcao, 6);
    expect(MARCA_CABECALHO_ALTURA_PT / MARCA_CABECALHO_LARGURA_PT).toBeCloseTo(proporcao, 6);
  });
});
