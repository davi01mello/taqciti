/**
 * O cursor da HOME: um ponto no lugar exato do mouse e um anel discreto que
 * chega atrasado.
 *
 * ── Por que ele aparecia onde não devia ────────────────────────────────────
 *
 * Duas causas, e nenhuma delas era o efeito em si.
 *
 * A primeira: `cursor: none` vivia no CSS incondicionalmente, enquanto a
 * camada desenhada era ligada por JavaScript. As duas coisas podiam discordar.
 * Levar o mouse para a barra do navegador, trocar de aba e voltar, ou sair pela
 * borda sem gerar o evento esperado deixava a página com `cursor: none` e sem
 * ponto nenhum — um cursor invisível. Agora a regra é a MESMA chave: o CSS só
 * esconde o cursor nativo enquanto `body.tq-pointer-in` existe (ver
 * `home.css`), então onde não há ponto desenhado há o cursor do sistema, e
 * nunca os dois nem nenhum.
 *
 * A segunda: `pointerleave` no `window` não é confiável. Ele não dispara ao
 * passar para a UI do navegador, nem quando a aba perde visibilidade com o
 * ponteiro parado dentro dela — e o ponto ficava congelado na última posição,
 * aceso, para sempre. Por isso a saída é observada por quatro caminhos
 * diferentes (ver `desligar` abaixo), e a volta sempre reposiciona antes de
 * acender, para não piscar no lugar velho.
 *
 * ── A regra que não pode ser quebrada ──────────────────────────────────────
 *
 *   - **O ponto não tem atraso.** Ele fica exatamente onde o mouse está. Quem
 *     mira um botão mira pelo ponto; qualquer interpolação ali vira
 *     imprecisão. O atraso é só do anel, que é enfeite e não alvo.
 *   - **Nada disso captura evento.** `pointer-events: none` nas duas camadas.
 *   - **Some no toque.** Em `pointer: coarse` não existe cursor para
 *     acompanhar, e um evento de toque desliga a camada.
 *   - **O caret é do campo.** `cursor: none` troca o desenho do PONTEIRO; o
 *     traço de inserção e a seleção do texto não são afetados.
 *
 * ── O brilho verde pertence ao campo de escrita, e a mais nada ─────────────
 *
 * Existe UM sinal verde, e ele acende exclusivamente dentro da área marcada
 * com `data-tq-escrita`. Sobre os outros controles o anel apenas fecha e ganha
 * contraste, sem cor.
 *
 * `prefers-reduced-motion` mata o atraso e o giro: o anel passa a colar no
 * ponto. A informação (onde estou, onde escrevo) continua; o movimento sai.
 */
import { useEffect, useRef } from 'react';

interface Props {
  /** Quando falso, o anel cola no ponto e não gira. */
  comMovimento: boolean;
}

/** Lado do anel em repouso e o teto do crescimento, em px. */
const ANEL_BASE = 24;
const ANEL_MAX = 34;
/** O lado do elemento no CSS; o `scale` é calculado contra ele. */
const ANEL_CSS = 30;
/**
 * Constante de tempo da perseguição, em ms. Era 55 — rápido demais para o atraso
 * ser lido como intenção; o anel parecia grudado no ponto. Em 150ms o
 * movimento tem peso e ainda assim se acomoda em poucos décimos ao parar.
 */
const PERSEGUICAO_MS = 150;

