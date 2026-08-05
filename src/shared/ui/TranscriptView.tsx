/**
 * A transcrição — UM componente para o painel dentro do Meet, o side panel e o
 * histórico. Antes eram dois (TranscriptFeed e TranscriptList) com espaçamento,
 * tipografia e agrupamento diferentes; a mesma reunião parecia outra em cada
 * tela.
 *
 * Falas seguidas da mesma pessoa viram um bloco só. O rótulo "(Eu)" é de tela:
 * o que vai para a plataforma é sempre o nome puro.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveSegment } from '@/shared/types/domain';
import { getSegmentDisplayText } from '@/shared/types/domain';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Wave } from './Wave';
import { assignSpeakerColors, formatOffset, speakerLabel } from './format';

interface TranscriptViewProps {
  segments: readonly LiveSegment[];
  /** Nome de quem está tocando a reunião: ganha "(Eu)" ao lado. */
  selfName?: string | null;
  /** Rola sozinho e mostra a pílula de novas falas (transcrição ao vivo). */
  live?: boolean;
  /** Captura pausada: o texto esmaece sem sumir. */
  dimmed?: boolean;
  /** Destaca as ocorrências desta busca. */
  query?: string;
  emptyMessage?: string;
  className?: string;
  /** Presença destes callbacks habilita as ações — quando ausentes (histórico
   *  só-leitura), a linha é só exibida, sem botão nenhum. */
  onDeleteSegment?: (segmentId: string) => void;
  onEditSegment?: (segmentId: string, text: string) => void;
  onRestoreSegment?: (segmentId: string) => void;
  /** Campo de linha manual: só aparece quando `live` E este callback existir. */
  onAddManualSegment?: (text: string, speaker?: string) => void;
}

/** Distância do fim abaixo da qual consideramos "grudado no rodapé". */
const STICK_THRESHOLD_PX = 56;

