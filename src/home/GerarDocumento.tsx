/**
 * Gerar um documento a partir de uma reunião — e GUARDÁ-LO.
 *
 * ── O que mudou, e por quê ───────────────────────────────────────────────
 *
 * O fluxo antigo gerava e entregava: o arquivo ia para o Google Docs ou caía na
 * pasta de downloads, e acabava ali. Nada ficava na extensão. Quem fechasse a
 * aba não tinha como voltar ao documento, e a seção "Documentos" listava
 * REUNIÕES como substituto.
 *
 * Agora o destino primeiro é a coleção local (ver `features/documents/store.ts`).
 * A entrega continua existindo — baixar, mandar para o Docs — mas como AÇÃO, e
 * não como único destino possível.
 *
 * ── A ordem importa: salvar antes de dizer que salvou ────────────────────
 *
 * "Salvo" só aparece depois de a gravação ter resolvido. Se ela falhar, o
 * conteúdo continua na tela, com "tentar de novo" e "baixar" à mão — o texto
 * gerado não pode ser descartado por causa de uma cota de storage, e uma falha
 * não pode se parecer com sucesso.
 *
 * ── O que NÃO mudou ──────────────────────────────────────────────────────
 *
 * A geração em si: mesmo `requestGeneration`, mesmo `/api/generate`, mesmo
 * formulário de lacunas. Nenhuma arquitetura de agente nova entrou aqui.
 *
 * As perguntas continuam ANTES da gravação: responder depois exigiria
 * regenerar o HTML de um documento já guardado. O que ficar sem resposta vira
 * marcação `**[A preencher: …]**` no conteúdo — e, como o conteúdo agora é
 * editável no editor, dá para completar à mão depois.
 */
import { useEffect, useRef, useState } from 'react';
import { protegerEdicao } from '@/shared/services/navigation';
import { textoDoHtml } from '@/document/textoDoHtml';
import type { MeetingRecord } from '@/shared/types/domain';
import { Icon } from '@/shared/ui/Icon';
import { guardarDocumento, type DocumentoGuardado } from '@/features/documents/store';
import {
  DOCUMENT_TYPE_LABELS,
  entregarDocumento,
  nomeDoDocumento,
  requestGeneration,
  type DocumentType,
  type GenerationResult,
} from '@/document/generateDocument';
import { aplicarRespostas, type Resposta } from '@/document/answers';
import { QuestionsForm } from '@/document/QuestionsForm';
import {
  baixarComoHtml,
  baixarComoPdf,
  baixarComoTexto,
} from '@/document/baixarDocumento';
import { oauthConfigurado } from '@/document/googleDocs';

/** Só os dois tipos com pipeline de verdade no servidor (ver server/lib/templates/). */
const TIPOS: ReadonlyArray<{ tipo: DocumentType; rotulo: string }> = [
  { tipo: 'ata', rotulo: DOCUMENT_TYPE_LABELS.ata },
  { tipo: 'x1', rotulo: DOCUMENT_TYPE_LABELS.x1 },
];

type Sucesso = Extract<GenerationResult, { status: 'success' }>;

/** O que sobrou de uma geração que ainda não conseguiu ser guardada. */
interface Pendente {
  formato?: 'markdown' | 'texto';
  tipo: DocumentType;
  titulo: string;
  conteudo: string;
  html: string;
  pdf?: string;
}

type Estado =
  | { fase: 'parado' }
  | { fase: 'gerando'; tipo: DocumentType }
  | { fase: 'perguntando'; tipo: DocumentType; geracao: Sucesso; aplicando: boolean }
  | { fase: 'salvando'; tipo: DocumentType }
  | { fase: 'salvo'; documento: DocumentoGuardado; pendente: Pendente }
  | { fase: 'erroNaGeracao'; mensagem: string }
  | { fase: 'erroAoSalvar'; pendente: Pendente; mensagem: string };

interface Props {
  registro: MeetingRecord;
  /** Abrir o documento recém-salvo, na seção Documentos. */
  onAbrirDocumento: (id: string) => void;
}

