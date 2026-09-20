/**
 * A SIDEBAR do TaqCiti — no painel lateral nativo do Chrome.
 *
 * ── Os dois mundos, e o que decide qual está na tela ─────────────────────
 *
 * FORA de uma reunião a sidebar é uma versão estreita do produto: conversar,
 * chegar na HOME, e alcançar o histórico (conversas, reuniões e notas).
 * DENTRO de uma reunião ela vira o painel dela: transcrição ao vivo, notas,
 * prints e a conversa com o contexto daquela reunião.
 *
 * Quem decide não é a sidebar: é o estado da reunião, que mora no background e
 * chega por `useMeetingState`. Abrir o painel não começa nada — é o requisito
 * literal, e é por isso que a pergunta de autorização é uma TELA aqui, e não um
 * efeito colateral da abertura.
 *
 * ── Por que os rascunhos moram aqui em cima ──────────────────────────────
 *
 * Trocar de aba interna desmonta o componente da aba. Se o texto que está sendo
 * escrito vivesse dentro dele, ir até as notas e voltar apagaria a pergunta pela
 * metade. Levantados para cá, os rascunhos atravessam a navegação interna — e o
 * da nota ainda é descarregado no storage ao sair, para não depender de o
 * respiro do gravador ter vencido.
 *
 * ── Por que a largura é um problema de verdade ───────────────────────────
 *
 * O painel é redimensionável e começa estreito. Nada aqui empilha tudo numa
 * coluna só: o que existe são três abas de cada vez, e cada tela assume que
 * pode ter 260px de largura.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Icon } from '@/shared/ui/Icon';
import { Wordmark } from '@/shared/ui/Wordmark';
import { Conversa } from './Conversa';
import { Historico } from './Historico';
import { Notas } from './Notas';
import { Pergunta } from './Pergunta';
import { Reuniao } from './Reuniao';

type Aba = 'reuniao' | 'notas' | 'conversa' | 'historico';

const ABAS_NA_REUNIAO: ReadonlyArray<{ id: Aba; rotulo: string }> = [
  { id: 'reuniao', rotulo: 'Reunião' },
  { id: 'notas', rotulo: 'Notas' },
  { id: 'conversa', rotulo: 'Conversa' },
];
const ABAS_FORA: ReadonlyArray<{ id: Aba; rotulo: string }> = [
  { id: 'conversa', rotulo: 'Conversa' },
  { id: 'historico', rotulo: 'Histórico' },
];

/** Chave do rascunho enquanto a conversa nova ainda não existe no storage. */
const RASCUNHO_NOVA = '\u0000nova';

