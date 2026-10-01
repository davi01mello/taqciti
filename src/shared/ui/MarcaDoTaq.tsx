/**
 * A MARCA VIVA — o ícone do TaqCiti, barra por barra, como um rádio.
 *
 * ── A metáfora ───────────────────────────────────────────────────────────
 *
 * O TaqCiti vive de comunicação: escuta a reunião e devolve o que foi dito. A
 * marca é uma onda sonora, então ela se comporta como um transceptor:
 *
 *   - `repouso`: o ícone, respirando devagar — um rádio ligado, em espera;
 *   - você DIGITA (`ouve`): as barras se erguem da borda para o centro, como
 *     som chegando. O Taq está ouvindo você;
 *   - `preparando`: as barras se recolhem numa linha, um feixe as varre e
 *     anéis CONVERGEM para a marca — o Taq recebendo, sintonizando, buscando.
 *     Cada etapa nova (`sinal`) solta um ping;
 *   - `escrevendo`: as barras viram voz — cada uma no seu ritmo, como sílabas —
 *     e os anéis SAEM da marca: o Taq transmitindo. Cada pedaço de texto
 *     injeta energia proporcional ao tamanho dele;
 *   - `concluido`: as barras voltam ao desenho exato do ícone com um leve
 *     passar do ponto, um brilho corre por cima e um último anel sai;
 *   - `falhou`: um estalo de estática e tudo achata, em âmbar;
 *     `cancelado`/`interrompido`, em cinza.
 *
 * As respostas antigas (`vivo={false}`) são o ícone parado; passar o mouse
 * sobre a resposta faz a marca "repetir a fala" uma vez.
 *
 * ── Por que CSS no compositor, e não canvas ──────────────────────────────
 *
 * O canvas era pintado a cada quadro na thread principal — a mesma que
 * re-renderiza a sidebar a cada tecla (o rascunho mora no `App`). Digitar
 * derrubava quadros e a marca dava trancos. Aqui cada barra é um elemento e
 * TODO movimento é `transform`/`opacity`, animado por CSS ou pela Web
 * Animations API: o compositor toca sozinho, e a thread principal pode estar
 * ocupada o quanto quiser. O JS só dispara rajadas (sinal, tecla) e sai.
 *
 * Cada barra tem três camadas de escala, que se multiplicam:
 *   `.b` a FORMA do estado (transição),  `.v` o movimento contínuo do estado
 *   (keyframes),  `.e` as rajadas pontuais (Web Animations).
 *
 * Movimento reduzido pelo sistema: nada se mexe, cada estado vira um desenho
 * parado e legível (ver `marcaDoTaq.css`).
 */
