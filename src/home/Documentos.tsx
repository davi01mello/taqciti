/**
 * A seção DOCUMENTOS — e o editor deles.
 *
 * ── O que ela era ────────────────────────────────────────────────────────
 *
 * Uma lista de REUNIÕES com um aviso explicando que documentos não eram
 * guardados. Clicar levava para a página de geração, noutra aba. Não havia
 * documento nenhum nesta tela, nem como voltar a um que já tinha sido gerado.
 *
 * ── O que ela é ──────────────────────────────────────────────────────────
 *
 * A coleção de verdade (ver `features/documents/store.ts`): abrir, editar,
 * renomear, salvar, baixar e chegar na reunião de origem. Nenhuma dessas
 * ações fala com o servidor de geração — abrir um documento guardado não pode
 * depender de a IA estar no ar.
 *
 * ── Apagar, nos dois lugares ─────────────────────────────────────────────
 *
 * Na LISTA, um ícone por item: é ali que se percebe que há lixo acumulado, e
 * obrigar a abrir cada documento para removê-lo transformaria uma faxina em
 * uma sequência de idas e voltas. E no EDITOR, no menu secundário, para quem
 * só descobre que não quer o documento depois de lê-lo.
 *
 * Nos dois, a confirmação diz que a reunião de origem não vai junto — o medo
 * de levar a transcrição embora é o que faz alguém deixar a lista crescer.
 *
 * ── O que ela nunca faz ──────────────────────────────────────────────────
 *
 * Inventar registro para a lista não parecer vazia. Documento que só foi
 * baixado num passado sem esta coleção não aparece aqui: a extensão não tem o
 * conteúdo dele, e oferecer "abrir" seria uma promessa vazia.
 */
import { useEffect, useRef, useState } from 'react';
import { protegerEdicao } from '@/shared/services/navigation';
import type { MeetingRecord } from '@/shared/types/domain';
import {
  apagarDocumento,
  lerDocumentos,
  criarGravadorDeDocumento,
  type DocumentoGuardado,
  type EstadoDaGravacaoDoDocumento,
} from '@/features/documents/store';
import { baixarComoTexto } from '@/document/baixarDocumento';
import { Icon } from '@/shared/ui/Icon';
import { formatDate, formatTime } from '@/shared/ui/format';

interface Props {
  documentos: DocumentoGuardado[];
  carregado: boolean;
  erro?: boolean;
  onTentarLer?: () => void;
  registros: MeetingRecord[];
  /** Documento aberto no editor. `null` = a lista. */
  abertoId: string | null;
  onAbrir: (id: string | null) => void;
  /** Ir para a reunião de origem, na seção Reuniões. */
  onIrParaReuniao: (meetingId: string) => void;
}

