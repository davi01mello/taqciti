/**
 * O cursor da HOME: um ponto verde no lugar exato do mouse e um halo que
 * chega atrasado.
 *
 * ── A regra que não pode ser quebrada ──────────────────────────────────────
 *
 * Um cursor desenhado à mão é ótimo até atrapalhar. Três travas:
 *
 *   - **O ponto não tem atraso.** Ele fica exatamente onde o mouse está. Quem
 *     mira um botão mira pelo ponto; qualquer interpolação ali vira
 *     imprecisão. O atraso é só do halo, que é enfeite e não alvo.
 *   - **Nada disso captura evento.** `pointer-events: none` nas duas camadas.
 *     Selecionar texto, arrastar, clicar — tudo continua acontecendo embaixo.
 *   - **Some no toque.** Em `pointer: coarse` não existe cursor para
 *     acompanhar, e o CSS esconde as duas camadas. O `cursor: none` também só
 *     vale em `pointer: fine`, senão um tablet ficaria sem nada.
 *
 * `prefers-reduced-motion` mata o atraso e o giro: o halo passa a colar no
 * ponto. A informação (onde estou, o que é clicável) continua; o movimento
 * extra é que sai.
 */
import { useEffect, useRef } from 'react';

interface Props {
  /** Quando falso, o halo cola no ponto e o rotor não gira. */
  comMovimento: boolean;
}

export function PointerLayer({ comMovimento }: Props) {
  const pontoRef = useRef<HTMLDivElement | null>(null);
  const haloRef = useRef<HTMLDivElement | null>(null);
  const rotorRef = useRef<HTMLDivElement | null>(null);
  const comMovimentoRef = useRef(comMovimento);
  comMovimentoRef.current = comMovimento;

  useEffect(() => {
    const ponto = pontoRef.current;
    const halo = haloRef.current;
    const rotor = rotorRef.current;
    if (!ponto || !halo || !rotor) return;

    const mouse = { x: -100, y: -100 };
    const rastro = { x: -100, y: -100 };
    let dentro = false;
    let quadro = 0;
    let anterior = 0;
    let giro = 0;

    const passo = (t: number) => {
      quadro = 0;
      const dt = Math.min(48, t - (anterior || t - 16));
      anterior = t;

      const distancia = Math.hypot(mouse.x - rastro.x, mouse.y - rastro.y);
      // Interpolação exponencial: independe da taxa de quadros, então o atraso
      // é o mesmo a 60Hz e a 144Hz.
      const a = comMovimentoRef.current ? 1 - Math.exp(-dt / 100) : 1;
      rastro.x += (mouse.x - rastro.x) * a;
      rastro.y += (mouse.y - rastro.y) * a;

      // O halo cresce com a distância: quanto mais rápido o gesto, mais ele
      // se abre — é o que dá a sensação de massa.
      const lado = comMovimentoRef.current ? 34 + Math.min(100, distancia * 0.6) : 34;
      halo.style.transform = `translate(${rastro.x}px, ${rastro.y}px) scale(${lado / 40})`;
      ponto.style.transform = `translate(${mouse.x}px, ${mouse.y}px)`;

      if (dentro && distancia > 0.1) quadro = requestAnimationFrame(passo);
    };

    const acordar = () => {
      if (!quadro) {
        anterior = 0;
        quadro = requestAnimationFrame(passo);
      }
    };

    const aoMover = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if (!dentro) {
        rastro.x = mouse.x;
        rastro.y = mouse.y;
        dentro = true;
        document.body.classList.add('tq-pointer-in');
      }
      // Reage a controle sob o cursor. `closest` cobre o caso comum de o alvo
      // ser o ícone dentro do botão.
      const alvo = e.target as Element | null;
      halo.classList.toggle(
        'over-control',
        !!alvo?.closest?.('button, a, summary, [role="button"], textarea'),
      );
      acordar();
    };

    const aoSair = () => {
      dentro = false;
      document.body.classList.remove('tq-pointer-in');
    };

    const aoPressionar = () => {
      if (!comMovimentoRef.current) return;
      giro += 90;
      rotor.style.transform = `rotate(${giro}deg) scale(.88)`;
    };
    const aoSoltar = () => {
      if (!comMovimentoRef.current) return;
      giro += 170;
      rotor.style.transform = `rotate(${giro}deg)`;
    };

    window.addEventListener('pointermove', aoMover, { passive: true });
    window.addEventListener('pointerleave', aoSair);
    window.addEventListener('pointerdown', aoPressionar, { passive: true });
    window.addEventListener('pointerup', aoSoltar, { passive: true });

    return () => {
      window.removeEventListener('pointermove', aoMover);
      window.removeEventListener('pointerleave', aoSair);
      window.removeEventListener('pointerdown', aoPressionar);
      window.removeEventListener('pointerup', aoSoltar);
      document.body.classList.remove('tq-pointer-in');
      if (quadro) cancelAnimationFrame(quadro);
    };
  }, []);

  return (
    <>
      <div ref={haloRef} className="tq-halo" aria-hidden="true">
        <div ref={rotorRef} className="tq-rotor" />
      </div>
      <div ref={pontoRef} className="tq-dot" aria-hidden="true" />
    </>
  );
}
