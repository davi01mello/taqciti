/**
 * O fundo vivo da HOME: dobras neutras ao alto e a onda sonora verde embaixo.
 *
 * ── O corte horizontal, e por que ele existia ──────────────────────────────
 *
 * O clarão da onda é um gradiente RADIAL. Ele era pintado dentro de um
 * retângulo mais baixo do que o próprio raio do gradiente — `fillRect(0, eixo -
 * 0.3h, w, 0.6h)` com raio `0.5w`. Numa janela larga, `0.5w` é muito maior que
 * `0.3h`: nas bordas de cima e de baixo do retângulo o gradiente ainda estava
 * bem longe de zero, e a pintura simplesmente PARAVA ali. O resultado é uma
 * linha reta atravessando a tela — a "divisão horizontal" que separava a região
 * da animação do resto da página.
 *
 * A correção não é apagar a onda: é pintar o clarão na tela inteira e deixar o
 * gradiente morrer sozinho. Um gradiente radial que chega a alpha 0 dentro do
 * canvas não tem borda para revelar. O canvas ainda ganha uma máscara suave no
 * topo (ver `home.css`), para a camada inteira se dissolver no fundo em vez de
 * terminar num retângulo.
 *
 * ── Por que a onda mora no FLUXO, e não presa na janela ────────────────────
 *
 * Este canvas é posicionado dentro do palco da conversa, logo atrás do campo de
 * escrita, e rola com a página. Subir para reler o histórico tira a escrita E a
 * onda da área visível, como numa página de verdade. Uma cópia fixa
 * acompanhando a leitura era a mentira mais visível da versão anterior.
 *
 * ── Os estados são os do produto, não do enfeite ───────────────────────────
 *
 * `captando` só existe quando há captura de legenda ACONTECENDO. `escrita` é o
 * campo em foco: a onda sobe enquanto se escreve e volta ao repouso no envio.
 * A troca entre eles é INTERPOLADA no laço de desenho, não um salto de valor —
 * um degrau de amplitude lê como falha de renderização, não como reação.
 *
 * ── Custo ──────────────────────────────────────────────────────────────────
 *
 * O laço desenha milhares de partículas por quadro (o passo em x é fixo em
 * 6px, e não proporcional à largura: numa tela larga isso é mais partícula,
 * que é exatamente o que se quer — a onda não "estica"). Por isso cada
 * partícula é um `fillRect`, não um `arc`+`fill`: na escala de ~1px de raio
 * as duas formas são indistinguíveis, mas `arc` tesselava uma curva por
 * partícula, e era o maior custo do laço. O devicePixelRatio é limitado a
 * 1,5 porque acima disso o ganho visual some e o custo dobra.
 */
import { useEffect, useRef } from 'react';

export type EstadoDaOnda = 'repouso' | 'escrita' | 'captando';

interface Props {
  estado: EstadoDaOnda;
  animando: boolean;
  /** Empurrão momentâneo de energia — um gesto real da pessoa. Decai sozinho. */
  pulso: number;
  /** A onda recua quando a leitura é o assunto da tela (listas, tutoriais). */
  discreta: boolean;
}

/** Intensidade por estado: amplitude base e velocidade do tempo. */
const PERFIL: Record<EstadoDaOnda, { amplitude: number; velocidade: number }> = {
  repouso: { amplitude: 38, velocidade: 0.00019 },
  escrita: { amplitude: 76, velocidade: 0.00052 },
  captando: { amplitude: 88, velocidade: 0.00042 },
};

/** Lê uma cor do tema como `r, g, b` para o canvas montar rgba() sozinho. */
function canais(nome: string, reserva: string): string {
  const valor = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
  return valor || reserva;
}

