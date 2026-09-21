/**
 * AS BOLHAS DO OCEANO — o fundo animado, atrás de tudo.
 *
 * ── O pedido, ao pé da letra ──────────────────────────────────────────────
 *
 * Barras finas subindo e desaparecendo em algum ponto, todas verdes,
 * pouquíssimas — "como se estivesse num oceano e sua densidade fosse
 * menor". Substitui a textura de pontos parados que havia antes: aquilo
 * era SÓ textura; isto é MOVIMENTO, então respeita as mesmas regras de
 * movimento que o resto do produto.
 *
 * ── Por que cada bolha é a SUA PRÓPRIA camada, e não uma repetição ────────
 *
 * Um `background-image` com um padrão repetindo teria todas as bolhas na
 * mesma fase — a tela inteira "respirando" junto, o oposto do efeito
 * pedido. Cada `<span>` tem sua própria duração e atraso (negativo, para
 * já nascer em pontos diferentes do ciclo em vez de todas começarem
 * juntas na montagem), o que só é possível com elementos de verdade.
 *
 * ── Fixo à JANELA, não ao documento ─────────────────────────────────────
 *
 * Ao contrário da onda da HOME (que rola com o conteúdo — ver o comentário
 * em `WaveField`/`tq-wave`), isto é o "fundo da tela" pedido: uma cena
 * contínua atrás de tudo, igual em qualquer ponto da rolagem.
 *
 * ── Movimento, e quem manda nele ──────────────────────────────────────────
 *
 * `useAnimacao(false)` dá a base — pausa sozinha com `prefers-reduced-
 * motion` e com a aba oculta, os dois já cobertos globalmente por
 * `animation-duration: 0.01ms` em `global.css`, mas aqui também precisa
 * PARAR DE SUBIR (não só encurtar a duração), daí o `animation-play-state`
 * por classe. `pausado` deixa quem usa (o botão "Pausar movimento" da
 * HOME) somar a própria pausa por cima.
 */
import { useAnimacao } from '@/home/useAnimacao';

interface Props {
  /** Pausa adicional, imposta por quem usa — ver o botão de movimento da HOME. */
  pausado?: boolean;
}

interface Bolha {
  esquerda: string;
  atraso: string;
  duracao: string;
  altura: string;
  largura: string;
  /** Alfa no pico — já embutido na cor, não na opacidade do elemento. */
  cor: string;
}

/*
 * Oito bolhas, espalhadas pela largura e COM VARIEDADE deliberada em
 * altura, duração e atraso — é essa variedade que lê como "várias bolhas
 * soltas", em vez de "um padrão repetindo". O atraso negativo adianta o
 * relógio de cada uma: sem ele, as oito nasceriam juntas no fundo da tela
 * no instante em que a página abre.
 */
const BOLHAS: Bolha[] = [
  { esquerda: '6%', atraso: '-2s', duracao: '14s', altura: '20px', largura: '2px', cor: 'rgb(var(--c-glow) / 0.28)' },
  { esquerda: '18%', atraso: '-9s', duracao: '19s', altura: '30px', largura: '3px', cor: 'rgb(var(--c-primary) / 0.4)' },
  { esquerda: '29%', atraso: '-4s', duracao: '16s', altura: '18px', largura: '2px', cor: 'rgb(var(--c-glow) / 0.32)' },
  { esquerda: '41%', atraso: '-14s', duracao: '22s', altura: '34px', largura: '2.5px', cor: 'rgb(var(--c-primary) / 0.45)' },
  { esquerda: '53%', atraso: '-1s', duracao: '13s', altura: '22px', largura: '2px', cor: 'rgb(var(--c-glow) / 0.3)' },
  { esquerda: '64%', atraso: '-11s', duracao: '18s', altura: '26px', largura: '3px', cor: 'rgb(var(--c-primary) / 0.38)' },
  { esquerda: '77%', atraso: '-6s', duracao: '20s', altura: '16px', largura: '2px', cor: 'rgb(var(--c-glow) / 0.26)' },
  { esquerda: '89%', atraso: '-17s', duracao: '15s', altura: '32px', largura: '2.5px', cor: 'rgb(var(--c-primary) / 0.42)' },
];

export function BarrasDoOceano({ pausado = false }: Props) {
  const { animando } = useAnimacao(false);
  const parada = pausado || !animando;

  return (
    <div className={`tq-barras-oceano${parada ? ' parada' : ''}`} aria-hidden="true">
      {BOLHAS.map((b, i) => (
        <span
          key={i}
          className="tq-barra"
          style={{
            left: b.esquerda,
            width: b.largura,
            height: b.altura,
            background: b.cor,
            animationDuration: b.duracao,
            animationDelay: b.atraso,
          }}
        />
      ))}
    </div>
  );
}
