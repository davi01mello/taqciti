/**
 * A tela da reunião em andamento: as ações, a pergunta rápida, as abas
 * (transcrição, notas, prints) e o aviso no chat.
 *
 * ── O que NUNCA acontece aqui ────────────────────────────────────────────
 *
 * Nada nesta tela modifica o texto capturado. A marcação é metadado guardado à
 * parte (ver features/annotations/marks.ts), a nota é outro registro, o print é
 * outro ainda, e a pergunta à IA vai para uma conversa. A transcrição é o que
 * foi dito; tudo o mais é o que a pessoa acrescentou em volta.
 *
 * ── A ordem da tela ──────────────────────────────────────────────────────
 *
 * Ações primeiro, transcrição depois: a transcrição rola sozinha e cresce sem
 * parar; qualquer controle depois dela é um controle que foge da tela em três
 * minutos de reunião. As ações ficam ancoradas no topo, e só a lista rola.
 *
 * ── A fala chegando (direção "Espectro") ─────────────────────────────────
 *
 * Uma fala nova acende três coisas de uma vez: a faísca no glifo da escuta (o
 * seletor "Reunião"), um pulso que atravessa a onda do painel, e a LEGENDA —
 * a fala em letra grande, logo acima da onda, que depois voa e pousa no lugar
 * dela na transcrição. É o momento em que a voz vira escrita, visível.
 *
 * Com movimento reduzido, com outra aba aberta ou com a seção fora de vista, a
 * fala entra direto na lista: a legenda é um gesto de quem está olhando.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LiveSegment, MeetingState } from '@/shared/types/domain';
import { usePlatform } from '@/shared/platform/context';
import type { EstadoDaGravacao } from '@/features/annotations/notes';
import type { EstadoDoAgente } from '@/features/agent/atividade';
import { anunciarEscrita } from '@/features/agent/escuta';
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
import { derivarEstadoDaCaptura } from '@/shared/ui/estadoDaCaptura';
import type { EstadoDaCaptura } from '@/shared/ui/MarcaDaEscuta';
import { MarcaDoTaq } from '@/shared/ui/MarcaDoTaq';
import { Markdown } from '@/shared/ui/Markdown';
import {
  formatElapsedClock,
  formatOffset,
  formatSpeechDuration,
  hostName,
  speakerLabel,
} from '@/shared/ui/format';
import { papelDoFalante } from '@/features/integracoes/colegas';
import { BotaoCopiar } from '@/shared/ui/BotaoCopiar';
import { useColegasDoCiti } from '@/shared/ui/useColegasDoCiti';
import { useAvisosDaReuniao } from '@/features/avisos/useAvisosDaReuniao';
import { useApoioAoVivo } from '@/features/apoio/useApoio';
import { souOrganizador, useAvisosVisiveis } from '@/features/avisos/useAvisos';
import { AcoesDaReuniao, FinalizarReuniao } from './AcoesDaReuniao';
import { CartaoDeApoio } from './CartaoDeApoio';
import { EstadoDosPontos } from './EstadoDosPontos';
import { useEstadoDosPontos } from '@/features/estado/useEstado';
import { registrarPontoComoAcompanhamento, registrarPontoComoDecisao } from '@/features/estado/registrar';
import { SugestoesDoOrganizador } from './SugestoesDoOrganizador';
import { EditorDeNota } from './Notas';
import { AbasDaReuniao, ParteDaReuniao, type AbaDaReuniao } from './AbasDaReuniao';

/** O que a pergunta rápida devolve à tela. */
export interface RespostaRapida {
  /** A conversa em que pergunta (e resposta) ficaram. `null` se nem gravou. */
  conversaId: string | null;
  resposta: string | null;
  /** Por que não houve resposta, numa frase. */
  aviso: string | null;
}

interface Props {
  state: MeetingState;
  /** A seção está à vista (seletor "Reunião", fora do histórico). */
  visivel?: boolean;
  notaExiste: boolean;
  rascunhoNota: string;
  estadoDaNota: EstadoDaGravacao;
  onEscreverNota: (meetingId: string, texto: string) => void;
  onPerguntarSobre: (contexto: ContextoDaPergunta) => void;
  taqPronto?: boolean;
  /** O agente, quando é a pergunta rápida que ele está respondendo. */
  agente?: EstadoDoAgente | null;
  onPerguntarRapido?: (texto: string, ctx: ContextoDaPergunta) => Promise<RespostaRapida>;
  onCancelarRapida?: () => void;
  onContinuarNaConversa?: (conversaId: string) => void;
}

