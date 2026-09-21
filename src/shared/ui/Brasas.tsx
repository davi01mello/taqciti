/**
 * AS BRASAS — o fundo animado, atrás de tudo.
 *
 * ── Como o pedido mudou ───────────────────────────────────────────────────
 *
 * Começou como pontos parados ("estrelinhas") gerados em CSS, virou barras
 * subindo, depois brasas finas geradas por fórmula — e a última volta foi
 * trocar o gerado por um ARTE DE VERDADE: `public/backgrounds/brasas.png`,
 * a textura de fagulhas que veio pronta. Nada aqui desenha partícula
 * nenhuma; o trabalho é só posicionar essa imagem, repeti-la sem costura e
 * fazê-la subir.
 *
 * ── Por que dá para repetir SEM COSTURA sem a imagem ser "seamless" ───────
 *
 * `background-repeat` ladrilha a MESMA imagem, lado a lado e em pilha. Rolar
 * o fundo por exatamente UMA altura de ladrilho (`ALTURA_PX`) e resetar a
 * posição nesse instante é sempre contínuo — não porque o conteúdo da
 * imagem foi desenhado para fechar nas bordas, mas porque o ladrilho de
 * cima é PIXEL POR PIXEL igual ao de baixo. A costura só apareceria se o
 * passo do laço não fosse um múltiplo exato da altura do ladrilho.
 *
 * ── Fixo à JANELA, não ao documento ────────────────────────────────────────
 *
 * Ao contrário da onda da HOME (que rola com o conteúdo — ver o comentário
 * em `WaveField`/`tq-wave`), isto é o "fundo da tela" pedido: uma cena
 * contínua atrás de tudo, igual em qualquer ponto da rolagem.
 *
 * ── Opacidade, e por que fica no CONTÊINER e não na imagem ─────────────────
 *
 * "Bem transparente, muito difícil de visualizar" é sobre o EFEITO na tela,
 * não sobre a arte — regravar o PNG mais fraco perderia informação sem
 * volta. `opacity` no `<div>` deixa a imagem original intacta em
 * `public/backgrounds/` e o ajuste fica reversível, num lugar só.
 *
 * ── Movimento, e quem manda nele ───────────────────────────────────────────
 *
 * `useAnimacao(false)` dá a base — pausa sozinha com `prefers-reduced-
 * motion` e com a aba oculta, os dois já cobertos globalmente por
 * `animation-duration: 0.01ms` em `global.css`, mas aqui também precisa
 * PARAR DE SUBIR (não só encurtar a duração), daí o `animation-play-state`
 * por classe. `pausado` deixa quem usa (o botão "Pausar movimento" da HOME)
 * somar a própria pausa por cima.
 */
import { useAnimacao } from '@/home/useAnimacao';

interface Props {
  /** Pausa adicional, imposta por quem usa — ver o botão de movimento da HOME. */
  pausado?: boolean;
}

/** Altura nativa de `brasas.png` — o passo do laço de rolagem tem que bater com isto. */
const ALTURA_PX = 768;
const LARGURA_PX = 2048;

export function Brasas({ pausado = false }: Props) {
  const { animando } = useAnimacao(false);
  const parada = pausado || !animando;

  return (
    <div
      className={`tq-brasas${parada ? ' parada' : ''}`}
      aria-hidden="true"
      style={{
        backgroundImage: `url(${chrome.runtime.getURL('backgrounds/brasas.png')})`,
        backgroundSize: `${LARGURA_PX}px ${ALTURA_PX}px`,
      }}
    />
  );
}