export function TranscriptView({
  segments,
  selfName = null,
  live = false,
  dimmed = false,
  query = '',
  emptyMessage = 'A transcrição aparece aqui conforme as pessoas falam.',
  className = '',
  onDeleteSegment,
  onEditSegment,
  onRestoreSegment,
  onAddManualSegment,
}: TranscriptViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const stickToBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const speakerColors = useMemo(
    () =>
      assignSpeakerColors(
        segments.map((segment) => segment.speaker ?? 'Falante'),
        'dark',
      ),
    [segments],
  );
  const hasSegments = segments.length > 0;

  /**
   * Cola no rodapé SEM animar.
   *
   * `behavior: 'smooth'` aqui era um defeito: o Meet reescreve a legenda várias
   * vezes por segundo e cada chamada REINICIA a animação, que nunca chega ao
   * fim — a transcrição parecia travada justamente enquanto a pessoa falava.
   * A ~4 atualizações por segundo o salto instantâneo é imperceptível: o que
   * se vê é o texto crescendo. O `smooth` fica só para o salto da pílula, que
   * é um movimento único e voluntário.
   */
  const pin = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  /**
   * Quem desliga o acompanhamento é a INTENÇÃO do usuário, não a posição da
   * barra.
   *
   * Ler só a posição no `onScroll` não funciona: rolagem programática também
   * dispara scroll, e quando o conteúdo cresce no meio do movimento a conta dá
   * "longe do fim" — o acompanhamento se desligava sozinho e a pílula de novas
   * falas aparecia sem ninguém ter tocado em nada.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const settle = () => {
      const nearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
      if (nearBottom) {
        stickToBottom.current = true;
        setShowJump(false);
      }
    };

    const release = () => {
      stickToBottom.current = false;
      if (live) setShowJump(true);
    };

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) release();
      else requestAnimationFrame(settle);
    };

    const onTouchMove = () => release();

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'ArrowUp' ||
        event.key === 'PageUp' ||
        event.key === 'Home' ||
        event.key === 'ArrowDown' ||
        event.key === 'PageDown' ||
        event.key === 'End'
      ) {
        if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home') {
          release();
        } else {
          // O DOM só move depois de tratar a tecla; a leitura vai no próximo quadro.
          requestAnimationFrame(settle);
        }
      }
    };

    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('keydown', onKeyDown);
    // Scroll programático nunca desliga; voltar fisicamente ao fim religa.
    el.addEventListener('scroll', settle, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('scroll', settle);
    };
  }, [live]);

  /**
   * O Meet faz o ÚLTIMO segmento crescer no lugar: quando o texto reflui para
   * mais uma linha, a altura muda sem entrar item na lista. Um efeito preso à
   * lista de segmentos não vê isso; o observer vê.
   */
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) pin();
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [hasSegments, pin]);

  useEffect(() => {
    if (!live) return;
    if (stickToBottom.current) pin();
    else if (segments.length > 0) setShowJump(true);
  }, [segments, live, pin]);

  const jumpToLatest = () => {
    stickToBottom.current = true;
    setShowJump(false);
    const el = scrollRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  const deletedCount = segments.filter((segment) => segment.status === 'deleted').length;
  const visibleSegments = showDeleted
    ? segments
    : segments.filter((segment) => segment.status !== 'deleted');

  /** Onde mostrar os pontinhos de "ainda falando" — nunca numa linha apagada:
   *  uma vez selada ou assentada, ela nunca mais recebe update de verdade. */
  let lastActiveIndex = -1;
  for (let i = visibleSegments.length - 1; i >= 0; i -= 1) {
    if (visibleSegments[i]?.status !== 'deleted') {
      lastActiveIndex = i;
      break;
    }
  }

  return (
    <div className={`relative flex min-h-0 flex-1 flex-col ${className}`}>
      {/*
       * A caixa de rolagem é ELA PRÓPRIA o item flexível — sem `h-full`.
       * Altura percentual contra um pai de altura indefinida resolve para
       * `auto`, e aí a caixa cresce até o tamanho do texto inteiro: nada rola,
       * o auto-scroll não tem para onde ir e o painel corta o resto. Assim a
       * altura vem do próprio flex e não depende de nenhum ancestral.
       *
       * `tabIndex` para a rolagem por teclado funcionar (e o Page Up soltar o
       * acompanhamento, como qualquer chat).
       */}
      <div
        ref={scrollRef}
        tabIndex={0}
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 outline-none transition-opacity duration-300 ease-flow ${
          dimmed ? 'opacity-45' : 'opacity-100'
        }`}
      >
        {deletedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowDeleted((current) => !current)}
            className="mb-2 rounded-control px-1 py-0.5 text-micro font-medium text-muted/70 transition-colors duration-200 ease-flow hover:text-foreground hover:underline"
          >
            {showDeleted
              ? 'Ocultar linhas removidas'
              : `Mostrar linhas removidas (${deletedCount})`}
          </button>
        )}

        {segments.length === 0 ? (
          <div className="mt-16 flex flex-col items-center gap-3 px-6 text-center">
            <span className="relative grid h-12 w-12 place-items-center">
              <span className="absolute inset-0 rounded-full border border-primary/25 animate-ripple motion-reduce:animate-none" />
              <span
                className="absolute inset-0 rounded-full border border-primary/25 animate-ripple motion-reduce:animate-none"
                style={{ animationDelay: '0.9s' }}
              />
              <Wave size={22} animated={live} tone={live ? 'green' : 'dim'} />
            </span>
            <p className="max-w-[230px] text-body text-muted">
              {emptyMessage}
            </p>
          </div>
        ) : (
          <ul ref={listRef}>
            {visibleSegments.map((segment, index) => {
              const name = segment.speaker ?? 'Falante';
              const previous = visibleSegments[index - 1];
              const isManual = segment.source === 'manual';
              const isDeleted = segment.status === 'deleted';
              // Manual nunca agrupa (nem como anterior nem como atual): a fala
              // digitada precisa do próprio cabeçalho pra mostrar o selo
              // "manual" — nunca pode se confundir com uma fala real.
              const grouped =
                !isManual &&
                previous !== undefined &&
                previous.source !== 'manual' &&
                (previous.speaker ?? 'Falante') === name;
              const editing = editingId === segment.id;
              const displayText = getSegmentDisplayText(segment);

              return (
                <li
                  // `id` é a identidade de linha lógica (estável, nunca
                  // reescrita) — diferente de `captionId`, que se repete entre
                  // segmentos quando o Meet reaproveita a linha do DOM.
                  key={segment.id ?? `${segment.captionId ?? 'legacy'}:${index}`}
                  /*
                   * `content-visibility` no lugar de um virtualizador: o
                   * navegador pula layout e paint do que está fora da janela,
                   * e a reunião de duas horas rola tão leve quanto a de cinco
                   * minutos. Diferente de virtualizar, mantém o Ctrl+F do
                   * navegador, a seleção de texto atravessando blocos e a
                   * altura variável sem medir nada.
                   */
                  style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 64px' }}
                  /*
                   * Fade puro, sem deslocamento: o `animate-entry` sobe o
                   * bloco 7px enquanto a lista desce atrás dele, e as duas
                   * coisas juntas dão um tremor a cada fala nova.
                   */
                  className={`group ${grouped ? 'mt-1' : 'mt-4 first:mt-0'} animate-fade-in motion-reduce:animate-none`}
                >
                  {!grouped && (
                    <div className="mb-1.5 flex min-w-0 items-center gap-2">
                      <Avatar name={name} size={22} />
                      <span
                        className="min-w-0 truncate text-body font-semibold"
                        style={{ color: speakerColors.get(name) }}
                      >
                        {speakerLabel(name, selfName)}
                      </span>
                      {isManual && (
                        <span
                          title="Linha digitada manualmente — não veio da captura do Meet"
                          className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted"
                        >
                          manual
                        </span>
                      )}
                      <span className="ml-auto shrink-0 text-micro tabular-nums text-muted/60">
                        {formatOffset(segment.startOffsetMs)}
                      </span>
                    </div>
                  )}

                  {editing ? (
                    <SegmentEditor
                      initialText={displayText}
                      onCancel={() => setEditingId(null)}
                      onSave={(text) => {
                        onEditSegment?.(segment.id, text);
                        setEditingId(null);
                      }}
                    />
                  ) : (
                    <>
                      {/*
                       * `break-words`: o texto vem do reconhecedor do Meet e
                       * pode trazer um token sem espaço nenhum (URL, número de
                       * pedido). Sem isso ele estoura os 392px do painel na
                       * horizontal.
                       */}
                      <p
                        className={`break-words pl-[30px] text-read text-foreground/90 ${
                          isDeleted ? 'text-foreground/50 line-through decoration-white/30' : ''
                        }`}
                      >
                        <Highlight text={displayText} query={query} />
                        {live && index === lastActiveIndex && (
                          <span className="ml-1 inline-flex gap-[3px] align-middle">
                            {[0, 1, 2].map((dot) => (
                              <span
                                key={dot}
                                className="h-[3px] w-[3px] rounded-full bg-glow animate-typing motion-reduce:animate-none"
                                style={{ animationDelay: `${dot * 0.16}s` }}
                              />
                            ))}
                          </span>
                        )}
                      </p>

                      {isDeleted
                        ? onRestoreSegment && (
                            <div className="mt-1 pl-[30px]">
                              <button
                                type="button"
                                onClick={() => onRestoreSegment(segment.id)}
                                className="text-micro font-semibold text-glow hover:underline"
                              >
                                Restaurar
                              </button>
                            </div>
                          )
                        : (onEditSegment || onDeleteSegment) && (
                            <div className="mt-1 flex gap-3 pl-[30px] opacity-0 transition-opacity duration-150 ease-flow group-hover:opacity-100 group-focus-within:opacity-100">
                              {onEditSegment && (
                                <button
                                  type="button"
                                  onClick={() => setEditingId(segment.id)}
                                  className="text-micro font-medium text-muted/70 hover:text-foreground hover:underline"
                                >
                                  Editar
                                </button>
                              )}
                              {onDeleteSegment && (
                                <button
                                  type="button"
                                  onClick={() => onDeleteSegment(segment.id)}
                                  className="flex items-center gap-1 text-micro font-medium text-muted/70 hover:text-red-300 hover:underline"
                                >
                                  <Icon name="trash" size={11} />
                                  Apagar
                                </button>
                              )}
                            </div>
                          )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {live && onAddManualSegment && <ManualSegmentField onSubmit={onAddManualSegment} />}
      </div>

      {showJump && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="glass absolute bottom-3 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-caption font-semibold text-glow animate-entry"
        >
          <Icon name="arrowDown" size={13} />
          Novas falas
        </button>
      )}
    </div>
  );
}

/** Edição inline de uma linha: Enter salva, Shift+Enter quebra linha, Esc cancela. */
function SegmentEditor({
  initialText,
  onSave,
  onCancel,
}: {
  initialText: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialText);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const save = () => {
    const text = draft.trim();
    if (text.length > 0) onSave(text);
    else onCancel();
  };

  return (
    <div className="pl-[30px]">
      <textarea
        ref={ref}
        value={draft}
        rows={2}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            save();
          }
          if (event.key === 'Escape') onCancel();
        }}
        className="w-full resize-none rounded-control border border-primary/40 bg-white/5 px-2 py-1.5 text-read text-foreground outline-none"
      />
      <div className="mt-1 flex gap-3">
        <button
          type="button"
          onClick={save}
          className="flex items-center gap-1 text-micro font-semibold text-glow hover:underline"
        >
          <Icon name="check" size={11} />
          Salvar
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-micro text-muted/70 hover:underline"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

/** Campo pra digitar uma linha que não veio da captura — pedido explícito do
 *  usuário, nunca confundido com fala real (badge "manual" no próprio campo). */
function ManualSegmentField({
  onSubmit,
}: {
  onSubmit: (text: string, speaker?: string) => void;
}) {
  const [draft, setDraft] = useState('');

  const submit = () => {
    const text = draft.trim();
    if (text.length === 0) return;
    onSubmit(text);
    setDraft('');
  };

  return (
    <div className="mt-4 flex items-center gap-2 border-t border-white/5 pt-3">
      <span
        title="A linha entra marcada como manual — não vem da captura do Meet"
        className="shrink-0 rounded-full bg-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted"
      >
        manual
      </span>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') submit();
        }}
        placeholder="Adicionar uma linha manualmente…"
        className="min-w-0 flex-1 rounded-control border border-white/10 bg-white/5 px-2.5 py-1.5 text-read text-foreground outline-none placeholder:text-muted/50 focus:border-primary/40"
      />
      <button
        type="button"
        onClick={submit}
        disabled={draft.trim().length === 0}
        className="shrink-0 rounded-control px-2.5 py-1.5 text-micro font-semibold text-glow hover:underline disabled:opacity-40 disabled:hover:no-underline"
      >
        Adicionar
      </button>
    </div>
  );
}

/**
 * Destaca a busca sem nunca montar HTML: o texto vem do DOM do Meet e é
 * tratado como não confiável em toda a extensão.
 */
function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return <>{text}</>;

  const parts: Array<{ chunk: string; hit: boolean }> = [];
  const haystack = text.toLowerCase();
  let cursor = 0;
  let found = haystack.indexOf(needle);

  while (found !== -1) {
    if (found > cursor) parts.push({ chunk: text.slice(cursor, found), hit: false });
    parts.push({ chunk: text.slice(found, found + needle.length), hit: true });
    cursor = found + needle.length;
    found = haystack.indexOf(needle, cursor);
  }
  if (cursor < text.length) parts.push({ chunk: text.slice(cursor), hit: false });

  return (
    <>
      {parts.map((part, index) =>
        part.hit ? (
          <mark key={index} className="rounded bg-primary/22 px-0.5 text-glow">
            {part.chunk}
          </mark>
        ) : (
          <span key={index}>{part.chunk}</span>
        ),
      )}
    </>
  );
}
