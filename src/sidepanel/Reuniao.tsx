/**
 * A tela da reunião em andamento: as ações, a transcrição, os prints e o aviso
 * no chat.
 *
 * ── O que NUNCA acontece aqui ────────────────────────────────────────────
 *
 * Nada nesta tela modifica o texto capturado. A marcação é metadado guardado à
 * parte (ver features/annotations/marks.ts), a nota é outro registro, o print é
 * outro ainda, e a pergunta à IA vai para a conversa. A transcrição é o que foi
 * dito; tudo o mais é o que a pessoa acrescentou em volta.
 *
 * ── A ordem da tela ──────────────────────────────────────────────────────
 *
 * Ações primeiro, transcrição depois. É o contrário do que era, e o motivo é o
 * uso: a transcrição rola sozinha e cresce sem parar; qualquer controle depois
 * dela é um controle que foge da tela em três minutos de reunião. As ações
 * ficam ancoradas no topo, e só a lista de falas rola.
 *
 * ── O trecho selecionado ─────────────────────────────────────────────────
 *
 * Um clique numa fala a seleciona — realce discreto, e uma fileira de controles
 * que pertence àquele trecho. É assim que marcar e perguntar têm um alvo
 * explícito, em vez de um botão genérico que agiria sobre "a transcrição" e
 * deixaria a pessoa adivinhar sobre o quê.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveSegment, MeetingState } from '@/shared/types/domain';
import { usePlatform } from '@/shared/platform/context';
import type { EstadoDaGravacao } from '@/features/annotations/notes';
import {
  lerMarcas,
  marcarTrecho,
  observarMarcas,
  TIPOS_DE_MARCA,
  type MarcasDaReuniao,
} from '@/features/annotations/marks';
import {
  estadoDoAviso,
  JANELA_MS,
  observarAvisos,
  registrarAvisoEnviado,
  segundosRestantes,
  TEXTO_DO_AVISO,
  type AvisoEnviado,
} from '@/features/annotations/chatNotice';
import {
  apagarPrint,
  guardarPrint,
  MAX_POR_REUNIAO,
  observarPrints,
  type Print,
} from '@/features/annotations/shots';
import { EXPLICACAO, type MotivoDeFalha } from '@/background/captura';
import type { ContextoDaPergunta } from '@/home/conversations';
import { Icon } from '@/shared/ui/Icon';
import { formatElapsedClock, formatOffset, hostName, speakerLabel } from '@/shared/ui/format';
import { WaveField } from '@/home/WaveField';
import { useAnimacao } from '@/home/useAnimacao';
import { AcoesDaReuniao } from './AcoesDaReuniao';
import { EditorDeNota } from './Notas';
import { AbasDaReuniao, ParteDaReuniao } from './AbasDaReuniao';

interface Props {
  state: MeetingState;
  notaExiste: boolean;
  rascunhoNota: string;
  estadoDaNota: EstadoDaGravacao;
  onEscreverNota: (meetingId: string, texto: string) => void;
  onPerguntarSobre: (contexto: ContextoDaPergunta) => void;
}

export function Reuniao({
  state,
  notaExiste,
  rascunhoNota,
  estadoDaNota,
  onEscreverNota,
  onPerguntarSobre,
}: Props) {
  const platform = usePlatform();
  const sessao = state.session;
  const fase = state.phase;

  /*
   * Aberto ou recolhido é estado desta tela, e sobrevive a trocar de seletor
   * porque a seção inteira continua montada (ver `Painel` em App.tsx). O
   * TEXTO da nota não mora aqui de propósito — ver o cabeçalho de Notas.tsx.
   */
  const [notaAberta, setNotaAberta] = useState(false);
  const [printAberto, setPrintAberto] = useState(false);
  const [prints, setPrints] = useState<Print[]>([]);

  const meetingId = sessao?.meetingId ?? null;
  useEffect(() => {
    if (meetingId === null) return;
    return observarPrints((todos) =>
      setPrints(todos.filter((p) => p.meetingId === meetingId)),
    );
  }, [meetingId]);

  // A duração é de relógio de parede: em pausa ela também corre. Parar o
  // relógio na pausa congelava o número e o fazia saltar ao retomar.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (fase !== 'recording' && fase !== 'paused') return;
    setAgora(Date.now());
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [fase]);

  if (!sessao || fase === 'idle') return null;

  if (fase === 'captionsRequired') {
    return (
      <div className="tq-vazio-centro">
        <span className="tq-girando" aria-hidden="true" />
        <h2>Preparando a transcrição…</h2>
        <p>
          Ligando as legendas do Meet e escondendo-as da tela. A captura começa assim que
          elas aparecerem.
        </p>
      </div>
    );
  }

  const duracao = formatElapsedClock((sessao.endedAt ?? agora) - sessao.startedAt);
  const viva = fase === 'recording' || fase === 'paused';
  const interrompida = fase === 'recording' && sessao.captureHealthy === false;

  const perguntarSobreAReuniao = () =>
    onPerguntarSobre({ meetingId: sessao.meetingId, meetingTitle: sessao.title });

  return (
    <div className="tq-rolavel">
      <div className="tq-reuniao-topo">
        <h2>{sessao.title}</h2>
        <p className="tq-fino">
          {interrompida
            ? 'Captura interrompida'
            : fase === 'recording'
              ? 'Transcrevendo'
              : 'Pausada'}{' '}
          · {duracao} · {sessao.segments.length}{' '}
          {sessao.segments.length === 1 ? 'fala' : 'falas'}
          {notaExiste && ' · com nota'}
        </p>
      </div>

      <AcoesDaReuniao
        viva={viva}
        pausada={fase === 'paused'}
        printAberto={printAberto}
        quantosPrints={prints.length}
        onPrint={() => setPrintAberto((v) => !v)}
        onPausar={() =>
          void platform.send({ type: fase === 'paused' ? 'ui/resume' : 'ui/pause' })
        }
        onPerguntar={perguntarSobreAReuniao}
        onFinalizar={() => void platform.send({ type: 'ui/finish' })}
      />

      {printAberto && <Prints meetingId={sessao.meetingId} prints={prints} viva={viva} />}

      {fase === 'paused' && (
        <p className="tq-aviso-caixa">
          Captura pausada. O que já foi transcrito continua guardado; nada novo entra até
          você retomar.
        </p>
      )}

      {/*
       * A interrupção tem aviso próprio, e não um "transcrevendo" mais
       * pálido: há legenda na tela que a captura não consegue ler, e
       * continuar comunicando captura normal seria mentir com a interface.
       */}
      {interrompida && (
        <p className="tq-aviso-caixa tq-aviso-atencao" role="status">
          A captura parou de ler as legendas do Meet. O TaqCiti está tentando religar
          sozinho — o que já foi transcrito continua guardado.
        </p>
      )}

      {viva && (
        <AvisoNoChat
          meetingId={sessao.meetingId}
          inicio={sessao.startedAt}
          capturando={fase === 'recording'}
        />
      )}

      <AbasDaReuniao
        notas={notaAberta}
        notaExiste={notaExiste}
        onNotas={setNotaAberta}
      />
      <div className="tq-reuniao-alternada">
        <ParteDaReuniao ativa={notaAberta}>
          <EditorDeNota
            ativa={notaAberta}
            meetingId={sessao.meetingId}
            texto={rascunhoNota}
            estado={estadoDaNota}
            onEscrever={onEscreverNota}
            onRecolher={() => setNotaAberta(false)}
          />
        </ParteDaReuniao>
        <ParteDaReuniao ativa={!notaAberta}>
          {/*
           * A onda é ancorada AQUI, no pé da transcrição, e não atrás do campo
           * de escrita da conversa: ela é o sinal de que há captura correndo, e
           * o lugar em que isso se lê é a lista de falas. Fica atrás do texto,
           * decorativa, sem capturar o ponteiro.
           */}
          <div className="tq-transcricao-palco">
            {sessao.segments.length === 0 ? (
              <p className="tq-fino tq-centrado">
                {fase === 'ended'
                  ? 'Nenhuma fala foi capturada nesta reunião — as legendas do Meet não chegaram a produzir texto.'
                  : fase === 'paused'
                    ? 'Captura pausada. As falas voltam a aparecer aqui quando você retomar.'
                    : interrompida
                      ? 'A captura não está conseguindo ler as legendas. O TaqCiti está tentando religar.'
                      : 'Capturando. As falas aparecem aqui conforme as legendas chegam.'}
              </p>
            ) : (
              <ListaDeFalas
                meetingId={sessao.meetingId}
                titulo={sessao.title}
                segmentos={sessao.segments}
                selfName={hostName(sessao.participants)}
                onPerguntarSobre={onPerguntarSobre}
              />
            )}
            <OndaDaTranscricao capturando={fase === 'recording'} />
          </div>
        </ParteDaReuniao>
      </div>
    </div>
  );
}

