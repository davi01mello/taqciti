/**
 * A identidade circular do agente: três anéis de traços radiais que pulsam.
 *
 * Fica pequena, ao lado da resposta — é assinatura, não protagonista. Por isso
 * só a marca da ÚLTIMA mensagem anima; as anteriores ficam paradas e um pouco
 * mais apagadas. Com dez respostas na tela, dez círculos girando ao mesmo
 * tempo transformam uma leitura calma num mural de movimento, e o custo sobe
 * linearmente com o histórico.
 *
 * O canvas é fixo em 90×90 e o CSS o reduz: assim a marca fica nítida em telas
 * retina sem precisar de um `devicePixelRatio` próprio por instância.
 */
import { useEffect, useRef } from 'react';

interface Props {
  /** Só a marca ativa avança no tempo. */
  animada: boolean;
  /** `true` enquanto uma operação real está em curso — o pulso acelera. */
  processando?: boolean;
  tamanho?: number;
}

const LADO = 90;
const ANEIS = [
  { raio: 9, tracos: 35, largura: 1, alcance: 5 },
  { raio: 20, tracos: 56, largura: 1, alcance: 5 },
  { raio: 32, tracos: 80, largura: 1.5, alcance: 10 },
];

export function AgentMark({ animada, processando = false, tamanho = 30 }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const animadaRef = useRef(animada);
  const processandoRef = useRef(processando);
  /** Reacende o laço, que se encerra sozinho quando a marca deixa de ser a
   *  ativa. Declarado aqui, antes do efeito que o preenche, para a ordem de
   *  leitura bater com a ordem de uso. */
  const retomarRef = useRef<(() => void) | null>(null);
  animadaRef.current = animada;
  processandoRef.current = processando;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let quadro = 0;
    let fase = 0;
    let anterior = 0;

    const desenhar = (t: number) => {
      quadro = 0;
      const dt = Math.min(48, t - (anterior || t - 16));
      anterior = t;
      if (animadaRef.current) fase += dt * (processandoRef.current ? 0.0036 : 0.0011);

      ctx.clearRect(0, 0, LADO, LADO);
      ctx.save();
      ctx.translate(LADO / 2, LADO / 2);

      for (const anel of ANEIS) {
        for (let k = 0; k < anel.tracos; k++) {
          const theta = (k / anel.tracos) * Math.PI * 2;
          const pico = Math.pow(
            Math.max(0, Math.sin(k * 0.68 + anel.raio * 0.1 + fase * 0.9)),
            9,
          );
          const comprimento = 1.3 + pico * anel.alcance;
          ctx.strokeStyle =
            k % 7 === 0 ? 'rgba(212, 234, 217, 0.8)' : 'rgba(113, 199, 144, 0.72)';
          ctx.lineWidth = anel.largura;
          ctx.beginPath();
          ctx.moveTo(Math.cos(theta) * anel.raio, Math.sin(theta) * anel.raio);
          ctx.lineTo(
            Math.cos(theta) * (anel.raio + comprimento),
            Math.sin(theta) * (anel.raio + comprimento),
          );
          ctx.stroke();
        }
      }

      const luz = ctx.createRadialGradient(0, 0, 0, 0, 0, 9);
      luz.addColorStop(0, 'rgba(210, 234, 219, 0.69)');
      luz.addColorStop(0.3, 'rgba(142, 202, 162, 0.29)');
      luz.addColorStop(1, 'rgba(115, 217, 157, 0)');
      ctx.fillStyle = luz;
      ctx.fillRect(-10, -10, 20, 20);
      ctx.restore();

      if (animadaRef.current) quadro = requestAnimationFrame(desenhar);
    };

    const retomar = () => {
      if (quadro) return;
      anterior = 0;
      quadro = requestAnimationFrame(desenhar);
    };
    retomar();
    retomarRef.current = retomar;

    return () => {
      retomarRef.current = null;
      if (quadro) cancelAnimationFrame(quadro);
    };
  }, []);

  useEffect(() => {
    if (animada) retomarRef.current?.();
  }, [animada]);

  return (
    <canvas
      ref={ref}
      width={LADO}
      height={LADO}
      className="tq-agent"
      style={{ width: tamanho, height: tamanho }}
      aria-hidden="true"
    />
  );
}