import { memo, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { AtividadeDoAgente } from '@/features/agent/atividade';
import { observarEscrita } from '@/features/agent/escuta';
import './marcaDoTaq.css';

interface Props {
  estado: AtividadeDoAgente;
  /** Lado do desenho em CSS px. */
  tamanho?: number;
  /**
   * Muda a cada passo real do agente (etapa nova, pedaço de texto novo). Um
   * número cresce com o texto; uma string muda com a etapa.
   */
  sinal?: string | number;
  /** `false` mostra o ícone parado, sem movimento contínuo. Para o histórico. */
  vivo?: boolean;
  /** Reage quando a pessoa digita — a marca "ouve". */
  ouve?: boolean;
  className?: string;
  /** Descrição para leitor de tela. Sem ela, o desenho é decorativo. */
  rotulo?: string;
}

/*
 * As barras do ícone, medidas no PNG de 1254 px: [centro x, topo, base].
 * As duas pontas são os traços curtos.
 */
const BARRAS_DO_ICONE: ReadonlyArray<readonly [number, number, number]> = [
  [226, 662, 682],
  [265, 632, 712],
  [305, 604, 737],
  [348, 568, 775],
  [392, 515, 822],
  [438, 454, 857],
  [486, 382, 897],
  [534, 454, 848],
  [581, 525, 804],
  [625, 579, 750],
  [667, 621, 731],
  [709, 636, 761],
  [752, 595, 796],
  [797, 544, 840],
  [843, 491, 827],
  [888, 545, 797],
  [933, 587, 757],
  [977, 626, 718],
  [1023, 662, 684],
];
/** Os entalhes brancos: [índice da barra, y no PNG]. */
const ENTALHES: ReadonlyArray<readonly [number, number]> = [
  [3, 691],
  [6, 508],
  [7, 656],
  [14, 607],
  [15, 739],
];
const X0 = 210;
const X1 = 1040;
const MEIO_Y = 672;

type Cor = readonly [number, number, number];
/** O degradê do topo, da esquerda para a direita. */
const TOPO: readonly Cor[] = [
  [58, 214, 44],
  [6, 200, 84],
  [4, 176, 120],
  [4, 190, 190],
  [12, 140, 230],
];
/** O degradê da base: turquesa à esquerda, violeta à direita. */
const BASE: readonly Cor[] = [
  [18, 190, 70],
  [6, 160, 150],
  [4, 150, 160],
  [110, 70, 225],
  [80, 70, 220],
];

function amostrar(paleta: readonly Cor[], u: number): string {
  const p = Math.min(0.9999, Math.max(0, u)) * (paleta.length - 1);
  const i = Math.floor(p);
  const f = p - i;
  const a = paleta[i]!;
  const b = paleta[i + 1]!;
  const c = [0, 1, 2].map((k) => Math.round(a[k]! + (b[k]! - a[k]!) * f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

interface Barra {
  /** Posição horizontal, 0..1. */
  u: number;
  /** Meia altura e centro do ícone, em fração da largura do desenho. */
  meia: number;
  centro: number;
  /** Onde fica o entalhe branco, em fração da altura da barra. */
  entalhe: number | null;
}

/**
 * O ícone reamostrado em `n` barras. Pequena demais, a marca de 19 barras
 * vira um borrão de 1 px por barra; por isso o seletor usa menos barras,
 * interpolando a mesma silhueta.
 */
function barrasDoIcone(n: number): Barra[] {
  const largura = X1 - X0;
  const fonte = BARRAS_DO_ICONE.map(([x, topo, base]) => ({
    u: (x - X0) / largura,
    meia: (base - topo) / 2 / largura,
    centro: ((topo + base) / 2 - MEIO_Y) / largura,
  }));
  if (n === fonte.length) {
    return fonte.map((b, i) => {
      const e = ENTALHES.find(([k]) => k === i);
      const [, topo, base] = BARRAS_DO_ICONE[i]!;
      return { ...b, entalhe: e ? (e[1] - topo) / (base - topo) : null };
    });
  }
  return Array.from({ length: n }, (_, k) => {
    const u = fonte[0]!.u + ((fonte.at(-1)!.u - fonte[0]!.u) * k) / (n - 1);
    let j = 0;
    while (j < fonte.length - 2 && fonte[j + 1]!.u < u) j++;
    const a = fonte[j]!;
    const b = fonte[j + 1]!;
    const f = (u - a.u) / (b.u - a.u);
    return {
      u,
      meia: a.meia + (b.meia - a.meia) * f,
      centro: a.centro + (b.centro - a.centro) * f,
      entalhe: null,
    };
  });
}

/** Pseudo-aleatório estável por índice: o ritmo de cada "sílaba". */
function ruido(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Desenho de cada barra, em px, e as variáveis que o CSS usa. */
function geometria(tamanho: number) {
  const barras = barrasDoIcone(tamanho < 30 ? 9 : 19);
  const n = barras.length;
  const esq = tamanho * 0.1;
  const larg = tamanho * 0.8;
  const passo = larg / (n - 1);
  const espessura = Math.max(1, passo * (n > 10 ? 0.62 : 0.56));
  /** A altura da linha em que as barras se recolhem. */
  const recolhida = Math.max(espessura * 0.9, larg * 0.05);
  return barras.map((b, i) => {
    const h = Math.max(espessura, b.meia * 2 * larg);
    const estilo = {
      left: esq + passo * i - espessura / 2,
      top: tamanho / 2 + b.centro * larg - h / 2,
      width: espessura,
      height: h,
      '--u': b.u.toFixed(3),
      '--rec': (recolhida / h).toFixed(3),
      '--dy': `${(-b.centro * larg).toFixed(2)}px`,
      '--dur': `${(0.26 + ruido(i) * 0.3).toFixed(2)}s`,
      '--atraso': `${(-ruido(i + 40) * 0.6).toFixed(2)}s`,
      '--c1': amostrar(TOPO, b.u),
      '--c2': amostrar(BASE, b.u),
    } as CSSProperties;
    return { u: b.u, entalhe: b.entalhe, estilo };
  });
}

const TRABALHANDO: ReadonlySet<AtividadeDoAgente> = new Set(['preparando', 'escrevendo']);

/** Das bordas para o centro: o som chegando. */
const PARA_DENTRO = (u: number) => (0.5 - Math.abs(u - 0.5)) * 2;

function movimentoReduzido(): boolean {
  return typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)').matches
    : true;
}

function MarcaDoTaqBase({
  estado,
  tamanho = 26,
  sinal,
  vivo = true,
  ouve = false,
  className,
  rotulo,
}: Props) {
  const barras = useMemo(() => geometria(tamanho), [tamanho]);
  const energiaRef = useRef<Array<HTMLSpanElement | null>>([]);
  const pulsoRef = useRef<HTMLSpanElement | null>(null);
  const estadoRef = useRef(estado);
  estadoRef.current = estado;
  const sinalRef = useRef(sinal);
  /** As rajadas em curso: uma nova substitui a anterior, não se empilha. */
  const rajadas = useRef<Animation[]>([]);
  const ultimaRajada = useRef(0);

  /**
   * Uma rajada: cada barra sobe e volta, com o atraso que `atraso(u)` der. É
   * disparada daqui, mas tocada pelo compositor.
   */
  const rajada = (forca: number, duracao: number, atraso: (u: number) => number) => {
    if (movimentoReduzido()) return;
    for (const a of rajadas.current) a.cancel();
    rajadas.current = [];
    energiaRef.current.forEach((el, i) => {
      if (!el?.animate) return;
      const u = barras[i]!.u;
      rajadas.current.push(
        el.animate(
          [
            { transform: 'scaleY(1)' },
            { transform: `scaleY(${1 + forca})`, offset: 0.3 },
            { transform: 'scaleY(1)' },
          ],
          { duration: duracao, delay: atraso(u), easing: 'cubic-bezier(.3,.7,.4,1)' },
        ),
      );
    });
  };

  /** Um anel avulso — para dentro (ouvindo) ou para fora (um ping). */
  const anel = (dentro: boolean, opacidade: number) => {
    const el = pulsoRef.current;
    if (!el?.animate || movimentoReduzido()) return;
    el.animate(
      dentro
        ? [
            { transform: 'scale(1.5)', opacity: 0 },
            { transform: 'scale(1.1)', opacity: opacidade, offset: 0.35 },
            { transform: 'scale(.45)', opacity: 0 },
          ]
        : [
            { transform: 'scale(.5)', opacity: opacidade },
            { transform: 'scale(1.55)', opacity: 0 },
          ],
      { duration: dentro ? 520 : 780, easing: 'ease-out' },
    );
  };

  // Um passo real do agente. Números (texto chegando) pesam pelo tamanho do
  // pedaço; strings (etapa nova) soltam um ping.
  useEffect(() => {
    const antes = sinalRef.current;
    sinalRef.current = sinal;
    if (!vivo || sinal === undefined || sinal === antes || sinal === '' || sinal === 0) return;
    const agora = performance.now();
    if (typeof sinal === 'number' && typeof antes === 'number') {
      // O texto chega em muitos pedaços por segundo: uma rajada por vez.
      if (agora - ultimaRajada.current < 110) return;
      ultimaRajada.current = agora;
      const forca = Math.min(0.9, Math.log10(1 + Math.max(0, sinal - antes)) * 0.45);
      rajada(forca, 380, (u) => u * 140);
      return;
    }
    rajada(0.7, 520, (u) => u * 220);
    anel(false, 0.7);
    // `rajada`/`anel` leem refs; só o sinal importa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinal]);

  // A pessoa digitando: a marca ouve. Só fora do trabalho — com o Taq
  // respondendo, as barras já têm o que dizer.
  useEffect(() => {
    if (!ouve) return;
    return observarEscrita(() => {
      if (TRABALHANDO.has(estadoRef.current)) return;
      const agora = performance.now();
      if (agora - ultimaRajada.current < 120) return;
      ultimaRajada.current = agora;
      rajada(0.32, 300, (u) => PARA_DENTRO(u) * 100);
      anel(true, 0.22);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouve, barras]);

  useEffect(
    () => () => {
      for (const a of rajadas.current) a.cancel();
    },
    [],
  );

  return (
    <span
      className={`tq-marca${className ? ` ${className}` : ''}`}
      data-estado={estado}
      data-vivo={vivo ? 'sim' : 'nao'}
      // `font-size` é a régua da espessura dos anéis (`em` no CSS).
      style={{ width: tamanho, height: tamanho, fontSize: tamanho }}
      role={rotulo ? 'img' : undefined}
      aria-label={rotulo}
      aria-hidden={rotulo ? undefined : true}
    >
      <span className="tq-marca-halo" />
      <span className="tq-marca-anel" />
      <span className="tq-marca-anel" />
      <span className="tq-marca-anel tq-marca-pulso" ref={pulsoRef} />
      {barras.map((b, i) => (
        <span key={i} className="b" style={b.estilo}>
          <span className="v">
            <span
              className="e"
              ref={(el) => {
                energiaRef.current[i] = el;
              }}
            >
              {b.entalhe !== null && (
                <span className="entalhe" style={{ top: `${b.entalhe * 100}%` }} />
              )}
            </span>
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * Memorizada: a sidebar re-renderiza a cada tecla, e a marca não tem nada a
 * ver com isso — ela só muda quando o estado, o sinal ou o tamanho mudam.
 */
export const MarcaDoTaq = memo(MarcaDoTaqBase);
