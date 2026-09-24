/**
 * A ANIMAÇÃO DA CAPTURA — o sinal de que a transcrição está viva.
 *
 * ── O que ela representa, e o que ela não mede ───────────────────────────
 *
 * O estado da captura de LEGENDAS, e só isso. Não é medidor de áudio: a
 * extensão nunca ouviu microfone nenhum, e uma animação que subisse com a voz
 * de quem fala prometeria uma captura que não existe. O que ela mostra é
 * "ligada e recebendo", "pausada", "interrompida" — e a reação discreta a cada
 * trecho novo que entra.
 *
 * ── Por que ela mora no seletor ──────────────────────────────────────────
 *
 * O requisito é explícito: não pode depender de a seção "Transcrição" estar
 * aberta. Como o seletor está sempre na tela, é dele que o movimento sai — quem
 * está lendo a conversa continua vendo que a captura corre.
 *
 * ── As transições ────────────────────────────────────────────────────────
 *
 * Pausar não estanca o movimento: a amplitude cai até o repouso, e as barras
 * ficam paradas na altura de base. Retomar sobe de novo pelo mesmo caminho.
 * Interrompida é um estado PRÓPRIO — as barras achatam numa linha âmbar que
 * respira devagar, para não continuar comunicando captura normal.
 */
import { useEffect, useRef } from 'react';
import { useAnimacao } from '@/home/useAnimacao';

export type EstadoDaCaptura =
  /** Legendas chegando: movimento contínuo. */
  | 'capturando'
  /** Ligando as legendas do Meet — ainda não há o que capturar. */
  | 'preparando'
  /** Pausa pedida por quem está na reunião. */
  | 'pausada'
  /** Legenda na tela que a captura não consegue ler. Estado próprio. */
  | 'interrompida'
  /** Reunião encerrada e salva. */
  | 'salva'
  /** Sem captura: não há reunião, ou o registro foi recusado. */
  | 'desligada';

interface Props {
  estado: EstadoDaCaptura;
  /**
   * Um número que SOBE a cada trecho novo. O valor não importa; a mudança sim —
   * é ela que dispara a reação discreta. Contar trechos é o sinal honesto mais
   * próximo de "chegou coisa nova".
   */
  pulso?: number;
  largura?: number;
  altura?: number;
  className?: string;
}

interface Alvo {
  /** Altura oscilante, em fração da altura útil. */
  amplitude: number;
  velocidade: number;
  /** 0 = grafite; 1 = verde. */
  verde: number;
  /** 0 = barras; 1 = linha achatada (o desenho da interrupção). */
  achatado: number;
  ambar: number;
  opacidade: number;
}

const ALVOS: Record<EstadoDaCaptura, Alvo> = {
  capturando: { amplitude: 0.72, velocidade: 2.5, verde: 1, achatado: 0, ambar: 0, opacidade: 1 },
  preparando: { amplitude: 0.3, velocidade: 1.1, verde: 0.25, achatado: 0, ambar: 0.45, opacidade: 0.9 },
  pausada: { amplitude: 0, velocidade: 0.6, verde: 0, achatado: 0, ambar: 0.3, opacidade: 0.85 },
  interrompida: { amplitude: 0, velocidade: 0.5, verde: 0, achatado: 1, ambar: 1, opacidade: 1 },
  salva: { amplitude: 0, velocidade: 0.4, verde: 0.35, achatado: 0, ambar: 0, opacidade: 0.75 },
  desligada: { amplitude: 0, velocidade: 0.4, verde: 0, achatado: 0, ambar: 0, opacidade: 0.5 },
};

/** Cinco barras: o suficiente para ler como onda, estreito o bastante para 26px. */
const BARRAS = 5;
/** Defasagem entre as barras — é o que faz a onda correr em vez de pulsar junto. */
const DEFASAGEM = 0.85;
/** Alturas de repouso, em fração. A do meio é a mais alta, como na marca. */
const REPOUSO = [0.3, 0.46, 0.6, 0.46, 0.3];

const NEUTRO = [150, 153, 157] as const;
const VERDE = [144, 223, 173] as const;
const AMBAR = [240, 198, 160] as const;

function misturar(a: readonly number[], b: readonly number[], t: number): string {
  const m = (i: number) => Math.round(a[i]! + (b[i]! - a[i]!) * t);
  return `rgb(${m(0)} ${m(1)} ${m(2)})`;
}

function amortecer(atual: number, alvo: number, dt: number, k: number): number {
  return atual + (alvo - atual) * Math.min(1, dt * k);
}

