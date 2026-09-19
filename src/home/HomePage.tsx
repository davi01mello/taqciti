/**
 * A HOME do TaqCiti: uma aba inteira do navegador.
 *
 * ── O que decide o que aparece ─────────────────────────────────────────────
 *
 * Quatro seções, uma de cada vez, e nenhuma rota de verdade: a aba é um
 * destino só, e trocar de seção não deveria empilhar histórico do navegador
 * (voltar aqui significa "voltar para a página anterior", não "voltar da
 * aba Documentos"). Por isso é estado local, e não `location`.
 *
 * ── A sincronia que importa ────────────────────────────────────────────────
 *
 * O estado da onda vem do estado REAL da reunião, via `useMeetingState`. Com
 * captura acontecendo (`phase === 'recording'`) a onda ganha amplitude e
 * velocidade; sem captura ela respira devagar. Nada aqui "escuta" microfone —
 * a extensão lê legendas do Meet, e é a existência dessa captura que a onda
 * reflete.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHistoryState } from '@/features/history/useHistory';
import { useMeetingState } from '@/shared/hooks/useMeetingState';
import { Icon } from '@/shared/ui/Icon';
import { AssistantView } from './AssistantView';
import { PaginaConexoes, PaginaDocumentos, PaginaReunioes } from './Paginas';
import { PointerLayer } from './PointerLayer';
import { SideNav, type Secao } from './SideNav';
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

export function HomePage() {
  const [secao, setSecao] = useState<Secao>('assistente');
  const [navAberta, setNavAberta] = useState(false);
  const [pausadoPeloUsuario, setPausado] = useState(false);
  const [pulso, setPulso] = useState(0);

  const [conversas, setConversas] = useState<Conversation[]>([]);
  const [conversaId, setConversaId] = useState<string | null>(null);
  /** "Nova conversa" é um estado, não um id: a conversa ainda não existe no
   *  storage, e só passa a existir quando a primeira mensagem for gravada. */
  const [iniciandoNova, setIniciandoNova] = useState(false);
  const [gravando, setGravando] = useState(false);

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

  const estadoDaOnda: EstadoDaOnda = gravando
    ? 'processando'
    : meeting.phase === 'recording'
      ? 'captando'
      : 'repouso';

  const enviar = useCallback(
    async (texto: string, anexos: string[]) => {
      setGravando(true);
      try {
        const id = await acrescentarMensagem(conversa?.id ?? null, {
          texto,
          attachments: anexos,
        });
        setConversaId(id);
        setIniciandoNova(false);
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
      <WaveField
        estado={estadoDaOnda}
        animando={animando}
        pulso={pulso}
        discreta={secao !== 'assistente'}
      />

      <header className="tq-topo">
        <div className="tq-brand">
          Taq<span>Citi</span>
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
        </div>
      </header>

      <SideNav
        ativa={secao}
        aberta={navAberta}
        onAbrir={setNavAberta}
        onIr={(s) => {
          setSecao(s);
          setNavAberta(false);
        }}
      />

      <main className="tq-main">
        {secao === 'assistente' && (
          <AssistantView
            conversa={conversa}
            gravando={gravando}
            onEnviar={(texto, anexos) => void enviar(texto, anexos)}
            onNova={() => {
              setIniciandoNova(true);
              setConversaId(null);
            }}
            onPulso={emitirPulso}
          />
        )}

        {secao === 'reunioes' && (
          <PaginaReunioes
            registros={records}
            carregado={loaded}
            onAbrirTranscricao={(id) =>
              abrirPagina(`src/sidepanel/index.html?view=history&record=${encodeURIComponent(id)}`)
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
