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
import { buildMeetingRecord } from '@/features/meeting/payload';
import { downloadTranscript } from '@/features/history/export';
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
  observarPrints,
  type Print,
} from '@/features/annotations/shots';
import { EXPLICACAO, type MotivoDeFalha } from '@/background/captura';
import type { ContextoDaPergunta } from '@/home/conversations';
import { Icon } from '@/shared/ui/Icon';
import { formatElapsedClock, formatOffset } from '@/shared/ui/format';
import { AcoesDaReuniao } from './AcoesDaReuniao';
import { EditorDeNota } from './Notas';

interface Props {
  state: MeetingState;
  notaExiste: boolean;
  rascunhoNota: string;
  estadoDaNota: EstadoDaGravacao;
  onEscreverNota: (meetingId: string, texto: string) => void;
  onPerguntarSobre: (contexto: ContextoDaPergunta) => void;
  onAbrirHome: (recordId?: string) => void;
}

export function Reuniao({
  state,
  notaExiste,
  rascunhoNota,
  estadoDaNota,
  onEscreverNota,
  onPerguntarSobre,
  onAbrirHome,
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

  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (fase !== 'recording') return;
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
          Ligando as legendas do Meet e escondendo-as da tela. A captura começa
          assim que elas aparecerem.
        </p>
      </div>
    );
  }

  const registro = buildMeetingRecord(sessao, fase === 'ended' ? 'ready' : 'recording');
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
          {fase === 'ended'
            ? 'Transcrição salva'
            : interrompida
              ? 'Captura interrompida'
              : fase === 'recording'
                ? 'Transcrevendo'
                : 'Pausado'}{' '}
          · {duracao} · {sessao.segments.length}{' '}
          {sessao.segments.length === 1 ? 'fala' : 'falas'}
          {notaExiste && ' · com nota'}
        </p>
      </div>

      <AcoesDaReuniao
        viva={viva}
        pausada={fase === 'paused'}
        notaAberta={notaAberta}
        notaExiste={notaExiste}
        printAberto={printAberto}
        quantosPrints={prints.length}
        onNota={() => setNotaAberta((v) => !v)}
        onPrint={() => setPrintAberto((v) => !v)}
        onPausar={() =>
          void platform.send({ type: fase === 'paused' ? 'ui/resume' : 'ui/pause' })
        }
        onPerguntar={perguntarSobreAReuniao}
        onFinalizar={() => void platform.send({ type: 'ui/finish' })}
      />

      {notaAberta && (
        <EditorDeNota
          meetingId={sessao.meetingId}
          texto={rascunhoNota}
          estado={estadoDaNota}
          onEscrever={onEscreverNota}
          onRecolher={() => setNotaAberta(false)}
        />
      )}

      {printAberto && <Prints meetingId={sessao.meetingId} prints={prints} />}

      {fase === 'paused' && (
        <p className="tq-aviso-caixa">
          Captura pausada. O que já foi transcrito continua guardado; nada novo
          entra até você retomar.
        </p>
      )}

      {/*
       * A interrupção tem aviso próprio, e não um "transcrevendo" mais
       * pálido: há legenda na tela que a captura não consegue ler, e
       * continuar comunicando captura normal seria mentir com a interface.
       */}
      {interrompida && (
        <p className="tq-aviso-caixa tq-aviso-atencao" role="status">
          A captura parou de ler as legendas do Meet. O TaqCiti está tentando
          religar sozinho — o que já foi transcrito continua guardado.
        </p>
      )}

      {fase === 'ended' && (
        <div className="tq-acoes-linha">
          <button
            type="button"
            className="tq-botao-principal"
            onClick={() => onAbrirHome(registro.id)}
          >
            Abrir no TaqCiti
          </button>
          <button
            type="button"
            className="tq-botao-fantasma"
            onClick={() => downloadTranscript(registro)}
            disabled={sessao.segments.length === 0}
          >
            Baixar .txt
          </button>
        </div>
      )}

      {viva && (
        <AvisoNoChat
          meetingId={sessao.meetingId}
          inicio={sessao.startedAt}
          capturando={fase === 'recording'}
        />
      )}

      {sessao.segments.length === 0 ? (
        <p className="tq-fino tq-centrado">
          {fase === 'ended'
            ? 'Nenhuma fala foi capturada nesta reunião — as legendas do Meet não chegaram a produzir texto.'
            : 'Capturando. As falas aparecem aqui conforme as legendas chegam.'}
        </p>
      ) : (
        <ListaDeFalas
          meetingId={sessao.meetingId}
          titulo={sessao.title}
          segmentos={sessao.segments}
          onPerguntarSobre={onPerguntarSobre}
        />
      )}
    </div>
  );
}

// ---------- a transcrição, com marcação e seleção ----------

function ListaDeFalas({
  meetingId,
  titulo,
  segmentos,
  onPerguntarSobre,
}: {
  meetingId: string;
  titulo: string;
  segmentos: readonly LiveSegment[];
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
        return (
          <article
            key={s.captionId}
            className={`tq-fala${aberto ? ' selecionada' : ''}${marca ? ' marcada' : ''}`}
          >
            <button
              type="button"
              className="tq-fala-corpo"
              aria-expanded={aberto}
              onClick={() => setSelecionado(aberto ? null : s.captionId)}
            >
              <span className="tq-fala-quem">
                {s.speaker ?? 'Alguém'}
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
                      void marcarTrecho(meetingId, s.captionId, marca === t.id ? null : t.id)
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
    const t = setInterval(() => setAgora(Date.now()), 1000);
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
          <span className="tq-fino tq-contagem">
            {segundosRestantes(inicio, agora)}s
          </span>
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
 * A prévia existe porque salvar sem mostrar seria a pessoa descobrir o que
 * capturou depois. Nada é guardado antes do "Salvar", e nada vai para a IA.
 */
function Prints({ meetingId, prints }: { meetingId: string; prints: Print[] }) {
  const platform = usePlatform();
  const [previa, setPrevia] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const tirar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      const r = await platform.send<
        { ok: true; dataUrl: string } | { ok: false; motivo: MotivoDeFalha }
      >({ type: 'ui/print' });
      if (r && r.ok) setPrevia(r.dataUrl);
      else setErro(r ? EXPLICACAO[r.motivo] : 'Não foi possível capturar a tela.');
    } catch {
      setErro('Não foi possível capturar a tela.');
    } finally {
      setOcupado(false);
    }
  };

  const salvar = async () => {
    if (!previa) return;
    try {
      await guardarPrint(meetingId, previa, 0, 0);
      setPrevia(null);
    } catch {
      setErro('Não coube no armazenamento local. Apague algum print e tente de novo.');
    }
  };

  return (
    <section className="tq-prints" aria-label="Prints da reunião">
      <div className="tq-acoes-linha">
        <button
          type="button"
          className="tq-botao-fantasma"
          onClick={() => void tirar()}
          disabled={ocupado}
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

      {erro && (
        <p className="tq-aviso-falha" role="status">
          {erro}
        </p>
      )}

      {previa && (
        <div className="tq-previa">
          <img src={previa} alt="Prévia do print da reunião" />
          <div className="tq-acoes-linha">
            <button type="button" className="tq-botao-principal" onClick={() => void salvar()}>
              Salvar
            </button>
            <button
              type="button"
              className="tq-botao-fantasma"
              onClick={() => setPrevia(null)}
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {prints.length > 0 && (
        <ul className="tq-print-tiras">
          {prints.map((p) => (
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
