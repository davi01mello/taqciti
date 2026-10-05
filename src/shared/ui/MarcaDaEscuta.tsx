/**
 * O GLIFO DA ESCUTA — o sinal de que a transcrição está viva.
 *
 * ── Irmão da marca, e não cópia dela ─────────────────────────────────────
 *
 * A conversa é a MARCA do Taq (`MarcaDoTaq`): a onda da voz dele. A
 * transcrição é outra coisa — é a voz dos OUTROS virando texto — e por isso tem
 * desenho próprio: três barras de onda à esquerda e três linhas de escrita à
 * direita. O que os faz família é o resto: o mesmo traço (espessura e pontas
 * redondas), a mesma tinta (o degradê da marca, amostrado na mesma posição) e a
 * mesma gramática de estado:
 *
 *   - MOVIMENTO só quando algo acontece de verdade;
 *   - CINZA é parado; ÂMBAR é atenção; o degradê é o normal.
 *
 * ── Os estados ───────────────────────────────────────────────────────────
 *
 *   - `capturando`: as barras ouvem (cada uma no seu ritmo) e as linhas se
 *     ESCREVEM, uma depois da outra, em passos de digitação — e somem no alto,
 *     como a transcrição rolando. Cada trecho novo (`pulso`) solta uma faísca
 *     que atravessa da onda para o texto: a fala virando escrita;
 *   - `preparando`: as barras viram três pontos que "digitam" (…) e as linhas
 *     são um esqueleto piscando — o lugar do texto, antes do texto;
 *   - `pausada`: tudo parado e acinzentado, as linhas inteiras — o que já foi
 *     escrito continua lá;
 *   - `interrompida`: a onda achata em âmbar e as linhas piscam devagar — há
 *     legenda na tela que a captura não lê;
 *   - `salva`: a página completa, e um brilho passa por ela uma vez;
 *   - `desligada`: o desenho apagado. Não há reunião.
 *
 * Não é medidor de áudio: a extensão nunca ouviu microfone nenhum. O que move
 * as barras é o ESTADO da captura de legendas; a faísca é a chegada de um
 * trecho novo, o sinal honesto mais próximo de "chegou coisa nova".
 *
 * Como na marca, todo movimento é `transform`/`opacity` no compositor; o JS só
 * dispara a faísca. Movimento reduzido: cada estado vira um desenho parado.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { tintaDaMarca } from './MarcaDoTaq';
import './marcaDaEscuta.css';

export type EstadoDaCaptura =
  /** Legendas chegando: movimento contínuo. */
  | 'capturando'
  /** Ligando as legendas do Meet — ainda não há o que capturar. */
  | 'preparando'
  /** Reunião detectada, primeiros segundos: ainda nenhum trecho. */
  | 'iniciando'
  /** Captura de pé, nada chegando: silêncio ou legenda desligada. */
  | 'aguardando_fonte'
  /** Pausa pedida por quem está na reunião. */
  | 'pausada'
  /** Legenda na tela que a captura não consegue ler. Estado próprio. */
  | 'interrompida'
  /** Interrompida por tempo demais: a leitura não voltou. */
  | 'erro'
  /** Reunião encerrada e salva. */
  | 'salva'
  /** Sem captura: não há reunião, ou o registro foi recusado. */
  | 'desligada';

interface Props {
  estado: EstadoDaCaptura;
  /** Sobe a cada trecho novo. O valor não importa; a mudança solta a faísca. */
  pulso?: number;
  /** Lado do desenho em CSS px. */
  tamanho?: number;
  className?: string;
}

/** As barras da onda: [centro x, altura], em fração do lado. */
const ONDAS: ReadonlyArray<readonly [number, number]> = [
  [0.15, 0.3],
  [0.27, 0.56],
  [0.39, 0.38],
];
/** As linhas de escrita: [y do centro, comprimento], em fração do lado. */
const LINHAS: ReadonlyArray<readonly [number, number]> = [
  [0.3, 0.4],
  [0.5, 0.3],
  [0.7, 0.36],
];
const X_DAS_LINHAS = 0.51;

/** Os estados de uma captura em curso. */
const VIVOS: ReadonlySet<EstadoDaCaptura> = new Set<EstadoDaCaptura>([
  'capturando',
  'preparando',
  'iniciando',
  'aguardando_fonte',
  'pausada',
  'interrompida',
  'erro',
]);

function movimentoReduzido(): boolean {
  return typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)').matches
    : true;
}

function geometria(tamanho: number) {
  // O traço da marca, que a 24 px tem ~1,5 px: mais grosso, o glifo pesaria
  // mais que ela ao lado.
  const esp = Math.max(1.4, tamanho * 0.07);
  const ondas = ONDAS.map(([x, h], i) => {
    const [c1, c2] = tintaDaMarca(x);
    const altura = h * tamanho;
    return {
      left: x * tamanho - esp / 2,
      top: (tamanho - altura) / 2,
      width: esp,
      height: altura,
      '--i': i,
      // Quanto encolher para virar um ponto: o desenho de `preparando`.
      '--ponto': (esp / altura).toFixed(3),
      '--c1': c1,
      '--c2': c2,
    } as CSSProperties;
  });
  const linhas = LINHAS.map(([y, w], i) => {
    const [c1] = tintaDaMarca(X_DAS_LINHAS);
    const [, c2] = tintaDaMarca(Math.min(1, X_DAS_LINHAS + w * 1.25));
    return {
      left: X_DAS_LINHAS * tamanho,
      top: y * tamanho - esp / 2,
      width: w * tamanho,
      height: esp,
      '--i': i,
      '--c1': c1,
      '--c2': c2,
    } as CSSProperties;
  });
  const faisca = {
    left: ONDAS[1]![0] * tamanho - esp * 0.6,
    top: tamanho / 2 - esp * 0.6,
    width: esp * 1.2,
    height: esp * 1.2,
  } as CSSProperties;
  /** Da onda do meio até o começo da linha do meio, em px. */
  const viagem = (X_DAS_LINHAS - ONDAS[1]![0]) * tamanho;
  return { ondas, linhas, faisca, viagem };
}

