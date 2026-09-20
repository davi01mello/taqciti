/**
 * A CÁPSULA — a única coisa que o TaqCiti ainda desenha dentro do Meet.
 *
 * ── O que ela deixou de ser ──────────────────────────────────────────────
 *
 * Ela era a porta de um painel flutuante montado na própria página. Esse painel
 * saiu: a sidebar agora é o painel lateral NATIVO do Chrome, que é página da
 * extensão de verdade — sem shadow root, sem disputar o centro da chamada, sem
 * morrer quando o Meet navega. O que sobra aqui é o que só a página pode fazer:
 * mostrar, por cima da reunião, que a captura está viva, e oferecer o caminho
 * de volta para a sidebar.
 *
 * ── O limite honesto do clique ───────────────────────────────────────────
 *
 * `chrome.sidePanel.open()` exige um gesto do usuário medido no contexto da
 * EXTENSÃO. Este clique acontece na PÁGINA: vira mensagem até o background, e o
 * gesto não atravessa a mensageria. O Chrome recusa — sempre, não às vezes.
 *
 * Então a cápsula tenta, e quando o Chrome recusa ela DIZ o que fazer, em vez
 * de não fazer nada e parecer quebrada. É a diferença entre uma limitação
 * explicada e um botão morto. (Ver o comentário longo em
 * `src/background/sidePanel.ts`.)
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { MeetingPhase, PanelPrefs } from '@/shared/types/domain';
import { formatElapsedClock } from '@/shared/ui/format';
import { Icon } from '@/shared/ui/Icon';
import { Sheen, SHEEN_HOST_POSITIONED, trackSheen } from '@/shared/ui/Sheen';
import { Wave } from '@/shared/ui/Wave';
import { useFloating } from './useFloating';
import { PANEL_OPEN_EVENT } from './mount';

export interface CapsulaCallbacks {
  /** Pede o painel lateral. Resolve com `false` quando o Chrome recusa. */
  onAbrirSidebar(): Promise<boolean>;
  /** Grava posição e presença. Sempre um patch. */
  onPrefsChange(patch: Partial<PanelPrefs>): void;
}

interface Props {
  phase: MeetingPhase;
  /** Início da sessão, para o relógio. `null` quando não há captura. */
  startedAt: number | null;
  /** Há uma reunião detectada esperando resposta na sidebar. */
  perguntando: boolean;
  /** A pessoa disse "agora não" para esta reunião. */
  recusado: boolean;
  /** `false` = há legenda na tela que a captura não está conseguindo ler. */
  saudavel: boolean;
  prefs: PanelPrefs;
  callbacks: CapsulaCallbacks;
}

/** Quanto tempo a dica de "clique no ícone" fica na tela. */
const DICA_MS = 6000;

