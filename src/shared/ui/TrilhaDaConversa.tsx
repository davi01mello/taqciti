/**
 * A barra da conversa: uma barra de rolagem que é também o MAPA da conversa.
 *
 * ── O que ela mostra ────────────────────────────────────────────────────────
 *
 * Cada mensagem é um bloco no trilho, com a altura proporcional à que ela tem
 * na página — as do Taq à esquerda e largas, as suas à direita e estreitas. Dá
 * para ler o formato da conversa de relance: onde estão as respostas longas,
 * onde houve troca rápida. Por cima, a LENTE: o trecho que está na tela, um
 * vidro de borda verde que acompanha a rolagem com uma mola curta. Os blocos
 * sob a lente acendem.
 *
 * ── O que se faz com ela ────────────────────────────────────────────────────
 *
 *  - segurar a lente e arrastar: rola junto, sem mola, com "7 de 24" ao lado;
 *  - passar o mouse no trilho: uma linha marca a altura e a mensagem daquele
 *    ponto aparece em prévia; clicar vai até ela;
 *  - teclado: Alt+↑/Alt+↓ de qualquer lugar (inclusive do campo de escrita), e
 *    setas, PageUp/PageDown e Home/End com a lente em foco.
 *
 * Em repouso ela quase some; acorda quando a página rola e volta a descansar
 * sozinha. É controle, não conteúdo.
 *
 * ── Página ou coluna ────────────────────────────────────────────────────────
 *
 * Na HOME quem rola é a PÁGINA (ver o cabeçalho de `AssistantView.tsx`); na
 * sidebar, a coluna da conversa. `rolador` nulo = a página. As mensagens são
 * achadas pelo atributo `data-tq-turno`, e toda rolagem é por `scrollTo` no
 * rolador — nunca `scrollIntoView`, que arrastaria os ancestrais junto (ver
 * `sidepanel/Conversa.tsx`). A barra nativa sai onde esta existe (`home.css`,
 * `sidepanel.css`): duas barras fazendo o mesmo, lado a lado, era o defeito.
 *
 * A barra é `position: fixed` — a exceção declarada ao "nada fixo" da HOME:
 * ela não é conteúdo, é o controle da rolagem, e um controle de rolagem que
 * rola junto não serve para nada.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as EventoDePonteiro,
} from 'react';
import './trilhaDaConversa.css';

export interface MarcaDaTrilha {
  id: string;
  voce: boolean;
  /** O começo do texto — o que aparece na prévia. */
  resumo: string;
}

interface Props {
  itens: readonly MarcaDaTrilha[];
  /** A coluna que rola. `null` = a página. */
  rolador: HTMLElement | null;
}

interface Medida {
  /** Altura total do conteúdo rolável. */
  total: number;
  /** Altura visível. */
  visivel: number;
  topo: number;
  /** Onde cada mensagem começa e quanto ela mede, na coordenada do conteúdo. */
  blocos: Array<{ id: string; y: number; h: number }>;
  /** Onde o trilho fica na janela. */
  caixa: { top: number; right: number; height: number };
}

/** Folga acima da mensagem ao pular até ela. */
const RESPIRO = 24;
const ALTURA_MAXIMA = 560;
/** A lente nunca fica menor que isto: precisa dar para segurar. */
const LENTE_MINIMA = 22;
/** Um bloco nunca some por ser curto demais na escala. */
const BLOCO_MINIMO = 2;
/** Quanto o ponteiro anda antes de um aperto na lente virar arrasto, em px. */
const LIMIAR_DO_ARRASTO = 3;
/** Quanto tempo a barra fica acordada depois de a página parar. */
const DESPERTA_POR = 1400;