export function PointerLayer({ comMovimento }: Props) {
  const pontoRef = useRef<HTMLDivElement | null>(null);
  const anelRef = useRef<HTMLDivElement | null>(null);
  const rotorRef = useRef<HTMLDivElement | null>(null);
  const comMovimentoRef = useRef(comMovimento);
  comMovimentoRef.current = comMovimento;

  useEffect(() => {
    const ponto = pontoRef.current;
    const anel = anelRef.current;
    const rotor = rotorRef.current;
    if (!ponto || !anel || !rotor) return;

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
      const a = comMovimentoRef.current ? 1 - Math.exp(-dt / PERSEGUICAO_MS) : 1;
      rastro.x += (mouse.x - rastro.x) * a;
      rastro.y += (mouse.y - rastro.y) * a;

      const lado = comMovimentoRef.current
        ? Math.min(ANEL_MAX, ANEL_BASE + distancia * 0.14)
        : ANEL_BASE;
      anel.style.transform = `translate(${rastro.x}px, ${rastro.y}px) scale(${lado / ANEL_CSS})`;
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

    /**
     * Apaga a camada e para o laço.
     *
     * Parar o laço sem apagar é exatamente o "ponto preso na tela": o desenho
     * fica no último lugar, aceso, sem ninguém para movê-lo. E como o CSS
     * amarra `cursor: none` a esta mesma classe, apagá-la devolve o cursor do
     * sistema no mesmo instante.
     */
    const desligar = () => {
      if (!dentro) return;
      dentro = false;
      if (quadro) {
        cancelAnimationFrame(quadro);
        quadro = 0;
      }
      document.body.classList.remove('tq-pointer-in');
    };

    const aoMover = (e: PointerEvent) => {
      // Um toque não tem ponteiro para acompanhar — e numa tela híbrida ele
      // chega no mesmo listener do mouse.
      if (e.pointerType === 'touch') {
        desligar();
        return;
      }
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if (!dentro) {
        // Reposiciona ANTES de acender: sem isto, voltar para a janela pinta
        // um quadro no lugar de onde o ponteiro saiu, e o anel atravessa a
        // tela para alcançar o mouse.
        rastro.x = mouse.x;
        rastro.y = mouse.y;
        anel.style.transform = `translate(${mouse.x}px, ${mouse.y}px) scale(${ANEL_BASE / ANEL_CSS})`;
        ponto.style.transform = `translate(${mouse.x}px, ${mouse.y}px)`;
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
      anel.classList.toggle('sobre-escrita', naEscrita);
      anel.classList.toggle(
        'sobre-controle',
        !naEscrita && !!alvo?.closest?.('button, a, summary, [role="button"]'),
      );
      acordar();
    };

    /**
     * Saiu para fora do documento.
     *
     * `relatedTarget === null` num `pointerout` é o Chrome dizendo "o ponteiro
     * não foi para outro elemento, foi para fora" — inclusive para a barra do
     * navegador, que é o caso que o `pointerleave` do `window` não cobria.
     */
    const aoSairDoDocumento = (e: PointerEvent) => {
      if (e.relatedTarget === null) desligar();
    };
    const aoPerderVisibilidade = () => {
      if (document.hidden) desligar();
    };

    const aoPressionar = () => {
      if (!comMovimentoRef.current) return;
      giro += 90;
      rotor.style.transform = `rotate(${giro}deg) scale(.86)`;
    };
    const aoSoltar = () => {
      if (!comMovimentoRef.current) return;
      giro += 170;
      rotor.style.transform = `rotate(${giro}deg)`;
    };

    window.addEventListener('pointermove', aoMover, { passive: true });
    // Os quatro caminhos de saída. Nenhum deles sozinho é confiável.
    document.addEventListener('pointerout', aoSairDoDocumento);
    document.documentElement.addEventListener('pointerleave', desligar);
    window.addEventListener('blur', desligar);
    document.addEventListener('visibilitychange', aoPerderVisibilidade);
    window.addEventListener('pointerdown', aoPressionar, { passive: true });
    window.addEventListener('pointerup', aoSoltar, { passive: true });

    return () => {
      window.removeEventListener('pointermove', aoMover);
      document.removeEventListener('pointerout', aoSairDoDocumento);
      document.documentElement.removeEventListener('pointerleave', desligar);
      window.removeEventListener('blur', desligar);
      document.removeEventListener('visibilitychange', aoPerderVisibilidade);
      window.removeEventListener('pointerdown', aoPressionar);
      window.removeEventListener('pointerup', aoSoltar);
      // A classe é global: deixá-la para trás numa desmontagem esconderia o
      // cursor do sistema sem nada no lugar.
      document.body.classList.remove('tq-pointer-in');
      if (quadro) cancelAnimationFrame(quadro);
    };
  }, []);

  return (
    <>
      <div ref={anelRef} className="tq-halo" aria-hidden="true">
        <div ref={rotorRef} className="tq-rotor" />
      </div>
      <div ref={pontoRef} className="tq-dot" aria-hidden="true" />
    </>
  );
}
