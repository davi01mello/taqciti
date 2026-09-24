/**
 * A BOLINHA NA ONDA — o sinal de atividade do agente.
 *
 * ── O que ela é, e o que ela NÃO é ───────────────────────────────────────
 *
 * É a onda da marca, pequena, com uma bolinha correndo por cima dela — como
 * quem surfa a curva. Aparece onde o agente age: no seletor "Conversa" e dentro
 * da conversa. NÃO substitui a marca: `Wave` continua sendo o símbolo do
 * produto na cápsula, na pergunta e no ícone da extensão, e `Wordmark` continua
 * no cabeçalho.
 *
 * ── Por que não é mais uma carinha ───────────────────────────────────────
 *
 * Eram dois olhos sobre a onda, com piscadas. Uma mascote antropomórfica dá ao
 * indicador uma promessa que o produto não cumpre — "alguém está te ouvindo" —
 * e aqui não há ninguém ouvindo: não há rota de conversa no servidor, e a
 * extensão nunca tocou em microfone. A bolinha diz a mesma coisa que importa
 * (parado, acelerando, trabalhando) sem fingir presença.
 *
 * ── Sobre áudio ──────────────────────────────────────────────────────────
 *
 * A altura da onda e o salto da bolinha NÃO acompanham volume de voz: não há
 * amplitude de áudio disponível em lugar nenhum desta extensão (ver o cabeçalho
 * de `OndaDaCaptura.tsx`). O movimento é senoidal contínuo, modulado pelo
 * estado do agente — que é um fato verdadeiro sobre o sistema.
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
  /** Velocidade do passeio da bolinha ao longo da onda. 0 a deixa parada. */
  passeio: number;
  /** Altura do salto acima da curva, em fração do lado. 0 a faz deslizar. */
  quique: number;
}

const ALVOS: Record<AtividadeDoAgente, Alvo> = {
  // Vivo, mas quieto: ondulação delicada e um passeio lento, quase deslizando.
  repouso: { amplitude: 0.05, velocidade: 0.95, verde: 0, passeio: 0.8, quique: 0.015 },
  // Atenção: a onda acelera e a bolinha começa a quicar.
  preparando: { amplitude: 0.085, velocidade: 2.1, verde: 0.5, passeio: 1.9, quique: 0.055 },
  // Respondendo: mais ativa, ainda suave.
  escrevendo: { amplitude: 0.132, velocidade: 3.1, verde: 0.8, passeio: 2.8, quique: 0.085 },
  // Acomodação: o alvo já é o repouso; quem faz a descida é o amortecimento.
  concluido: { amplitude: 0.05, velocidade: 1.1, verde: 0.18, passeio: 1, quique: 0.02 },
  // Falha: a onda achata e a bolinha pousa nela. Nada de verde.
  falhou: { amplitude: 0.012, velocidade: 0.4, verde: 0, passeio: 0, quique: 0 },
  // Cancelado: mesma quietude da falha, sem o âmbar (ver `corDoTraco`).
  cancelado: { amplitude: 0.016, velocidade: 0.4, verde: 0, passeio: 0, quique: 0 },
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
    let passeio = ALVOS.repouso.passeio;
    let quique = ALVOS.repouso.quique;
    let ambar = 0;
    /** Onde a bolinha está no percurso. Vira ida e volta por um seno. */
    let percurso = 0;
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
        // valores vão direto para o alvo, e nem a fase nem o percurso avançam.
        amplitude = alvo.amplitude;
        velocidade = alvo.velocidade;
        verde = alvo.verde;
        passeio = alvo.passeio;
        quique = 0;
        ambar = estadoRef.current === 'falhou' ? 1 : 0;
      } else {
        amplitude = amortecer(amplitude, alvo.amplitude, dt, 3.4);
        velocidade = amortecer(velocidade, alvo.velocidade, dt, 3);
        verde = amortecer(verde, alvo.verde, dt, 2.6);
        passeio = amortecer(passeio, alvo.passeio, dt, 2.4);
        quique = amortecer(quique, alvo.quique, dt, 3);
        ambar = amortecer(ambar, estadoRef.current === 'falhou' ? 1 : 0, dt, 3);
        fase += dt * velocidade * Math.PI;
        percurso += dt * passeio;
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

      // ---- a bolinha ----
      /*
       * Ela SURFA a curva: a posição horizontal vai e volta por um seno — que
       * desacelera sozinho nas pontas, como quem vira no fim da onda —, e a
       * altura é a da própria onda naquele x, menos o raio, para a bolinha
       * tocar a linha em vez de cruzá-la.
       *
       * O quique é um segundo seno, mais rápido, sempre POSITIVO (`abs`): ele
       * só levanta a bolinha, nunca a afunda dentro do traço. Quanto mais o
       * agente trabalha, mais alto o salto.
       */
      const raio = L * 0.1;
      const fracao = 0.5 + 0.5 * Math.sin(percurso);
      const xBola = esq + (dir - esq) * fracao;
      const yOnda = base + Math.sin(fracao * Math.PI * 2.4 + fase) * amp;
      const salto = L * quique * Math.abs(Math.sin(percurso * 3));
      const yBola = yOnda - raio - salto;

      // O rastro do salto: some quando a bolinha está pousada.
      if (salto > 0.5) {
        ctx.globalAlpha = Math.min(0.35, salto / (L * 0.12));
        ctx.beginPath();
        ctx.moveTo(xBola, yOnda - raio * 0.2);
        ctx.lineTo(xBola, yBola);
        ctx.strokeStyle = cor;
        ctx.lineWidth = Math.max(1, L * 0.03);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = misturar(
        [238, 240, 242],
        ambar > 0.5 ? AMBAR : VERDE,
        Math.max(verde * 0.55, ambar * 0.7),
      );
      ctx.beginPath();
      ctx.arc(xBola, yBola, raio, 0, Math.PI * 2);
      ctx.fill();

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
