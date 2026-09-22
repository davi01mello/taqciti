/**
 * A seção Reuniões.
 *
 * (Documentos mora em `Documentos.tsx` e Conexões em `Conexoes.tsx` — as duas
 * deixaram de ser listas de reuniões disfarçadas e passaram a ter estado
 * próprio: uma tem coleção e editor, a outra tem sincronização e tokens.)
 *
 * Todas leem dados REAIS ou dizem que não há dado nenhum. Nenhuma inventa lista
 * de exemplo — o protótipo de referência tinha "EXEMPLO DE HISTÓRICO" porque
 * precisava se mostrar com o storage vazio; aqui o storage é de verdade, e
 * vazio é uma informação, não um buraco para preencher com ficção.
 */
import { useEffect, useRef, useState } from 'react';
import type { MeetingRecord } from '@/shared/types/domain';
import type { EstadoDaGravacao, Nota } from '@/features/annotations/notes';
import type { DocumentoGuardado } from '@/features/documents/store';
import { documentosDaReuniao } from '@/features/documents/store';
import { usePlatform } from '@/shared/platform/context';
import { downloadTranscript, transcriptToText } from '@/features/history/export';
import { Icon } from '@/shared/ui/Icon';
import { TranscriptView } from '@/shared/ui/TranscriptView';
import {
  countWords,
  formatCount,
  formatDate,
  formatDurationHuman,
  formatTime,
  hostName,
} from '@/shared/ui/format';
import { GerarDocumento } from './GerarDocumento';
import { NotasDaReuniao } from './NotasDaReuniao';
import { useCabemDuasColunas } from './useLargura';

function Cabecalho({ titulo, sub }: { titulo: string; sub: string }) {
  return (
    <header className="tq-pagina-topo">
      <h1>{titulo}</h1>
      <p>{sub}</p>
    </header>
  );
}

function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="tq-vazio">{children}</p>;
}


// ---------------------------------------------------------------- Reuniões

interface ReunioesProps {
  registros: MeetingRecord[];
  carregado: boolean;
  /**
   * Qual reunião está aberta. Controlado por quem renderiza a HOME, e não um
   * estado interno, porque a navegação vem de fora também: um documento leva à
   * reunião de origem, e a URL pode pedir uma reunião específica.
   */
  abertaId: string | null;
  onAbrir: (id: string | null) => void;
  notas: Record<string, Nota>;
  rascunhosNota: Record<string, string>;
  estadoDaNota: EstadoDaGravacao;
  documentos: DocumentoGuardado[];
  onEscreverNota: (meetingId: string, texto: string) => void;
  onAbrirDocumento: (id: string) => void;
}

