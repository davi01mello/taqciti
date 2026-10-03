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
import {
  countWords,
  formatCount,
  formatDate,
  formatDurationHuman,
  formatOffset,
  formatTime,
  hostName,
  speakerLabel,
} from '@/shared/ui/format';
import { Carta, IconeEnviar } from './Carta';
import { GerarDocumento } from './GerarDocumento';
import { NotasDaReuniao } from './NotasDaReuniao';
import { PrintsDaReuniao } from './PrintsDaReuniao';
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
  onApagarNota: (meetingId: string) => Promise<boolean>;
  onAbrirDocumento: (id: string) => void;
  /** A carta manda para Conexões quando o canal não está conectado. */
  onIrConexoes?: () => void;
  /** "Criar documento" em texto livre: o pedido segue para a conversa. */
  onPedirDocumento?: (registro: MeetingRecord, texto: string) => void;
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
  onApagarNota,
  onAbrirDocumento,
  onIrConexoes = () => {},
  onPedirDocumento = () => {},
}: ReunioesProps) {
  // A reunião pode sumir (apagada aqui mesmo, ou noutra aba): a tela volta
  // para a lista em vez de ficar num detalhe sem dono.
  const aberta = abertaId ? (registros.find((r) => r.id === abertaId) ?? null) : null;
  useEffect(() => {
    if (abertaId && carregado && !aberta) onAbrir(null);
  }, [abertaId, carregado, aberta, onAbrir]);
  const platform = usePlatform();
  /** A reunião cuja lixeira foi apertada na lista: a pergunta ocupa o lugar dela. */
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [erroDaLista, setErroDaLista] = useState('');

  const apagar = (id: string) => {
    void platform
      .send({ type: 'ui/history/delete', id })
      .then((resposta) => {
        if (resposta && typeof resposta === 'object' && 'ok' in resposta && resposta.ok) {
          setConfirmandoId(null);
        } else {
          setErroDaLista('Não foi possível apagar. Encerre a captura e tente novamente.');
        }
      })
      .catch(() => setErroDaLista('Não foi possível apagar a reunião.'));
  };

  if (aberta) {
    return (
      <DetalheDaReuniao
        key={aberta.id}
        registro={aberta}
        nota={rascunhosNota[aberta.id] ?? notas[aberta.id]?.texto ?? ''}
        estadoDaNota={estadoDaNota}
        documentos={documentosDaReuniao(documentos, aberta.id)}
        onEscreverNota={onEscreverNota}
        onApagarNota={onApagarNota}
        onAbrirDocumento={onAbrirDocumento}
        onVoltar={() => onAbrir(null)}
        onIrConexoes={onIrConexoes}
        onPedirDocumento={onPedirDocumento}
      />
    );
  }

  const grupos = agruparPorSemana(registros);

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
        <>
          {erroDaLista && <p role="alert">{erroDaLista}</p>}
          {grupos.map(([nomeDoGrupo, doGrupo]) => (
          <section key={nomeDoGrupo} className="tq-grupo" aria-label={nomeDoGrupo}>
          <h2 className="tq-grupo-titulo">{nomeDoGrupo}</h2>
          <div className="tq-lista">
          {doGrupo.map((r) => {
            const vinculados = documentosDaReuniao(documentos, r.id).length;

            /* A pergunta ocupa o LUGAR do item, e não uma caixa por cima: é o
               que mantém óbvio qual reunião está prestes a sumir. O texto diz o
               que VAI JUNTO — ver `features/annotations/vinculos.ts`. */
            if (confirmandoId === r.id) {
              return (
                <div
                  key={r.id}
                  className="tq-confirma"
                  role="alertdialog"
                  aria-label={`Apagar "${r.title}"?`}
                >
                  <p>
                    <strong>Apagar &ldquo;{r.title}&rdquo;?</strong> A transcrição sai
                    deste computador para sempre, e com ela as notas, as marcações de
                    trecho e os prints desta reunião.
                    {vinculados > 0 && (
                      <>
                        {' '}
                        {vinculados === 1
                          ? 'O documento gerado a partir dela '
                          : `Os ${vinculados} documentos gerados a partir dela `}
                        <strong>{vinculados === 1 ? 'continua' : 'continuam'}</strong> em
                        Documentos, sem o vínculo.
                      </>
                    )}
                  </p>
                  <div className="tq-acoes">
                    <button
                      type="button"
                      className="tq-acao tq-acao-perigo"
                      onClick={() => apagar(r.id)}
                    >
                      Apagar
                    </button>
                    <button
                      type="button"
                      className="tq-acao"
                      onClick={() => setConfirmandoId(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={r.id} className="tq-item-linha">
                <button type="button" className="tq-item tq-linha-reuniao" onClick={() => onAbrir(r.id)}>
                  <strong>{r.title}</strong>
                  <span className="tq-meta">
                    {r.status === 'recording' ? (
                      <span className="tq-ao-vivo-txt">Ao vivo agora</span>
                    ) : (
                      <span>{formatDate(r.startedAt)}</span>
                    )}
                    <span className="tq-relogio">{formatTime(r.startedAt)}</span>
                    {r.status !== 'recording' && (
                      <span>{formatDurationHuman(r.durationSeconds)}</span>
                    )}
                  </span>
                  {(r.segments.length > 0 || notas[r.id] || vinculados > 0) && (
                    <small>
                      {r.segments.length > 0 && `“${r.segments.at(-1)!.text}”`}
                      {notas[r.id] && <span className="tq-linha-selo">com nota</span>}
                      {vinculados > 0 && <span className="tq-linha-selo">com documento</span>}
                    </small>
                  )}
                </button>
                {/* A que está sendo gravada não se apaga: a captura ainda escreve nela. */}
                {r.status !== 'recording' && (
                  <button
                    type="button"
                    className="tq-item-apagar"
                    title={`Apagar "${r.title}"`}
                    aria-label={`Apagar "${r.title}"`}
                    onClick={() => {
                      setErroDaLista('');
                      setConfirmandoId(r.id);
                    }}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </div>
            );
          })}
          </div>
          </section>
          ))}
        </>
      )}
    </div>
  );
}

/** Esta semana e antes: a lista longa lê por tempo, e não como uma fila só. */
function agruparPorSemana(registros: MeetingRecord[]): Array<[string, MeetingRecord[]]> {
  const corte = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentes = registros.filter((r) => r.startedAt >= corte);
  const antigas = registros.filter((r) => r.startedAt < corte);
  return [
    ['Esta semana', recentes] as [string, MeetingRecord[]],
    ['Antes', antigas] as [string, MeetingRecord[]],
  ].filter(([, lista]) => lista.length > 0);
}

/**
 * A transcrição, na leitura da HOME.
 *
 * Quem fala: VOCÊ em verde, os OUTROS em roxo — a mesma regra da sidebar e do
 * chat. A cor nunca vem sozinha: o "(Eu)" continua escrito ao lado do nome.
 * Falas seguidas da mesma pessoa não repetem o nome.
 *
 * `content-visibility` em cada fala, no lugar de virtualizar: a reunião de duas
 * horas rola tão leve quanto a de cinco minutos, e o Ctrl+F continua achando.
 */
function FalasDaReuniao({ registro }: { registro: MeetingRecord }) {
  if (registro.segments.length === 0)
    return <p className="tq-vazio">Nenhuma fala foi capturada nesta reunião.</p>;
  const eu = hostName(registro.participants);
  return (
    <ol className="tq-falas" aria-label="Falas da reunião">
      {registro.segments.map((s, i) => {
        const nome = s.speaker ?? 'Alguém';
        const rotulo = speakerLabel(nome, eu);
        const seguida = i > 0 && (registro.segments[i - 1]?.speaker ?? 'Alguém') === nome;
        return (
          <li
            key={`${s.captionId}:${i}`}
            className={`tq-fala${rotulo !== nome ? ' voce' : ''}${seguida ? ' seguida' : ''}`}
            style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 56px' }}
          >
            <div className="tq-fala-quem">
              <b>{rotulo}</b>
              <span>{formatOffset(s.startOffsetMs)}</span>
            </div>
            <p className="tq-fala-texto">{s.text}</p>
          </li>
        );
      })}
    </ol>
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
  onApagarNota,
  onAbrirDocumento,
  onVoltar,
  onIrConexoes,
  onPedirDocumento,
}: {
  registro: MeetingRecord;
  nota: string;
  estadoDaNota: EstadoDaGravacao;
  documentos: DocumentoGuardado[];
  onEscreverNota: (meetingId: string, texto: string) => void;
  onApagarNota: (meetingId: string) => Promise<boolean>;
  onAbrirDocumento: (id: string) => void;
  onVoltar: () => void;
  onIrConexoes: () => void;
  onPedirDocumento: (registro: MeetingRecord, texto: string) => void;
}) {
  const platform = usePlatform();
  const [carta, setCarta] = useState<{
    assunto: string;
    corpo: string;
    anexo: string | null;
  } | null>(null);
  const cabemDuas = useCabemDuasColunas();
  const [titulo, setTitulo] = useState(registro.title);
  const cancelouTitulo = useRef(false);
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
            // O `blur` roda o `onBlur` NESTE mesmo evento, antes de o estado
            // desfeito valer: sem a marca, o Escape salvava a edição.
            cancelouTitulo.current = true;
            setTitulo(registro.title);
            e.currentTarget.blur();
          }
        }}
        onBlur={() => {
          if (cancelouTitulo.current) {
            cancelouTitulo.current = false;
            return;
          }
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
        <span>{formatDate(registro.startedAt)}</span>
        <span className="tq-relogio">{formatTime(registro.startedAt)}</span>
        <span>{formatDurationHuman(registro.durationSeconds)}</span>
        {palavras > 0 && <span>{formatCount(palavras)} palavras</span>}
        {registro.participants.length > 0 && (
          <span>{registro.participants.map((p) => p.name).join(', ')}</span>
        )}
      </p>

      {/*
       * As AÇÕES, em pílulas neutras lado a lado — o desenho da HOME antiga.
       * Nenhuma "chama" atenção: a cor fica para o que a ação produz (a
       * caixinha da IA, a carta). O que cada uma abre nasce logo abaixo da
       * fileira, na largura toda, e não num menu flutuante.
       */}
      <div className="tq-rodape-acoes tq-acoes-reuniao">
        <button
          type="button"
          className="tq-acao tq-pilula"
          title="Copiar a transcrição"
          onClick={copiar}
        >
          <Icon name="copy" size={15} />
          Copiar
        </button>
        <button
          type="button"
          className="tq-acao tq-pilula"
          title="Baixar a transcrição em .txt"
          onClick={() => downloadTranscript(registro)}
        >
          <Icon name="arrowDown" size={15} />
          Baixar .txt
        </button>

        <GerarDocumento
          registro={registro}
          onAbrirDocumento={onAbrirDocumento}
          onPedirLivre={(texto) => onPedirDocumento(registro, texto)}
          onEnviar={(d) =>
            setCarta({
              assunto: d.title,
              corpo: `Oi,\n\nSegue “${d.title}”, da reunião ${registro.title}.\n\n`,
              anexo: `${d.title}.pdf`,
            })
          }
        />

        <button
          type="button"
          className="tq-acao tq-pilula"
          aria-expanded={carta !== null}
          onClick={() =>
            setCarta((atual) =>
              atual
                ? null
                : {
                    assunto: registro.title,
                    corpo: `Oi,\n\nSegue a transcrição da reunião ${registro.title}, de ${formatDate(registro.startedAt)}.\n\n`,
                    anexo: 'Transcrição.txt',
                  },
            )
          }
        >
          <IconeEnviar />
          Enviar
        </button>

        {/* A que está sendo gravada não se apaga, como na lista: a captura
            ainda escreve nela, e o pedido seria recusado depois de confirmado. */}
        {registro.status !== 'recording' && (
          <div className="tq-menu-secundario">
            <button
              type="button"
              className="tq-acao tq-pilula tq-acao-icone"
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
        )}

        {aviso && (
          <p className="tq-aviso-curto" role="status">
            {aviso}
          </p>
        )}

        {carta && (
          <Carta
            key={`${carta.assunto}:${carta.anexo ?? ''}`}
            assunto={carta.assunto}
            corpo={carta.corpo}
            anexo={carta.anexo}
            onFechar={() => setCarta(null)}
            onIrConexoes={onIrConexoes}
          />
        )}
      </div>

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
            <FalasDaReuniao registro={registro} />
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
            onApagar={onApagarNota}
          />
          <PrintsDaReuniao meetingId={registro.id} titulo={registro.title} />
        </Coluna>
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
                {documentos.length === 1
                  ? 'O documento gerado a partir dela '
                  : `Os ${documentos.length} documentos gerados a partir dela `}
                <strong>{documentos.length === 1 ? 'continua' : 'continuam'}</strong> em
                Documentos, sem o vínculo.
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