// ---------- a onda, no pé da transcrição ----------

/**
 * O fundo vivo da transcrição.
 *
 * `captando` só enquanto a captura corre de verdade — uma onda subindo com a
 * reunião pausada seria a animação contando uma história que não está
 * acontecendo. E ela NÃO mede áudio: a extensão nunca ouviu microfone nenhum, e
 * o que a faz reagir é a chegada de um trecho novo (ver `MarcaDaEscuta.tsx`).
 */
function OndaDaTranscricao({ capturando }: { capturando: boolean }) {
  const { animando, movimentoReduzido } = useAnimacao(false);
  return (
    <WaveField
      estado={capturando && !movimentoReduzido ? 'captando' : 'repouso'}
      animando={animando}
      pulso={0}
      discreta
    />
  );
}

// ---------- a transcrição, com marcação e seleção ----------

function ListaDeFalas({
  meetingId,
  titulo,
  segmentos,
  selfName,
  onPerguntarSobre,
}: {
  meetingId: string;
  titulo: string;
  segmentos: readonly LiveSegment[];
  /** Quem é "eu" nesta reunião: a fala dessa pessoa é desenhada em verde. */
  selfName: string | null;
  onPerguntarSobre: (contexto: ContextoDaPergunta) => void;
}) {
  const [marcas, setMarcas] = useState<MarcasDaReuniao>({});
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const listaRef = useRef<HTMLDivElement | null>(null);
  const noFim = useRef(true);

  useEffect(() => {
    void lerMarcas(meetingId).then(setMarcas);
    return observarMarcas((mapa) => setMarcas(mapa[meetingId] ?? {}));
  }, [meetingId]);

  /*
   * Acompanha o fim só se já estava no fim: ler uma fala de trás enquanto a
   * reunião corre não pode ser interrompido pela próxima linha.
   *
   * E acompanha mexendo no `scrollTop` DESTA lista, não com `scrollIntoView`.
   * `scrollIntoView` rola todos os ancestrais roláveis até o elemento aparecer
   * — e o ancestral aqui é a coluna inteira da reunião. O efeito era a fileira
   * de ações e o título subirem para fora da tela sozinhos, a cada fala nova,
   * poucos segundos depois de a reunião começar. Ancorar as ações no topo é
   * metade do motivo de elas terem vindo para cá.
   */
  useEffect(() => {
    const lista = listaRef.current;
    if (lista && noFim.current) lista.scrollTop = lista.scrollHeight;
  }, [segmentos.length]);

  const aoRolar = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 64;
  }, []);

  return (
    <div className="tq-falas" ref={listaRef} onScroll={aoRolar}>
      {segmentos.map((s) => {
        const marca = marcas[s.captionId];
        const aberto = selecionado === s.captionId;
        /*
         * Quem falou. O "(Eu)" é o mesmo rótulo do histórico na HOME, e sai da
         * MESMA conta: "eu" é o participante marcado como anfitrião (ver
         * `hostName`). A comparação é a de `speakerLabel`, e não uma segunda
         * regra escrita aqui — duas contas de "sou eu" divergiriam na primeira
         * reunião em que o nome viesse com espaço a mais.
         */
        const nome = s.speaker ?? 'Alguém';
        const rotulo = speakerLabel(nome, selfName);
        const ehVoce = rotulo !== nome;
        return (
          <article
            key={s.captionId}
            className={`tq-fala${aberto ? ' selecionada' : ''}${marca ? ' marcada' : ''}${
              ehVoce ? ' minha' : ''
            }`}
          >
            <button
              type="button"
              className="tq-fala-corpo"
              aria-expanded={aberto}
              onClick={() => setSelecionado(aberto ? null : s.captionId)}
            >
              <span className="tq-fala-quem">
                {rotulo}
                <span className="tq-fala-hora">{formatOffset(s.startOffsetMs)}</span>
                {marca && (
                  <span
                    className="tq-fala-marca"
                    title={TIPOS_DE_MARCA.find((t) => t.id === marca)?.rotulo}
                  >
                    {TIPOS_DE_MARCA.find((t) => t.id === marca)?.simbolo}
                  </span>
                )}
              </span>
              <span className="tq-fala-texto">{s.text}</span>
            </button>

            {aberto && (
              <div className="tq-fala-acoes" role="group" aria-label="Ações deste trecho">
                {TIPOS_DE_MARCA.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={marca === t.id ? 'marca atual' : 'marca'}
                    title={marca === t.id ? `Remover ${t.rotulo}` : t.rotulo}
                    aria-label={marca === t.id ? `Remover ${t.rotulo}` : t.rotulo}
                    aria-pressed={marca === t.id}
                    onClick={() =>
                      void marcarTrecho(
                        meetingId,
                        s.captionId,
                        marca === t.id ? null : t.id,
                      )
                    }
                  >
                    <span aria-hidden="true">{t.simbolo}</span>
                  </button>
                ))}
                <button
                  type="button"
                  className="tq-linkish"
                  onClick={() => {
                    onPerguntarSobre({
                      meetingId,
                      meetingTitle: titulo,
                      excerpt: s.text,
                      captionId: s.captionId,
                    });
                    setSelecionado(null);
                  }}
                >
                  Perguntar à IA
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

// ---------- o aviso no chat do Meet ----------

/**
 * O atalho de 60 segundos.
 *
 * A janela é uma conta sobre `session.startedAt`, e não um cronômetro: reabrir
 * a sidebar não pode devolver o minuto. Quando ela vence, o bloco sai com uma
 * transição de altura em vez de desaparecer — o requisito pede que a interface
 * não salte, e um `display: none` súbito puxaria a transcrição para cima.
 */
function AvisoNoChat({
  meetingId,
  inicio,
  capturando,
}: {
  meetingId: string;
  inicio: number;
  capturando: boolean;
}) {
  const platform = usePlatform();
  const [avisos, setAvisos] = useState<Record<string, AvisoEnviado>>({});
  const [agora, setAgora] = useState(() => Date.now());
  const [enviando, setEnviando] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [saindo, setSaindo] = useState(false);

  useEffect(() => observarAvisos(setAvisos), []);

  // Um tique por segundo enquanto a janela pode estar aberta, e nem um depois.
  useEffect(() => {
    if (Date.now() - inicio > JANELA_MS) return;
    const t = setInterval(() => {
      const agora = Date.now();
      setAgora(agora);
      // A janela venceu: o último tique já pintou a saída, e o relógio para.
      if (agora - inicio > JANELA_MS) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [inicio]);

  const estado = estadoDoAviso({
    capturando,
    inicioDaReuniao: inicio,
    jaEnviado: Boolean(avisos[meetingId]),
    agora,
  });

  // A saída suave: quando a janela vence, o bloco ainda é renderizado por um
  // instante com a classe que o encolhe.
  const estavaOferecendo = useRef(false);
  useEffect(() => {
    if (estado === 'oferecer') estavaOferecendo.current = true;
    else if (estavaOferecendo.current && estado === 'fora') {
      estavaOferecendo.current = false;
      setSaindo(true);
      const t = setTimeout(() => setSaindo(false), 420);
      return () => clearTimeout(t);
    }
  }, [estado]);

  const enviar = async () => {
    setEnviando(true);
    setFalhou(false);
    try {
      const r = await platform.send<{ ok?: boolean }>({
        type: 'ui/chatNotice',
        text: TEXTO_DO_AVISO,
      });
      if (r?.ok === true) {
        // Só AQUI o envio vira registro. Um `false` não pode virar confirmação.
        await registrarAvisoEnviado(meetingId);
      } else {
        setFalhou(true);
      }
    } catch {
      setFalhou(true);
    } finally {
      setEnviando(false);
    }
  };

  if (estado === 'inativo') return null;
  if (estado === 'fora' && !saindo) return null;

  if (estado === 'enviado') {
    return (
      <p className="tq-aviso-ok" role="status">
        <Icon name="check" size={13} /> Avisado no chat da reunião.
      </p>
    );
  }

  return (
    <div className={`tq-aviso-chat${saindo ? ' saindo' : ''}`}>
      <p className="tq-aviso-chat-texto">
        Avisar no chat da reunião que você está transcrevendo?
      </p>
      <p className="tq-fino">
        Esta mensagem vai para o <strong>chat do Meet</strong>, visível a todos os
        participantes: &ldquo;{TEXTO_DO_AVISO}&rdquo;
      </p>
      <div className="tq-acoes-linha">
        <button
          type="button"
          className="tq-botao-principal"
          onClick={() => void enviar()}
          disabled={enviando || saindo}
        >
          {enviando ? 'Enviando…' : 'Enviar ao chat'}
        </button>
        {!saindo && (
          <span className="tq-fino tq-contagem">{segundosRestantes(inicio, agora)}s</span>
        )}
      </div>
      {falhou && (
        <p className="tq-aviso-falha" role="status">
          Não consegui escrever no chat do Meet.{' '}
          <button
            type="button"
            className="tq-linkish"
            onClick={() => {
              void navigator.clipboard
                .writeText(TEXTO_DO_AVISO)
                .then(() => setCopiado(true))
                .catch(() => setCopiado(false));
            }}
          >
            {copiado ? 'Copiado' : 'Copiar o texto'}
          </button>
        </p>
      )}
    </div>
  );
}

// ---------- prints ----------

/**
 * O print da aba da reunião.
 *
 * A captura é sempre por clique, e o background confere que a aba da reunião é
 * a que está à vista antes de capturar — `captureVisibleTab` pega a aba ATIVA,
 * não a que se pede, e sem essa conferência um print do e-mail de alguém seria
 * guardado como "print da reunião". Ver src/background/captura.ts.
 *
 * O print é GUARDADO no instante da captura, e a prévia mostra o que foi
 * guardado, com "Descartar" para desfazer. Antes a prévia vivia só na memória
 * do painel até o "Salvar": ir à aba do TaqCiti, recolher a seção ou o painel
 * recarregar jogava o print fora, e a pessoa só descobria depois. Nada vai
 * para a IA.
 */
function Prints({
  meetingId,
  prints,
  viva,
}: {
  meetingId: string;
  prints: Print[];
  /** Só se captura enquanto a reunião está viva; depois, só se vê. */
  viva: boolean;
}) {
  const platform = usePlatform();
  /** O print que acabou de ser tirado, em destaque até ser visto. */
  const [recenteId, setRecenteId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const recente = prints.find((p) => p.id === recenteId) ?? null;

  const tirar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      const r = await platform.send<
        | { ok: true; dataUrl: string; meetingId?: string | null }
        | { ok: false; motivo: MotivoDeFalha }
      >({ type: 'ui/print' });
      if (!r || !r.ok) {
        setErro(r ? EXPLICACAO[r.motivo] : 'Não foi possível capturar a tela.');
        return;
      }
      try {
        // A reunião que o BACKGROUND capturou: se a sessão trocou no meio da
        // captura, o print vai para a reunião em que foi tirado.
        const guardado = await guardarPrint(r.meetingId ?? meetingId, r.dataUrl, 0, 0);
        setRecenteId(guardado.id);
      } catch {
        setErro('Não coube no armazenamento local. Apague algum print e tente de novo.');
      }
    } catch {
      setErro('Não foi possível capturar a tela.');
    } finally {
      setOcupado(false);
    }
  };

  const descartar = async () => {
    if (!recente) return;
    setRecenteId(null);
    await apagarPrint(recente.id);
  };

  return (
    <section className="tq-prints" aria-label="Prints da reunião">
      <div className="tq-acoes-linha">
        <button
          type="button"
          className="tq-botao-fantasma"
          onClick={() => void tirar()}
          // Depois do fim, a aba mostra a tela "você saiu da chamada": um
          // print dela não é um print da reunião.
          disabled={ocupado || !viva}
          title={viva ? undefined : 'A reunião já terminou — não há mais o que capturar.'}
        >
          <Icon name="image" size={14} />
          {ocupado ? 'Capturando…' : 'Capturar a aba da reunião'}
        </button>
        {prints.length > 0 && (
          <span className="tq-fino">
            {prints.length} {prints.length === 1 ? 'print' : 'prints'}
          </span>
        )}
      </div>

      {viva && prints.length >= MAX_POR_REUNIAO && (
        <p className="tq-fino" role="status">
          Limite de {MAX_POR_REUNIAO} prints por reunião: o próximo substitui o mais antigo.
        </p>
      )}

      {erro && (
        <p className="tq-aviso-falha" role="status">
          {erro}
        </p>
      )}

      {recente && (
        <div className="tq-previa">
          <img src={recente.dataUrl} alt="Print que acabou de ser guardado" />
          <div className="tq-acoes-linha">
            <span className="tq-fino" role="status">
              Guardado com a reunião
            </span>
            <button
              type="button"
              className="tq-botao-principal"
              onClick={() => setRecenteId(null)}
            >
              Ok
            </button>
            <button
              type="button"
              className="tq-botao-fantasma"
              onClick={() => void descartar()}
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {prints.length > 0 && (
        <ul className="tq-print-tiras">
          {prints.filter((p) => p.id !== recenteId).map((p) => (
            <li key={p.id}>
              <img
                src={p.dataUrl}
                alt={`Print de ${new Date(p.at).toLocaleTimeString('pt-BR')}`}
              />
              <button
                type="button"
                title="Apagar este print"
                aria-label="Apagar este print"
                onClick={() => void apagarPrint(p.id)}
              >
                <Icon name="close" size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
