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
import type { DecisaoDeRegistro, GravacaoAnterior } from '@/features/meeting/consent';
import { formatElapsedClock } from '@/shared/ui/format';
import { Icon } from '@/shared/ui/Icon';
import { Sheen, SHEEN_HOST_POSITIONED, trackSheen } from '@/shared/ui/Sheen';
import { Wave } from '@/shared/ui/Wave';
import { derivarEstadoDaCaptura, LEITURA_DO_ESTADO } from '@/shared/ui/estadoDaCaptura';
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
  /** A última gravação desta sala, oferecida para continuar. */
  gravacaoAnterior?: GravacaoAnterior | null;
  /** A pessoa disse "agora não" para esta participação. */
  recusado: boolean;
  /** `false` = há legenda na tela que a captura não está conseguindo ler. */
  saudavel: boolean;
  /** Instante do último trecho recebido; 
ull = nenhum ainda. */
  ultimoTrechoEm?: number | null;
  /** Quantas falas já foram capturadas. */
  falas?: number;
  prefs: PanelPrefs;
  callbacks: CapsulaCallbacks;
}

/** Quanto tempo a explicação de falha fica na tela. */
const DICA_MS = 6000;

/** Largura desejada do balão da pergunta — a mesma do `w-[286px]` abaixo. */
const LARGURA_PERGUNTA = 286;
/** Respiro mínimo entre o balão e a borda da tela. */
const MARGEM_DA_PERGUNTA = 12;

export function Capsula({
  phase,
  startedAt,
  perguntandoSobre,
  gravacaoAnterior = null,
  recusado,
  saudavel,
  ultimoTrechoEm = null,
  falas = 0,
  prefs,
  callbacks,
}: Props) {
  const [dica, setDica] = useState(false);
  const dicaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const perguntando = perguntandoSobre !== null;

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

  const estado = derivarEstadoDaCaptura(
    { phase, captureHealthy: saudavel, startedAt, lastChunkAt: ultimoTrechoEm, falas },
    agora,
  );
  const gravando = estado === 'capturando' && !perguntando;

  const tone = perguntando
    ? 'amber'
    : estado === 'erro'
      ? 'red'
      : estado === 'capturando'
        ? 'green'
        : estado === 'desligada' || estado === 'salva'
          ? 'dim'
          : 'amber';

  const rotulo = perguntando
    ? 'registrar?'
    : estado === 'erro'
      ? 'erro na captura'
      : estado === 'interrompida'
        ? 'religando…'
        : estado === 'capturando'
          ? `Gravando ${formatElapsedClock(agora - (startedAt ?? agora))}`
          : estado === 'iniciando'
            ? 'iniciando…'
            : estado === 'aguardando_fonte'
              ? 'aguardando legendas'
              : estado === 'pausada'
                ? 'pausado'
                : estado === 'preparando'
                  ? 'preparando…'
                  : phase === 'ended'
                    ? 'salva'
                    : recusado
                      ? 'sem registro'
                      : 'TaqCiti';
  /** A pergunta abre para cima ou para baixo, conforme onde a cápsula está. */
  const paraBaixo = floating.geometry.capsule.top < 220;

  /*
   * Onde a pergunta cabe — e não só onde ela gostaria de ficar.
   *
   * A cápsula nasce encostada à direita (`x: 0.97` em DEFAULT_PANEL_PREFS), e
   * a pergunta era posicionada apenas como "96px à esquerda da cápsula". Numa
   * instalação nova isso punha metade do balão fora da tela: o botão "Agora
   * não" ficava cortado pela borda direita, na primeira reunião de quem acabou
   * de instalar. Medido no Chrome, com a posição padrão.
   *
   * Agora ela é presa dentro do viewport nos dois eixos. `window.innerWidth` é
   * lido no render porque o hook de posicionamento já repinta a cada `resize`.
   */
  const larguraDaPergunta = Math.min(LARGURA_PERGUNTA, window.innerWidth * 0.92);
  const esquerdaDaPergunta = Math.max(
    MARGEM_DA_PERGUNTA,
    Math.min(
      floating.geometry.capsule.left - 96,
      window.innerWidth - larguraDaPergunta - MARGEM_DA_PERGUNTA,
    ),
  );
  const topoDaPergunta = Math.max(
    MARGEM_DA_PERGUNTA,
    paraBaixo
      ? floating.geometry.capsule.top + 52
      : floating.geometry.capsule.top - (gravacaoAnterior ? 236 : 172),
  );

  return (
    <>
      <button
        ref={floating.capsuleRef as RefObject<HTMLButtonElement>}
        type="button"
        title="TaqCiti — clique para abrir a sidebar, arraste para mover"
        aria-label={
          perguntando || estado === 'desligada'
            ? 'Abrir a sidebar do TaqCiti'
            : `${LEITURA_DO_ESTADO[estado]}. Abrir a sidebar do TaqCiti`
        }
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
        <Wave size={16} animated={estado === 'capturando'} tone={tone} />
        <span className={gravando ? '' : 'text-muted'}>
          {rotulo}
        </span>
        {gravando && (
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-dot" />
        )}
        {perguntando && (
          <span className="h-1.5 w-1.5 rounded-full bg-[#f2c94c] animate-pulse-dot" />
        )}
        {/* Só a MUDANÇA de estado é anunciada: o relógio, que muda a cada segundo, fica de fora. */}
        <span className="sr-only" role="status">{perguntando ? '' : LEITURA_DO_ESTADO[estado]}</span>
      </button>

      {/* ---------- a solicitação, na própria página ---------- */}
      {perguntando && (
        <div
          role="dialog"
          aria-label="Registrar esta reunião?"
          style={{ left: esquerdaDaPergunta, top: topoDaPergunta }}
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

          {gravacaoAnterior && (
            <p className="mt-2 text-micro leading-relaxed text-muted/90">
              Esta sala já tem uma gravação:{' '}
              <strong className="font-medium">{gravacaoAnterior.title}</strong> ·{' '}
              {new Date(gravacaoAnterior.endedAt).toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              · {gravacaoAnterior.segmentos} fala(s).
            </p>
          )}

          {gravacaoAnterior && (
            <button
              type="button"
              onClick={() => callbacks.onResponder(`continuar:${gravacaoAnterior.id}`)}
              className="mt-3 w-full rounded-full border border-primary/45 bg-primary/[0.16] px-3 py-2 text-caption font-medium text-glow transition-colors duration-200 hover:bg-primary/25"
            >
              Continuar de onde parou
            </button>
          )}
          <div className={`${gravacaoAnterior ? 'mt-1.5' : 'mt-3'} flex gap-1.5`}>
            <button
              type="button"
              onClick={() => callbacks.onResponder('aceito')}
              className={`flex-1 rounded-full px-3 py-2 text-caption transition-colors duration-200 ${
                gravacaoAnterior
                  ? 'border border-white/15 text-foreground hover:bg-white/[0.07]'
                  : 'border border-primary/45 bg-primary/[0.16] font-medium text-glow hover:bg-primary/25'
              }`}
            >
              {gravacaoAnterior ? 'Nova gravação' : 'Iniciar captura'}
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
