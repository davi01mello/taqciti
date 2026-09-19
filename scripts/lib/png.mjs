/**
 * Ler, redimensionar e gravar PNG sem dependência externa.
 *
 * O projeto não tem `sharp` nem `jimp`, e acrescentar um deles para gerar
 * quatro ícones traria binário nativo, passo de instalação e uma dependência
 * que precisa ser atualizada para sempre. O encoder já existia à mão em
 * `scripts/generate-icons.mjs`; o que faltava era o decoder e a redução de
 * escala — é isso que mora aqui, e os dois passaram a compartilhar o mesmo
 * código.
 *
 * ESCOPO DELIBERADAMENTE ESTREITO: só RGBA de 8 bits sem entrelaçamento, que
 * é o que a arte da marca é (`color type 6`, `bit depth 8`). Qualquer outra
 * coisa falha alto em vez de devolver pixel errado em silêncio — um ícone
 * torto só apareceria na barra do Chrome, tarde.
 */
import { deflateSync, inflateSync } from 'node:zlib';

const ASSINATURA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(tipo, dados) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([len, corpo, crc]);
}

/**
 * Desfaz o filtro por linha do PNG. Cada scanline escolhe um dos cinco
 * filtros, e o valor de cada byte é relativo ao vizinho da esquerda (a), de
 * cima (b) ou da diagonal (c). Sem desfazer isso, os bytes do IDAT não são
 * pixels — são diferenças.
 */
function desfiltrar(bruto, largura, altura) {
  const bpp = 4;
  const passo = largura * bpp;
  const saida = Buffer.alloc(passo * altura);

  for (let y = 0; y < altura; y++) {
    const filtro = bruto[y * (passo + 1)];
    const entrada = y * (passo + 1) + 1;
    const destino = y * passo;
    const anterior = destino - passo;

    for (let i = 0; i < passo; i++) {
      const x = bruto[entrada + i];
      const a = i >= bpp ? saida[destino + i - bpp] : 0;
      const b = y > 0 ? saida[anterior + i] : 0;
      const c = y > 0 && i >= bpp ? saida[anterior + i - bpp] : 0;
      let valor;
      switch (filtro) {
        case 0:
          valor = x;
          break;
        case 1:
          valor = x + a;
          break;
        case 2:
          valor = x + b;
          break;
        case 3:
          valor = x + ((a + b) >> 1);
          break;
        case 4: {
          // Paeth: escolhe o vizinho cuja estimativa erra menos.
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          valor = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`filtro PNG desconhecido na linha ${y}: ${filtro}`);
      }
      saida[destino + i] = valor & 0xff;
    }
  }

  return saida;
}

/** Devolve `{ largura, altura, dados }`, com `dados` em RGBA de 8 bits. */
export function decodificarPng(buffer) {
  if (!buffer.subarray(0, 8).equals(ASSINATURA)) {
    throw new Error('não é um PNG (assinatura ausente)');
  }

  let i = 8;
  let largura = 0;
  let altura = 0;
  const partes = [];

  while (i < buffer.length) {
    const len = buffer.readUInt32BE(i);
    const tipo = buffer.toString('ascii', i + 4, i + 8);
    const dados = buffer.subarray(i + 8, i + 8 + len);

    if (tipo === 'IHDR') {
      largura = dados.readUInt32BE(0);
      altura = dados.readUInt32BE(4);
      const profundidade = dados[8];
      const cor = dados[9];
      const entrelacado = dados[12];
      if (profundidade !== 8 || cor !== 6) {
        throw new Error(
          `só sei ler PNG RGBA de 8 bits; este é bit depth ${profundidade}, color type ${cor}`,
        );
      }
      if (entrelacado !== 0) throw new Error('PNG entrelaçado não é suportado aqui');
    } else if (tipo === 'IDAT') {
      partes.push(dados);
    } else if (tipo === 'IEND') {
      break;
    }
    // Qualquer outro chunk (gAMA, pHYs, e os privados que editores gravam) é
    // ignorado de propósito: não muda os pixels.

    i += 12 + len;
  }

  if (!partes.length) throw new Error('PNG sem dados de imagem (IDAT)');

  const bruto = inflateSync(Buffer.concat(partes));
  return { largura, altura, dados: desfiltrar(bruto, largura, altura) };
}