function MarcaDaEscutaBase({ estado, pulso, tamanho = 24, className }: Props) {
  const g = useMemo(() => geometria(tamanho), [tamanho]);
  const faiscaRef = useRef<HTMLSpanElement | null>(null);
  const ondasRef = useRef<Array<HTMLSpanElement | null>>([]);
  const pulsoRef = useRef(pulso);
  const linhasRef = useRef<Array<HTMLSpanElement | null>>([]);
  const ultima = useRef(0);
  /*
   * O estado do render anterior. A faísca só vale para um trecho que chegou
   * DURANTE a captura: ao abrir a sidebar no meio da reunião, o primeiro
   * estado real troca "desligada" por "capturando" e a contagem salta de 0 para
   * N no mesmo quadro — sem isto, uma faísca por uma fala que ninguém disse.
   */
  const estadoAntes = useRef(estado);
  /** O brilho de "salva" é o MOMENTO de salvar, não toda montagem já salva. */
  const [brilho, setBrilho] = useState(false);

  useEffect(() => {
    const antes = estadoAntes.current;
    estadoAntes.current = estado;
    if (antes === estado || movimentoReduzido()) return;

    // Saindo da escrita: a animação contínua some de um quadro para o outro, e
    // as linhas saltariam de meio escritas para inteiras. Em vez disso, elas
    // se COMPLETAM, uma depois da outra.
    if (antes === 'capturando') {
      linhasRef.current.forEach((el, i) =>
        el?.animate?.(
          [
            { transform: 'scaleX(.45)', opacity: 0.55 },
            { transform: 'scaleX(1)', opacity: 1 },
          ],
          { duration: 360, delay: i * 70, easing: 'cubic-bezier(.3,1.2,.6,1)', fill: 'backwards' },
        ),
      );
    }

    // Só quem VEM de uma captura acabou de salvar. "desligada" → "salva" é a
    // sidebar abrindo (o primeiro estado real), não o fim da reunião.
    if (estado !== 'salva' || !VIVOS.has(antes)) return;
    setBrilho(true);
    const t = setTimeout(() => setBrilho(false), 1600);
    return () => clearTimeout(t);
  }, [estado]);

  // Um trecho novo: a faísca atravessa da onda para o texto, e a onda salta.
  // Declarado DEPOIS do efeito acima, que já trocou `estadoAntes`: por isso a
  // pergunta é sobre o pulso anterior, e o estado anterior vem por `pulsoEm`.
  const pulsoEm = useRef<EstadoDaCaptura>(estado);
  useEffect(() => {
    const antes = pulsoRef.current;
    const estadoDoPulsoAnterior = pulsoEm.current;
    pulsoRef.current = pulso;
    pulsoEm.current = estado;
    if (estado !== 'capturando' || estadoDoPulsoAnterior !== 'capturando') return;
    if (pulso === undefined || antes === undefined || pulso <= antes) return;
    if (movimentoReduzido()) return;
    const agora = performance.now();
    if (agora - ultima.current < 260) return;
    ultima.current = agora;

    const faisca = faiscaRef.current;
    faisca?.animate?.(
      [
        { transform: 'translateX(0) scale(.6)', opacity: 0 },
        { transform: `translateX(${g.viagem * 0.35}px) scale(1.15)`, opacity: 1, offset: 0.3 },
        { transform: `translateX(${g.viagem}px) scale(.5)`, opacity: 0 },
      ],
      { duration: 520, easing: 'cubic-bezier(.3,.6,.4,1)' },
    );
    ondasRef.current.forEach((el, i) =>
      el?.animate?.(
        [
          { transform: 'scaleY(1)' },
          { transform: 'scaleY(1.45)', offset: 0.35 },
          { transform: 'scaleY(1)' },
        ],
        { duration: 380, delay: i * 45, easing: 'cubic-bezier(.3,.7,.4,1)' },
      ),
    );
    // g.viagem só muda com o tamanho, que não muda no meio de uma reunião.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulso, estado]);

  return (
    <span
      className={`tq-escuta${className ? ` ${className}` : ''}`}
      data-estado={estado}
      data-brilho={brilho ? 'sim' : undefined}
      style={{ width: tamanho, height: tamanho }}
      aria-hidden="true"
    >
      {g.ondas.map((estilo, i) => (
        <span key={`o${i}`} className="tq-escuta-onda" style={estilo}>
          <span className="v">
            <span
              className="e"
              ref={(el) => {
                ondasRef.current[i] = el;
              }}
            />
          </span>
        </span>
      ))}
      {g.linhas.map((estilo, i) => (
        <span key={`l${i}`} className="tq-escuta-linha" style={estilo}>
          <span
            className="e"
            ref={(el) => {
              linhasRef.current[i] = el;
            }}
          />
        </span>
      ))}
      <span className="tq-escuta-faisca" style={g.faisca} ref={faiscaRef} />
    </span>
  );
}

/** Memorizado pelo mesmo motivo da marca: a sidebar re-renderiza a cada tecla. */
export const MarcaDaEscuta = memo(MarcaDaEscutaBase);