export function Capsula({
  phase,
  startedAt,
  perguntando,
  recusado,
  saudavel,
  prefs,
  callbacks,
}: Props) {
  const [dica, setDica] = useState(false);
  const dicaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ativo = phase === 'recording' || phase === 'paused';

  // Relógio: só corre enquanto a captura está viva.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (phase !== 'recording') return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(
    () => () => {
      if (dicaTimer.current) clearTimeout(dicaTimer.current);
    },
    [],
  );

  const abrir = useCallback(() => {
    void callbacks.onAbrirSidebar().then((ok) => {
      if (ok) return;
      setDica(true);
      if (dicaTimer.current) clearTimeout(dicaTimer.current);
      dicaTimer.current = setTimeout(() => setDica(false), DICA_MS);
    });
  }, [callbacks]);

  // O clique no ícone da extensão numa aba que já tem a cápsula montada.
  useEffect(() => {
    const aoPedir = () => abrir();
    document.addEventListener(PANEL_OPEN_EVENT, aoPedir);
    return () => document.removeEventListener(PANEL_OPEN_EVENT, aoPedir);
  }, [abrir]);

  const floating = useFloating({
    x: prefs.x,
    y: prefs.y,
    // A cápsula é a única caixa que flutua agora; não há painel para alinhar.
    panel: CAIXA_ZERO,
    onMove: (x, y) => callbacks.onPrefsChange({ x, y }),
  });

  // Fechada: nada na tela. Volta pelo ícone da extensão ou por uma reunião nova.
  if (prefs.presence === 'closed') return null;

  // Legenda na tela que a captura não está lendo: âmbar, mesmo "gravando". A
  // cápsula não pode mostrar verde enquanto nada entra.
  const degradada = ativo && !saudavel;

  const tone = perguntando || degradada
    ? 'amber'
    : phase === 'recording'
      ? 'green'
      : phase === 'paused' || phase === 'captionsRequired'
        ? 'amber'
        : 'dim';

  const rotulo = perguntando
    ? 'registrar?'
    : degradada
      ? 'religando…'
      : phase === 'recording'
        ? formatElapsedClock(agora - (startedAt ?? agora))
        : phase === 'paused'
          ? 'pausado'
          : phase === 'captionsRequired'
            ? 'preparando…'
            : phase === 'ended'
              ? 'salva'
              : recusado
                ? 'sem registro'
                : 'TaqCiti';

  return (
    <>
      <button
        ref={floating.capsuleRef as RefObject<HTMLButtonElement>}
        type="button"
        title="TaqCiti — clique para abrir a sidebar, arraste para mover"
        aria-label="Abrir a sidebar do TaqCiti"
        {...floating.dragHandlers}
        onPointerMove={(event) => {
          floating.dragHandlers.onPointerMove(event);
          trackSheen(event);
        }}
        onPointerUp={(event) => {
          floating.dragHandlers.onPointerUp(event);
          if (floating.wasClick()) abrir();
        }}
        style={{ left: floating.geometry.capsule.left, top: floating.geometry.capsule.top }}
        className={`glass ${SHEEN_HOST_POSITIONED} fixed z-[2147483000] flex items-center gap-2.5 rounded-full py-2.5 pl-3.5 pr-4 text-body font-semibold tabular-nums text-foreground transition-[opacity,transform] duration-300 ease-flow animate-dock-in ${
          floating.dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <Sheen />
        <Wave size={16} animated={phase === 'recording'} tone={tone} />
        <span className={ativo && phase === 'recording' ? '' : 'text-muted'}>{rotulo}</span>
        {phase === 'recording' && (
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-dot" />
        )}
        {perguntando && (
          <span className="h-1.5 w-1.5 rounded-full bg-[#f2c94c] animate-pulse-dot" />
        )}
      </button>

      {/*
       * A explicação. Aparece só quando o Chrome recusou a abertura, e diz o
       * gesto que funciona — que é o clique no ícone da extensão.
       */}
      {dica && (
        <div
          role="status"
          style={{
            left: floating.geometry.capsule.left,
            top: floating.geometry.capsule.top - 78,
          }}
          className="glass fixed z-[2147483001] max-w-[280px] rounded-card px-3.5 py-2.5 text-caption leading-relaxed text-muted animate-fade-in"
        >
          O Chrome só abre o painel lateral a partir do ícone da extensão.
          <strong className="font-medium text-foreground">
            {' '}
            Clique no ícone do TaqCiti
          </strong>{' '}
          na barra do navegador.
        </div>
      )}

      {/* Fechar: tira a cápsula da tela desta aba. Discreto e fora do caminho
          do arraste — por isso um botão próprio, e não um gesto na cápsula. */}
      <button
        type="button"
        title="Esconder a cápsula do TaqCiti"
        aria-label="Esconder a cápsula do TaqCiti"
        onClick={() => callbacks.onPrefsChange({ presence: 'closed' })}
        style={{
          left: floating.geometry.capsule.left - 26,
          top: floating.geometry.capsule.top + 2,
        }}
        className="glass fixed z-[2147483000] grid h-6 w-6 place-items-center rounded-full text-muted opacity-0 transition-opacity duration-200 hover:opacity-100 focus-visible:opacity-100"
      >
        <Icon name="close" size={12} />
      </button>
    </>
  );
}

/** Estável entre renders: entra nas dependências da geometria do hook. */
const CAIXA_ZERO = { width: 0, height: 0 };
