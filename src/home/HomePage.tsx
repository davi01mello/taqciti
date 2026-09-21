/**
 * A HOME do TaqCiti — a página principal do produto.
 *
 * ── O que ela é agora ──────────────────────────────────────────────────────
 *
 * O clique no ícone da extensão abre esta tela, e "Abrir numa aba" também. Não
 * há mais popup nem histórico em tela cheia disputando o papel: o que aquelas
 * telas faziam mora aqui dentro, na navegação lateral, com os mesmos dados.
 * A única outra superfície do produto é a sidebar de reunião, que só existe
 * durante uma reunião, dentro do Meet.
 *
 * ── O que decide o que aparece ─────────────────────────────────────────────
 *
 * Quatro seções, uma de cada vez, e nenhuma rota de verdade: a aba é um destino
 * só, e trocar de seção não deveria empilhar histórico do navegador (voltar
 * aqui significa "voltar para a página anterior", não "voltar da aba
 * Documentos"). Por isso é estado local — semeado uma vez pela query string,
 * que é como um link consegue apontar para uma reunião. Ver `rota.ts`.
 *
 * ── A onda, e o que ela responde ───────────────────────────────────────────
 *
 * Três estados, todos ligados a algo que está de fato acontecendo:
 *
 *   escrita   — o campo está em foco ou recebendo texto;
 *   captando  — há captura de legenda acontecendo AGORA, noutra aba;
 *   repouso   — o resto, inclusive logo depois de um envio bem-sucedido.
 *
 * Nada aqui "escuta" microfone. E a onda é uma camada de fundo: não intercepta
 * clique, seleção nem rolagem (ver `pointer-events` em `home.css`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistoryState } from '@/features/history/useHistory';
import { useMeetingState } from '@/shared/hooks/useMeetingState';
import {
  criarGravadorDeNota,
  observarNotas,
  type EstadoDaGravacao,
  type Nota,
} from '@/features/annotations/notes';
import { observarDocumentos, type DocumentoGuardado } from '@/features/documents/store';
import { prepararSaida, protegerEdicao } from '@/shared/services/navigation';
import { Brasas } from '@/shared/ui/Brasas';
import { Icon } from '@/shared/ui/Icon';
import { AssistantView } from './AssistantView';
import { ConversasMenu } from './ConversasMenu';
import { PaginaDocumentos } from './Documentos';
import { PaginaReunioes } from './Paginas';
import { PaginaConexoes } from './Conexoes';
import { PointerLayer } from './PointerLayer';
import { lerPedidoDaHome, type Secao } from './rota';
import { SideNav } from './SideNav';
import { useAnimacao } from './useAnimacao';
import { WaveField, type EstadoDaOnda } from './WaveField';
import {
  acrescentarMensagem,
  observarConversas,
  type Conversation,
} from './conversations';

/** Chave do rascunho enquanto a conversa nova ainda não existe no storage. */
const RASCUNHO_NOVA = '\u0000nova';

