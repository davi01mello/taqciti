/**
 * A ONDINHA COM OLHOS — a expressão do agente na interface.
 *
 * ── O que ela é, e o que ela NÃO é ───────────────────────────────────────
 *
 * É o personagem do agente: a onda da marca, pequena, com dois olhos. Aparece
 * onde o agente age — no seletor "Conversa" e dentro da conversa. NÃO substitui
 * a marca: `Wave` continua sendo o símbolo do produto na cápsula, na pergunta e
 * no ícone da extensão, e `Wordmark` continua no cabeçalho. Um personagem no
 * lugar do logotipo seria a identidade trocada por uma mascote.
 *
 * ── Por que canvas, e por que UM laço só ─────────────────────────────────
 *
 * O requisito é literal: nada de recriar o ícone a cada trecho de resposta, e
 * nada de salto ao reiniciar o loop. As duas coisas saem da mesma decisão — o
 * laço de desenho nasce na MONTAGEM, com dependências vazias, e lê o estado por
 * `ref`. Trocar de estado não remonta nada: muda um alvo, e a fase do seno
 * continua exatamente de onde estava. Um componente que renascesse a cada
 * atualização de props começaria a onda do zero, e o salto seria visível.
 *
 * As transições são por AMORTECIMENTO, não por troca de valor: amplitude,
 * velocidade, verde e abertura dos olhos perseguem um alvo com uma constante de
 * tempo. É isso que faz "concluído" se acomodar no repouso em vez de estancar.
 *
 * ── Sobre a cor ──────────────────────────────────────────────────────────
 *
 * Grafite, branco e cinza dominam; o verde é pontual e só aparece quando há
 * processamento de verdade. Em repouso não há verde nenhum. Estes hex são os
 * mesmos de `--c-primary` / `--c-glow` em tokens.css — pelo mesmo motivo do
 * comentário em `Wave.tsx`, a cor precisa ser literal para entrar no canvas.
 */
import { useEffect, useRef } from 'react';
import type { AtividadeDoAgente } from '@/features/agent/atividade';
import { useAnimacao } from '@/home/useAnimacao';

interface Props {
  estado: AtividadeDoAgente;
  /** Lado do desenho em CSS px. O canvas interno escala por devicePixelRatio. */
  tamanho?: number;
  className?: string;
  /** Descrição para leitor de tela. Sem ela, o desenho é decorativo. */
  rotulo?: string;
}

/** Como cada estado quer a onda. Tudo aqui é ALVO, nunca valor aplicado direto. */
interface Alvo {
  /** Amplitude da onda, em fração da altura. */
  amplitude: number;
  /** Velocidade da fase. */
  velocidade: number;
  /** Quanto de verde entra no traço, 0..1. */
  verde: number;
  /** Abertura dos olhos, 0..1 — 1 é redondo, perto de 0 é um traço. */
  abertura: number;
  /** Deslocamento vertical dos olhos: negativo é "olhando para cima". */
  atencao: number;
  /** Segundos médios entre piscadas. 0 desliga o piscar. */
  piscaCada: number;
}

const ALVOS: Record<AtividadeDoAgente, Alvo> = {
  // Vivo, mas quieto: ondulação delicada e piscadas ocasionais.
  repouso: { amplitude: 0.05, velocidade: 0.95, verde: 0, abertura: 1, atencao: 0, piscaCada: 4.6 },
  // Atenção: a onda acelera e os olhos sobem um pouco, como quem escuta.
  preparando: { amplitude: 0.085, velocidade: 2.1, verde: 0.5, abertura: 1.08, atencao: -0.035, piscaCada: 7 },
  // Respondendo: mais ativa, ainda suave.
  escrevendo: { amplitude: 0.132, velocidade: 3.1, verde: 0.8, abertura: 1, atencao: -0.012, piscaCada: 5.5 },
  // Acomodação: o alvo já é o repouso; quem faz a descida é o amortecimento.
  concluido: { amplitude: 0.05, velocidade: 1.1, verde: 0.18, abertura: 1, atencao: 0, piscaCada: 3.2 },
  // Falha: a onda achata e os olhos viram traço. Nada de verde.
  falhou: { amplitude: 0.012, velocidade: 0.4, verde: 0, abertura: 0.16, atencao: 0.02, piscaCada: 0 },
  // Cancelado: mesma quietude da falha, sem o âmbar (ver `corDoTraco`).
  cancelado: { amplitude: 0.016, velocidade: 0.4, verde: 0, abertura: 0.3, atencao: 0.015, piscaCada: 0 },
};

/** Grafite claro: a cor de repouso do traço e dos olhos. */
const NEUTRO = [214, 217, 221] as const;
/** `--c-glow` — o verde só entra por interpolação, e só com processamento. */
const VERDE = [144, 223, 173] as const;
/** O âmbar de falha, o mesmo de `.tq-aviso-falha`. */
const AMBAR = [240, 198, 160] as const;

function misturar(a: readonly number[], b: readonly number[], t: number): string {
  const m = (i: number) => Math.round(a[i]! + (b[i]! - a[i]!) * t);
  return `rgb(${m(0)} ${m(1)} ${m(2)})`;
}

/** Persegue um alvo. `k` é quanto do caminho se anda por segundo. */
function amortecer(atual: number, alvo: number, dt: number, k: number): number {
  return atual + (alvo - atual) * Math.min(1, dt * k);
}

