/**
 * A SIDEBAR do TaqCiti — no painel lateral nativo do Chrome.
 *
 * ── Duas atividades, sempre visíveis ─────────────────────────────────────
 *
 * A sidebar tem DOIS modos de conteúdo, e não duas colunas: "Transcrição" e
 * "Conversa". São dois assuntos que acontecem ao mesmo tempo e são lidos um de
 * cada vez — numa coluna de 260px não cabe outra coisa.
 *
 * O que os seletores mostram é a atividade de CADA UM, independentemente de
 * qual está aberto: a captura corre enquanto se lê a conversa, e o agente
 * responde enquanto se lê a transcrição. Ver `Seletores.tsx`.
 *
 * ── Por que as duas seções ficam montadas ────────────────────────────────
 *
 * Trocar de modo não pode custar nada: nem o rascunho, nem a posição de
 * leitura. Desmontar a seção que sai perderia a segunda coisa mesmo com a
 * primeira levantada para cá — a rolagem é do DOM, não do React.
 *
 * Então as duas vivem ao mesmo tempo, empilhadas, e a que não está em uso fica
 * com `visibility: hidden` e `inert`. `visibility` e não `display: none` de
 * propósito: `display: none` destrói a caixa e, com ela, o `scrollTop`. Quem
 * volta para a transcrição depois de três minutos de conversa volta para a
 * linha em que estava.
 *
 * ── Por que os rascunhos moram aqui em cima ──────────────────────────────
 *
 * Mesmo com a seção montada, o texto da nota é usado em dois lugares (o editor
 * da reunião em curso e o de uma reunião do histórico). Levantados para cá, os
 * rascunhos atravessam a navegação interna — e o da nota ainda é descarregado
 * no storage ao sair, para não depender de o respiro do gravador ter vencido.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistoryState } from '@/features/history/useHistory';
import { useMeetingState } from '@/shared/hooks/useMeetingState';
import { usePlatform } from '@/shared/platform/context';
import {
  guardarDecisao,
  observarDecisoes,
  observarParticipacao,
  observarReuniaoDetectada,
  type DecisaoDeRegistro,
  type Participacao,
  type ReuniaoDetectada,
} from '@/features/meeting/consent';
import {
  observarAgente,
  type AtividadeDoAgente,
  type EstadoDoAgente,
} from '@/features/agent/atividade';
import {
  cancelarTaq,
  desfazerExclusao,
  mensagemDoDesfecho,
  perguntarAoTaq,
  useDisponibilidadeDoTaq,
} from '@/features/taq/interface';
import {
  criarGravadorDeNota,
  observarNotas,
  type EstadoDaGravacao,
  type Nota,
} from '@/features/annotations/notes';
import {
  acrescentarMensagem,
  observarConversas,
  type ContextoDaPergunta,
  type Conversation,
  type FonteDaResposta,
} from '@/home/conversations';
import { useConversaAberta } from '@/home/useConversaAberta';
import type { MeetingState } from '@/shared/types/domain';
import type { UiCommand } from '@/shared/types/messages';
import type { EstadoDaCaptura } from '@/shared/ui/MarcaDaEscuta';
import { Brasas } from '@/shared/ui/Brasas';
import { Icon } from '@/shared/ui/Icon';
import { Wordmark } from '@/shared/ui/Wordmark';
import { Conversa } from './Conversa';
import { Pergunta } from './Pergunta';
import { Reuniao } from './Reuniao';
import { Reunioes } from './Reunioes';
import { Seletores, type Modo } from './Seletores';

/**
 * Os controles de desenvolvimento, e por que eles são carregados assim.
 *
 * `import()` dentro de um ramo que o bundler resolve em tempo de build: com
 * `__TAQCITI_DEV__` falso o ternário vira `null`, a função que contém o
 * `import()` morre com ele, e o chunk inteiro deixa de ser emitido. Não é um
 * menu escondido — é código que não está lá. Ver `src/ambiente.d.ts`.
 */
const PainelDeSimulacao = __TAQCITI_DEV__
  ? lazy(() => import('@/dev/PainelDeSimulacao'))
  : null;

/** O que a simulação de desenvolvimento pode sobrepor. Só existe em dev. */
export interface Sobreposicao {
  meeting: MeetingState;
}

/** Chave do rascunho enquanto a conversa nova ainda não existe no storage. */
const RASCUNHO_NOVA = '\u0000nova';

/** Como uma execução terminou: é disso que só a conversa dela fala. */
const DESFECHOS: ReadonlySet<AtividadeDoAgente> = new Set<AtividadeDoAgente>([
  'concluido',
  'falhou',
  'cancelado',
  'interrompido',
]);

