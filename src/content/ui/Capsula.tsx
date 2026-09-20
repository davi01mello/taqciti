/**
 * A CÁPSULA — e a pergunta que aparece ao lado dela.
 *
 * ── Por que a pergunta mora aqui, e não só na sidebar ────────────────────
 *
 * A sidebar pode estar fechada, e quase sempre está quando se entra numa
 * reunião. Uma pergunta que só existe lá dentro é uma pergunta que ninguém vê —
 * e o resultado prático seria a captura nunca começar, ou começar sozinha.
 *
 * Então a solicitação é desenhada na página, encostada na cápsula: pequena,
 * com a identidade atual, duas ações e nada mais. Não é o painel flutuante
 * antigo de volta: aquele era o produto inteiro numa janela arrastável, com
 * histórico, busca e transcrição. Isto é uma pergunta e dois botões, e some
 * assim que for respondida.
 *
 * A confirmação daqui e a da sidebar são a MESMA decisão: as duas gravam na
 * mesma chave por participação (ver features/meeting/consent.ts). Responder num
 * lugar apaga a pergunta no outro, sem ninguém coordenar nada — e por isso não
 * existe pergunta duplicada.
 *
 * ── O clique abre a sidebar, e isso funciona ─────────────────────────────
 *
 * Por um tempo este botão foi um botão que falhava: `chrome.sidePanel.open()`
 * exige gesto do usuário, e a conclusão foi que o gesto não atravessava a
 * mensageria. Errado. O gesto atravessa; o que ele não sobrevive é a um `await`
 * antes da chamada — e havia um `await ready` no roteador de mensagens do
 * background. Medido no Chrome 144, o caminho abre. Ver
 * `src/background/sidePanel.ts`.
 *
 * É por isso que `abrir()` não é `async` e não espera nada antes de mandar a
 * mensagem. Qualquer `await` acrescentado neste caminho quebra a abertura.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { MeetingPhase, PanelPrefs } from '@/shared/types/domain';
import type { DecisaoDeRegistro } from '@/features/meeting/consent';
import { formatElapsedClock } from '@/shared/ui/format';
import { Icon } from '@/shared/ui/Icon';
import { Sheen, SHEEN_HOST_POSITIONED, trackSheen } from '@/shared/ui/Sheen';
import { Wave } from '@/shared/ui/Wave';
import { useFloating } from './useFloating';
import { PANEL_OPEN_EVENT } from './mount';

export interface CapsulaCallbacks {
  /** Pede o painel lateral. Resolve com `false` se o Chrome recusar. */
  onAbrirSidebar(): Promise<boolean>;
  /** Grava posição e presença. Sempre um patch. */
  onPrefsChange(patch: Partial<PanelPrefs>): void;
  /** A resposta à pergunta, dada na página. Mesma decisão da sidebar. */
  onResponder(decisao: DecisaoDeRegistro): void;
}

interface Props {
  phase: MeetingPhase;
  /** Início da sessão, para o relógio. `null` quando não há captura. */
  startedAt: number | null;
  /** Título da reunião detectada esperando resposta. `null` = não há pergunta. */
  perguntandoSobre: string | null;
  /** A pessoa disse "agora não" para esta participação. */
  recusado: boolean;
  /** `false` = há legenda na tela que a captura não está conseguindo ler. */
  saudavel: boolean;
  prefs: PanelPrefs;
  callbacks: CapsulaCallbacks;
}

/** Quanto tempo a explicação de falha fica na tela. */
const DICA_MS = 6000;

export function Capsula({
  phase,
  startedAt,
  perguntandoSobre,
  recusado,
  saudavel,
  prefs,
  callbacks,
}: Props) {
  const [dica, setDica] = useState(false);
  const dicaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const perguntando = perguntandoSobre !== null;
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

  /*
   * NÃO é `async`, e a mensagem é a primeira coisa que acontece: é o gesto do
   * clique que autoriza a abertura do painel, e ele não sobrevive a um `await`.
   */
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
    panel: CAIXA_ZERO,
    onMove: (x, y) => callbacks.onPrefsChange({ x, y }),
  });

  // Fechada: nada na tela. Volta pelo ícone da extensão ou por uma reunião
  // nova — uma pergunta pendente reacende a cápsula, senão ela seria invisível
  // justamente no momento em que tem algo a dizer.
  if (prefs.presence === 'closed' && !perguntando) return null;

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

  /** A pergunta abre para cima ou para baixo, conforme onde a cápsula está. */
  const paraBaixo = floating.geometry.capsule.top < 220;

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
        <span className={phase === 'recording' && !degradada ? '' : 'text-muted'}>
          {rotulo}
        </span>
        {phase === 'recording' && !degradada && (
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-dot" />
        )}
        {perguntando && (
          <span className="h-1.5 w-1.5 rounded-full bg-[#f2c94c] animate-pulse-dot" />
        )}
      </button>

      {/* ---------- a solicitação, na própria página ---------- */}
      {perguntando && (
        <div
          role="dialog"
          aria-label="Registrar esta reunião?"
          style={{
            left: Math.max(12, floating.geometry.capsule.left - 96),
            top: paraBaixo
              ? floating.geometry.capsule.top + 52
              : floating.geometry.capsule.top - 172,
          }}
          className="glass fixed z-[2147483002] w-[286px] max-w-[92vw] rounded-card p-3.5 animate-dock-in"
        >
          <p className="text-read font-semibold text-foreground">
            Deseja registrar esta reunião?
          </p>
          {perguntandoSobre && (
            <p className="mt-0.5 truncate text-caption text-muted">{perguntandoSobre}</p>
          )}
          <p className="mt-2 text-micro leading-relaxed text-muted/90">
            O TaqCiti lê as <strong className="font-medium">legendas do Meet</strong> e
            guarda a transcrição neste computador. Não há gravação de áudio nem de
            vídeo.
          </p>

          <div className="mt-3 flex gap-1.5">
            <button
              type="button"
              onClick={() => callbacks.onResponder('aceito')}
              className="flex-1 rounded-full border border-primary/45 bg-primary/[0.16] px-3 py-2 text-caption font-medium text-glow transition-colors duration-200 hover:bg-primary/25"
            >
              Iniciar captura
            </button>
            <button
              type="button"
              onClick={() => callbacks.onResponder('recusado')}
              className="flex-1 rounded-full border border-white/10 px-3 py-2 text-caption text-muted transition-colors duration-200 hover:bg-white/[0.07] hover:text-foreground"
            >
              Agora não
            </button>
          </div>
          <p className="mt-2 text-micro text-muted/75">
            Ignorar mantém a captura desligada.
          </p>
        </div>
      )}

      {/* A explicação de falha. Só aparece se a abertura for recusada — o que,
          desde a correção do gesto, deixou de ser o caso comum. */}
      {dica && (
        <div
          role="status"
          style={{
            left: floating.geometry.capsule.left,
            top: floating.geometry.capsule.top - 78,
          }}
          className="glass fixed z-[2147483001] max-w-[280px] rounded-card px-3.5 py-2.5 text-caption leading-relaxed text-muted animate-fade-in"
        >
          Não consegui abrir o painel daqui.
          <strong className="font-medium text-foreground">
            {' '}
            Clique no ícone do TaqCiti
          </strong>{' '}
          na barra do navegador.
        </div>
      )}

      {/* Esconder: tira a cápsula desta aba. Fora do caminho do arraste, por
          isso um botão próprio e não um gesto na cápsula. */}
      {!perguntando && (
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
      )}
    </>
  );
}

/** Estável entre renders: entra nas dependências da geometria do hook. */
const CAIXA_ZERO = { width: 0, height: 0 };