export function GerarDocumento({ registro, onAbrirDocumento }: Props) {
  const [aberto, setAberto] = useState(false);
  const [estado, setEstado] = useState<Estado>({ fase: 'parado' });
  const [avisoRespostas, setAvisoRespostas] = useState('');
  const caixaRef = useRef<HTMLDivElement>(null);

  const ocupado =
    estado.fase === 'gerando' ||
    estado.fase === 'salvando' ||
    estado.fase === 'perguntando';

  useEffect(
    () => protegerEdicao(async () => !ocupado && estado.fase !== 'erroAoSalvar'),
    [ocupado, estado.fase],
  );
  useEffect(() => {
    const antesDeFechar = (e: BeforeUnloadEvent) => {
      if (ocupado || estado.fase === 'erroAoSalvar') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', antesDeFechar);
    return () => window.removeEventListener('beforeunload', antesDeFechar);
  }, [ocupado, estado.fase]);

  // Clicar fora fecha — menos durante uma geração, para não abandonar um
  // pedido que o servidor já está processando (e já cobrou).
  useEffect(() => {
    if (!aberto) return;
    const aoApontar = (e: PointerEvent) => {
      if (ocupado) return;
      if (caixaRef.current && e.composedPath().includes(caixaRef.current)) return;
      setAberto(false);
    };
    document.addEventListener('pointerdown', aoApontar, { capture: true });
    return () =>
      document.removeEventListener('pointerdown', aoApontar, { capture: true });
  }, [aberto, ocupado]);

  /** Guarda o documento. É AQUI que "salvo" passa a ser verdade. */
  const salvar = async (pendente: Pendente) => {
    setEstado({ fase: 'salvando', tipo: pendente.tipo });
    try {
      const documento = await guardarDocumento({
        title: pendente.titulo,
        content: pendente.conteudo,
        formato: pendente.formato ?? 'markdown',
        meetingId: registro.id,
        tipo: DOCUMENT_TYPE_LABELS[pendente.tipo],
        html: pendente.html,
        origem: 'gerado',
      });
      setAberto(false);
      setEstado({ fase: 'salvo', documento, pendente });
    } catch {
      // O texto gerado NÃO se perde por causa de uma falha de gravação.
      setEstado({
        fase: 'erroAoSalvar',
        pendente,
        mensagem:
          'O documento foi gerado, mas não foi possível salvá-lo neste computador. ' +
          'Ele continua aqui: tente salvar de novo ou baixe o arquivo.',
      });
    }
  };

  const finalizar = (
    tipo: DocumentType,
    geracao: Sucesso,
    html: string,
    pdf: string | undefined,
    conteudo: string,
  ) => {
    void salvar({ tipo, titulo: geracao.title, conteudo, html, pdf });
  };

  const gerar = (tipo: DocumentType) => {
    if (ocupado) return;
    setAvisoRespostas('');
    setEstado({ fase: 'gerando', tipo });

    void requestGeneration(registro, tipo).then((geracao) => {
      if (geracao.status !== 'success') {
        setEstado({ fase: 'erroNaGeracao', mensagem: geracao.message });
        return;
      }
      if (geracao.questions.length > 0) {
        setAberto(false);
        setEstado({ fase: 'perguntando', tipo, geracao, aplicando: false });
        return;
      }
      finalizar(tipo, geracao, geracao.html, geracao.pdf, geracao.content);
    });
  };

  const responder = (tipo: DocumentType, geracao: Sucesso, respostas: Resposta[]) => {
    if (respostas.length === 0) {
      finalizar(tipo, geracao, geracao.html, geracao.pdf, geracao.content);
      return;
    }
    setEstado({ fase: 'perguntando', tipo, geracao, aplicando: true });

    void aplicarRespostas({
      documentType: tipo,
      documentData: geracao.documentData,
      gaps: geracao.gaps,
      answers: respostas,
      title: geracao.title,
    }).then((resultado) => {
      if (resultado.status !== 'success') {
        setAvisoRespostas(
          'Não foi possível aplicar as respostas ao documento. Elas foram preservadas no fim do texto editável.',
        );
        const adicionais = respostas
          .map(
            (r) =>
              `${geracao.questions.find((q) => q.id === r.questionId)?.question ?? r.questionId}\n${r.answer}`,
          )
          .join('\n\n');
        finalizar(
          tipo,
          geracao,
          '',
          undefined,
          `${geracao.content}\n\n## Respostas informadas\n\n${adicionais}`,
        );
        return;
      }
      void salvar({
        tipo,
        titulo: geracao.title,
        html: resultado.html,
        pdf: resultado.pdf,
        conteudo: textoDoHtml(resultado.html),
        formato: 'texto',
      });
    });
  };

  const baixar = (pendente: Pendente) => {
    const nome = nomeDoDocumento(registro, pendente.tipo, undefined);
    if (pendente.pdf) baixarComoPdf(pendente.pdf, nome);
    else if (pendente.html) baixarComoHtml(pendente.html, nome);
    else
      baixarComoTexto(
        pendente.conteudo,
        nome,
        pendente.formato === 'texto' ? 'txt' : 'md',
      );
  };

  const enviarAoDocs = async (pendente: Pendente) => {
    const nome = nomeDoDocumento(registro, pendente.tipo, undefined);
    const entrega = await entregarDocumento(
      pendente.html,
      nome,
      pendente.tipo,
      pendente.pdf,
    );
    if (entrega.via === 'docs') {
      void chrome.tabs.create({ url: entrega.url });
    }
  };

  return (
    <div className="tq-gerar" ref={caixaRef}>
      <button
        type="button"
        className="tq-acao"
        aria-haspopup="true"
        aria-expanded={aberto}
        title="Gerar um documento a partir desta reunião"
        onClick={() => setAberto((v) => !v)}
      >
        <Icon name="sparkles" size={14} />
        Gerar documento
      </button>

      {aberto && (
        <div className="tq-gerar-menu" role="menu">
          {TIPOS.map(({ tipo, rotulo }) => {
            const emCurso =
              (estado.fase === 'gerando' || estado.fase === 'salvando') &&
              estado.tipo === tipo;
            return (
              <button
                key={tipo}
                type="button"
                role="menuitem"
                aria-disabled={ocupado}
                className={ocupado ? 'ocupado' : undefined}
                onClick={() => gerar(tipo)}
              >
                {emCurso
                  ? estado.fase === 'salvando'
                    ? 'Salvando…'
                    : `Gerando ${rotulo}…`
                  : rotulo}
              </button>
            );
          })}
          {estado.fase === 'erroNaGeracao' && (
            <p className="tq-gerar-erro">{estado.mensagem}</p>
          )}
        </div>
      )}

      {estado.fase === 'perguntando' && (
        <div className="tq-gerar-perguntas">
          <QuestionsForm
            perguntas={estado.geracao.questions}
            salvando={estado.aplicando}
            ampla
            onConfirmar={(respostas) => responder(estado.tipo, estado.geracao, respostas)}
            onPular={() =>
              finalizar(
                estado.tipo,
                estado.geracao,
                estado.geracao.html,
                estado.geracao.pdf,
                estado.geracao.content,
              )
            }
          />
        </div>
      )}

      {/* Só depois de a gravação ter resolvido. */}
      {estado.fase === 'salvo' && (
        <div className="tq-gerar-resultado" role="status">
          <p>
            <Icon name="check" size={13} />
            <strong>Salvo em Documentos</strong> · {estado.documento.title}
          </p>
          {avisoRespostas && <p role="alert">{avisoRespostas}</p>}
          <div className="tq-acoes">
            <button
              type="button"
              className="tq-acao"
              onClick={() => onAbrirDocumento(estado.documento.id)}
            >
              Abrir documento
            </button>
            <button
              type="button"
              className="tq-acao"
              onClick={() => baixar(estado.pendente)}
            >
              <Icon name="arrowDown" size={13} />
              Baixar
            </button>
            {estado.pendente.html && oauthConfigurado() && (
              <button
                type="button"
                className="tq-acao"
                onClick={() => void enviarAoDocs(estado.pendente)}
              >
                Enviar ao Google Docs
              </button>
            )}
            <button
              type="button"
              className="tq-acao"
              onClick={() => setEstado({ fase: 'parado' })}
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {estado.fase === 'erroAoSalvar' && (
        <div className="tq-gerar-resultado falhou" role="alert">
          <p>{estado.mensagem}</p>
          <div className="tq-acoes">
            <button
              type="button"
              className="tq-acao"
              onClick={() => void salvar(estado.pendente)}
            >
              Tentar salvar de novo
            </button>
            <button
              type="button"
              className="tq-acao"
              onClick={() => baixar(estado.pendente)}
            >
              <Icon name="arrowDown" size={13} />
              Baixar
            </button>
            <button
              type="button"
              className="tq-acao"
              onClick={() => {
                if (
                  window.confirm(
                    'Descartar este resultado que ainda não foi salvo? Baixe uma cópia antes de sair.',
                  )
                )
                  setEstado({ fase: 'parado' });
              }}
            >
              Descartar resultado
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