export function PaginaDocumentos({
  documentos,
  carregado,
  erro,
  onTentarLer,
  registros,
  abertoId,
  onAbrir,
  onIrParaReuniao,
}: Props) {
  const aberto = abertoId ? (documentos.find((d) => d.id === abertoId) ?? null) : null;
  /** O documento da lista cuja remoção está à espera de confirmação. */
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [erroDaLista, setErroDaLista] = useState('');

  // O documento pode sumir (apagado aqui, ou noutra aba): a tela volta para a
  // lista em vez de ficar num editor sem dono.
  useEffect(() => {
    if (abertoId && carregado && !aberto) onAbrir(null);
  }, [abertoId, carregado, aberto, onAbrir]);

  // A confirmação morre com o documento que ela apontava. Sem isto, apagar
  // noutra aba deixaria a pergunta na tela sobre um id que não existe mais.
  useEffect(() => {
    if (confirmandoId && !documentos.some((d) => d.id === confirmandoId))
      setConfirmandoId(null);
  }, [documentos, confirmandoId]);

  if (aberto) {
    return (
      <EditorDeDocumento
        documento={aberto}
        reuniao={
          aberto.meetingId
            ? (registros.find((r) => r.id === aberto.meetingId) ?? null)
            : null
        }
        onVoltar={() => onAbrir(null)}
        onIrParaReuniao={onIrParaReuniao}
      />
    );
  }

  return (
    <div className="tq-pagina">
      <header className="tq-pagina-topo">
        <h1>Documentos</h1>
        <p>O que você gerou e guardou neste computador.</p>
      </header>

      {erro ? (
        <p role="alert">
          Não foi possível ler os documentos.{' '}
          <button className="tq-acao" onClick={onTentarLer}>
            Tentar novamente
          </button>
        </p>
      ) : !carregado ? (
        <p className="tq-vazio">Lendo os documentos…</p>
      ) : documentos.length === 0 ? (
        <p className="tq-vazio">Nenhum documento guardado ainda.</p>
      ) : (
        <div className="tq-lista">
          {erroDaLista && <p role="alert">{erroDaLista}</p>}
          {documentos.map((d) => {
            const reuniao = d.meetingId
              ? (registros.find((r) => r.id === d.meetingId) ?? null)
              : null;

            /* A pergunta ocupa o LUGAR do item, e não uma caixa por cima: é o
               que mantém óbvio qual documento está prestes a sumir. */
            if (confirmandoId === d.id) {
              return (
                <div
                  key={d.id}
                  className="tq-confirma"
                  role="alertdialog"
                  aria-label={`Apagar "${d.title}"?`}
                >
                  <p>
                    <strong>Apagar &ldquo;{d.title}&rdquo;?</strong> O conteúdo sai
                    deste computador para sempre. A reunião de origem não é afetada.
                  </p>
                  <div className="tq-acoes">
                    <button
                      type="button"
                      className="tq-acao tq-acao-perigo"
                      onClick={() => {
                        void apagarDocumento(d.id)
                          .then(() => setConfirmandoId(null))
                          .catch(() =>
                            setErroDaLista('Não foi possível apagar o documento.'),
                          );
                      }}
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
              <div key={d.id} className="tq-item-linha">
                <button type="button" className="tq-item" onClick={() => onAbrir(d.id)}>
                  <span>
                    <strong>{d.title}</strong>
                    <small>
                      {formatDate(d.updatedAt)} · {formatTime(d.updatedAt)}
                      {d.tipo && ` · ${d.tipo}`}
                      {reuniao && ` · de "${reuniao.title}"`}
                      {d.origem === 'demo' && ' · demonstração'}
                    </small>
                  </span>
                  <Icon name="arrowUpRight" size={16} />
                </button>
                <button
                  type="button"
                  className="tq-item-apagar"
                  title={`Apagar "${d.title}"`}
                  aria-label={`Apagar "${d.title}"`}
                  onClick={() => {
                    setErroDaLista('');
                    setConfirmandoId(d.id);
                  }}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * O editor.
 *
 * O CONTEÚDO vem primeiro: é ele que ocupa a tela, e o resto (título, ações,
 * origem) fica em volta sem disputar espaço. Salva sozinho, com respiro entre
 * as teclas, e o estado da gravação aparece discreto ao lado do título —
 * "salvando…", "salvo", ou uma frase clara quando não deu.
 *
 * Nada aqui chama o servidor. Abrir, editar, renomear, salvar e baixar um
 * documento que já existe não pode depender de a geração estar disponível.
 */
function EditorDeDocumento({
  documento,
  reuniao,
  onVoltar,
  onIrParaReuniao,
}: {
  documento: DocumentoGuardado;
  reuniao: MeetingRecord | null;
  onVoltar: () => void;
  onIrParaReuniao: (meetingId: string) => void;
}) {
  const [estado, setEstado] = useState<EstadoDaGravacaoDoDocumento>('parado');
  /*
   * Rascunhos locais do que está sendo digitado.
   *
   * O valor do storage volta pelo observador a cada gravação, e usá-lo direto
   * no campo faria o cursor pular para o fim a cada respiro do gravador. O
   * campo é controlado por estes, e eles nascem do documento aberto.
   */
  const [titulo, setTitulo] = useState(documento.title);
  const [conteudo, setConteudo] = useState(documento.content);
  const [menuAberto, setMenuAberto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [erroAcao, setErroAcao] = useState('');

  const gravador = useRef(criarGravadorDeDocumento(setEstado));
  useEffect(
    () =>
      protegerEdicao(
        async () =>
          !gravador.current.temPendente() || (await gravador.current.descarregar()),
      ),
    [],
  );

  // Trocar de documento sem desmontar o editor: o rascunho pendente do
  // anterior é descarregado antes de os campos passarem a ser do novo.
  const idAnterior = useRef(documento.id);
  useEffect(() => {
    if (idAnterior.current === documento.id && gravador.current.temPendente()) return;
    void gravador.current.descarregar();
    idAnterior.current = documento.id;
    setTitulo(documento.title);
    setConteudo(documento.content);
  }, [documento.id, documento.title, documento.content]);

  /*
   * A última tecla não pode morrer com a página. Sair da seção desmonta este
   * componente, e fechar a aba não avisa ninguém — os dois instantes precisam
   * do mesmo descarregamento.
   */
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

  const escreverTitulo = (valor: string) => {
    setTitulo(valor);
    const limpo = valor.trim();
    // Título vazio não vai para o storage: o documento ficaria sem nome
    // nenhum na lista. O campo continua vazio enquanto se digita.
    if (limpo.length > 0) gravador.current.agendar(documento.id, { title: limpo });
  };

  const escreverConteudo = (valor: string) => {
    setConteudo(valor);
    gravador.current.agendar(documento.id, { content: valor });
  };

  /** Baixa o que está SALVO — e garante isso descarregando antes. */
  const baixar = async () => {
    if (!(await gravador.current.descarregar())) return;
    try {
      const salvo = (await lerDocumentos()).find((d) => d.id === documento.id);
      if (!salvo) throw new Error('ausente');
      baixarComoTexto(
        salvo.content,
        salvo.title,
        salvo.formato === 'texto' ? 'txt' : 'md',
      );
    } catch {
      setErroAcao('Não foi possível ler o documento salvo.');
    }
  };

  return (
    <div className="tq-pagina tq-documento">
      <button
        type="button"
        className="tq-voltar"
        onClick={() =>
          void gravador.current.descarregar().then((ok) => {
            if (ok) onVoltar();
          })
        }
      >
        <Icon name="chevron" size={14} className="tq-girado" />
        Documentos
      </button>

      <div className="tq-documento-topo">
        <input
          className="tq-titulo-editavel"
          value={titulo}
          maxLength={200}
          spellCheck={false}
          aria-label="Nome do documento"
          onChange={(e) => escreverTitulo(e.target.value)}
          onBlur={() => {
            if (titulo.trim().length === 0) setTitulo(documento.title);
          }}
        />
        <span
          className={`tq-notas-estado${estado === 'falhou' ? ' falhou' : ''}`}
          role="status"
        >
          {estado === 'gravando'
            ? 'salvando…'
            : estado === 'salvo'
              ? 'salvo'
              : estado === 'falhou'
                ? 'não foi possível salvar'
                : ''}
        </span>
      </div>

      <p className="tq-meta">
        {documento.tipo ? `${documento.tipo} · ` : ''}
        criado em {formatDate(documento.createdAt)} · atualizado em{' '}
        {formatDate(documento.updatedAt)} às {formatTime(documento.updatedAt)}
        {documento.origem === 'demo' && ' · demonstração'}
      </p>

      {reuniao && (
        <div className="tq-vinculados" aria-label="Reunião de origem">
          <Icon name="history" size={13} />
          <button
            type="button"
            className="tq-chip"
            title={`Abrir "${reuniao.title}"`}
            onClick={() => onIrParaReuniao(reuniao.id)}
          >
            {reuniao.title}
          </button>
        </div>
      )}
      {/* O vínculo existia e a reunião não existe mais: dito, em vez de um
          atalho que não leva a lugar nenhum ou de um silêncio que esconde. */}
      {documento.meetingId && !reuniao && (
        <p className="tq-meta">
          A reunião de origem não está mais no histórico deste computador.
        </p>
      )}

      <textarea
        className="tq-documento-campo"
        value={conteudo}
        aria-label={`Conteúdo de ${documento.title}`}
        placeholder="Escreva o documento…"
        spellCheck
        onChange={(e) => escreverConteudo(e.target.value)}
      />

      {erroAcao && <p role="alert">{erroAcao}</p>}
      <div className="tq-rodape-acoes">
        <button
          type="button"
          className="tq-acao"
          onClick={() => void gravador.current.descarregar()}
        >
          {estado === 'falhou' ? 'Tentar salvar novamente' : 'Salvar'}
        </button>
        {estado === 'falhou' && (
          <button
            type="button"
            className="tq-acao"
            onClick={() =>
              baixarComoTexto(
                conteudo,
                titulo,
                documento.formato === 'texto' ? 'txt' : 'md',
              )
            }
          >
            Baixar rascunho
          </button>
        )}
        <button
          type="button"
          className="tq-acao"
          title="Baixar o documento como arquivo de texto"
          onClick={() => void baixar()}
        >
          <Icon name="arrowDown" size={14} />
          Baixar .{documento.formato === 'texto' ? 'txt' : 'md'}
        </button>

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
                Apagar documento
              </button>
            </div>
          )}
        </div>
      </div>

      {confirmando && (
        <div className="tq-confirma" role="alertdialog" aria-label="Apagar documento?">
          <p>
            <strong>Apagar &ldquo;{documento.title}&rdquo;?</strong> O conteúdo sai deste
            computador para sempre. A reunião de origem não é afetada.
          </p>
          <div className="tq-acoes">
            <button
              type="button"
              className="tq-acao tq-acao-perigo"
              onClick={() => {
                setConfirmando(false);
                gravador.current.cancelar();
                void apagarDocumento(documento.id)
                  .then(() => onVoltar())
                  .catch(() => setErroAcao('Não foi possível apagar o documento.'));
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
