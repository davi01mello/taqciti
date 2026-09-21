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
  observarReuniaoDetectada,
  type DecisaoDeRegistro,
  type ReuniaoDetectada,
} from '@/features/meeting/consent';
import { observarAgente, type EstadoDoAgente } from '@/features/agent/atividade';
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
} from '@/home/conversations';
import type { MeetingState } from '@/shared/types/domain';
import type { EstadoDaCaptura } from '@/shared/ui/OndaDaCaptura';
import { BarrasDoOceano } from '@/shared/ui/BarrasDoOceano';
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
  });
  /** Preenchida apenas pelos controles de desenvolvimento. `null` em produção. */
  const [sobreposicao, setSobreposicao] = useState<Sobreposicao | null>(null);

  useEffect(() => observarReuniaoDetectada(setDetectada), []);
  useEffect(() => observarDecisoes(setDecisoes), []);
  useEffect(() => observarNotas(setNotas), []);
  useEffect(() => observarConversas(setConversas), []);
  useEffect(() => observarAgente(setAgente), []);

  const state = sobreposicao?.meeting ?? estadoReal;
  const sessao = state.session;
  const emReuniao = sessao !== null && state.phase !== 'idle';
  /*
   * A decisão é chaveada pela PARTICIPAÇÃO — esta vez em que se entrou nesta
   * sala —, e não pelo código dela. O link do Meet é reutilizado, e chavear
   * pela sala faria um "sim" de hoje ligar a captura sozinha amanhã. Ver
   * features/meeting/consent.ts.
   */
  const perguntando =
    detectada !== null && decisoes[detectada.participacaoId] === undefined;
  const recusada =
    detectada !== null && decisoes[detectada.participacaoId] === 'recusado';

  const [modo, setModo] = useState<Modo>('conversa');
  // Entrar numa reunião leva para a transcrição; sair devolve para a conversa.
  // Reage à MUDANÇA de contexto, não a cada render — senão trocar de modo
  // durante a reunião seria desfeito no quadro seguinte.
  const contextoAnterior = useRef(emReuniao);
  useEffect(() => {
    if (contextoAnterior.current !== emReuniao) {
      contextoAnterior.current = emReuniao;
      setModo(emReuniao ? 'transcricao' : 'conversa');
    }
  }, [emReuniao]);

  // ---------- conversas ----------

  const [conversaId, setConversaId] = useState<string | null>(null);
  const [iniciandoNova, setIniciandoNova] = useState(false);
  const [gravandoMensagem, setGravandoMensagem] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [rascunhosConversa, setRascunhosConversa] = useState<Record<string, string>>({});
  /** O que a próxima pergunta vai levar junto. Montado por gesto explícito. */
  const [contexto, setContexto] = useState<ContextoDaPergunta | null>(null);

  const conversa = useMemo(
    () =>
      iniciandoNova
        ? null
        : (conversas.find((c) => c.id === conversaId) ?? conversas[0] ?? null),
    [conversas, conversaId, iniciandoNova],
  );
  const chaveRascunho = conversa?.id ?? RASCUNHO_NOVA;

  const enviar = useCallback(
    async (texto: string): Promise<boolean> => {
      setGravandoMensagem(true);
      setErroEnvio(null);
      try {
        const id = await acrescentarMensagem(conversa?.id ?? null, {
          texto,
          ...(contexto ? { contexto, meetingId: contexto.meetingId } : {}),
        });
        setConversaId(id);
        setIniciandoNova(false);
        setContexto(null);
        return true;
      } catch {
        setErroEnvio('Não foi possível guardar a mensagem neste computador.');
        return false;
      } finally {
        setGravandoMensagem(false);
      }
    },
    [conversa, contexto],
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
    window.addEventListener('pagehide', aoFechar);
    return () => {
      window.removeEventListener('pagehide', aoFechar);
      void atual.descarregar();
    };
  }, []);

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

  // ---------- a tela ----------

  /*
   * A pergunta ocupa o painel inteiro. Não é uma faixa no topo de outra tela:
   * enquanto ela não for respondida não há captura, e qualquer outra coisa ali
   * seria a interface fingindo que existe uma reunião sendo registrada.
   */
  if (perguntando && detectada) {
    return (
      <div className="tq-side">
        <BarrasDoOceano />
        <Cabecalho onHome={() => abrirHome()} />
        <Pergunta
          titulo={detectada.title}
          onAceitar={() => void responder('aceito')}
          onRecusar={() => void responder('recusado')}
        />
      </div>
    );
  }

  const meetingId = sessao?.meetingId ?? null;
  const captura = estadoDaCaptura(state);

  return (
    <div className="tq-side">
      <BarrasDoOceano />
      <Cabecalho onHome={() => abrirHome()} />

      <Seletores
        modo={modo}
        onModo={setModo}
        captura={captura}
        /* Contar falas é o sinal honesto mais próximo de "chegou trecho novo". */
        pulso={sessao?.segments.length ?? 0}
        agente={agente.atividade}
      />

      <div className="tq-palco">
        <Painel ativo={modo === 'transcricao'} rotulo="Transcrição">
          {emReuniao && sessao ? (
            <Reuniao
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
              onAbrirHome={abrirHome}
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
            agente={agente}
            contexto={contexto}
            registros={records}
            rascunho={rascunhosConversa[chaveRascunho] ?? ''}
            onRascunho={(t) =>
              setRascunhosConversa((atual) => ({ ...atual, [chaveRascunho]: t }))
            }
            onEnviar={enviar}
            onLimparContexto={() => setContexto(null)}
            onNova={() => {
              setIniciandoNova(true);
              setConversaId(null);
            }}
            onEscolher={(id) => {
              setConversaId(id);
              setIniciandoNova(false);
            }}
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
      return 'salva';
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
function Cabecalho({ onHome }: { onHome: () => void }) {
  return (
    <header className="tq-side-topo">
      <Wordmark height={26} />
      <button
        type="button"
        className="tq-icone"
        onClick={onHome}
        title="Abrir HOME"
        aria-label="Abrir HOME"
      >
        <Icon name="home" size={20} />
      </button>
    </header>
  );
}
