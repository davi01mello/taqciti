/**
 * O SINAL do TaqCiti — a waveform da marca, em vetor.
 *
 * ── Por que deixou de ser o PNG ──────────────────────────────────────────
 *
 * `brand/taqciti-mark.png` é um quadrado de 1240px em que a onda ocupa a faixa
 * do meio: 60% da altura é margem transparente. Escalado para 21px no
 * cabeçalho, sobravam ~8px de onda — o sinal virava um tracinho ao lado do
 * nome, e era isso que se via em todas as capturas da sidebar.
 *
 * Aqui as barras são as MESMAS do PNG (mesma posição, mesma altura, os mesmos
 * cortes horizontais em cinco delas), medidas no arquivo original e recortadas
 * na caixa exata da onda. O sinal agora ocupa a altura que se pede a ele, é
 * nítido em qualquer densidade de tela e não depende de `chrome.runtime`.
 *
 * Os cortes são máscara, e não traço pintado de branco: assim eles são
 * transparentes de verdade e leem igual sobre o grafite, sobre o vidro e sobre
 * o fundo claro do guia de instalação.
 */
import { useId } from 'react';

/** [centro x, topo, base] de cada barra, nas coordenadas do PNG original. */
const BARRAS: ReadonlyArray<readonly [number, number, number]> = [
  [265, 632, 712],
  [305, 605, 737],
  [348, 568, 775],
  [392, 515, 821],
  [438, 455, 856],
  [486, 382, 896],
  [534, 455, 848],
  [581, 526, 803],
  [625, 580, 750],
  [667, 621, 731],
  [709, 636, 760],
  [752, 596, 795],
  [798, 545, 839],
  [843, 491, 826],
  [888, 545, 797],
  [933, 588, 757],
  [977, 627, 717],
];

/** Os dois pontos das pontas: a onda saindo do silêncio e voltando a ele. */
const PONTAS: ReadonlyArray<number> = [226, 1023];

/** Os cortes: [centro x, y] — as "linhas de legenda" que atravessam a onda. */
const CORTES: ReadonlyArray<readonly [number, number]> = [
  [348, 691],
  [486, 508],
  [534, 656],
  [843, 607],
  [888, 739],
];

const LARGURA = 32;
/** A caixa da onda, com 2px de folga para o arredondamento não ser cortado. */
const X0 = 207;
const Y0 = 380;
const W = 836;
const H = 518;

interface Props {
  /** Altura em px. A largura sai da proporção da onda (~1,6×). */
  altura?: number;
  className?: string;
}

export function SinalTaqciti({ altura = 20, className }: Props) {
  // Dois sinais na mesma página não podem disputar o mesmo id de gradiente.
  const id = useId().replace(/:/g, '');
  const grad = `tq-sinal-g-${id}`;
  const mask = `tq-sinal-m-${id}`;

  return (
    <svg
      className={className}
      viewBox={`${X0} ${Y0} ${W} ${H}`}
      height={altura}
      width={Math.round((altura * W) / H)}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* Verde-limão no alto à esquerda, atravessando o verde da marca e o
            petróleo até o azul e o violeta na base à direita — o mesmo
            percurso de cor do PNG. Em `userSpaceOnUse`: com o padrão
            (`objectBoundingBox`) cada barra receberia o gradiente inteiro
            sozinha, e a onda viraria dezessete arco-íris iguais. */}
        <linearGradient
          id={grad}
          gradientUnits="userSpaceOnUse"
          x1={X0}
          y1={Y0}
          x2={X0 + W}
          y2={Y0 + H}
        >
          <stop offset="0" stopColor="#3ddc2e" />
          <stop offset="0.34" stopColor="#05c45f" />
          <stop offset="0.55" stopColor="#06a48c" />
          <stop offset="0.74" stopColor="#05b2d4" />
          <stop offset="0.9" stopColor="#1a7fea" />
          <stop offset="1" stopColor="#6a3de8" />
        </linearGradient>
        <mask id={mask} maskUnits="userSpaceOnUse" x={X0} y={Y0} width={W} height={H}>
          <rect x={X0} y={Y0} width={W} height={H} fill="#fff" />
          {CORTES.map(([x, y]) => (
            <rect key={`${x}-${y}`} x={x - LARGURA / 2} y={y - 4} width={LARGURA} height={8} fill="#000" />
          ))}
        </mask>
      </defs>
      <g fill={`url(#${grad})`} mask={`url(#${mask})`}>
        {BARRAS.map(([x, topo, base]) => (
          <rect
            key={x}
            x={x - LARGURA / 2}
            y={topo}
            width={LARGURA}
            height={base - topo}
            rx={LARGURA / 2}
          />
        ))}
        {PONTAS.map((x) => (
          <rect key={x} x={x - 18} y={661} width={36} height={22} rx={11} />
        ))}
      </g>
    </svg>
  );
}
