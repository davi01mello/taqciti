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
 * A geração em si: mesmo `requestGeneration`, mesmo `/api/generate`.
 *
 * ── As perguntas não param o documento ───────────────────────────────────
 *
 * O documento é gerado e salvo DIRETO. O que a transcrição não trouxe sai
 * como marcação `**[A preencher: …]**` no conteúdo. As perguntas da geração
 * vão para uma conversa nova com o Taq (`abrirConversaDoTaq`): é ele quem
 * pergunta, na interface de conversa, e quem atualiza o texto editável quando a
 * pessoa responder. O HTML/PDF guardados continuam os da geração; o download
 * do editor leva o texto atualizado.
 */
import { useEffect, useRef, useState } from 'react';
import { protegerEdicao } from '@/shared/services/navigation';
import type { MeetingRecord } from '@/shared/types/domain';
import { Icon } from '@/shared/ui/Icon';
import { guardarDocumento, type DocumentoGuardado } from '@/features/documents/store';
import {
  DOCUMENT_TYPE_LABELS,
  entregarDocumento,
  nomeDoDocumento,
  requestGeneration,
  type DocumentType,
} from '@/document/generateDocument';
import {
  baixarComoHtml,
  baixarComoPdf,
  baixarComoTexto,
} from '@/document/baixarDocumento';
import { oauthConfigurado } from '@/document/googleDocs';
import { abrirConversaDoTaq } from '@/home/conversations';
import { CATALOGO_DE_DOCUMENTOS } from '@/features/documents/catalogo';

/**
 * Os tipos vêm do CATÁLOGO — o mesmo que o Taq oferece (ver
 * `features/documents/catalogo.ts`). São os dois com pipeline de verdade no
 * servidor, e um teste de lá confere que o catálogo e os templates batem.
 */
const TIPOS: ReadonlyArray<{ tipo: DocumentType; rotulo: string; finalidade: string }> =
  CATALOGO_DE_DOCUMENTOS.map((t) => ({
    tipo: t.id,
    rotulo: t.nome,
    finalidade: t.finalidade,
  }));


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
  /** Quantas perguntas foram para a conversa com o Taq, na última geração. */
  const [perguntasNoTaq, setPerguntasNoTaq] = useState(0);
  const caixaRef = useRef<HTMLDivElement>(null);

  const ocupado = estado.fase === 'gerando' || estado.fase === 'salvando';

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
  const salvar = async (pendente: Pendente): Promise<DocumentoGuardado | null> => {
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
      return documento;
    } catch {
      // O texto gerado NÃO se perde por causa de uma falha de gravação.
      setEstado({
        fase: 'erroAoSalvar',
        pendente,
        mensagem:
          'O documento foi gerado, mas não foi possível salvá-lo neste computador. ' +
          'Ele continua aqui: tente salvar de novo ou baixe o arquivo.',
      });
      return null;
    }
  };

  /*
   * Gerar é gerar e SALVAR, sem parar para perguntar.
   *
   * O que a transcrição não trouxe sai no documento como "A preencher" (é o que
   * a geração já produz quando não há resposta). As perguntas que a geração
   * fez não viram formulário na frente do documento: vão para uma conversa
   * nova com o Taq, que atualiza o documento quando a pessoa responder lá.
   */
  const gerar = (tipo: DocumentType) => {
    if (ocupado) return;
    setPerguntasNoTaq(0);
    setEstado({ fase: 'gerando', tipo });

    void requestGeneration(registro, tipo).then(async (geracao) => {
      if (geracao.status !== 'success') {
        setEstado({ fase: 'erroNaGeracao', mensagem: geracao.message });
        return;
      }
      const documento = await salvar({
        tipo,
        titulo: geracao.title,
        conteudo: geracao.content,
        html: geracao.html,
        pdf: geracao.pdf,
      });
      if (!documento || geracao.questions.length === 0) return;
      try {
        await abrirConversaDoTaq({
          titulo: `Pendências de ${documento.title}`,
          meetingId: registro.id,
          documento: { id: documento.id, titulo: documento.title },
          texto:
            `Gerei “${documento.title}” e já salvei em Documentos. O que a reunião não ` +
            `deixou claro ficou marcado para preencher. Se souber, me responda aqui que eu ` +
            `atualizo o documento:\n\n` +
            geracao.questions.map((q) => `- ${q.question}`).join('\n'),
        });
        setPerguntasNoTaq(geracao.questions.length);
      } catch {
        /* sem a conversa, o documento continua salvo com as marcações */
      }
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
          {TIPOS.map(({ tipo, rotulo, finalidade }) => {
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
                title={finalidade}
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

      {/* Só depois de a gravação ter resolvido. */}
      {estado.fase === 'salvo' && (
        <div className="tq-gerar-resultado" role="status">
          <p>
            <Icon name="check" size={13} />
            <strong>Salvo em Documentos</strong> · {estado.documento.title}
          </p>
          {perguntasNoTaq > 0 && (
            <p>
              {perguntasNoTaq === 1 ? 'Uma pergunta ficou' : `${perguntasNoTaq} perguntas ficaram`}{' '}
              na conversa com o Taq, na seção Assistente — responda lá que ele atualiza o documento.
            </p>
          )}
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
