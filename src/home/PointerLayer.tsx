/**
 * O cursor da HOME: um ponto no lugar exato do mouse e um halo discreto que
 * chega atrasado.
 *
 * ── O tamanho, que era o defeito ───────────────────────────────────────────
 *
 * O halo crescia com a velocidade do gesto até 134px de lado — do tamanho de
 * uma lente de aumento. Ele cobria palavras inteiras, dominava a composição e,
 * num movimento rápido, era a coisa mais visível da tela. Agora o crescimento é
 * de 22 para no máximo 38px, o que ainda dá a sensação de massa sem virar
 * objeto. E a acomodação é rápida: parado o mouse, o halo alcança o ponto em
 * poucos quadros em vez de vir flutuando atrás.
 *
 * ── A regra que não pode ser quebrada ──────────────────────────────────────
 *
 *   - **O ponto não tem atraso.** Ele fica exatamente onde o mouse está. Quem
 *     mira um botão mira pelo ponto; qualquer interpolação ali vira
 *     imprecisão. O atraso é só do halo, que é enfeite e não alvo.
 *   - **Nada disso captura evento.** `pointer-events: none` nas duas camadas.
 *   - **Some no toque.** Em `pointer: coarse` não existe cursor para
 *     acompanhar, e o CSS esconde as duas camadas.
 *
 * ── O brilho verde pertence ao campo de escrita, e a mais nada ─────────────
 *
 * Antes ele acendia sobre `button, a, summary, textarea` — ou seja, sobre meia
 * tela. O sinal virou ruído: se tudo brilha, o brilho não diz mais onde dá para
 * escrever. Agora existe UM sinal verde, e ele acende exclusivamente dentro da
 * área marcada com `data-tq-escrita`. Sobre os outros controles o halo apenas
 * se fecha um pouco, sem cor.
 *
 * `prefers-reduced-motion` mata o atraso e o giro: o halo passa a colar no
 * ponto. A informação (onde estou, onde escrevo) continua; o movimento sai.
 */
import { useEffect, useRef } from 'react';

interface Props {
  /** Quando falso, o halo cola no ponto e o rotor não gira. */
  comMovimento: boolean;
}

/** Lado do halo em repouso e o teto do crescimento, em px. */
const HALO_BASE = 22;
const HALO_MAX = 38;
/** O lado do elemento no CSS; o `scale` é calculado contra ele. */
const HALO_CSS = 30;

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
      /*
       * Interpolação exponencial: independe da taxa de quadros, então o atraso
       * é o mesmo a 60Hz e a 144Hz. A constante caiu de 100ms para 55ms — é o
       * que faz o halo "se acomodar rapidamente" ao parar o mouse, em vez de
       * continuar chegando enquanto já se lê a tela.
       */
      const a = comMovimentoRef.current ? 1 - Math.exp(-dt / 55) : 1;
      rastro.x += (mouse.x - rastro.x) * a;
      rastro.y += (mouse.y - rastro.y) * a;

      const lado = comMovimentoRef.current
        ? Math.min(HALO_MAX, HALO_BASE + distancia * 0.22)
        : HALO_BASE;
      halo.style.transform = `translate(${rastro.x}px, ${rastro.y}px) scale(${lado / HALO_CSS})`;
      ponto.style.transform = `translate(${mouse.x}px, ${mouse.y}px)`;

      // Meio pixel: abaixo disso o movimento não é mais visível, e continuar
      // agendando quadros só para perseguir subpixel é CPU a troco de nada.
      if (dentro && distancia > 0.5) quadro = requestAnimationFrame(passo);
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

      /*
       * Dois sinais distintos, e a ordem importa: primeiro "isto é onde se
       * escreve" (verde), depois "isto é clicável" (só a forma). `closest`
       * cobre o caso comum de o alvo ser um filho do elemento marcado.
       */
      const alvo = e.target as Element | null;
      const naEscrita = !!alvo?.closest?.('[data-tq-escrita]');
      halo.classList.toggle('sobre-escrita', naEscrita);
      halo.classList.toggle(
        'sobre-controle',
        !naEscrita && !!alvo?.closest?.('button, a, summary, [role="button"]'),
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
