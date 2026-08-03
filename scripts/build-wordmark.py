#!/usr/bin/env python3
"""
Extrai a marca TaqCITi limpa a partir da arte original.

    python3 scripts/build-wordmark.py <arte.png>

POR QUE ESTE SCRIPT EXISTE. A arte de origem é um letreiro de neon: as letras
são nítidas, mas vivem dentro de um halo de brilho que se espalha por centenas
de pixels. Colar essa arte num cabeçalho de 30px transforma o halo em quase
toda a caixa, e o que se lê é uma mancha, não um nome. Recortar "no conteúdo"
não resolve, porque o conteúdo, para o recorte, INCLUI o halo.

COMO A SEPARAÇÃO FUNCIONA. Letra e halo compartilham a mesma cor e diferem só
no brilho, então o corte é por brilho — com duas faixas, porque as duas
palavras vivem em patamares diferentes:

  - "citi" verde: miolo da letra por volta de 77% de brilho, halo abaixo de 40%;
  - "Taq" branco: miolo acima de 93%, halo na casa dos 50%.

Qual das duas faixas se aplica a cada pixel é decidido pela saturação dele: o
verde é saturado, o branco não. As bordas usam uma transição suave (smoothstep)
em vez de um corte seco, que é o que preserva o antisserrilhado das letras em
vez de devolver uma silhueta serrilhada.

O resultado é gravado em `public/brand/taqciti-wordmark.png`, com fundo
transparente, pronto para compor sobre o vidro escuro do painel.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / 'public' / 'brand' / 'taqciti-wordmark.png'

# Faixas de corte (início, fim) da transição suave, em fração de brilho.
FAIXA_BRANCO = (0.93, 0.99)
FAIXA_VERDE = (0.76, 0.84)
# Acima de FAIXA_SATURACAO[1] o pixel é tratado como verde; abaixo do início,
# como branco. Entre os dois, mistura — evita costura visível no encontro.
FAIXA_SATURACAO = (0.18, 0.34)

# Folga em volta das letras, em pixels da arte original. Pequena de propósito:
# margem é respiro do layout, não do arquivo.
FOLGA = 6
# @4x do maior uso real (≈220px), para telas retina.
LARGURA_FINAL = 880


def suavizar(x: np.ndarray, inicio: float, fim: float) -> np.ndarray:
    """Transição suave de 0 a 1 entre `inicio` e `fim` (smoothstep)."""
    t = np.clip((x - inicio) / (fim - inicio), 0, 1)
    return t * t * (3 - 2 * t)


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    origem = Path(sys.argv[1])
    if not origem.exists():
        print(f'arte não encontrada: {origem}')
        return 1

    rgb = np.asarray(Image.open(origem).convert('RGB')).astype(np.float32)
    maior = rgb.max(axis=2)
    menor = rgb.min(axis=2)
    brilho = maior / 255.0
    # Saturação relativa: 0 no cinza puro, alta no verde da marca.
    saturacao = np.where(maior > 1, (maior - menor) / np.maximum(maior, 1), 0)

    ehVerde = suavizar(saturacao, *FAIXA_SATURACAO)
    alpha = ehVerde * suavizar(brilho, *FAIXA_VERDE) + (1 - ehVerde) * suavizar(
        brilho, *FAIXA_BRANCO
    )

    ys, xs = np.where(alpha > 0.5)
    if len(ys) == 0:
        print('nada sobrou depois do corte: confira as faixas de brilho')
        return 1

    y0 = max(int(ys.min()) - FOLGA, 0)
    y1 = min(int(ys.max()) + FOLGA + 1, rgb.shape[0])
    x0 = max(int(xs.min()) - FOLGA, 0)
    x1 = min(int(xs.max()) + FOLGA + 1, rgb.shape[1])

    recorte = np.dstack([rgb[y0:y1, x0:x1], alpha[y0:y1, x0:x1] * 255]).astype(np.uint8)
    marca = Image.fromarray(recorte, 'RGBA')

    altura = round(marca.height * LARGURA_FINAL / marca.width)
    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    marca.resize((LARGURA_FINAL, altura), Image.LANCZOS).save(DESTINO)

    print(f'{DESTINO.relative_to(RAIZ)}: {LARGURA_FINAL}x{altura}')
    print(f'proporção {marca.width / marca.height:.2f}:1')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
