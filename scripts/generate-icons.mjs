/**
 * Gera os ícones PNG da TaqCITi sem dependências externas: squircle escuro
 * com três barras de waveform verdes — a marca da transcrição. PNG montado
 * à mão (IHDR/IDAT/IEND + zlib), com anti-aliasing por distância assinada.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const SIZES = [16, 32, 48, 128];

const BG_TOP = [15, 19, 24];
const BG_BOTTOM = [8, 10, 13];
const GREEN = [45, 219, 96];
const GLOW = [122, 242, 165];

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

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixelFn) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtro "None" por linha
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Distância assinada de um retângulo arredondado centrado em (cx, cy). */
function sdRoundRect(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - (halfW - radius);
  const qy = Math.abs(y - cy) - (halfH - radius);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Cobertura 0..1 a partir da distância assinada (1px de suavização). */
function coverage(sd) {
  return Math.min(1, Math.max(0, 0.5 - sd));
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function pixel(x, y, size) {
  const c = (size - 1) / 2;
  const edge = size / 2 - 0.5;
  const corner = size * 0.24;

  const bgSd = sdRoundRect(x, y, c, c, edge, edge, corner);
  const bgAlpha = coverage(bgSd);
  if (bgAlpha <= 0) return [0, 0, 0, 0];

  // Fundo com gradiente vertical sutil.
  let [r, g, b] = mix(BG_TOP, BG_BOTTOM, y / (size - 1));

  // Três barras de waveform: alturas 42% / 66% / 30% da área útil.
  const barW = size * 0.115;
  const gap = size * 0.215;
  const bars = [
    { cx: c - gap, halfH: size * 0.155, color: GREEN },
    { cx: c, halfH: size * 0.26, color: GLOW },
    { cx: c + gap, halfH: size * 0.115, color: GREEN },
  ];
  for (const bar of bars) {
    const sd = sdRoundRect(x, y, bar.cx, c, barW / 2, bar.halfH, barW / 2);
    const t = coverage(sd);
    if (t > 0) [r, g, b] = mix([r, g, b], bar.color, t);
  }

  return [r, g, b, Math.round(bgAlpha * 255)];
}

mkdirSync(new URL('../public/icons/', import.meta.url), { recursive: true });
for (const size of SIZES) {
  const out = new URL(`../public/icons/icon-${size}.png`, import.meta.url);
  writeFileSync(out, png(size, pixel));
  console.log(`icon-${size}.png`);
}