export function App() {
  const platform = usePlatform();
  const estadoReal = useMeetingState();
  const { records, loaded } = useHistoryState();

  const [detectada, setDetectada] = useState<ReuniaoDetectada | null>(null);
  const [decisoes, setDecisoes] = useState<Record<string, DecisaoDeRegistro>>({});
  const [notas, setNotas] = useState<Record<string, Nota>>({});
  const [conversas, setConversas] = useState<Conversation[]>([]);
  const [agente, setAgente] = useState<EstadoDoAgente>({
    atividade: 'repouso',
    parcial: '',
    etapa: null,
  });
  /** Preenchida apenas pelos controles de desenvolvimento. `null` em produção. */
  const [sobreposicao, setSobreposicao] = useState<Sobreposicao | null>(null);
  /** As brasas do fundo — ver o botão no cabeçalho, ao lado do de ir para a HOME. */
  const [brasasVisiveis, setBrasasVisiveis] = useState(true);

  useEffect(() => observarReuniaoDetectada(setDetectada), []);
  useEffect(() => observarDecisoes(setDecisoes), []);
  const [participacao, setParticipacao] = useState<Participacao | null>(null);
  useEffect(() => observarParticipacao(setParticipacao), []);
  useEffect(() => observarNotas(setNotas), []);
  useEffect(() => observarConversas(setConversas), []);
  useEffect(() => observarAgente(setAgente), []);

  const state = sobreposicao?.meeting ?? estadoReal;
  /*
   * A reunião encerrada de ANTES não fica na tela quando já se está noutra
   * sala: o estado global guarda a última sessão até a aba fechar, e sem este
   * corte a sidebar mostrava a reunião antiga enquanto a nova esperava.
   */
  const emOutraSala =
    state.phase === 'ended' &&
    participacao !== null &&
    participacao.saiuEm === null &&
    state.session !== null &&
    participacao.meetingCode !== state.session.meetingCode;
  const sessao = emOutraSala ? null : state.session;
  /*
   * Só a reunião em CURSO ocupa a seção. A encerrada vai para o histórico — a
   * lista logo abaixo, onde ela já está no topo — em vez de ficar presa na tela
   * até a aba fechar. (O background ainda a guarda por um tempo, para retomar
   * se a pessoa voltar à mesma sala; isso não precisa de tela.)
   */
  const emReuniao =
    sessao !== null &&
    (state.phase === 'recording' ||
      state.phase === 'paused' ||
      state.phase === 'captionsRequired');
  /*
   * A decisão é chaveada pela PARTICIPAÇÃO — esta vez em que se entrou nesta
   * sala —, e não pelo código dela. O link do Meet é reutilizado, e chavear
   * pela sala faria um "sim" de hoje ligar a captura sozinha amanhã. Ver
   * features/meeting/consent.ts.
   */
  const perguntando =
    detectada !== null && decisoes[detectada.participacaoId] === undefined;
  /*
   * Da PARTICIPAÇÃO aberta, e não da pergunta anunciada: a pergunta some no
   * instante em que é respondida, e com ela sumia o "agora não" — a tela
   * "Captura desligada" nunca chegava a aparecer.
   */
  const recusada =
    (detectada !== null && decisoes[detectada.participacaoId] === 'recusado') ||
    (participacao !== null &&
      participacao.saiuEm === null &&
      decisoes[participacao.id] === 'recusado');

  const [modo, setModo] = useState<Modo>('conversa');
  // Entrar numa reunião leva para a transcrição. Ela ENCERRAR não tira a
  // pessoa dali: a seção mostra o histórico, com a reunião recém-salva no
  // topo — é para lá que ela foi. Sair por outro caminho (sem reunião nenhuma)
  // devolve para a conversa. Reage à MUDANÇA de contexto, não a cada render —
  // senão trocar de modo durante a reunião seria desfeito no quadro seguinte.
  const contextoAnterior = useRef(emReuniao);
  const encerrou = state.phase === 'ended';
  useEffect(() => {
    if (contextoAnterior.current !== emReuniao) {
      contextoAnterior.current = emReuniao;
      if (emReuniao) setModo('transcricao');
      else if (!encerrou) setModo('conversa');
    }
    // `encerrou` é lido no instante da troca; ele sozinho não é troca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emReuniao]);

  // ---------- conversas ----------

  // A mesma regra da HOME, inclusive quando a conversa aberta é apagada.
  const {
    conversa,
    escolher: escolherConversa,
    nova: novaConversa,
  } = useConversaAberta(conversas);
  const [gravandoMensagem, setGravandoMensagem] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [rascunhosConversa, setRascunhosConversa] = useState<Record<string, string>>({});
  /** O que a próxima pergunta vai levar junto. Montado por gesto explícito. */
  const [contexto, setContexto] = useState<ContextoDaPergunta | null>(null);

  const chaveRascunho = conversa?.id ?? RASCUNHO_NOVA;

  const [taq] = useDisponibilidadeDoTaq();
  /**
   * Na sidebar, "abrir" é abrir na HOME: é lá que reuniões e documentos têm
   * tela própria. `enviar` é o mesmo `platform.send` que o resto da sidebar usa.
   */
  const acoesDaTela = useMemo(
    () => ({
      enviar: (mensagem: { type: string } & Record<string, unknown>) =>
        platform.send(mensagem as UiCommand),
      abrirReuniao: (recordId: string) =>
        void platform.send({ type: 'ui/openHome', recordId }),
      abrirDocumento: (documentId: string) =>
        void platform.send({ type: 'ui/openHome', documentId }),
    }),
    [platform],
  );
  /** Estável: é dependência do histórico memorizado da conversa. */
  const desfazer = useCallback(
    (id: string) => desfazerExclusao(id, acoesDaTela),
    [acoesDaTela],
  );
  /** Como a última execução terminou quando não deixou resposta. */
  const [desfecho, setDesfecho] = useState<string | null>(null);
  /**
   * A conversa da última execução. O estado do agente é um só para o
   * navegador, e o desfecho dele ("A resposta falhou…") seguia a pessoa para
   * qualquer conversa, para a "Nova" e para a sidebar reaberta no dia
   * seguinte. Ele pertence à conversa em que aconteceu, e só nela aparece.
   */
  const [execucaoEm, setExecucaoEm] = useState<string | null>(null);
  const daOutraConversa =
    DESFECHOS.has(agente.atividade) && (execucaoEm === null || execucaoEm !== conversa?.id);
  const agenteVisivel: EstadoDoAgente = daOutraConversa
    ? { atividade: 'repouso', parcial: '', etapa: null }
    : agente;

  const enviar = useCallback(
    async (texto: string): Promise<boolean> => {
      setGravandoMensagem(true);
      setErroEnvio(null);
      try {
        const id = await acrescentarMensagem(conversa?.id ?? null, {
          texto,
          ...(contexto ? { contexto, meetingId: contexto.meetingId } : {}),
        });
        escolherConversa(id);
        setContexto(null);
        // Mesma regra da HOME: gravada a pergunta, o Taq segue sem prender o campo.
        if (taq.fase === 'pronto') {
          setDesfecho(null);
          setExecucaoEm(id);
          void perguntarAoTaq({
            conversaId: id,
            texto,
            contexto,
            acoes: acoesDaTela,
          }).then((r) => setDesfecho(r && !r.resposta ? mensagemDoDesfecho(r) : null));
        }
        return true;
      } catch {
        setErroEnvio('Não foi possível guardar a mensagem neste computador.');
        return false;
      } finally {
        setGravandoMensagem(false);
      }
    },
    [conversa, contexto, taq.fase, acoesDaTela, escolherConversa],
  );

  /** Vem da transcrição: leva o trecho (ou a reunião) para a conversa. */
  const perguntarSobre = useCallback((ctx: ContextoDaPergunta) => {
    setContexto(ctx);
    setModo('conversa');
  }, []);

  // ---------- notas ----------

  const [estadoDaNota, setEstadoDaNota] = useState<EstadoDaGravacao>('parado');
  const [rascunhosNota, setRascunhosNota] = useState<Record<string, string>>({});
  const gravador = useRef(criarGravadorDeNota(setEstadoDaNota));

  // A última tecla não pode morrer com o painel. O painel lateral fecha
  // desmontando a página inteira, então este é o último instante útil.
  useEffect(() => {
    const atual = gravador.current;
    const aoFechar = () => void atual.descarregar();
    const antesDeFechar = (e: BeforeUnloadEvent) => {
      if (atual.temPendente()) {
        e.preventDefault();
        e.returnValue = '';
        void atual.descarregar();
      }
    };
    window.addEventListener('beforeunload', antesDeFechar);
    window.addEventListener('pagehide', aoFechar);
    return () => {
      window.removeEventListener('beforeunload', antesDeFechar);
      window.removeEventListener('pagehide', aoFechar);
      void atual.descarregar();
    };
  }, []);

  // Rascunhos confirmados deixam de ocultar as edições de outra superfície.
  useEffect(() => {
    setRascunhosNota((atual) => {
      const proximo = { ...atual };
      for (const [id, texto] of Object.entries(atual)) {
        if ((notas[id]?.texto ?? '') === texto) delete proximo[id];
      }
      return proximo;
    });
  }, [notas]);

  const escreverNota = useCallback((meetingId: string, texto: string) => {
    setRascunhosNota((atual) => ({ ...atual, [meetingId]: texto }));
    gravador.current.agendar(meetingId, texto);
  }, []);

  // ---------- ações de sessão ----------

  const responder = useCallback(
    async (decisao: DecisaoDeRegistro) => {
      if (!detectada) return;
      // A MESMA gravação que a pergunta na página faz: uma decisão só, e por
      // isso responder num lugar apaga a pergunta no outro.
      await guardarDecisao(detectada.participacaoId, decisao);
    },
    [detectada],
  );

  const abrirHome = useCallback(
    (recordId?: string) => {
      void platform.send({
        type: 'ui/openHome',
        ...(recordId ? { recordId } : {}),
      });
    },
    [platform],
  );

  /** A origem de uma fonte abre na HOME — reunião ou documento. */
  const abrirFonte = useCallback(
    (fonte: FonteDaResposta) => {
      void platform.send({
        type: 'ui/openHome',
        ...(fonte.tipo === 'reuniao'
          ? { recordId: fonte.registroId }
          : { documentId: fonte.registroId }),
      });
    },
    [platform],
  );
  const abrirDocumento = useCallback(
    (id: string) => void platform.send({ type: 'ui/openHome', documentId: id }),
    [platform],
  );

  // ---------- a tela ----------

  /*
   * A pergunta ocupa o painel inteiro. Não é uma faixa no topo de outra tela:
   * enquanto ela não for respondida não há captura, e qualquer outra coisa ali
   * seria a interface fingindo que existe uma reunião sendo registrada.
   */
  if (perguntando && detectada) {
    return (
      <div className="tq-side">
        {brasasVisiveis && <Brasas />}
        <Cabecalho
          onHome={() => abrirHome()}
          brasasVisiveis={brasasVisiveis}
          onAlternarBrasas={() => setBrasasVisiveis((v) => !v)}
        />
        <Pergunta
          titulo={detectada.title}
          anterior={detectada.anterior ?? null}
          onContinuar={(id) => void responder(`continuar:${id}`)}
          onAceitar={() => void responder('aceito')}
          onRecusar={() => void responder('recusado')}
        />
      </div>
    );
  }

  const meetingId = sessao?.meetingId ?? null;
  const captura = sessao === null ? 'desligada' : estadoDaCaptura(state);

  return (
    <div className="tq-side">
      {brasasVisiveis && <Brasas />}
      <Cabecalho
        onHome={() => abrirHome()}
        brasasVisiveis={brasasVisiveis}
        onAlternarBrasas={() => setBrasasVisiveis((v) => !v)}
      />

      <Seletores
        modo={modo}
        onModo={setModo}
        captura={captura}
        /* Contar falas é o sinal honesto mais próximo de "chegou trecho novo". */
        pulso={sessao?.segments.length ?? 0}
        agente={agenteVisivel.atividade}
        sinalDoAgente={
          agenteVisivel.parcial ? agenteVisivel.parcial.length : (agenteVisivel.etapa ?? '')
        }
      />

      <div className="tq-palco">
        <Painel ativo={modo === 'transcricao'} rotulo="Reunião">
          {emReuniao && sessao ? (
            <Reuniao
              // Uma sessão nova é uma tela nova: prints, marcas e seções
              // abertas da reunião anterior não atravessam a troca.
              key={sessao.meetingId}
              state={state}
              notaExiste={meetingId !== null && Boolean(notas[meetingId])}
              rascunhoNota={
                meetingId === null
                  ? ''
                  : (rascunhosNota[meetingId] ?? notas[meetingId]?.texto ?? '')
              }
              estadoDaNota={estadoDaNota}
              onEscreverNota={escreverNota}
              onPerguntarSobre={perguntarSobre}
            />
          ) : (
            <Reunioes
              registros={records}
              carregado={loaded}
              notas={notas}
              rascunhosNota={rascunhosNota}
              estadoDaNota={estadoDaNota}
              recusada={recusada}
              onEscreverNota={escreverNota}
              onAbrirNaHome={abrirHome}
            />
          )}
        </Painel>

        <Painel ativo={modo === 'conversa'} rotulo="Conversa">
          <Conversa
            conversa={conversa}
            conversas={conversas}
            gravando={gravandoMensagem}
            erro={erroEnvio}
            agente={agenteVisivel}
            contexto={contexto}
            registros={records}
            rascunho={rascunhosConversa[chaveRascunho] ?? ''}
            onRascunho={(t) =>
              setRascunhosConversa((atual) => ({ ...atual, [chaveRascunho]: t }))
            }
            onEnviar={enviar}
            onLimparContexto={() => setContexto(null)}
            onNova={novaConversa}
            onEscolher={escolherConversa}
            taq={taq}
            desfecho={daOutraConversa ? null : desfecho}
            onCancelar={cancelarTaq}
            onAbrirFonte={abrirFonte}
            onAbrirDocumento={abrirDocumento}
            onDesfazer={desfazer}
          />
        </Painel>
      </div>

      {PainelDeSimulacao && (
        <Suspense fallback={null}>
          <PainelDeSimulacao
            estadoReal={estadoReal}
            sobreposicao={sobreposicao}
            onSobrepor={setSobreposicao}
          />
        </Suspense>
      )}
    </div>
  );
}

/**
 * O estado da captura, traduzido do estado da reunião.
 *
 * "Interrompida" é derivado de `captureHealthy`, que vem da aba do Meet: é a
 * única coisa que sabe que há legenda na tela que a captura não está lendo.
 */
function estadoDaCaptura(state: MeetingState): EstadoDaCaptura {
  switch (state.phase) {
    case 'recording':
      return state.session?.captureHealthy === false ? 'interrompida' : 'capturando';
    case 'paused':
      return 'pausada';
    case 'captionsRequired':
      return 'preparando';
    case 'ended':
      // Sem nenhuma fala não há transcrição salva: dizer "Salva" seria falso.
      return (state.session?.segments.length ?? 0) > 0 ? 'salva' : 'desligada';
    default:
      // Sem reunião e "agora não" são o mesmo fato para a captura: ela está
      // desligada. O que os separa é o texto da seção, não o indicador.
      return 'desligada';
  }
}

/**
 * Uma das duas seções. A que não está em uso continua montada e viva — só
 * invisível e fora do alcance do teclado.
 */
function Painel({
  ativo,
  rotulo,
  children,
}: {
  ativo: boolean;
  rotulo: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  /*
   * `inert` é o que impede o Tab de entrar na seção invisível. Sem ele, quem
   * navega por teclado atravessaria a conversa inteira — campos, botões, menu —
   * sem ver nada na tela. É atribuído por `ref` porque a propriedade existe no
   * DOM antes de existir na tipagem de React 18.
   */
  useEffect(() => {
    const el = ref.current as (HTMLDivElement & { inert?: boolean }) | null;
    if (el) el.inert = !ativo;
  }, [ativo]);

  return (
    <div
      ref={ref}
      className={`tq-painel${ativo ? ' ativo' : ''}`}
      role="region"
      aria-label={rotulo}
      aria-hidden={!ativo}
    >
      {children}
    </div>
  );
}

/**
 * O cabeçalho: marca e a porta para a HOME.
 *
 * O selo de estado que ficava aqui saiu: os seletores agora dizem o que cada
 * seção está fazendo, com mais precisão e no lugar em que se clica. Duas
 * superfícies anunciando o mesmo estado divergiriam no primeiro ajuste.
 *
 * "Abrir HOME" continua sendo um controle fixo, e não um item escondido num
 * menu: é o caminho de volta para a página principal, e ter de procurá-lo seria
 * a sidebar competindo com ela em vez de apontar para ela.
 */
function Cabecalho({
  onHome,
  brasasVisiveis,
  onAlternarBrasas,
}: {
  onHome: () => void;
  brasasVisiveis: boolean;
  onAlternarBrasas: () => void;
}) {
  return (
    <header className="tq-side-topo">
      <Wordmark height={20} />
      <div className="tq-side-topo-acoes">
        <button
          type="button"
          className={`tq-icone${brasasVisiveis ? '' : ' desligado'}`}
          onClick={onAlternarBrasas}
          title={brasasVisiveis ? 'Remover brasas do fundo' : 'Trazer brasas de volta'}
          aria-label={
            brasasVisiveis ? 'Remover brasas do fundo' : 'Trazer brasas de volta'
          }
          aria-pressed={!brasasVisiveis}
        >
          <Icon name="sparkles" size={16} />
        </button>
        <button
          type="button"
          className="tq-icone"
          onClick={onHome}
          title="Abrir HOME"
          aria-label="Abrir HOME"
        >
          <Icon name="home" size={18} />
        </button>
      </div>
    </header>
  );
}
