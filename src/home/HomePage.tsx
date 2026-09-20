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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHistoryState } from '@/features/history/useHistory';
import { useMeetingState } from '@/shared/hooks/useMeetingState';
import { Icon } from '@/shared/ui/Icon';
import { AssistantView } from './AssistantView';
import { ConversasMenu } from './ConversasMenu';
import { PaginaConexoes, PaginaDocumentos, PaginaReunioes } from './Paginas';
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

function abrirPagina(caminho: string): void {
  window.open(chrome.runtime.getURL(caminho), '_blank', 'noopener');
}

/** Chave do rascunho enquanto a conversa nova ainda não existe no storage. */
const RASCUNHO_NOVA = '\u0000nova';

export function HomePage() {
  const pedido = useMemo(() => lerPedidoDaHome(window.location.search), []);

  const [secao, setSecao] = useState<Secao>(pedido.secao);
  const [navAberta, setNavAberta] = useState(false);
  const [pausadoPeloUsuario, setPausado] = useState(false);
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

  const { records, loaded } = useHistoryState();
  const meeting = useMeetingState();
  const { animando, movimentoReduzido, motivo } = useAnimacao(pausadoPeloUsuario);

  useEffect(() => observarConversas(setConversas), []);

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
      <header className="tq-topo">
        <div className="tq-brand" aria-label="TaqCiti">
          <img src={chrome.runtime.getURL('brand/taqciti-mark.png')} alt="" draggable={false} />
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

      <main className="tq-main">
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
            inicial={pedido.recordId}
            onGerar={(id) =>
              abrirPagina(`src/document/index.html?meetingId=${encodeURIComponent(id)}`)
            }
          />
        )}

        {secao === 'documentos' && (
          <PaginaDocumentos
            registros={records}
            carregado={loaded}
            onGerar={(id) =>
              abrirPagina(`src/document/index.html?meetingId=${encodeURIComponent(id)}`)
            }
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
