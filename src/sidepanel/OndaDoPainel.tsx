/**
 * A ONDA da sidebar — o chão do painel, atrás de tudo.
 *
 * É a mesma família do `WaveField` da HOME (partículas, linha central com
 * hastes, dobras neutras), redesenhada para uma coluna de 260 a 500px e com
 * duas coisas que a HOME não tem:
 *
 *   - **o pulso por fala.** Cada fala nova manda um pacote que atravessa a onda
 *     da esquerda para a direita. É o único sinal de "chegou fala" que não
 *     depende de olhar a transcrição — e ele NÃO mede áudio: a extensão nunca
 *     ouviu microfone nenhum; o que dispara o pulso é a chegada de um trecho.
 *   - **a tinta.** Verde é quem fala na reunião; violeta são as ideias que
 *     voltam dela. Enquanto o assistente responde, a onda anda para o violeta,
 *     e volta ao verde quando ele termina.
 *
 * O desenho é o do protótipo aprovado ("Espectro TaqCiti", 02/10/2026). Os
 * valores são interpolados no laço: um degrau de amplitude lê como falha de
 * renderização, não como reação.
 *
 * Custo: `fillRect` por partícula (ver o cabeçalho do `WaveField`), dpr
 * limitado a 1,5, e o laço para sozinho quando não há o que mudar — em
 * movimento reduzido ele pinta um quadro e não pede outro.
 */
import { useEffect, useRef } from 'react';

export type EstadoDaOndaDoPainel = 'repouso' | 'escrita' | 'captando';

interface Props {
  estado: EstadoDaOndaDoPainel;
  /** 0 a 1: quanto da onda está à vista. 0 a recolhe por inteiro. */
  recuo: number;
  /** 0 = verde (pessoas), 1 = violeta (o assistente). */
  tinta: number;
  /** Sobe a cada fala nova: cada incremento é um pulso inteiro. */
  falas: number;
  /** Muda a cada passo da resposta: cada mudança é um pulso fraco. */
  sinal?: string | number;
  /** `false` congela a fase (movimento reduzido, aba oculta). */
  animando: boolean;
}

const PERFIL: Record<EstadoDaOndaDoPainel, { a: number; v: number }> = {
  repouso: { a: 11, v: 0.00019 },
  escrita: { a: 20, v: 0.00052 },
  captando: { a: 24, v: 0.00042 },
};

const VERDE = [92, 203, 133];
const BRILHO = [144, 223, 173];
const VIOLETA = [155, 130, 245];
const VIOLETA_BRILHO = [205, 192, 252];

const mistura = (a: number[], b: number[], k: number) =>
  a.map((v, i) => Math.round(v + (b[i]! - v) * k)).join(', ');

/** Quanto tempo um pulso leva para atravessar a onda. */
const TRAVESSIA_MS = 1400;