export function codificarPng(largura, altura, dados) {
  const passo = largura * 4;
  const bruto = Buffer.alloc(altura * (passo + 1));
  for (let y = 0; y < altura; y++) {
    bruto[y * (passo + 1)] = 0; // filtro "None"
    dados.copy(bruto, y * (passo + 1) + 1, y * passo, (y + 1) * passo);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    ASSINATURA,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(bruto, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Redução de escala por média de área, com alfa PRÉ-MULTIPLICADO.
 *
 * A pré-multiplicação não é detalhe: sem ela, a média puxa a cor dos pixels
 * transparentes (que costumam ser preto com alfa 0) para dentro da borda, e o
 * resultado ganha uma auréola escura em volta de cada traço. Numa waveform
 * fina reduzida a 16px isso é a diferença entre um traço limpo e um borrão
 * sujo.
 *
 * Média de área, e não amostragem do pixel mais próximo: reduzir 1254 -> 16 é
 * um fator de ~78, e pegar um pixel a cada 78 descarta 99% da arte — barras
 * inteiras somem dependendo de onde a grade cai.
 */
export function reduzir(origem, largura, altura, novaLargura, novaAltura) {
  const saida = Buffer.alloc(novaLargura * novaAltura * 4);
  const escalaX = largura / novaLargura;
  const escalaY = altura / novaAltura;

  for (let y = 0; y < novaAltura; y++) {
    const y0 = Math.floor(y * escalaY);
    const y1 = Math.min(altura, Math.ceil((y + 1) * escalaY));

    for (let x = 0; x < novaLargura; x++) {
      const x0 = Math.floor(x * escalaX);
      const x1 = Math.min(largura, Math.ceil((x + 1) * escalaX));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;

      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const o = (sy * largura + sx) * 4;
          const alfa = origem[o + 3] / 255;
          r += origem[o] * alfa;
          g += origem[o + 1] * alfa;
          b += origem[o + 2] * alfa;
          a += origem[o + 3];
          n++;
        }
      }

      const destino = (y * novaLargura + x) * 4;
      if (!n || a === 0) {
        saida[destino] = 0;
        saida[destino + 1] = 0;
        saida[destino + 2] = 0;
        saida[destino + 3] = 0;
        continue;
      }
      const alfaMedio = a / n;
      // Desfaz a pré-multiplicação para voltar ao RGBA direto que o PNG grava.
      const fator = 255 / alfaMedio;
      saida[destino] = Math.min(255, Math.round((r / n) * fator));
      saida[destino + 1] = Math.min(255, Math.round((g / n) * fator));
      saida[destino + 2] = Math.min(255, Math.round((b / n) * fator));
      saida[destino + 3] = Math.round(alfaMedio);
    }
  }

  return saida;
}

/** Recorta o retângulo com conteúdo visível (alfa > limiar). */
export function recortarConteudo(dados, largura, altura, limiar = 8) {
  let minX = largura;
  let minY = altura;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      if (dados[(y * largura + x) * 4 + 3] > limiar) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return { x: 0, y: 0, largura, altura };
  return { x: minX, y: minY, largura: maxX - minX + 1, altura: maxY - minY + 1 };
}

/** Extrai um retângulo para um buffer RGBA novo. */
export function recortar(dados, largura, { x, y, largura: w, altura: h }) {
  const saida = Buffer.alloc(w * h * 4);
  for (let linha = 0; linha < h; linha++) {
    dados.copy(
      saida,
      linha * w * 4,
      ((y + linha) * largura + x) * 4,
      ((y + linha) * largura + x + w) * 4,
    );
  }
  return saida;
}