const movimentoReduzido = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** O que a linha de estado da reunião diz, por estado da captura. */
const ROTULO_NA_REUNIAO: Partial<Record<EstadoDaCaptura, string>> = {
  iniciando: 'Iniciando a captura',
  capturando: 'Transcrevendo',
  aguardando_fonte: 'Aguardando legendas',
  interrompida: 'Captura interrompida',
  erro: 'Erro na captura',
  pausada: 'Pausada',
};

export function Reuniao({
  state,
  visivel = true,
  notaExiste,
  rascunhoNota,
  estadoDaNota,
  onEscreverNota,
  onPerguntarSobre,
  taqPronto = false,
  agente = null,
  onPerguntarRapido,
  onCancelarRapida = () => {},
  onContinuarNaConversa = () => {},
}: Props) {
  const platform = usePlatform();
  const sessao = state.session;
  const fase = state.phase;

  /*
   * A aba escolhida é estado desta tela, e sobrevive a trocar de seletor
   * porque a seção inteira continua montada (ver `Painel` em App.tsx). O TEXTO
   * da nota não mora aqui de propósito — ver o cabeçalho de Notas.tsx.
   */
  const [aba, setAba] = useState<AbaDaReuniao>('transcricao');
  const [rapidaAberta, setRapidaAberta] = useState(false);
  const [avisosAberto, setAvisosAberto] = useState(false);
  const [prints, setPrints] = useState<Print[]>([]);

  const meetingId = sessao?.meetingId ?? null;

  // Avisos do acompanhamento e da captura: só gravam.
  useAvisosDaReuniao(state);
  // Apoio à condução: sugestões privadas, no máximo uma por vez, só com perfil e assistente.
  const apoio = useApoioAoVivo(state, taqPronto);
  // O que falta fechar, ponto a ponto: lido pelo Taq a pedido, conferido em código.
  const estadoDosPontos = useEstadoDosPontos(state, taqPronto);
  const [estadoAberto, setEstadoAberto] = useState(false);
  const [fechamentoAberto, setFechamentoAberto] = useState(false);
  const organizador = souOrganizador(sessao?.participants);
  const avisos = useAvisosVisiveis({
    ...(meetingId ? { reuniaoId: meetingId } : {}),
    souOrganizador: organizador,
  });
  useEffect(() => {
    if (meetingId === null) return;
    return observarPrints((todos) =>
      setPrints(todos.filter((p) => p.meetingId === meetingId).sort((a, b) => b.at - a.at)),
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

  const print = usePrint(meetingId);

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
        {/* Se o religar sozinho não der conta (uma sala de grupo, uma troca de
            sala), a pessoa manda tentar de novo daqui — sem sair da tela. */}
        <button
          type="button"
          className="tq-acao tq-pilula"
          onClick={() => void platform.send({ type: 'ui/gravarAgora' })}
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  const duracao = formatElapsedClock((sessao.endedAt ?? agora) - sessao.startedAt);
  const viva = fase === 'recording' || fase === 'paused';
  const estadoCaptura = derivarEstadoDaCaptura({ phase: fase, session: sessao }, agora);
  const interrompida = estadoCaptura === 'interrompida' || estadoCaptura === 'erro';
  const quando = (p: Print) => formatOffset(p.at - sessao.startedAt);

  return (
    <div className="tq-rolavel tq-ao-vivo">
      {/*
       * O título e, embaixo, o estado com o relógio. O relógio é o único
       * número que muda sozinho na tela, e é o que se procura ao olhar para o
       * painel no meio da reunião ("quanto tempo já foi?") — por isso ele tem
       * peso próprio, e o resto da linha é cinza.
       */}
      <div className="tq-reuniao-topo">
        <h2>{sessao.title}</h2>
        <p className="tq-reuniao-meta">
          <span
            className={`tq-captura-estado${
              estadoCaptura === 'capturando' || estadoCaptura === 'iniciando' ? ' vivo' : ' atencao'
            }`}
          >
            {ROTULO_NA_REUNIAO[estadoCaptura] ?? 'Transcrevendo'}
          </span>
          <span className="tq-relogio">{duracao}</span>
          <span>
            {sessao.segments.length} {sessao.segments.length === 1 ? 'fala' : 'falas'}
          </span>
        </p>
      </div>

      <AcoesDaReuniao
        viva={viva}
        pausada={fase === 'paused'}
        capturando={print.ocupado}
        quantosPrints={prints.length}
        rapidaAberta={rapidaAberta}
        avisosNovos={avisos.novos}
        avisosAberto={avisosAberto}
        onPrint={() => void print.tirar()}
        onPausar={() =>
          void platform.send({ type: fase === 'paused' ? 'ui/resume' : 'ui/pause' })
        }
        onRapida={() => {
          setAvisosAberto(false);
          setRapidaAberta((v) => !v);
        }}
        onAvisos={() => {
          setRapidaAberta(false);
          setAvisosAberto((v) => !v);
        }}
      />

      <CartaoDeApoio meetingId={sessao.meetingId} apoio={apoio} />

      <EstadoDosPontos
        meetingId={sessao.meetingId}
        estado={estadoDosPontos}
        aberto={estadoAberto}
        onAlternar={() => setEstadoAberto((v) => !v)}
        taqPronto={taqPronto}
        falasAgora={sessao.segments.length}
        fechamentoAberto={fechamentoAberto}
        onAlternarFechamento={() => setFechamentoAberto((v) => !v)}
        onRegistrar={(ponto) =>
          registrarPontoComoAcompanhamento({
            reuniao: { id: sessao.meetingId, titulo: sessao.title },
            ponto,
            versao: `${sessao.endedAt ?? sessao.startedAt}:${sessao.segments.length}`,
          })
        }
        onRegistrarDecisao={(ponto) =>
          registrarPontoComoDecisao({
            reuniao: { id: sessao.meetingId, titulo: sessao.title },
            ponto,
            versao: `${sessao.endedAt ?? sessao.startedAt}:${sessao.segments.length}`,
          })
        }
      />

      {avisosAberto && (
        <SugestoesDoOrganizador
          visiveis={avisos.visiveis}
          historico={avisos.historico}
          participantes={sessao.participants.map((p) => p.name)}
          souOrganizador={organizador}
          onFechar={() => setAvisosAberto(false)}
          onAbrir={(a) => {
            if (a.acao?.tipo === 'abrir_conversa') {
              setAvisosAberto(false);
              onContinuarNaConversa(a.acao.alvoId);
            } else if (a.acao?.tipo === 'abrir_documento') {
              void platform.send({ type: 'ui/openHome', documentId: a.acao.alvoId });
            } else {
              // Reunião e acompanhamento abrem a HOME na reunião de origem.
              const recordId =
                a.acao?.tipo === 'abrir_reuniao' ? a.acao.alvoId : a.reuniaoId;
              void platform.send({ type: 'ui/openHome', ...(recordId ? { recordId } : {}) });
            }
          }}
        />
      )}

      {print.recente && (
        <p className="tq-aviso-print" role="status">
          <span>Print guardado com a reunião.</span>
          <button
            type="button"
            onClick={() => {
              print.esquecer();
              setAba('prints');
            }}
          >
            Ver
          </button>
          <button type="button" onClick={() => void print.desfazer()}>
            Desfazer
          </button>
        </p>
      )}
      {print.erro && (
        <p className="tq-aviso-falha" role="status">
          {print.erro}
        </p>
      )}

      {rapidaAberta && (
        <PerguntaRapida
          meetingId={sessao.meetingId}
          titulo={sessao.title}
          taqPronto={taqPronto}
          agente={agente}
          onPerguntar={onPerguntarRapido}
          onCancelar={onCancelarRapida}
          onContinuar={(id) => {
            setRapidaAberta(false);
            onContinuarNaConversa(id);
          }}
          onFechar={() => setRapidaAberta(false)}
          onVerEstado={() => {
            setRapidaAberta(false);
            setEstadoAberto(true);
            void estadoDosPontos.atualizar();
          }}
          onVerFechamento={() => {
            setRapidaAberta(false);
            setEstadoAberto(true);
            setFechamentoAberto(true);
            void estadoDosPontos.atualizar();
          }}
        />
      )}

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
          sozinho — o que já foi transcrito continua guardado.{' '}
          <button
            type="button"
            className="tq-acao tq-pilula"
            onClick={() => void platform.send({ type: 'ui/gravarAgora' })}
          >
            Religar agora
          </button>
        </p>
      )}

      {viva && (
        <AvisoNoChat
          meetingId={sessao.meetingId}
          inicio={sessao.startedAt}
          capturando={fase === 'recording'}
        />
      )}

      {/* As abas e, na ponta, o fim da reunião: longe do Print e da Pausa, que
          são os botões que se aperta sem pensar. */}
      <div className="tq-reuniao-faixa">
        <AbasDaReuniao
          aba={aba}
          onAba={setAba}
          notaExiste={notaExiste}
          quantosPrints={prints.length}
        />
        {viva && (
          <FinalizarReuniao onFinalizar={() => void platform.send({ type: 'ui/finish' })} />
        )}
      </div>
      <div className="tq-reuniao-alternada">
        <ParteDaReuniao ativa={aba === 'notas'}>
          <EditorDeNota
            ativa={aba === 'notas'}
            meetingId={sessao.meetingId}
            texto={rascunhoNota}
            estado={estadoDaNota}
            onEscrever={onEscreverNota}
          />
        </ParteDaReuniao>
        <ParteDaReuniao ativa={aba === 'prints'}>
          <PrintsDaReuniao
            prints={prints}
            recenteId={print.recente?.id ?? null}
            quando={quando}
            viva={viva}
          />
        </ParteDaReuniao>
        <ParteDaReuniao ativa={aba === 'transcricao'}>
          {sessao.segments.length === 0 ? (
            <p className="tq-fino tq-centrado tq-falas-vazio">
              {fase === 'paused'
                ? 'Captura pausada. As falas voltam a aparecer aqui quando você retomar.'
                : interrompida
                  ? 'A captura não está conseguindo ler as legendas. O TaqCiti está tentando religar.'
                  : 'Capturando. As falas aparecem aqui conforme as legendas chegam.'}
            </p>
          ) : (
            <TranscricaoAoVivo
              meetingId={sessao.meetingId}
              titulo={sessao.title}
              segmentos={sessao.segments}
              selfName={hostName(sessao.participants)}
              legendaLigada={visivel && aba === 'transcricao' && fase === 'recording'}
              onPerguntarSobre={onPerguntarSobre}
            />
          )}
        </ParteDaReuniao>
      </div>
      <div className="tq-clarao" ref={print.clarao} aria-hidden="true" />
    </div>
  );
}

// ---------- o print ----------

/**
 * O print da aba da reunião, num clique.
 *
 * A captura é sempre por gesto, e o background confere que a aba da reunião é
 * a que está à vista antes de capturar — `captureVisibleTab` pega a aba ATIVA,
 * não a que se pede, e sem essa conferência um print do e-mail de alguém seria
 * guardado como "print da reunião". Ver src/background/captura.ts.
 *
 * O print é GUARDADO no instante da captura; o aviso embaixo das ações tem
 * "Desfazer" por alguns segundos. Nada vai para a IA.
 */
function usePrint(meetingId: string | null) {
  const platform = usePlatform();
  const [recente, setRecente] = useState<Print | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const clarao = useRef<HTMLDivElement | null>(null);

  // O aviso some sozinho: é confirmação, não tarefa.
  useEffect(() => {
    if (!recente) return;
    const t = setTimeout(() => setRecente(null), 3600);
    return () => clearTimeout(t);
  }, [recente]);
  useEffect(() => {
    if (!erro) return;
    const t = setTimeout(() => setErro(null), 6000);
    return () => clearTimeout(t);
  }, [erro]);

  const tirar = useCallback(async () => {
    if (meetingId === null) return;
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
        setRecente(guardado);
        // O clarão de câmera: rápido, sobre a coluna. Só com movimento.
        if (!movimentoReduzido()) {
          clarao.current?.animate?.([{ opacity: 0.5 }, { opacity: 0 }], {
            duration: 320,
            easing: 'ease-out',
          });
        }
      } catch {
        setErro('Não coube no armazenamento local. Apague algum print e tente de novo.');
      }
    } catch {
      setErro('Não foi possível capturar a tela.');
    } finally {
      setOcupado(false);
    }
  }, [meetingId, platform]);

  const desfazer = useCallback(async () => {
    if (!recente) return;
    setRecente(null);
    try {
      await apagarPrint(recente.id);
    } catch {
      // O print continua guardado: dizer que foi desfeito seria falso.
      setErro('Não foi possível desfazer o print. Ele continua guardado: apague-o na aba Prints.');
    }
  }, [recente]);

  return { tirar, desfazer, esquecer: () => setRecente(null), recente, erro, ocupado, clarao };
}