export function AgenteOnda({ estado, tamanho = 26, className, rotulo }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const estadoRef = useRef(estado);
  const animandoRef = useRef(true);
  /** O desenho de um quadro só, para repintar quando o movimento está desligado. */
  const repintarRef = useRef<(() => void) | null>(null);
  /** Reacende o laço quando o movimento volta a ser permitido. */
  const retomarRef = useRef<(() => void) | null>(null);

  const { animando } = useAnimacao(false);
  estadoRef.current = estado;
  animandoRef.current = animando;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const lado = canvas.clientWidth || tamanho;
    canvas.width = Math.round(lado * dpr);
    canvas.height = Math.round(lado * dpr);

    const L = canvas.width;
    // Estado contínuo do desenho. Vive fora do React de propósito: é o que faz
    // a onda atravessar as trocas de estado sem recomeçar.
    let fase = 0;
    let amplitude = ALVOS.repouso.amplitude;
    let velocidade = ALVOS.repouso.velocidade;
    let verde = 0;
    let abertura = 1;
    let atencao = 0;
    let ambar = 0;
    /** 0 = olho aberto; 1 = fechado. Sobe e desce numa piscada. */
    let piscada = 0;
    let proximaPiscada = 2.5;
    let relogio = 0;
    let anterior = 0;
    let quadro = 0;

    const corDoTraco = (): string => {
      const base = misturar(NEUTRO, VERDE, verde);
      if (ambar < 0.01) return base;
      // A falha some o verde e traz o âmbar; as duas misturas não se somam.
      return misturar(NEUTRO, AMBAR, ambar);
    };

    const desenhar = (t: number) => {
      const bruto = anterior === 0 ? 16 : t - anterior;
      anterior = t;
      // Teto no passo: voltar de uma aba oculta traria um salto de segundos.
      const dt = Math.min(0.05, Math.max(0, bruto / 1000));

      const alvo = ALVOS[estadoRef.current];
      const parado = !animandoRef.current;

      if (parado) {
        // Movimento reduzido: o estado continua legível, mas nada se mexe. Os
        // valores vão direto para o alvo, e a fase não avança.
        amplitude = alvo.amplitude;
        velocidade = alvo.velocidade;
        verde = alvo.verde;
        abertura = alvo.abertura;
        atencao = alvo.atencao;
        ambar = estadoRef.current === 'falhou' ? 1 : 0;
        piscada = 0;
      } else {
        relogio += dt;
        amplitude = amortecer(amplitude, alvo.amplitude, dt, 3.4);
        velocidade = amortecer(velocidade, alvo.velocidade, dt, 3);
        verde = amortecer(verde, alvo.verde, dt, 2.6);
        abertura = amortecer(abertura, alvo.abertura, dt, 6);
        atencao = amortecer(atencao, alvo.atencao, dt, 5);
        ambar = amortecer(ambar, estadoRef.current === 'falhou' ? 1 : 0, dt, 3);
        fase += dt * velocidade * Math.PI;

        // A piscada: um vaivém rápido, em instantes sorteados.
        if (alvo.piscaCada === 0) {
          piscada = 0;
        } else if (piscada > 0) {
          piscada -= dt * 7.5;
          if (piscada < 0) piscada = 0;
        } else if (relogio >= proximaPiscada) {
          piscada = 1;
          proximaPiscada = relogio + alvo.piscaCada * (0.6 + Math.random() * 0.8);
        }
      }

      ctx.clearRect(0, 0, L, L);

      const cor = corDoTraco();
      const base = L * 0.66;
      const esq = L * 0.12;
      const dir = L * 0.88;
      const amp = L * amplitude;

      // ---- a onda ----
      ctx.beginPath();
      for (let x = esq; x <= dir; x += L / 48) {
        const u = (x - esq) / (dir - esq);
        const y = base + Math.sin(u * Math.PI * 2.4 + fase) * amp;
        if (x === esq) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = cor;
      ctx.lineWidth = Math.max(1, L * 0.085);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      // ---- os olhos ----
      // Montam na onda: cada um segue a altura dela no seu x, para o conjunto
      // ler como uma carinha em vez de dois pontos soltos sobre um traço.
      const raio = L * 0.092;
      const alturaOlho = Math.max(L * 0.02, raio * abertura * (1 - piscada * 0.88));
      ctx.fillStyle = misturar(
        [238, 240, 242],
        ambar > 0.5 ? AMBAR : VERDE,
        Math.max(verde * 0.45, ambar * 0.7),
      );
      for (const fracao of [0.38, 0.62]) {
        const x = esq + (dir - esq) * fracao;
        const u = (x - esq) / (dir - esq);
        const yOnda = base + Math.sin(u * Math.PI * 2.4 + fase) * amp;
        const y = yOnda - L * 0.26 + L * atencao;
        ctx.beginPath();
        ctx.ellipse(x, y, raio * Math.min(1, abertura), alturaOlho, 0, 0, Math.PI * 2);
        ctx.fill();
      }

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
    // Montagem apenas: o laço não pode renascer a cada troca de estado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * Duas coisas, e as duas precisam acontecer sem remontar o canvas:
   *
   *  - o movimento voltou (a aba reapareceu, ou a preferência mudou): o laço
   *    precisa ser reaceso, porque ele se encerra sozinho quando não pode
   *    avançar;
   *  - o movimento está desligado e o estado mudou: um quadro novo precisa
   *    sair, senão a interface congela na expressão anterior.
   */
  useEffect(() => {
    if (animando) retomarRef.current?.();
    else repintarRef.current?.();
  }, [estado, animando]);

  return (
    <canvas
      ref={ref}
      className={className}
      style={{ width: tamanho, height: tamanho, display: 'block' }}
      role={rotulo ? 'img' : undefined}
      aria-label={rotulo}
      aria-hidden={rotulo ? undefined : true}
    />
  );
}
