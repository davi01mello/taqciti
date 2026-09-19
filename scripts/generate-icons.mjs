/**
 * Gera os ícones PNG da extensão a partir da arte da marca.
 *
 * ── O que mudou, e por quê ─────────────────────────────────────────────────
 *
 * Antes, este script DESENHAVA um ícone: squircle escuro com três barras de
 * waveform, tudo em código. Era uma aproximação feita à mão porque não havia
 * arte. Agora existe — `public/brand/taqciti-mark.png`, a waveform em
 * gradiente verde→azul — e o ícone passa a ser essa arte reduzida, não uma
 * imitação dela. Duas marcas parecidas mas diferentes é pior do que uma só.
 *
 * ── Por que o fundo escuro continua ────────────────────────────────────────
 *
 * A arte é transparente, e a tentação é publicá-la assim. Não dá: a barra de
 * ferramentas do Chrome é clara no tema claro, e um traço fino em gradiente
 * some contra branco. O squircle escuro é o que garante contraste nos dois
 * temas — é a mesma razão de ele existir no desenho anterior. A arte fica por
 * cima, com respiro nas bordas.
 *
 * Rode com `npm run icons` depois de trocar a arte.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { codificarPng, decodificarPng, recortar, recortarConteudo, reduzir } from './lib/png.mjs';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const ARTE = join(RAIZ, 'public', 'brand', 'taqciti-mark.png');
const DESTINO = join(RAIZ, 'public', 'icons');

const TAMANHOS = [16, 32, 48, 128];

const FUNDO_TOPO = [15, 19, 24];
const FUNDO_BASE = [8, 10, 13];

/**
 * Quanto da caixa a arte ocupa, por tamanho.
 *
 * Não é um número só porque ícone pequeno precisa de MAIS proporção de arte:
 * em 16px, 6% de margem é um pixel inteiro, e o que sobra para a waveform não
 * desenha nada. Em 128px a margem generosa é o que faz o ícone parecer
 * desenhado, e não espremido.
 */
const OCUPACAO = { 16: 0.94, 32: 0.9, 48: 0.86, 128: 0.82 };

/**
 * Em 16px, a arte inteira não cabe: são ~40 barras finas espremidas em 16
 * pixels, e o resultado é uma mancha colorida, não uma waveform. Este recorte
 * fica com a fração CENTRAL da largura — as barras altas do meio — que é a
 * parte que ainda se lê nesse tamanho. É simplificação óptica, a mesma ideia
 * de um logotipo ter versão reduzida; não é outra marca.
 *
 * Acima de 16px a arte inteira lê bem e o recorte não se aplica.
 */
const RECORTE_CENTRAL = { 16: 0.46 };

/** Distância assinada de um retângulo de cantos arredondados. */
function sdRoundRect(px, py, cx, cy, hw, hh, raio) {
  const qx = Math.abs(px - cx) - (hw - raio);
  const qy = Math.abs(py - cy) - (hh - raio);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - raio;
}

function cobertura(sd) {
  return Math.min(1, Math.max(0, 0.5 - sd));
}

function misturar(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function gerar(arteCheia, tamanho) {
  // 0. Recorte central nos tamanhos onde a arte inteira não se lê.
  const fracao = RECORTE_CENTRAL[tamanho];
  let arte = arteCheia;
  if (fracao) {
    const largura = Math.round(arteCheia.largura * fracao);
    const x = Math.round((arteCheia.largura - largura) / 2);
    arte = {
      largura,
      altura: arteCheia.altura,
      dados: recortar(arteCheia.dados, arteCheia.largura, {
        x,
        y: 0,
        largura,
        altura: arteCheia.altura,
      }),
    };
  }

  // 1. A arte, reduzida para caber na área útil SEM deformar. A waveform é um
  // retângulo largo (≈1,6:1); esticá-la para um quadrado engordaria as barras
  // e mudaria a marca. O fator é o menor dos dois, e o que sobra vira margem.
  const area = Math.max(1, Math.round(tamanho * (OCUPACAO[tamanho] ?? 0.85)));
  const fator = Math.min(area / arte.largura, area / arte.altura);
  const larguraMarca = Math.max(1, Math.round(arte.largura * fator));
  const alturaMarca = Math.max(1, Math.round(arte.altura * fator));
  const marca = reduzir(arte.dados, arte.largura, arte.altura, larguraMarca, alturaMarca);
  const deslocX = Math.round((tamanho - larguraMarca) / 2);
  const deslocY = Math.round((tamanho - alturaMarca) / 2);

  // 2. O fundo, e a arte composta por cima.
  const saida = Buffer.alloc(tamanho * tamanho * 4);
  const centro = (tamanho - 1) / 2;
  const borda = tamanho / 2 - 0.5;
  const canto = tamanho * 0.24;

  for (let y = 0; y < tamanho; y++) {
    for (let x = 0; x < tamanho; x++) {
      const destino = (y * tamanho + x) * 4;
      const alfaFundo = cobertura(sdRoundRect(x, y, centro, centro, borda, borda, canto));
      if (alfaFundo <= 0) continue;

      let [r, g, b] = misturar(FUNDO_TOPO, FUNDO_BASE, y / (tamanho - 1));

      const mx = x - deslocX;
      const my = y - deslocY;
      if (mx >= 0 && my >= 0 && mx < larguraMarca && my < alturaMarca) {
        const o = (my * larguraMarca + mx) * 4;
        const a = marca[o + 3] / 255;
        if (a > 0) {
          [r, g, b] = misturar([r, g, b], [marca[o], marca[o + 1], marca[o + 2]], a);
        }
      }

      saida[destino] = Math.round(r);
      saida[destino + 1] = Math.round(g);
      saida[destino + 2] = Math.round(b);
      saida[destino + 3] = Math.round(alfaFundo * 255);
    }
  }

  return codificarPng(tamanho, tamanho, saida);
}

function main() {
  const bruto = decodificarPng(readFileSync(ARTE));
  const caixa = recortarConteudo(bruto.dados, bruto.largura, bruto.altura);
  const arte = {
    largura: caixa.largura,
    altura: caixa.altura,
    dados: recortar(bruto.dados, bruto.largura, caixa),
  };

  console.log(
    `[icons] arte: ${bruto.largura}x${bruto.altura} → conteúdo ${caixa.largura}x${caixa.altura}`,
  );

  mkdirSync(DESTINO, { recursive: true });
  for (const tamanho of TAMANHOS) {
    const arquivo = join(DESTINO, `icon-${tamanho}.png`);
    const png = gerar(arte, tamanho);
    writeFileSync(arquivo, png);
    console.log(`[icons] icon-${tamanho}.png (${png.length} bytes)`);
  }
}

main();