export function PaginaReunioes({
  registros,
  carregado,
  abertaId,
  onAbrir,
  notas,
  rascunhosNota,
  estadoDaNota,
  documentos,
  onEscreverNota,
  onAbrirDocumento,
}: ReunioesProps) {
  // A reunião pode sumir (apagada aqui mesmo, ou noutra aba): a tela volta
  // para a lista em vez de ficar num detalhe sem dono.
  const aberta = abertaId ? (registros.find((r) => r.id === abertaId) ?? null) : null;
  useEffect(() => {
    if (abertaId && carregado && !aberta) onAbrir(null);
  }, [abertaId, carregado, aberta, onAbrir]);

  if (aberta) {
    return (
      <DetalheDaReuniao
        key={aberta.id}
        registro={aberta}
        nota={rascunhosNota[aberta.id] ?? notas[aberta.id]?.texto ?? ''}
        estadoDaNota={estadoDaNota}
        documentos={documentosDaReuniao(documentos, aberta.id)}
        onEscreverNota={onEscreverNota}
        onAbrirDocumento={onAbrirDocumento}
        onVoltar={() => onAbrir(null)}
      />
    );
  }

  return (
    <div className="tq-pagina">
      <Cabecalho titulo="Reuniões" sub="O que a extensão capturou neste computador." />

      {!carregado ? (
        <Vazio>Lendo o histórico…</Vazio>
      ) : registros.length === 0 ? (
        <Vazio>
          Nenhuma reunião guardada ainda. Entre numa reunião do Google Meet, aceite
          registrar quando o TaqCiti perguntar, e a transcrição aparece aqui.
        </Vazio>
      ) : (
        <div className="tq-lista">
          {registros.map((r) => (
            <button
              key={r.id}
              type="button"
              className="tq-item"
              onClick={() => onAbrir(r.id)}
            >
              <span>
                <strong>{r.title}</strong>
                <small>
                  {formatDate(r.startedAt)} · {formatTime(r.startedAt)} ·{' '}
                  {formatDurationHuman(r.durationSeconds)} · {r.segments.length} trecho
                  {r.segments.length === 1 ? '' : 's'}
                  {notas[r.id] && ' · com nota'}
                  {documentosDaReuniao(documentos, r.id).length > 0 && ' · com documento'}
                  {r.status === 'recording' ? ' · gravando' : ''}
                </small>
              </span>
              <Icon name="arrowUpRight" size={16} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Uma reunião por inteiro: transcrição de um lado, notas do outro.
 *
 * ── A composição ────────────────────────────────────────────────────────
 *
 * Cabeçalho compacto — título editável e uma linha de metadados —, e abaixo
 * duas colunas de topo alinhado, separadas por espaço e não por moldura: a
 * transcrição com dois terços da largura, as notas com o resto. As notas estão
 * sempre ali, inclusive vazias; não há botão para revelá-las.
 *
 * Em largura estreita as duas não cabem sem sufocar, e aí elas se ALTERNAM —
 * nunca duas colunas espremidas. As duas continuam montadas, e a escondida sai
 * do alcance do teclado: é o que preserva a posição de leitura e o que já foi
 * escrito ao trocar (ver `useLargura.ts`).
 *
 * ── O que saiu daqui ─────────────────────────────────────────────────────
 *
 * As ações eram quatro botões soltos no meio da tela, logo abaixo do título, e
 * "Apagar" era um deles — do mesmo tamanho de "Copiar". Agora são uma faixa
 * discreta no rodapé, e apagar mora no menu secundário, atrás de um gesto a
 * mais, com o texto dizendo o que vai junto.
 */
function DetalheDaReuniao({
  registro,
  nota,
  estadoDaNota,
  documentos,
  onEscreverNota,
  onAbrirDocumento,
  onVoltar,
}: {
  registro: MeetingRecord;
  nota: string;
  estadoDaNota: EstadoDaGravacao;
  documentos: DocumentoGuardado[];
  onEscreverNota: (meetingId: string, texto: string) => void;
  onAbrirDocumento: (id: string) => void;
  onVoltar: () => void;
}) {
  const platform = usePlatform();
  const cabemDuas = useCabemDuasColunas();
  const [titulo, setTitulo] = useState(registro.title);
  const [foco, setFoco] = useState<'transcricao' | 'notas'>(() =>
    new URLSearchParams(window.location.search).get('foco') === 'notas'
      ? 'notas'
      : 'transcricao',
  );
  const [menuAberto, setMenuAberto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // O título vindo do storage manda enquanto ninguém está editando aqui.
  useEffect(() => setTitulo(registro.title), [registro.title]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 2600);
    return () => clearTimeout(t);
  }, [aviso]);

  const palavras = countWords(registro.segments.map((s) => s.text));

  const copiar = () => {
    void navigator.clipboard
      .writeText(transcriptToText(registro.segments))
      .then(() => setAviso('Transcrição copiada'))
      .catch(() => setAviso('Não foi possível copiar'));
  };

  return (
    <div className="tq-pagina tq-reuniao">
      <button type="button" className="tq-voltar" onClick={onVoltar}>
        <Icon name="chevron" size={14} className="tq-girado" />
        Reuniões
      </button>

      <input
        className="tq-titulo-editavel"
        value={titulo}
        maxLength={200}
        spellCheck={false}
        aria-label="Nome da reunião"
        onChange={(e) => setTitulo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setTitulo(registro.title);
            e.currentTarget.blur();
          }
        }}
        onBlur={() => {
          const novo = titulo.trim();
          if (novo.length > 0 && novo !== registro.title) {
            // Renomear não mexe em vínculo nenhum: nota, marcações, prints e
            // documentos apontam para o `id`, nunca para o nome.
            void platform.send({
              type: 'ui/history/rename',
              id: registro.id,
              title: novo,
            });
          } else {
            setTitulo(registro.title);
          }
        }}
      />

      <p className="tq-meta">
        {formatDate(registro.startedAt)} · {formatTime(registro.startedAt)} ·{' '}
        {formatDurationHuman(registro.durationSeconds)}
        {palavras > 0 && ` · ${formatCount(palavras)} palavras`}
        {registro.participants.length > 0 &&
          ` · ${registro.participants.map((p) => p.name).join(', ')}`}
      </p>

      {/* O acesso aos documentos desta reunião: uma linha de atalhos, e não
          mais um painel permanentemente aberto disputando a largura. */}
      {documentos.length > 0 && (
        <div className="tq-vinculados" aria-label="Documentos desta reunião">
          <Icon name="doc" size={13} />
          {documentos.map((d) => (
            <button
              key={d.id}
              type="button"
              className="tq-chip"
              title={`Abrir "${d.title}"`}
              onClick={() => onAbrirDocumento(d.id)}
            >
              {d.title}
            </button>
          ))}
        </div>
      )}

      {!cabemDuas && (
        <div className="tq-alternar" role="tablist" aria-label="O que mostrar">
          <button
            type="button"
            role="tab"
            aria-selected={foco === 'transcricao'}
            className={foco === 'transcricao' ? 'atual' : undefined}
            onClick={() => setFoco('transcricao')}
          >
            Transcrição
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={foco === 'notas'}
            className={foco === 'notas' ? 'atual' : undefined}
            onClick={() => setFoco('notas')}
          >
            Notas
          </button>
        </div>
      )}

      <div className={`tq-reuniao-corpo${cabemDuas ? ' lado-a-lado' : ''}`}>
        <Coluna
          rotulo="Transcrição"
          ativa={cabemDuas || foco === 'transcricao'}
          empilhada={!cabemDuas}
        >
          <div className="tq-coluna-topo">
            <h2>Transcrição</h2>
          </div>
          {/* `scroll={false}`: quem rola é a coluna, e só ela. Uma caixa de
              rolagem a mais aqui dentro seria a caixa aninhada que engole a
              roda do mouse. */}
          <div className="tq-coluna-corpo">
            <TranscriptView
              neutral
              segments={registro.segments}
              selfName={hostName(registro.participants)}
              emptyMessage="Nenhuma fala foi capturada nesta reunião."
              scroll={false}
            />
          </div>
        </Coluna>

        <Coluna
          rotulo="Notas da reunião"
          ativa={cabemDuas || foco === 'notas'}
          empilhada={!cabemDuas}
        >
          <NotasDaReuniao
            meetingId={registro.id}
            tituloDaReuniao={registro.title}
            texto={nota}
            estado={estadoDaNota}
            onEscrever={onEscreverNota}
          />
        </Coluna>
      </div>

      <div className="tq-rodape-acoes">
        <button
          type="button"
          className="tq-acao"
          title="Copiar a transcrição"
          onClick={copiar}
        >
          <Icon name="doc" size={14} />
          Copiar
        </button>
        <button
          type="button"
          className="tq-acao"
          title="Baixar a transcrição em .txt"
          onClick={() => downloadTranscript(registro)}
        >
          <Icon name="arrowDown" size={14} />
          Baixar .txt
        </button>

        <GerarDocumento registro={registro} onAbrirDocumento={onAbrirDocumento} />

        <div className="tq-menu-secundario">
          <button
            type="button"
            className="tq-acao tq-acao-icone"
            aria-haspopup="true"
            aria-expanded={menuAberto}
            title="Mais ações"
            aria-label="Mais ações"
            onClick={() => setMenuAberto((v) => !v)}
          >
            <Icon name="chevron" size={14} />
          </button>
          {menuAberto && (
            <div className="tq-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="perigo"
                onClick={() => {
                  setMenuAberto(false);
                  setConfirmando(true);
                }}
              >
                Apagar reunião
              </button>
            </div>
          )}
        </div>

        {aviso && (
          <p className="tq-aviso-curto" role="status">
            {aviso}
          </p>
        )}
      </div>

      {confirmando && (
        <div className="tq-confirma" role="alertdialog" aria-label="Apagar do histórico?">
          {/*
           * O texto diz o que VAI JUNTO. Antes ele falava só da transcrição, e
           * a nota, as marcações e os prints sumiam em silêncio no mesmo
           * clique. Ver `features/annotations/vinculos.ts`.
           */}
          <p>
            <strong>Apagar &ldquo;{registro.title}&rdquo;?</strong> A transcrição sai
            deste computador para sempre, e com ela as notas, as marcações de trecho e os
            prints desta reunião.
            {documentos.length > 0 && (
              <>
                {' '}
                Os {documentos.length}{' '}
                {documentos.length === 1 ? 'documento' : 'documentos'} gerados a partir
                dela <strong>continuam</strong> em Documentos, sem o vínculo.
              </>
            )}
          </p>
          <div className="tq-acoes">
            <button
              type="button"
              className="tq-acao tq-acao-perigo"
              onClick={() => {
                setConfirmando(false);
                void platform
                  .send({ type: 'ui/history/delete', id: registro.id })
                  .then((resposta) => {
                    if (
                      resposta &&
                      typeof resposta === 'object' &&
                      'ok' in resposta &&
                      resposta.ok
                    )
                      onVoltar();
                    else
                      setAviso(
                        'Não foi possível apagar. Encerre a captura e tente novamente.',
                      );
                  })
                  .catch(() => setAviso('Não foi possível apagar a reunião.'));
              }}
            >
              Apagar
            </button>
            <button
              type="button"
              className="tq-acao"
              onClick={() => setConfirmando(false)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Uma das duas colunas.
 *
 * Em largura estreita as duas ficam montadas e empilhadas no mesmo lugar; a
 * que não está em uso some por `visibility` e recebe `inert`. `visibility`, e
 * não `display: none`, porque `display: none` destrói a caixa e leva junto o
 * `scrollTop` — a posição de leitura da transcrição. `inert` porque uma coluna
 * invisível que ainda recebe o Tab é pior do que uma coluna ausente.
 */
function Coluna({
  rotulo,
  ativa,
  empilhada,
  children,
}: {
  rotulo: string;
  ativa: boolean;
  empilhada: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current as (HTMLElement & { inert?: boolean }) | null;
    if (el) el.inert = !ativa;
  }, [ativa]);

  return (
    <section
      ref={ref}
      className={`tq-coluna${empilhada ? ' empilhada' : ''}${ativa ? ' ativa' : ''}`}
      aria-label={rotulo}
      aria-hidden={!ativa}
    >
      {children}
    </section>
  );
}