export function App() {
  const platform = usePlatform();
  const state = useMeetingState();
  const { records, loaded } = useHistoryState();

  const [detectada, setDetectada] = useState<ReuniaoDetectada | null>(null);
  const [decisoes, setDecisoes] = useState<Record<string, DecisaoDeRegistro>>({});
  const [notas, setNotas] = useState<Record<string, Nota>>({});
  const [conversas, setConversas] = useState<Conversation[]>([]);

  useEffect(() => observarReuniaoDetectada(setDetectada), []);
  useEffect(() => observarDecisoes(setDecisoes), []);
  useEffect(() => observarNotas(setNotas), []);
  useEffect(() => observarConversas(setConversas), []);

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
  const noContextoDeReuniao = emReuniao || detectada !== null;

  const [aba, setAba] = useState<Aba>('conversa');
  // Entrar numa reunião leva para a tela dela; sair devolve para a conversa.
  // Reage à MUDANÇA de contexto, não a cada render — senão trocar de aba
  // durante a reunião seria desfeito no quadro seguinte.
  const contextoAnterior = useRef(noContextoDeReuniao);
  useEffect(() => {
    if (contextoAnterior.current !== noContextoDeReuniao) {
      contextoAnterior.current = noContextoDeReuniao;
      setAba(noContextoDeReuniao ? 'reuniao' : 'conversa');
    }
  }, [noContextoDeReuniao]);

  const abas = noContextoDeReuniao ? ABAS_NA_REUNIAO : ABAS_FORA;
  const abaAtual = abas.some((a) => a.id === aba) ? aba : abas[0]!.id;

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

  /** Vem da transcrição: leva o trecho para a conversa e troca de aba. */
  const perguntarSobre = useCallback((ctx: ContextoDaPergunta) => {
    setContexto(ctx);
    setAba('conversa');
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
        <Cabecalho onHome={() => abrirHome()} estado="Aguardando" />
        <Pergunta
          titulo={detectada.title}
          onAceitar={() => void responder('aceito')}
          onRecusar={() => void responder('recusado')}
        />
      </div>
    );
  }

  const meetingId = sessao?.meetingId ?? null;

  return (
    <div className="tq-side">
      <Cabecalho
        onHome={() => abrirHome()}
        estado={
          state.phase === 'recording'
            ? 'Transcrevendo'
            : state.phase === 'paused'
              ? 'Pausado'
              : state.phase === 'captionsRequired'
                ? 'Preparando'
                : state.phase === 'ended'
                  ? 'Salva'
                  : recusada
                    ? 'Sem registro'
                    : null
        }
      />

      <nav className="tq-abas" aria-label="Seções da sidebar">
        {abas.map((a) => (
          <button
            key={a.id}
            type="button"
            className={a.id === abaAtual ? 'atual' : undefined}
            aria-current={a.id === abaAtual ? 'page' : undefined}
            onClick={() => setAba(a.id)}
          >
            {a.rotulo}
          </button>
        ))}
      </nav>

      <div className="tq-corpo">
        {abaAtual === 'reuniao' && (
          <Reuniao
            state={state}
            recusada={recusada}
            notaExiste={meetingId !== null && Boolean(notas[meetingId])}
            onComecar={() => void responder('aceito')}
            onPerguntarSobre={perguntarSobre}
            onAbrirHome={abrirHome}
          />
        )}

        {abaAtual === 'notas' && (
          <Notas
            meetingId={meetingId}
            titulo={sessao?.title ?? null}
            texto={
              meetingId === null
                ? ''
                : (rascunhosNota[meetingId] ?? notas[meetingId]?.texto ?? '')
            }
            estado={estadoDaNota}
            onEscrever={escreverNota}
          />
        )}

        {abaAtual === 'conversa' && (
          <Conversa
            conversa={conversa}
            conversas={conversas}
            gravando={gravandoMensagem}
            erro={erroEnvio}
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
        )}

        {abaAtual === 'historico' && (
          <Historico
            registros={records}
            carregado={loaded}
            notas={notas}
            conversas={conversas}
            onAbrirConversa={(id) => {
              setConversaId(id);
              setIniciandoNova(false);
              setAba('conversa');
            }}
            onEscreverNota={escreverNota}
            rascunhosNota={rascunhosNota}
            estadoDaNota={estadoDaNota}
            onAbrirNaHome={abrirHome}
          />
        )}
      </div>
    </div>
  );
}

/**
 * O cabeçalho: marca, estado real e a porta para a HOME.
 *
 * "Abrir HOME" é um controle fixo, e não um item escondido num menu: é o
 * caminho de volta para a página principal, e ter de procurá-lo seria a
 * sidebar competindo com ela em vez de apontar para ela.
 */
function Cabecalho({ onHome, estado }: { onHome: () => void; estado: string | null }) {
  return (
    <header className="tq-side-topo">
      <Wordmark height={20} />
      <div className="tq-side-topo-direita">
        {estado && (
          <span className={`tq-selo${estado === 'Transcrevendo' ? ' vivo' : ''}`} role="status">
            {estado}
          </span>
        )}
        <button
          type="button"
          className="tq-icone"
          onClick={onHome}
          title="Abrir o TaqCiti numa aba"
          aria-label="Abrir o TaqCiti numa aba"
        >
          <Icon name="sparkles" size={15} />
        </button>
      </div>
    </header>
  );
}
