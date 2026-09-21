/**
 * AS BRASAS — o fundo animado, atrás de tudo.
 *
 * ── Como o pedido mudou ───────────────────────────────────────────────────
 *
 * Começou como pontos parados ("estrelinhas"), virou oito barras subindo
 * "como um oceano", e agora são brasas: mais partículas, mais finas, e
 * quase invisíveis — "bem transparentes, muito difícil de visualizar". A
 * ideia final é a de uma fagulha subindo de uma fogueira distante: fina,
 * numerosa, e no limite do que se percebe sem prestar atenção.
 *
 * ── Por que GERADAS, e não escritas à mão uma a uma ───────────────────────
 *
 * Oito dava para escrever cada uma à mão; vinte e seis não — a lista viraria
 * ruído maior que o efeito. `gerarBrasas` deriva os cinco parâmetros de cada
 * partícula do seu ÍNDICE, com multiplicadores que não são múltiplos de 100
 * nem uns dos outros (37, 11, 13, 7 — todos primos entre si com a base),
 * pelo mesmo motivo do `--bg-estrelas` que existiu antes: um período que não
 * bate com os outros não mostra onde a sequência se repete.
 *
 * ── Por que cada brasa é a SUA PRÓPRIA camada, e não uma repetição ────────
 *
 * Um `background-image` com um padrão repetindo teria todas as brasas na
 * mesma fase — a tela inteira "pulsando" junto, o oposto do efeito pedido.
 * Cada `<span>` tem sua própria duração e atraso (negativo, para já nascer
 * em pontos diferentes do ciclo em vez de todas começarem juntas na
 * montagem), o que só é possível com elementos de verdade.
 *
 * ── Fixo à JANELA, não ao documento ────────────────────────────────────────
 *
 * Ao contrário da onda da HOME (que rola com o conteúdo — ver o comentário
 * em `WaveField`/`tq-wave`), isto é o "fundo da tela" pedido: uma cena
 * contínua atrás de tudo, igual em qualquer ponto da rolagem.
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

interface Brasa {
  esquerda: string;
  atraso: string;
  duracao: string;
  altura: string;
  largura: string;
  /** Alfa no pico — já embutido na cor, não na opacidade do elemento. */
  cor: string;
}

const QUANTIDADE = 26;

function gerarBrasas(): Brasa[] {
  const brasas: Brasa[] = [];
  for (let i = 0; i < QUANTIDADE; i++) {
    const duracaoS = 9 + ((i * 11) % 16); // 9..24s — o passeio até sumir no alto.
    const atrasoS = (i * 13) % duracaoS; // dentro do próprio ciclo: nasce já em voo.
    const esquerda = (i * 37) % 100; // espalhado pela largura, sem repetir vizinho.
    // Bem fina, quase um traço: uma brasa não é uma barra.
    const altura = 3 + (i % 4) * 1.4;
    const largura = 1 + (i % 3) * 0.4;
    // "Muito difícil de visualizar": o pico fica entre 4% e 13% de alfa.
    const opacidadePico = (0.04 + ((i * 3) % 10) * 0.009).toFixed(3);
    const cor = i % 2 === 0 ? 'glow' : 'primary';
    brasas.push({
      esquerda: `${esquerda}%`,
      atraso: `-${atrasoS}s`,
      duracao: `${duracaoS}s`,
      altura: `${altura}px`,
      largura: `${largura}px`,
      cor: `rgb(var(--c-${cor}) / ${opacidadePico})`,
    });
  }
  return brasas;
}

const BRASAS = gerarBrasas();

export function Brasas({ pausado = false }: Props) {
  const { animando } = useAnimacao(false);
  const parada = pausado || !animando;

  return (
    <div className={`tq-brasas${parada ? ' parada' : ''}`} aria-hidden="true">
      {BRASAS.map((b, i) => (
        <span
          key={i}
          className="tq-brasa"
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
