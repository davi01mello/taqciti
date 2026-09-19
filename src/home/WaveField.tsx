/**
 * O fundo vivo da HOME: dobras neutras ao alto e a onda sonora verde embaixo.
 *
 * ── Por que a onda fica VISÍVEL, e não decorativa ──────────────────────────
 *
 * O jeito fácil de resolver "fundo animado que não atrapalha a leitura" é
 * afogar a onda: baixar a opacidade até ela virar textura, ou cobri-la com um
 * painel opaco. Os dois apagam justamente o que dá identidade à tela. O que
 * separa as duas coisas aqui não é opacidade, é GEOMETRIA: a onda mora na
 * faixa de baixo (≈78% da altura), onde não há texto, e o conteúdo vive numa
 * coluna centrada com fundo transparente. Ninguém precisa sumir para o outro
 * aparecer.
 *
 * O envelope `sin(πu)` é o que mantém isso verdadeiro quando a janela é larga:
 * a onda nasce e morre nas bordas em vez de bater na lateral, então numa tela
 * ampla ela continua sendo uma forma, e não uma listra de ponta a ponta.
 *
 * ── Os estados são os do produto, não do enfeite ───────────────────────────
 *
 * `captando` só existe quando há captura de legenda ACONTECENDO — vem de
 * `MeetingState.phase === 'recording'`, não de um timer. Sem reunião ao vivo a
 * onda respira devagar, porque é isso que está acontecendo. Uma onda que
 * "escuta" com o microfone desligado seria uma mentira animada.
 *
 * ── Custo ──────────────────────────────────────────────────────────────────
 *
 * O laço desenha ~1.900 partículas por quadro. O passo em x é fixo em 6px, e
 * não proporcional à largura: numa tela de 2.560px isso é mais partícula, que
 * é exatamente o que se quer (a onda não "estica"). O devicePixelRatio é
 * limitado a 1,5 porque acima disso o ganho visual some e o custo dobra.
 */
import { useEffect, useRef } from 'react';

export type EstadoDaOnda = 'repouso' | 'captando' | 'processando';

interface Props {
  estado: EstadoDaOnda;
  animando: boolean;
  /** Empurrão momentâneo de energia — um gesto real da pessoa (enviar uma
   *  mensagem, digitar). Decai sozinho; não é um estado. */
  pulso: number;
  /** A onda recua quando a leitura é o assunto da tela (listas, tutoriais). */
  discreta: boolean;
}

/** Intensidade por estado: amplitude base e velocidade do tempo. */
const PERFIL: Record<EstadoDaOnda, { amplitude: number; velocidade: number }> = {
  repouso: { amplitude: 46, velocidade: 0.00019 },
  captando: { amplitude: 78, velocidade: 0.00042 },
  processando: { amplitude: 62, velocidade: 0.0009 },
};

/** Lê uma cor do tema como `r, g, b` para o canvas montar rgba() sozinho.
 *  Mantém canvas e CSS na mesma fonte (tokens.css) em vez de duplicar hex. */
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
  /** Reagenda o laço depois de ele ter se encerrado sozinho (pausa, aba
   *  oculta). Preenchido pelo efeito principal; chamado pelo efeito de
   *  retomada abaixo. */
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

    // "92 203 133" (formato dos tokens) -> "92, 203, 133" (formato do rgba).
    // Convertido uma vez: dentro do laço isto rodaria milhares de vezes por
    // quadro.
    const verde = canais('--c-primary', '92 203 133').replace(/\s+/g, ', ');
    const brilho = canais('--c-glow', '144 223 173').replace(/\s+/g, ', ');

    let largura = 1;
    let altura = 1;
    let fase = 0;
    let anterior = 0;
    let quadro = 0;

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

      const recuo = discretaRef.current ? 0.42 : 1;
      ctx.clearRect(0, 0, largura, altura);

      // --- 1. Dobras neutras: profundidade, sem cor. Elas atravessam a tela
      // inteira e é sobre elas que a navegação translúcida se lê.
      const centro = altura * 0.5 + Math.sin(fase) * 22;
      const halo = ctx.createRadialGradient(
        largura * 0.5, centro, 0,
        largura * 0.5, centro, Math.max(largura, altura) * 0.72,
      );
      halo.addColorStop(0, 'rgba(62, 70, 66, 0.26)');
      halo.addColorStop(0.5, 'rgba(36, 43, 41, 0.18)');
      halo.addColorStop(1, 'rgba(21, 24, 25, 0)');
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
        ctx.strokeStyle = `rgba(179, 190, 184, ${(0.012 + Math.sin((linha / linhas) * Math.PI) * 0.034) * recuo})`;
        ctx.lineWidth = linha % 4 === 0 ? 1.1 : 0.65;
        ctx.stroke();
      }

      // --- 2. A onda verde. É ela que carrega o estado do produto.
      const amplitude = (perfil.amplitude + pulsoRef.current * 26) * recuo;
      const eixo = altura * 0.78 + Math.sin(fase * 1.4) * 12;

      const clarao = ctx.createRadialGradient(
        largura * 0.5, eixo, 2,
        largura * 0.5, eixo, largura * 0.5,
      );
      clarao.addColorStop(0, `rgba(${verde}, ${0.075 * recuo})`);
      clarao.addColorStop(1, `rgba(${verde}, 0)`);
      ctx.fillStyle = clarao;
      ctx.fillRect(0, eixo - altura * 0.3, largura, altura * 0.6);

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

          ctx.fillStyle = central
            ? `rgba(${brilho}, ${alfa * 1.9})`
            : `rgba(${verde}, ${alfa})`;
          ctx.beginPath();
          ctx.arc(x, y, central ? 1.25 : 0.7, 0, Math.PI * 2);
          ctx.fill();

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
            ctx.beginPath();
            ctx.arc(x, y - subida, 1.1, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Continua o laço só enquanto houver o que mudar. Parado com pulso
      // residual ainda desenha, para a energia terminar de decair na tela.
      if (animandoRef.current || pulsoRef.current > 0.01) {
        quadro = requestAnimationFrame(desenhar);
      }
    };

    /** Reacende o laço, se ele não estiver rodando. `anterior = 0` zera o
     *  delta: sem isso, voltar de uma aba oculta por dez minutos entregaria um
     *  `dt` gigante e a onda daria um salto. */
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
      // Redesenha já: sem isto, redimensionar com a animação pausada deixaria
      // o canvas limpo — a onda sumiria justamente para quem pediu menos
      // movimento.
      retomar();
    });
    observador.observe(canvas);

    return () => {
      retomarRef.current = null;
      observador.disconnect();
      if (quadro) cancelAnimationFrame(quadro);
    };
  }, []);

  // A animação voltou (aba visível de novo, pausa desfeita): o laço já se
  // encerrou sozinho, então precisa ser reaceso de fora.
  useEffect(() => {
    if (animando) retomarRef.current?.();
  }, [animando]);

  // Um pulso também precisa reacender o laço — é ele que desenha o decaimento.
  useEffect(() => {
    if (pulso > 0) retomarRef.current?.();
  }, [pulso]);

  return <canvas ref={ref} className="tq-wave" aria-hidden="true" />;
}