export function OndaDaCaptura({
  estado,
  pulso = 0,
  largura = 26,
  altura = 16,
  className,
}: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const estadoRef = useRef(estado);
  const animandoRef = useRef(true);
  const pulsoRef = useRef(pulso);
  /** Quanto resta da reação ao último trecho. Some sozinho. */
  const reacaoRef = useRef(0);
  const repintarRef = useRef<(() => void) | null>(null);
  const retomarRef = useRef<(() => void) | null>(null);

  const { animando } = useAnimacao(false);
  estadoRef.current = estado;
  animandoRef.current = animando;

  // Um trecho novo entrou. Só reage durante a captura: um "pulso" com a
  // transcrição pausada seria a animação contando uma história errada.
  useEffect(() => {
    if (pulso === pulsoRef.current) return;
    pulsoRef.current = pulso;
    if (estadoRef.current === 'capturando') reacaoRef.current = 1;
  }, [pulso]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.round((canvas.clientWidth || largura) * dpr);
    canvas.height = Math.round((canvas.clientHeight || altura) * dpr);
    const W = canvas.width;
    const H = canvas.height;

    let fase = 0;
    let amplitude = 0;
    let velocidade = 0.6;
    let verde = 0;
    let achatado = 0;
    let ambar = 0;
    let opacidade = 0.5;
    let respiro = 0;
    let anterior = 0;
    let quadro = 0;

    const desenhar = (t: number) => {
      const bruto = anterior === 0 ? 16 : t - anterior;
      anterior = t;
      const dt = Math.min(0.05, Math.max(0, bruto / 1000));
      const alvo = ALVOS[estadoRef.current];

      if (!animandoRef.current) {
        amplitude = 0;
        velocidade = alvo.velocidade;
        verde = alvo.verde;
        achatado = alvo.achatado;
        ambar = alvo.ambar;
        opacidade = alvo.opacidade;
        reacaoRef.current = 0;
      } else {
        amplitude = amortecer(amplitude, alvo.amplitude, dt, 2.8);
        velocidade = amortecer(velocidade, alvo.velocidade, dt, 3);
        verde = amortecer(verde, alvo.verde, dt, 3);
        achatado = amortecer(achatado, alvo.achatado, dt, 4);
        ambar = amortecer(ambar, alvo.ambar, dt, 3);
        opacidade = amortecer(opacidade, alvo.opacidade, dt, 4);
        fase += dt * velocidade * Math.PI;
        respiro += dt;
        if (reacaoRef.current > 0) {
          reacaoRef.current = Math.max(0, reacaoRef.current - dt * 2.2);
        }
      }

      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = opacidade;

      const cor =
        ambar > verde
          ? misturar(NEUTRO, AMBAR, ambar)
          : misturar(NEUTRO, VERDE, verde);
      ctx.fillStyle = cor;

      const vao = W / (BARRAS * 2 - 1);
      const larguraBarra = vao;
      const raio = larguraBarra / 2;
      // A interrupção: a linha respira devagar, e é o único movimento que resta.
      const pulsacaoDaFalha = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(respiro * 1.9));

      for (let i = 0; i < BARRAS; i++) {
        const repouso = REPOUSO[i]!;
        const onda = Math.sin(fase + i * DEFASAGEM);
        const reacao = reacaoRef.current * 0.3 * Math.sin(reacaoRef.current * Math.PI);
        const viva = repouso + (onda * 0.5 + 0.5) * amplitude * 0.55 + reacao;
        // Achatado leva TODAS as barras para a mesma altura mínima: o desenho da
        // interrupção é uma linha, e não um equalizador baixinho.
        const fracao = viva * (1 - achatado) + 0.16 * achatado;
        const alturaBarra = Math.max(
          larguraBarra,
          Math.min(H, H * fracao * (achatado > 0.5 ? pulsacaoDaFalha : 1)),
        );
        const x = i * vao * 2;
        const y = (H - alturaBarra) / 2;

        ctx.beginPath();
        ctx.roundRect(x, y, larguraBarra, alturaBarra, raio);
        ctx.fill();
      }

      ctx.globalAlpha = 1;

      if (animandoRef.current) quadro = requestAnimationFrame(desenhar);
      else quadro = 0;
    };

    repintarRef.current = () => {
      anterior = 0;
      desenhar(performance.now());
    };
    const retomar = () => {
      if (quadro) return;
      anterior = 0;
      quadro = requestAnimationFrame(desenhar);
    };
    retomarRef.current = retomar;

    if (animandoRef.current) retomar();
    else repintarRef.current();

    return () => {
      repintarRef.current = null;
      retomarRef.current = null;
      if (quadro) cancelAnimationFrame(quadro);
    };
    // Montagem apenas, pelo mesmo motivo de `AgenteOnda`: o laço não renasce a
    // cada trecho capturado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (animando) retomarRef.current?.();
    else repintarRef.current?.();
  }, [estado, animando]);

  return (
    <canvas
      ref={ref}
      className={className}
      style={{ width: largura, height: altura, display: 'block' }}
      aria-hidden="true"
    />
  );
}