/** Os prints guardados: grade de duas colunas e, ao abrir um, o visor. */
function PrintsDaReuniao({
  prints,
  recenteId,
  quando,
  viva,
}: {
  prints: Print[];
  recenteId: string | null;
  quando: (p: Print) => string;
  viva: boolean;
}) {
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [erroAoApagar, setErroAoApagar] = useState<string | null>(null);
  const aberto = prints.find((p) => p.id === abertoId) ?? null;
  const fechar = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (aberto) fechar.current?.focus();
  }, [aberto]);

  return (
    <section className="tq-prints" aria-label="Prints da reunião">
      {prints.length === 0 ? (
        <p className="tq-fino">
          Nenhum print ainda. Use Print durante a reunião para guardar o que está na tela.
        </p>
      ) : (
        <ul className="tq-prints-grade">
          {prints.map((p) => (
            <li key={p.id} className={p.id === recenteId ? 'novo' : undefined}>
              <button
                type="button"
                aria-label={`Abrir o print de ${quando(p)}`}
                onClick={() => setAbertoId(p.id)}
              >
                <img src={p.dataUrl} alt="" />
                <span className="tq-prints-hora">{quando(p)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {erroAoApagar && (
        <p className="tq-aviso-falha" role="alert">
          {erroAoApagar}
        </p>
      )}
      {viva && prints.length >= MAX_POR_REUNIAO && (
        <p className="tq-fino" role="status">
          Limite de {MAX_POR_REUNIAO} prints por reunião: o próximo substitui o mais antigo.
        </p>
      )}

      {/* O print aberto ocupa a coluna, sem sair dela. */}
      {aberto && (
        <div
          className="tq-print-visor"
          role="dialog"
          aria-label={`Print da reunião, ${quando(aberto)}`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setAbertoId(null);
          }}
        >
          <img src={aberto.dataUrl} alt={`Print da reunião, ${quando(aberto)}`} />
          <div className="tq-print-visor-barra">
            <span>Print de {quando(aberto)}</span>
            <button
              type="button"
              className="perigo"
              onClick={() => {
                setAbertoId(null);
                setErroAoApagar(null);
                // Falha de armazenamento não pode virar rejeição solta: o print continua lá.
                void apagarPrint(aberto.id).catch(() =>
                  setErroAoApagar('Não foi possível apagar o print. Ele continua guardado.'),
                );
              }}
            >
              Apagar
            </button>
            <button type="button" ref={fechar} onClick={() => setAbertoId(null)}>
              Fechar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- a pergunta rápida ----------

type FaseDaRapida = 'escrevendo' | 'procurando' | 'respondida';

/**
 * Perguntas prontas de condução. Só preenchem e enviam o pedido: quem responde é
 * o copiloto, com as fontes — não há regra de texto aqui. Cada uma é uma
 * pergunta comum da pessoa, que ela também poderia ter digitado.
 *
 * "O que falta fechar" e "Me ajude a fechar" NÃO são perguntas em prosa: abrem o
 * cartão com o estado de cada ponto (a esclarecer, discutido, a confirmar,
 * decidido, adiado) e a síntese de fechamento, com a fala citada e conferidos em
 * código. Em prosa livre o modelo listou como aberto o que o cliente já tinha
 * respondido.
 */
const ATALHOS_DA_CONDUCAO: ReadonlyArray<{ rotulo: string; pedido: string }> = [
  { rotulo: 'Sugerir acompanhamentos', pedido: 'Sugira os compromissos desta reunião para eu revisar.' },
];

/**
 * Pergunte sem sair da reunião. A resposta nasce ali mesmo, embaixo das ações.
 *
 * Quem responde aparece só como a marca viva — sem nome fora do chat: o nome
 * do assistente mora dentro da conversa. "Continuar na conversa" abre a
 * conversa em que a pergunta foi gravada, com a resposta já lá.
 */
function PerguntaRapida({
  meetingId,
  titulo,
  taqPronto,
  agente,
  onPerguntar,
  onCancelar,
  onContinuar,
  onFechar,
  onVerEstado,
  onVerFechamento,
}: {
  meetingId: string;
  titulo: string;
  taqPronto: boolean;
  agente: EstadoDoAgente | null;
  onPerguntar?: (texto: string, ctx: ContextoDaPergunta) => Promise<RespostaRapida>;
  onCancelar: () => void;
  onContinuar: (conversaId: string) => void;
  onFechar: () => void;
  /** Abre o cartão do estado dos pontos e o atualiza. */
  onVerEstado: () => void;
  /** Abre o cartão com a síntese de fechamento e o atualiza. */
  onVerFechamento: () => void;
}) {
  const [texto, setTexto] = useState('');
  const [fase, setFase] = useState<FaseDaRapida>('escrevendo');
  const [resultado, setResultado] = useState<RespostaRapida | null>(null);
  const campo = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const q = requestAnimationFrame(() => campo.current?.focus());
    return () => cancelAnimationFrame(q);
  }, []);

  const perguntar = async (dado?: string) => {
    const limpo = (dado ?? texto).trim();
    if (!limpo || fase === 'procurando' || !onPerguntar) return;
    setTexto(limpo);
    setFase('procurando');
    setResultado(null);
    const r = await onPerguntar(limpo, { meetingId, meetingTitle: titulo });
    setResultado(r);
    setFase('respondida');
  };

  const estadoDaMarca =
    fase === 'procurando'
      ? (agente?.atividade ?? 'preparando')
      : fase === 'respondida'
        ? resultado?.resposta
          ? 'concluido'
          : 'falhou'
        : 'repouso';

  return (
    <div
      className="tq-rapida"
      id="tq-rapida"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && fase !== 'procurando') onFechar();
      }}
    >
      <form
        className="tq-rapida-campo"
        onSubmit={(e) => {
          e.preventDefault();
          void perguntar();
        }}
      >
        <MarcaDoTaq
          estado={estadoDaMarca}
          tamanho={20}
          sinal={agente ? agente.parcial.length || (agente.etapa ?? '') : ''}
          ouve
        />
        <input
          ref={campo}
          type="text"
          value={texto}
          autoComplete="off"
          placeholder="O que você quer saber desta reunião?"
          aria-label="Pergunta rápida sobre esta reunião"
          disabled={fase === 'procurando'}
          onChange={(e) => {
            setTexto(e.target.value);
            anunciarEscrita();
          }}
        />
        <button type="submit" className="tq-so-leitor">
          Perguntar
        </button>
      </form>

      {taqPronto && fase === 'escrevendo' && (
        <div className="tq-rapida-pe tq-rapida-atalhos" role="group" aria-label="Perguntas prontas">
          <button type="button" onClick={onVerEstado}>
            O que falta fechar
          </button>
          <button type="button" onClick={onVerFechamento}>
            Me ajude a fechar
          </button>
          {ATALHOS_DA_CONDUCAO.map((a) => (
            <button key={a.rotulo} type="button" onClick={() => void perguntar(a.pedido)}>
              {a.rotulo}
            </button>
          ))}
        </div>
      )}

      {!taqPronto && fase === 'escrevendo' && (
        <p className="tq-rapida-nota">
          O assistente não está conectado: a pergunta fica guardada numa conversa, sem
          resposta.
        </p>
      )}

      {fase !== 'escrevendo' && (
        <div className="tq-rapida-resposta" aria-live="polite">
          {fase === 'procurando' ? (
            <>
              {agente?.parcial ? (
                <p className="tq-rapida-texto">{agente.parcial}</p>
              ) : (
                <span className="tq-rapida-procurando">
                  {agente?.etapa ? `${agente.etapa}…` : 'Procurando nesta reunião…'}
                </span>
              )}
            </>
          ) : resultado?.resposta ? (
            <div className="tq-rapida-texto">
              <Markdown texto={resultado.resposta.replace(/\s?\[r\d+\]/g, '')} />
            </div>
          ) : (
            <p className="tq-rapida-aviso">{resultado?.aviso}</p>
          )}
        </div>
      )}

      {fase === 'procurando' ? (
        <div className="tq-rapida-pe">
          <button type="button" onClick={onCancelar}>
            Cancelar
          </button>
        </div>
      ) : fase === 'respondida' ? (
        <div className="tq-rapida-pe">
          {resultado?.conversaId && (
            <button
              type="button"
              className="principal"
              onClick={() => onContinuar(resultado.conversaId!)}
            >
              Continuar na conversa
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setTexto('');
              setResultado(null);
              setFase('escrevendo');
              campo.current?.focus();
            }}
          >
            Outra pergunta
          </button>
          <button type="button" onClick={onFechar}>
            Fechar
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------- a transcrição ao vivo, com a legenda ----------

/** Quanto a legenda fica parada depois da última mudança de texto. */
const LEGENDA_PARADA_MS = 1900;
/** Fala que não para de crescer pousa assim mesmo depois disto. */
const LEGENDA_MAXIMA_MS = 6000;

function TranscricaoAoVivo({
  meetingId,
  titulo,
  segmentos,
  selfName,
  legendaLigada,
  onPerguntarSobre,
}: {
  meetingId: string;
  titulo: string;
  segmentos: readonly LiveSegment[];
  selfName: string | null;
  legendaLigada: boolean;
  onPerguntarSobre: (contexto: ContextoDaPergunta) => void;
}) {
  const listaRef = useRef<HTMLDivElement | null>(null);
  const textoDaLegenda = useRef<HTMLSpanElement | null>(null);
  const quemDaLegenda = useRef<HTMLSpanElement | null>(null);
  /** A fala que está na legenda, ainda escondida na lista. */
  const [legendaId, setLegendaId] = useState<string | null>(null);
  const inicioDaLegenda = useRef(0);
  const voando = useRef(false);

  // A contagem inicial é o que já estava na tela: não é fala nova.
  const contagemAntes = useRef(segmentos.length);
  useLayoutEffect(() => {
    const antes = contagemAntes.current;
    contagemAntes.current = segmentos.length;
    if (segmentos.length <= antes) return;
    const ultima = segmentos.at(-1);
    if (!ultima || !legendaLigada || movimentoReduzido()) {
      setLegendaId(null);
      return;
    }
    // Uma fala nova com outra ainda na legenda: a anterior entra direto.
    voando.current = false;
    inicioDaLegenda.current = Date.now();
    setLegendaId(ultima.captionId);
  }, [segmentos, legendaLigada]);

  // Saiu de vista: a legenda entra direto na lista.
  useEffect(() => {
    if (!legendaLigada) setLegendaId(null);
  }, [legendaLigada]);

  const legenda = legendaId ? (segmentos.find((s) => s.captionId === legendaId) ?? null) : null;
  // Quem foi apagado da sessão (correção da legenda do Meet) não fica preso.
  useEffect(() => {
    if (legendaId && !legenda) setLegendaId(null);
  }, [legendaId, legenda]);

  /*
   * O pouso: a legenda voa até o lugar da fala na lista, encolhendo para o
   * corpo de leitura, e a fala aparece embaixo dela. Espera o texto parar de
   * mudar — a legenda do Meet cresce enquanto a pessoa fala.
   */
  const textoAtual = legenda?.text ?? '';
  useEffect(() => {
    if (!legendaId) return;
    const decorrido = Date.now() - inicioDaLegenda.current;
    const espera = Math.max(0, Math.min(LEGENDA_PARADA_MS, LEGENDA_MAXIMA_MS - decorrido));
    const t = setTimeout(() => {
      const origem = textoDaLegenda.current;
      const destinoLi = listaRef.current?.querySelector<HTMLElement>(
        `[data-caption="${CSS.escape(legendaId)}"]`,
      );
      const destino = destinoLi?.querySelector<HTMLElement>('.tq-fala-texto');
      if (!origem || !destinoLi || !destino || typeof origem.animate !== 'function') {
        setLegendaId(null);
        return;
      }
      voando.current = true;
      const a = origem.getBoundingClientRect();
      const b = destino.getBoundingClientRect();
      const escala = parseFloat(getComputedStyle(destino).fontSize) /
        parseFloat(getComputedStyle(origem).fontSize);
      quemDaLegenda.current?.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 180,
        fill: 'forwards',
      });
      const voo = origem.animate(
        [
          { transform: 'none', opacity: 1 },
          {
            transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${escala})`,
            opacity: 1,
            offset: 0.78,
          },
          {
            transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${escala})`,
            opacity: 0,
          },
        ],
        { duration: 680, easing: 'cubic-bezier(.35,.7,.1,1)', fill: 'forwards' },
      );
      destinoLi.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 260,
        delay: 470,
        fill: 'forwards',
        easing: 'ease-out',
      });
      void voo.finished
        .catch(() => undefined)
        .then(() => {
          if (!voando.current) return;
          voando.current = false;
          setLegendaId((atual) => (atual === legendaId ? null : atual));
        });
    }, espera);
    return () => clearTimeout(t);
  }, [legendaId, textoAtual]);

  const nomesDosFalantes = useMemo(
    () => segmentos.map((s) => s.speaker ?? 'Alguém'),
    [segmentos],
  );
  const colegas = useColegasDoCiti(nomesDosFalantes);
  const papelDaLegenda = legenda
    ? papelDoFalante(legenda.speaker ?? 'Alguém', selfName, colegas)
    : 'externo';

  return (
    <div className="tq-transcricao-palco">
      <ListaDeFalas
        listaRef={listaRef}
        meetingId={meetingId}
        titulo={titulo}
        segmentos={segmentos}
        selfName={selfName}
        colegas={colegas}
        chegandoId={legendaId}
        onPerguntarSobre={onPerguntarSobre}
      />
      <div className="tq-palco-legenda" aria-hidden="true">
        {legenda && (
          <div
            className={`tq-legenda${
              papelDaLegenda === 'eu' ? ' minha' : papelDaLegenda === 'citi' ? ' citi' : ''
            }`}
            key={legenda.captionId}
          >
            <span className="tq-legenda-quem" ref={quemDaLegenda}>
              {speakerLabel(legenda.speaker ?? 'Alguém', selfName)}
            </span>
            <span className="tq-legenda-texto" ref={textoDaLegenda}>
              &ldquo;{legenda.text}&rdquo;
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- a transcrição, com marcação e seleção ----------

function ListaDeFalas({
  listaRef,
  meetingId,
  titulo,
  segmentos,
  selfName,
  colegas,
  chegandoId,
  onPerguntarSobre,
}: {
  listaRef: React.MutableRefObject<HTMLDivElement | null>;
  meetingId: string;
  titulo: string;
  segmentos: readonly LiveSegment[];
  /** Quem é "eu" nesta reunião: a fala dessa pessoa vem em branco. */
  selfName: string | null;
  /** Os falantes do CITi (e-mail @citi.org.br): a fala deles vem em verde. */
  colegas: ReadonlySet<string>;
  /** A fala que ainda está na legenda: tem lugar na lista, mas invisível. */
  chegandoId: string | null;
  onPerguntarSobre: (contexto: ContextoDaPergunta) => void;
}) {
  const [marcas, setMarcas] = useState<MarcasDaReuniao>({});
  const [selecionado, setSelecionado] = useState<string | null>(null);
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
   * de ações e o título subirem para fora da tela sozinhos, a cada fala nova.
   */
  useEffect(() => {
    const lista = listaRef.current;
    if (lista && noFim.current) lista.scrollTop = lista.scrollHeight;
  }, [segmentos.length, listaRef]);

  const aoRolar = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 64;
  }, []);

  return (
    <div className="tq-falas" ref={listaRef} onScroll={aoRolar}>
      {segmentos.map((s, i) => {
        const marca = marcas[s.captionId];
        const aberto = selecionado === s.captionId;
        /*
         * Fala SEGUIDA da mesma pessoa: o nome não se repete. Numa coluna
         * estreita, "Ana Duarte (Eu)" em cima de cada frase de um mesmo
         * raciocínio dobrava a altura da lista sem dizer nada novo.
         */
        const seguida = i > 0 && segmentos[i - 1]?.speaker === s.speaker;
        /*
         * Quem falou. O "(Eu)" é o mesmo rótulo do histórico na HOME, e sai da
         * MESMA conta: "eu" é o participante marcado como anfitrião (ver
         * `hostName`). A comparação é a de `speakerLabel`, e não uma segunda
         * regra escrita aqui.
         */
        const nome = s.speaker ?? 'Alguém';
        const rotulo = speakerLabel(nome, selfName);
        const papel = papelDoFalante(nome, selfName, colegas);
        return (
          <article
            key={s.captionId}
            data-caption={s.captionId}
            className={`tq-fala${aberto ? ' selecionada' : ''}${marca ? ' marcada' : ''}${
              papel === 'eu' ? ' minha' : papel === 'citi' ? ' citi' : ''
            }${seguida ? ' seguida' : ''}${s.captionId === chegandoId ? ' chegando' : ''}`}
          >
            <button
              type="button"
              className="tq-fala-corpo"
              aria-expanded={aberto}
              onClick={() => setSelecionado(aberto ? null : s.captionId)}
            >
              <span className="tq-fala-quem">
                <span className="tq-fala-nome">{rotulo}</span>
                <span className="tq-fala-hora">{formatOffset(s.startOffsetMs)}</span>
                {formatSpeechDuration(s.startOffsetMs, s.endOffsetMs) && (
                  <span className="tq-fala-duracao" title="Duração da fala">
                    {formatSpeechDuration(s.startOffsetMs, s.endOffsetMs)}
                  </span>
                )}
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
                  <Icon name="sparkles" size={14} />
                  Perguntar sobre o trecho
                </button>
                <BotaoCopiar texto={`${nome}: ${s.text}`} rotulo="Copiar o trecho" />
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