export function OndaDoPainel({ estado, recuo, tinta, falas, sinal, animando }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // Refs, e não estado: mudam a cada quadro e não podem re-renderizar o React.
  const alvo = useRef({ estado, recuo, tinta, animando });
  alvo.current = { estado, recuo, tinta, animando };
  const pulsos = useRef<{ t0: number; f: number }[]>([]);
  const energia = useRef(0);
  const retomar = useRef<(() => void) | null>(null);

  const pulsar = (forca: number) => {
    pulsos.current.push({ t0: performance.now(), f: forca });
    energia.current = Math.min(1.4, energia.current + forca * 0.6);
    retomar.current?.();
  };

  // A primeira contagem é o que já estava na tela: não é fala nova.
  const falasAntes = useRef(falas);
  useEffect(() => {
    if (falas > falasAntes.current) pulsar(1);
    falasAntes.current = falas;
  }, [falas]);

  const sinalAntes = useRef(sinal);
  useEffect(() => {
    if (sinal !== sinalAntes.current && sinal !== undefined && sinal !== '') pulsar(0.3);
    sinalAntes.current = sinal;
  }, [sinal]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let L = 1;
    let A = 1;
    let fase = 0;
    let anterior = 0;
    let quadro = 0;
    let amp = PERFIL[alvo.current.estado].a;
    let recuoAtual = alvo.current.recuo;
    let tintaAtual = alvo.current.tinta;

    const medir = () => {
      const r = canvas.getBoundingClientRect();
      L = Math.max(1, r.width);
      A = Math.max(1, r.height);
      const d = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(L * d);
      canvas.height = Math.round(A * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
    };

    const desenhar = (t: number) => {
      quadro = 0;
      const dt = Math.min(48, t - (anterior || t - 16));
      anterior = t;
      const { estado: e, recuo: r, tinta: ti, animando: anima } = alvo.current;
      const p = PERFIL[e];
      if (anima) fase += dt * p.v;
      const k = anima ? 1 - Math.exp(-dt / 260) : 1;
      amp += (p.a - amp) * k;
      recuoAtual += (r - recuoAtual) * k;
      tintaAtual += (ti - tintaAtual) * (anima ? 1 - Math.exp(-dt / 600) : 1);
      energia.current *= 0.972;
      ctx.clearRect(0, 0, L, A);

      const verde = mistura(VERDE, VIOLETA, tintaAtual);
      const brilho = mistura(BRILHO, VIOLETA_BRILHO, tintaAtual);
      const eixo = A * 0.76 + Math.sin(fase * 1.4) * 4;
      const rc = recuoAtual;
      const en = energia.current;

      if (rc > 0.01) {
        // O clarão, morrendo dentro do canvas: sem aresta para revelar.
        const clarao = ctx.createRadialGradient(
          L / 2, eixo, 2,
          L / 2, eixo, Math.max(L * 0.55, A * 0.7),
        );
        clarao.addColorStop(0, `rgba(${verde}, ${0.07 * rc * (1 + en * 0.6)})`);
        clarao.addColorStop(0.5, `rgba(${verde}, ${0.022 * rc})`);
        clarao.addColorStop(1, `rgba(${verde}, 0)`);
        ctx.fillStyle = clarao;
        ctx.fillRect(0, 0, L, A);

        // As dobras neutras: profundidade, sem cor.
        for (let l = 0; l < 9; l++) {
          ctx.beginPath();
          for (let x = -10; x <= L + 10; x += 10) {
            const u = x / L;
            const y =
              eixo + 16 + l * 3.4 +
              Math.sin(u * 5.2 + fase * 0.65 + l * 0.08) * (9 + l * 0.6) +
              Math.cos(u * 3.4 - fase * 0.43) * 5;
            if (x === -10) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `rgba(179, 190, 184, ${(0.012 + Math.sin((l / 9) * Math.PI) * 0.03) * rc})`;
          ctx.lineWidth = l % 4 === 0 ? 0.9 : 0.55;
          ctx.stroke();
        }

        // Os pulsos: cada fala é um pacote que atravessa a onda.
        const ativos: [number, number][] = [];
        const lista = pulsos.current;
        for (let i = lista.length - 1; i >= 0; i--) {
          const pos = ((t - lista[i]!.t0) / TRAVESSIA_MS) * 1.4 - 0.2;
          if (pos > 1.3) lista.splice(i, 1);
          else ativos.push([pos, lista[i]!.f]);
        }

        const camadas = 15;
        const meio = 7;
        for (let linha = 0; linha < camadas; linha++) {
          for (let x = 0; x < L; x += 5) {
            const u = x / L;
            const env = Math.pow(Math.max(0, Math.sin(Math.PI * u)), 1.2);
            let pac = 0;
            for (const [pos, f] of ativos) pac += f * Math.exp(-((u - pos) ** 2) / 0.009);
            const a = (amp + en * 8) * (1 + pac * 1.5) * rc;
            const y =
              eixo + Math.sin(u * 8.4 - fase * 1.4 + linha * 0.09) * a * env + (linha - meio) * 2.5;
            const alfa = 0.42 * rc * env * (1 - Math.abs(linha - meio) / 10) * (1 + pac * 0.9);
            const central = linha === meio;
            const raio = central ? 1.1 : 0.6;
            ctx.fillStyle = central
              ? `rgba(${brilho}, ${Math.min(1, alfa * 1.9)})`
              : `rgba(${verde}, ${alfa})`;
            ctx.fillRect(x - raio, y - raio, raio * 2, raio * 2);
            // As hastes da linha central: a leitura de "espectro".
            if (central && x % 20 === 0) {
              const pico = Math.pow(Math.abs(Math.sin(x * 7.79)), 3);
              const sub =
                (5 + pico * 26) * env * (0.82 + Math.sin(fase * 2 + x) * 0.18) * rc * (1 + pac * 2.2);
              ctx.strokeStyle = `rgba(${verde}, ${Math.min(0.8, env * 0.26 * rc * (1 + pac))})`;
              ctx.lineWidth = 0.6;
              ctx.beginPath();
              ctx.moveTo(x, y);
              ctx.lineTo(x, y - sub);
              ctx.stroke();
              ctx.fillStyle = `rgba(${brilho}, ${Math.min(1, env * 0.75 * rc * (1 + pac * 0.5))})`;
              ctx.fillRect(x - 1.1, y - sub - 1.1, 2.2, 2.2);
            }
          }
        }
      }

      // Continua enquanto houver o que mudar; parada, a onda não pede quadro.
      const chegando =
        Math.abs(p.a - amp) > 0.2 ||
        Math.abs(r - recuoAtual) > 0.004 ||
        Math.abs(ti - tintaAtual) > 0.004;
      if (anima || chegando || pulsos.current.length > 0 || energia.current > 0.01) {
        quadro = requestAnimationFrame(desenhar);
      }
    };

    const reacender = () => {
      if (quadro) return;
      anterior = 0;
      quadro = requestAnimationFrame(desenhar);
    };
    retomar.current = reacender;

    medir();
    reacender();
    const observador = new ResizeObserver(() => {
      medir();
      reacender();
    });
    observador.observe(canvas);
    return () => {
      retomar.current = null;
      observador.disconnect();
      if (quadro) cancelAnimationFrame(quadro);
    };
  }, []);

  // O alvo mudou, ou a animação voltou: o laço pode ter parado sozinho.
  useEffect(() => {
    retomar.current?.();
  }, [estado, recuo, tinta, animando]);

  /*
   * O que a onda está fazendo vai no DOM: é comportamento do produto ("a onda
   * passa ao violeta enquanto o assistente responde"), e sem os atributos ele só
   * seria verificável olhando pixels.
   */
  return (
    <canvas
      ref={ref}
      className="tq-onda"
      data-estado={estado}
      data-tinta={tinta >= 0.5 ? 'ideias' : 'pessoas'}
      aria-hidden="true"
    />
  );
}