export function HomePage() {
  const pedido = useMemo(() => lerPedidoDaHome(window.location.search), []);

  const [secao, definirSecao] = useState<Secao>(pedido.secao);
  const [erroNavegacao, setErroNavegacao] = useState('');
  const navegar = useCallback(async (acao: () => void) => {
    if (await prepararSaida()) {
      setErroNavegacao('');
      acao();
    } else
      setErroNavegacao('Conclua a geração ou tente salvar as alterações antes de sair.');
  }, []);
  const setSecao = (valor: Secao) => {
    void navegar(() => definirSecao(valor));
  };
  const [navAberta, setNavAberta] = useState(false);
  const [pausadoPeloUsuario, setPausado] = useState(false);
  /** As brasas do fundo, e não a animação inteira — ver o botão ao lado do de pausar. */
  const [brasasVisiveis, setBrasasVisiveis] = useState(true);
  const [pulso, setPulso] = useState(0);

  const [conversas, setConversas] = useState<Conversation[]>([]);
  const [conversaId, setConversaId] = useState<string | null>(null);
  /** "Nova conversa" é um estado, não um id: a conversa ainda não existe no
   *  storage, e só passa a existir quando a primeira mensagem for gravada.
   *  É isso que faz criar uma conversa nova NÃO apagar a anterior. */
  const [iniciandoNova, setIniciandoNova] = useState(false);
  const [menuConversas, setMenuConversas] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [escrevendo, setEscrevendo] = useState(false);
  /** Um rascunho por conversa: alternar não pode comer o que estava escrito. */
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({});

  /*
   * O que a navegação entre seções precisa lembrar.
   *
   * Sobem para cá porque a navegação atravessa as seções nos DOIS sentidos:
   * de uma reunião para o documento gerado a partir dela, e do documento de
   * volta para a reunião de origem. Com o estado dentro de cada seção, cada
   * ida dessas voltaria para a lista.
   */
  const [reuniaoAberta, setReuniaoAberta] = useState<string | null>(pedido.recordId);
  const [documentoAberto, setDocumentoAberto] = useState<string | null>(null);

  const [notas, setNotas] = useState<Record<string, Nota>>({});
  const [documentos, setDocumentos] = useState<DocumentoGuardado[]>([]);
  const [documentosCarregados, setDocumentosCarregados] = useState(false);
  const [erroDocumentos, setErroDocumentos] = useState(false);
  const [tentativaLeitura, setTentativaLeitura] = useState(0);

  const { records, loaded } = useHistoryState();
  const meeting = useMeetingState();
  const { animando, movimentoReduzido, motivo } = useAnimacao(pausadoPeloUsuario);

  useEffect(() => observarConversas(setConversas), []);
  useEffect(() => observarNotas(setNotas), []);
  useEffect(
    () =>
      observarDocumentos(
        (lista) => {
          setDocumentos(lista);
          setDocumentosCarregados(true);
          setErroDocumentos(false);
        },
        () => setErroDocumentos(true),
      ),
    [tentativaLeitura],
  );

  // ---------- notas ----------

  /*
   * O rascunho e o gravador moram aqui, e não na coluna de notas.
   *
   * A coluna alterna com a transcrição em largura estreita, e a seção inteira
   * desmonta ao navegar para Documentos — nos dois casos um estado lá dentro
   * perderia a frase pela metade. O gravador fica fora do React pelo mesmo
   * motivo de sempre (ver `features/annotations/notes.ts`): a última tecla não
   * pode morrer junto com o componente.
   */
  const [estadoDaNota, setEstadoDaNota] = useState<EstadoDaGravacao>('parado');
  const [rascunhosNota, setRascunhosNota] = useState<Record<string, string>>({});
  const gravadorDeNota = useRef(criarGravadorDeNota(setEstadoDaNota));

  useEffect(() => {
    const atual = gravadorDeNota.current;
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

  useEffect(
    () =>
      protegerEdicao(
        async () =>
          !gravadorDeNota.current.temPendente() ||
          (await gravadorDeNota.current.descarregar()),
      ),
    [],
  );

  const escreverNota = useCallback((meetingId: string, texto: string) => {
    setRascunhosNota((atual) => ({ ...atual, [meetingId]: texto }));
    gravadorDeNota.current.agendar(meetingId, texto);
  }, []);

  const abrirDocumento = useCallback(
    (id: string) => {
      void navegar(() => {
        setDocumentoAberto(id);
        definirSecao('documentos');
      });
    },
    [navegar],
  );

  const irParaReuniao = useCallback(
    (meetingId: string) => {
      void navegar(() => {
        setReuniaoAberta(meetingId);
        definirSecao('reunioes');
      });
    },
    [navegar],
  );

  // Sem conversa escolhida, a mais recente é a conversa. Só isso já dá
  // continuidade entre sessões sem inventar um conceito de "conversa ativa"
  // guardado à parte.
  const conversa = useMemo(
    () =>
      iniciandoNova
        ? null
        : (conversas.find((c) => c.id === conversaId) ?? conversas[0] ?? null),
    [conversas, conversaId, iniciandoNova],
  );

  const chaveRascunho = conversa?.id ?? RASCUNHO_NOVA;
  const rascunho = rascunhos[chaveRascunho] ?? '';
  const definirRascunho = useCallback(
    (texto: string) => setRascunhos((atual) => ({ ...atual, [chaveRascunho]: texto })),
    [chaveRascunho],
  );

  const estadoDaOnda: EstadoDaOnda = escrevendo
    ? 'escrita'
    : meeting.phase === 'recording'
      ? 'captando'
      : 'repouso';

  const enviar = useCallback(
    async (texto: string, anexos: string[]): Promise<boolean> => {
      setGravando(true);
      setErroEnvio(null);
      try {
        const id = await acrescentarMensagem(conversa?.id ?? null, {
          texto,
          attachments: anexos,
        });
        setConversaId(id);
        setIniciandoNova(false);
        /*
         * A onda volta ao repouso no envio, mesmo com o campo ainda em foco: o
         * estado "escrevendo" acabou quando a mensagem saiu. A próxima tecla
         * digitada o liga de novo, pelo `onChange` do campo.
         */
        setEscrevendo(false);
        return true;
      } catch {
        setErroEnvio('Não foi possível guardar a mensagem neste computador.');
        return false;
      } finally {
        setGravando(false);
      }
    },
    [conversa],
  );

  const emitirPulso = useCallback((forca: number) => {
    // Valor novo a cada gesto para o efeito do canvas disparar; o próprio
    // canvas cuida do decaimento.
    setPulso(forca + Math.random() * 1e-6);
  }, []);

  const rotuloPausa = movimentoReduzido
    ? 'Movimento reduzido pelo sistema'
    : pausadoPeloUsuario
      ? 'Retomar movimento'
      : 'Pausar movimento';

  return (
    <div className={`tq-home${navAberta ? ' nav-aberta' : ''}`}>
      {brasasVisiveis && <Brasas pausado={!animando} />}
      <header className="tq-topo">
        <div className="tq-brand" aria-label="TaqCiti">
          <img
            src={chrome.runtime.getURL('brand/taqciti-mark.png')}
            alt=""
            draggable={false}
          />
          <span aria-hidden="true">
            Taq<em>Citi</em>
          </span>
        </div>
        <div className="tq-topo-direita">
          {meeting.phase === 'recording' && (
            <span className="tq-captando" role="status">
              capturando legendas
            </span>
          )}
          <button
            type="button"
            className={`tq-motion${brasasVisiveis ? '' : ' desligado'}`}
            aria-label={brasasVisiveis ? 'Desligar brasas do fundo' : 'Ligar brasas do fundo'}
            aria-pressed={!brasasVisiveis}
            title={brasasVisiveis ? 'Desligar brasas do fundo' : 'Ligar brasas do fundo'}
            onClick={() => setBrasasVisiveis((v) => !v)}
          >
            <Icon name="sparkles" size={15} />
          </button>
          <button
            type="button"
            className="tq-motion"
            aria-label={rotuloPausa}
            aria-pressed={!animando}
            disabled={movimentoReduzido}
            title={
              movimentoReduzido
                ? 'O sistema está configurado para reduzir movimento.'
                : rotuloPausa
            }
            onClick={() => setPausado((v) => !v)}
          >
            <Icon name={animando ? 'pause' : 'play'} size={15} />
          </button>

          {/* O canto superior direito é o das conversas. O controle de
              movimento fica ao lado, não por baixo: dois botões pequenos
              cabem sem virar uma barra. */}
          <ConversasMenu
            conversas={conversas}
            atualId={iniciandoNova ? null : (conversa?.id ?? null)}
            aberto={menuConversas}
            onAbrir={setMenuConversas}
            onNova={() => {
              setIniciandoNova(true);
              setConversaId(null);
              setSecao('assistente');
            }}
            onEscolher={(id) => {
              setConversaId(id);
              setIniciandoNova(false);
              setSecao('assistente');
            }}
          />
        </div>
      </header>

      <SideNav ativa={secao} aberta={navAberta} onAbrir={setNavAberta} onIr={setSecao} />

      <main
        className={`tq-main${secao === 'reunioes' && reuniaoAberta ? ' tq-main-reuniao' : ''}`}
      >
        {erroNavegacao && (
          <p className="tq-aviso" role="alert">
            {erroNavegacao}
          </p>
        )}
        {/*
         * O fundo vive AQUI, dentro do fluxo, e não preso na janela: é o que
         * faz a onda sair da tela ao subir para reler o histórico. Ela é a
         * última camada, e não intercepta nada.
         */}
        <WaveField
          estado={estadoDaOnda}
          animando={animando}
          pulso={pulso}
          discreta={secao !== 'assistente'}
        />

        {secao === 'assistente' && (
          <AssistantView
            conversa={conversa}
            gravando={gravando}
            erro={erroEnvio}
            rascunho={rascunho}
            onRascunho={definirRascunho}
            onEnviar={enviar}
            onEscrevendo={setEscrevendo}
            onPulso={emitirPulso}
          />
        )}

        {secao === 'reunioes' && (
          <PaginaReunioes
            registros={records}
            carregado={loaded}
            abertaId={reuniaoAberta}
            onAbrir={(id) => void navegar(() => setReuniaoAberta(id))}
            notas={notas}
            rascunhosNota={rascunhosNota}
            estadoDaNota={estadoDaNota}
            documentos={documentos}
            onEscreverNota={escreverNota}
            onAbrirDocumento={abrirDocumento}
          />
        )}

        {secao === 'documentos' && (
          <PaginaDocumentos
            erro={erroDocumentos}
            onTentarLer={() => setTentativaLeitura((v) => v + 1)}
            documentos={documentos}
            carregado={documentosCarregados}
            registros={records}
            abertoId={documentoAberto}
            onAbrir={setDocumentoAberto}
            onIrParaReuniao={irParaReuniao}
          />
        )}

        {secao === 'conexoes' && <PaginaConexoes registros={records} />}
      </main>

      {motivo === 'preferencia' && (
        <p className="tq-nota-movimento" role="status">
          Movimento reduzido: a onda está desenhada, mas parada.
        </p>
      )}

      <PointerLayer comMovimento={!movimentoReduzido} />
    </div>
  );
}