function medir(rolador: HTMLElement | null, ids: readonly string[]): Medida {
  const raiz = rolador ?? document.documentElement;
  const topo = rolador ? rolador.scrollTop : window.scrollY;
  const total = raiz.scrollHeight;
  const visivel = rolador ? rolador.clientHeight : window.innerHeight;
  const base = rolador ? rolador.getBoundingClientRect().top - rolador.scrollTop : -window.scrollY;
  const porId = new Map<string, HTMLElement>();
  for (const el of raiz.querySelectorAll<HTMLElement>('[data-tq-turno]')) {
    porId.set(el.dataset.tqTurno ?? '', el);
  }
  const blocos: Medida['blocos'] = [];
  for (const id of ids) {
    const el = porId.get(id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    blocos.push({ id, y: r.top - base, h: r.height });
  }
  let caixa: Medida['caixa'];
  if (rolador) {
    const r = rolador.getBoundingClientRect();
    const height = Math.min(ALTURA_MAXIMA, Math.max(0, r.height - 40));
    caixa = {
      top: r.top + (r.height - height) / 2,
      right: Math.max(0, window.innerWidth - r.right) + 3,
      height,
    };
  } else {
    const height = Math.min(ALTURA_MAXIMA, window.innerHeight * 0.72);
    caixa = { top: (window.innerHeight - height) / 2, right: 12, height };
  }
  return { total, visivel, topo, blocos, caixa };
}

export function TrilhaDaConversa({ itens, rolador }: Props) {
  const [medida, setMedida] = useState<Medida | null>(null);
  const [desperta, setDesperta] = useState(false);
  const [segurando, setSegurando] = useState(false);
  /** A altura do ponteiro sobre o trilho, em px do trilho; `null` = fora. */
  const [mira, setMira] = useState<number | null>(null);
  const arrasto = useRef<{ y: number; topo: number; pegou: boolean } | null>(null);
  const ids = itens.map((i) => i.id);
  const chaveDosIds = ids.join('|');

  const remedir = useCallback(() => {
    setMedida(medir(rolador, chaveDosIds ? chaveDosIds.split('|') : []));
  }, [rolador, chaveDosIds]);

  useEffect(() => {
    let quadro = 0;
    let dormir = 0;
    const agendar = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(remedir);
    };
    const aoRolar = () => {
      agendar();
      setDesperta(true);
      window.clearTimeout(dormir);
      dormir = window.setTimeout(() => setDesperta(false), DESPERTA_POR);
    };
    agendar();
    const alvo: HTMLElement | Window = rolador ?? window;
    alvo.addEventListener('scroll', aoRolar, { passive: true });
    window.addEventListener('resize', agendar);
    // O conteúdo cresce sem rolar (resposta chegando, fonte aberta): observa.
    const observador =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(agendar);
    const conteudo = rolador ? rolador.firstElementChild : document.body;
    if (observador && conteudo) observador.observe(conteudo);
    return () => {
      cancelAnimationFrame(quadro);
      window.clearTimeout(dormir);
      alvo.removeEventListener('scroll', aoRolar);
      window.removeEventListener('resize', agendar);
      observador?.disconnect();
    };
  }, [rolador, remedir]);

  const rolarPara = useCallback(
    (topo: number, suave = true) => {
      const alvo = rolador ?? window;
      alvo.scrollTo({ top: Math.max(0, topo), behavior: suave ? 'smooth' : 'auto' });
    },
    [rolador],
  );

  /** A mensagem anterior (-1) ou a próxima (+1) em relação ao que está no topo. */
  const pular = useCallback(
    (direcao: 1 | -1) => {
      const m = medir(rolador, ids);
      const referencia = m.topo + RESPIRO;
      const alvo =
        direcao > 0
          ? m.blocos.find((p) => p.y > referencia + 4)
          : [...m.blocos].reverse().find((p) => p.y < referencia - 4);
      if (alvo) rolarPara(alvo.y - RESPIRO);
      else rolarPara(direcao > 0 ? m.total : 0);
    },
    // `ids` muda de identidade a cada render; a chave é o que importa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rolador, chaveDosIds, rolarPara],
  );

  // Alt+↑ / Alt+↓ de qualquer lugar — o campo de escrita não usa essa combinação.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      pular(e.key === 'ArrowDown' ? 1 : -1);
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [pular]);

  if (!medida || itens.length < 2 || medida.total <= medida.visivel + 40) return null;

  const { total, visivel, topo, blocos, caixa } = medida;
  const trilho = caixa.height;
  const escala = trilho / total;

  // A lente: tamanho e posição de polegar de barra de rolagem de verdade.
  const alturaDaLente = Math.max(LENTE_MINIMA, visivel * escala);
  const curso = Math.max(1, trilho - alturaDaLente);
  const maxTopo = Math.max(1, total - visivel);
  const fracao = Math.min(1, Math.max(0, topo / maxTopo));
  const topoDaLente = fracao * curso;
  // O trecho do conteúdo que está sob a lente, na coordenada do conteúdo.
  const sobDe = topo;
  const sobAte = topo + visivel;

  const porId = new Map(itens.map((i) => [i.id, i]));
  const indiceNoTopo = Math.max(
    0,
    blocos.findIndex((b) => b.y + b.h > topo + visivel * 0.25),
  );

  /** Do ponteiro no trilho para o conteúdo: a mesma conta da lente, invertida. */
  const doTrilho = (y: number) => ((y - alturaDaLente / 2) / curso) * maxTopo + visivel / 2;
  const blocoEm = (yConteudo: number) =>
    blocos.find((b) => yConteudo >= b.y && yConteudo < b.y + Math.max(b.h, 1)) ??
    blocos.reduce((perto, b) =>
      Math.abs(b.y - yConteudo) < Math.abs(perto.y - yConteudo) ? b : perto,
    );
  const mirado = mira === null || segurando ? null : blocoEm(doTrilho(mira));
  const itemMirado = mirado ? porId.get(mirado.id) : undefined;

  // --- a lente se segura ---------------------------------------------------
  const apertarLente = (e: EventoDePonteiro<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    arrasto.current = { y: e.clientY, topo, pegou: false };
    // Quem segura a lente não está mais apontando para um bloco.
    setMira(null);
  };
  const moverLente = (e: EventoDePonteiro<HTMLDivElement>) => {
    const a = arrasto.current;
    if (!a) return;
    const dy = e.clientY - a.y;
    if (!a.pegou) {
      if (Math.abs(dy) < LIMIAR_DO_ARRASTO) return;
      a.pegou = true;
      setSegurando(true);
    }
    rolarPara(a.topo + (dy / curso) * maxTopo, false);
  };
  const soltarLente = (e: EventoDePonteiro<HTMLDivElement>) => {
    arrasto.current = null;
    setSegurando(false);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <nav
      className={`tq-trilha${desperta ? ' desperta' : ''}${segurando ? ' segurando' : ''}`}
      aria-label="Mapa da conversa"
      style={{ top: caixa.top, right: caixa.right, height: trilho }}
      onWheel={(e) => {
        // Sobre a barra, a roda rola a conversa — na sidebar a barra fica sobre
        // a borda da coluna, e a roda não chegaria a ela sozinha.
        if (rolador) rolador.scrollBy({ top: e.deltaY });
      }}
    >
      <div
        className="tq-trilha-trilho"
        onPointerMove={(e) => {
          if (arrasto.current) return;
          setMira(e.clientY - e.currentTarget.getBoundingClientRect().top);
        }}
        onPointerLeave={() => setMira(null)}
        onClick={(e) => {
          // Clique no mapa: vai à mensagem daquele ponto. A lente trata o seu.
          if (e.defaultPrevented) return;
          const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
          const bloco = blocoEm(doTrilho(y));
          rolarPara(bloco.y - RESPIRO);
        }}
      >
        {blocos.map((b, i) => {
          const item = porId.get(b.id);
          if (!item) return null;
          const top = b.y * escala;
          const altura = Math.max(BLOCO_MINIMO, b.h * escala - 1.5);
          // Sob a lente = o bloco cruza o trecho que está na tela.
          const aceso = b.y < sobAte && b.y + b.h > sobDe;
          return (
            <span
              key={b.id}
              className={`tq-trilha-bloco${item.voce ? ' voce' : ''}${aceso ? ' aceso' : ''}${
                mirado?.id === b.id ? ' mirado' : ''
              }`}
              style={{ top, height: altura, animationDelay: `${Math.min(i, 12) * 18}ms` }}
              aria-hidden="true"
            />
          );
        })}

        {mira !== null && !segurando && (
          <span className="tq-trilha-mira" style={{ top: mira }} aria-hidden="true" />
        )}

        <div
          className="tq-trilha-lente"
          role="scrollbar"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fracao * 100)}
          aria-label="Trecho da conversa na tela: arraste para subir ou descer (Alt+↑/↓ pula mensagens)"
          tabIndex={0}
          style={{ top: topoDaLente, height: alturaDaLente }}
          onPointerDown={apertarLente}
          onPointerMove={moverLente}
          onPointerUp={soltarLente}
          onPointerCancel={soltarLente}
          onClick={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            const pagina = visivel * 0.85;
            const acoes: Record<string, () => void> = {
              ArrowUp: () => pular(-1),
              ArrowDown: () => pular(1),
              PageUp: () => rolarPara(topo - pagina),
              PageDown: () => rolarPara(topo + pagina),
              Home: () => rolarPara(0),
              End: () => rolarPara(total),
            };
            const acao = acoes[e.key];
            if (!acao) return;
            e.preventDefault();
            acao();
          }}
        >
          <span className="tq-trilha-pega" aria-hidden="true" />
          {segurando && (
            <span className="tq-trilha-contagem" aria-hidden="true">
              {indiceNoTopo + 1} <small>de {blocos.length}</small>
            </span>
          )}
        </div>

        {itemMirado && mira !== null && !segurando && (
          <span className="tq-trilha-previa" style={{ top: mira }} aria-hidden="true">
            <strong>{itemMirado.voce ? 'Você' : 'Taq'}</strong>
            {itemMirado.resumo}
          </span>
        )}
      </div>
    </nav>
  );
}

/** As marcas a partir das mensagens de uma conversa. */
export function marcasDasMensagens(
  mensagens: ReadonlyArray<{ id: string; role: string; text: string }>,
): MarcaDaTrilha[] {
  return mensagens.map((m) => {
    const limpo = m.text.replace(/[*_`#>[\]]/g, '').replace(/\s+/g, ' ').trim();
    return {
      id: m.id,
      voce: m.role === 'user',
      resumo: limpo.length > 96 ? `${limpo.slice(0, 96)}…` : limpo || '(sem texto)',
    };
  });
}