export function WaveField({ estado, animando, pulso, discreta }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // Refs, e não estado: mudam a cada quadro e não podem re-renderizar o React.
  const estadoRef = useRef(estado);
  const discretaRef = useRef(discreta);
  const pulsoRef = useRef(0);
  const animandoRef = useRef(animando);
  const retomarRef = useRef<(() => void) | null>(null);

  estadoRef.current = estado;
  discretaRef.current = discreta;
  animandoRef.current = animando;

  // Um `pulso` novo soma energia; o decaimento acontece no laço de desenho.
  useEffect(() => {
    if (pulso > 0) pulsoRef.current = Math.min(1.4, pulsoRef.current + pulso);
  }, [pulso]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const verde = canais('--c-primary', '92 203 133').replace(/\s+/g, ', ');
    const brilho = canais('--c-glow', '144 223 173').replace(/\s+/g, ', ');

    let largura = 1;
    let altura = 1;
    let fase = 0;
    let anterior = 0;
    let quadro = 0;

    /*
     * Os valores DESENHADOS, que perseguem os do perfil. A subida ao começar a
     * escrever e a volta ao repouso depois do envio são esta perseguição — e é
     * por isso que elas não deslocam nada: o que muda é a forma pintada no
     * canvas, nunca o layout.
     */
    let amplitudeAtual = PERFIL.repouso.amplitude;
    let recuoAtual = 1;

    const medir = () => {
      const r = canvas.getBoundingClientRect();
      largura = Math.max(1, r.width);
      altura = Math.max(1, r.height);
      const d = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(largura * d);
      canvas.height = Math.round(altura * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
    };

    const desenhar = (t: number) => {
      quadro = 0;
      const dt = Math.min(48, t - (anterior || t - 16));
      anterior = t;

      const perfil = PERFIL[estadoRef.current];
      if (animandoRef.current) fase += dt * perfil.velocidade;
      pulsoRef.current *= 0.972;

      // Interpolação exponencial: mesma suavidade a 60Hz e a 144Hz.
      const k = 1 - Math.exp(-dt / 260);
      amplitudeAtual += (perfil.amplitude - amplitudeAtual) * k;
      recuoAtual += ((discretaRef.current ? 0.4 : 1) - recuoAtual) * k;
      const recuo = recuoAtual;

      ctx.clearRect(0, 0, largura, altura);

      // --- 1. Dobras neutras: profundidade, sem cor. Elas atravessam a camada
      // inteira e é sobre elas que a navegação translúcida se lê.
      //
      // Cinza puro, e não o cinza levemente esverdeado de antes: era uma das
      // fontes do verde espalhado pela página. Aqui o trabalho é profundidade,
      // e profundidade não tem matiz.
      const centro = altura * 0.42 + Math.sin(fase) * 22;
      const halo = ctx.createRadialGradient(
        largura * 0.5, centro, 0,
        largura * 0.5, centro, Math.max(largura, altura) * 0.72,
      );
      halo.addColorStop(0, 'rgba(66, 69, 73, 0.2)');
      halo.addColorStop(0.5, 'rgba(38, 40, 43, 0.12)');
      halo.addColorStop(1, 'rgba(22, 23, 25, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, largura, altura);

      const linhas = 26;
      for (let linha = 0; linha < linhas; linha++) {
        ctx.beginPath();
        for (let x = -10; x <= largura + 15; x += 12) {
          const u = x / largura;
          const y =
            centro + 60 + linha * (altura * 0.012) +
            Math.sin(u * 6.1 + fase * 0.65 + linha * 0.063) * (55 + linha * 0.9) +
            Math.cos(u * 3.8 - fase * 0.43) * 20;
          if (x === -10) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(179, 190, 184, ${(0.01 + Math.sin((linha / linhas) * Math.PI) * 0.028) * recuo})`;
        ctx.lineWidth = linha % 4 === 0 ? 1.1 : 0.65;
        ctx.stroke();
      }

      // --- 2. A onda verde. É ela que carrega o estado do produto.
      const amplitude = (amplitudeAtual + pulsoRef.current * 26) * recuo;
      const eixo = altura * 0.74 + Math.sin(fase * 1.4) * 12;

      /*
       * O clarão, pintado na TELA INTEIRA.
       *
       * Era um `fillRect` de 60% da altura, e a borda desse retângulo era o
       * corte horizontal. Pintando tudo, quem decide onde a luz acaba é o
       * próprio gradiente — e ele cai muito antes da borda do canvas, então não
       * há aresta para aparecer. O custo é o mesmo: um `fillRect` é um
       * `fillRect`.
       *
       * ── Por que ele quase sumiu ──────────────────────────────────────────
       *
       * Esta era a principal fonte de verde da interface: um halo com 8,5% de
       * alfa sobre meia tela não é um detalhe da onda, é um filtro verde na
       * página inteira — e é o que fazia o grafite do fundo, o texto e as
       * superfícies puxarem para o verde. O alfa caiu para um terço e a luz
       * ficou colada na onda. Quem carrega o verde agora são as partículas
       * abaixo, que é onde ele significa alguma coisa.
       */
      const alcance = Math.max(largura * 0.36, altura * 0.52);
      const clarao = ctx.createRadialGradient(
        largura * 0.5, eixo, 2,
        largura * 0.5, eixo, alcance,
      );
      clarao.addColorStop(0, `rgba(${verde}, ${0.03 * recuo})`);
      clarao.addColorStop(0.5, `rgba(${verde}, ${0.011 * recuo})`);
      clarao.addColorStop(1, `rgba(${verde}, 0)`);
      ctx.fillStyle = clarao;
      ctx.fillRect(0, 0, largura, altura);

      const camadas = 19;
      const meio = (camadas - 1) / 2;
      for (let linha = 0; linha < camadas; linha++) {
        for (let x = 0; x < largura; x += 6) {
          const u = x / largura;
          // Envelope: a onda nasce e morre nas bordas em vez de ser cortada.
          const env = Math.pow(Math.max(0, Math.sin(Math.PI * u)), 1.2);
          const y =
            eixo +
            Math.sin(u * 8.4 - fase * 1.4 + linha * 0.09) * amplitude * env +
            (linha - meio) * 3.4;
          const alfa = 0.4 * recuo * env * (1 - Math.abs(linha - meio) / 14);
          const central = linha === Math.round(meio);

          /*
           * `fillRect`, não `arc`+`fill`: nesta escala (raio de ~1px) um
           * quadrado e um círculo são indistinguíveis, mas o círculo exige
           * tesselar uma curva a cada uma das milhares de partículas por
           * quadro. Era o maior custo do laço — trocar a forma, não a
           * quantidade nem a cor, foi o que sobrou de banda para o resto da
           * página (o cursor incluso) parar de perder quadro.
           */
          const raio = central ? 1.25 : 0.7;
          ctx.fillStyle = central
            ? `rgba(${brilho}, ${alfa * 1.9})`
            : `rgba(${verde}, ${alfa})`;
          ctx.fillRect(x - raio, y - raio, raio * 2, raio * 2);

          // Hastes verticais na linha central: é o que dá leitura de
          // "espectro" em vez de "linha ondulando".
          if (central && x % 24 === 0) {
            const pico = Math.pow(Math.abs(Math.sin(x * 7.79)), 3);
            const subida =
              (12 + pico * 68) * env * (0.82 + Math.sin(fase * 2 + x) * 0.18) * recuo;
            ctx.strokeStyle = `rgba(${verde}, ${env * 0.24 * recuo})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x, y - subida);
            ctx.stroke();
            ctx.fillStyle = `rgba(${brilho}, ${env * 0.7 * recuo})`;
            ctx.fillRect(x - 1.1, y - subida - 1.1, 2.2, 2.2);
          }
        }
      }

      /*
       * Continua o laço enquanto houver o que mudar. "Parado" inclui ainda estar
       * chegando ao alvo: sem a comparação de amplitude, pausar o movimento no
       * meio de uma subida congelaria a onda a meio caminho.
       */
      const chegando =
        Math.abs(perfil.amplitude - amplitudeAtual) > 0.4 ||
        Math.abs((discretaRef.current ? 0.4 : 1) - recuoAtual) > 0.005;
      if (animandoRef.current || pulsoRef.current > 0.01 || chegando) {
        quadro = requestAnimationFrame(desenhar);
      }
    };

    /** Reacende o laço, se ele não estiver rodando. */
    const retomar = () => {
      if (quadro) return;
      anterior = 0;
      quadro = requestAnimationFrame(desenhar);
    };
    retomarRef.current = retomar;

    medir();
    retomar();

    const observador = new ResizeObserver(() => {
      medir();
      retomar();
    });
    observador.observe(canvas);

    return () => {
      retomarRef.current = null;
      observador.disconnect();
      if (quadro) cancelAnimationFrame(quadro);
    };
  }, []);

  // A animação voltou, ou o alvo mudou: o laço pode ter se encerrado sozinho.
  useEffect(() => {
    retomarRef.current?.();
  }, [animando, estado, discreta]);

  useEffect(() => {
    if (pulso > 0) retomarRef.current?.();
  }, [pulso]);

  /*
   * `data-estado` no elemento não é decoração: o que a onda está fazendo é um
   * comportamento do produto ("a onda sobe ao escrever, e volta ao repouso no
   * envio"), e sem isto ele só seria verificável olhando pixels. Com o atributo
   * o teste pergunta à árvore, e a regressão aparece antes do navegador.
   */
  return <canvas ref={ref} className="tq-wave" data-estado={estado} aria-hidden="true" />;
}
