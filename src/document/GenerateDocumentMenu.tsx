/**
 * Botão "Gerar Documento" com os dois tipos disponíveis (Ata, X1) numa lista
 * direta — sem menu de área/drill-down, que fazia sentido com 5 tipos e não
 * faz mais com 2.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/shared/ui/Button';
import {
  DOCUMENT_TYPE_LABELS,
  entregarDocumento,
  nomeDoDocumento,
  requestGeneration,
  type DocumentoPronto,
  type DocumentType,
  type Entrega,
  type GenerationResult,
  type GenerationSource,
} from './generateDocument';
import { aplicarRespostas, type Resposta } from './answers';
import { QuestionsForm } from './QuestionsForm';

// Só os dois documentos com pipeline de verdade (ver server/lib/templates/).
// daily/planning/review continuam existindo no servidor como stub genérico —
// só pararam de aparecer aqui.
const MENU_ITEMS: { documentType: DocumentType; label: string }[] = [
  { documentType: 'ata', label: DOCUMENT_TYPE_LABELS.ata },
  { documentType: 'x1', label: DOCUMENT_TYPE_LABELS.x1 },
];

type Generating =
  | { status: 'idle' }
  // Duas etapas visíveis: a segunda leva segundos e, sem rótulo próprio, o
  // botão parece travado justamente quando já deu tudo certo no servidor.
  | { status: 'loading'; documentType: DocumentType; etapa: 'gerando' | 'entregando' }
  // Entre gerar e entregar: o que a IA não conseguiu determinar.
  | {
      status: 'perguntando';
      documentType: DocumentType;
      generation: Extract<GenerationResult, { status: 'success' }>;
      salvando: boolean;
    }
  | { status: 'error'; documentType: DocumentType; message: string }
  // O download não abre aba nenhuma. Sem um aviso, o clique parece não ter
  // feito nada — o arquivo caiu na pasta de downloads em silêncio.
  | { status: 'baixado'; arquivo: string };

/**
 * Abre a ata recém-criada.
 *
 * `chrome.tabs.create` quando existe (janela da extensão, painel lateral) e
 * `window.open` no content script, onde a API de abas não está disponível. É
 * o mesmo par de contextos em que este menu já vive.
 */
function abrirDocumento(url: string): void {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    void chrome.tabs.create({ url });
    return;
  }
  window.open(url, '_blank', 'noopener');
}

interface GenerateDocumentMenuProps {
  source: GenerationSource;
  /**
   * Chamado mais de uma vez pelo MESMO documento: assim que ele existe, e de
   * novo quando a entrega termina. O painel de resultado precisa aparecer
   * antes da entrega — ela leva segundos, e esconder o documento até lá faria
   * o usuário esperar por algo que já está pronto.
   */
  onGenerated: (documento: DocumentoPronto) => void;
  className?: string;
}

/** A geração crua vira o estado que o painel de resultado consome. */
function comoDocumento(
  generation: Extract<GenerationResult, { status: 'success' }>,
): DocumentoPronto {
  return {
    documentType: generation.documentType,
    title: generation.title,
    content: generation.content,
    html: generation.html,
    documentData: generation.documentData,
    questions: generation.questions,
    gaps: generation.gaps,
    projectName: generation.metadata.projectName,
  };
}

export function GenerateDocumentMenu({
  source,
  onGenerated,
  className = '',
}: GenerateDocumentMenuProps) {
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState<Generating>({ status: 'idle' });
  const wrapperRef = useRef<HTMLDivElement>(null);

  // `perguntando` conta como ocupado: um clique fora ali chamaria `reset()` e
  // jogaria fora um documento que o servidor já gerou e já cobrou.
  const busy = generating.status === 'loading' || generating.status === 'perguntando';

  const reset = () => {
    setOpen(false);
    setGenerating({ status: 'idle' });
  };

  // Clicar fora fecha — mas não durante uma geração em andamento, pra não
  // abandonar o pedido sem o usuário ver se deu certo ou não.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (busy) return;
      if (wrapperRef.current && event.composedPath().includes(wrapperRef.current)) return;
      reset();
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, [open, busy]);

  // Fecha no Escape. Capture no document, e não no wrapper, pelo mesmo
  // motivo de sempre: dispara antes de qualquer handler de Escape em fase de
  // bolha (ex.: o painel do Meet se recolhendo com o mesmo Escape), e
  // stopPropagation evita os dois picarem a mesma tecla.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      event.stopPropagation();
      reset();
    };
    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [open, busy]);

  /** Último passo: manda o HTML para o Docs ou para o download. */
  const finalizar = async (
    documentType: DocumentType,
    generation: Extract<GenerationResult, { status: 'success' }>,
    html: string,
    /** O que voltou de `/api/answers`, quando o usuário respondeu algo. */
    atualizacao?: Partial<DocumentoPronto>,
  ) => {
    setGenerating({ status: 'loading', documentType, etapa: 'entregando' });

    const entrega: Entrega = await entregarDocumento(
      html,
      nomeDoDocumento(source, documentType, generation.metadata.projectName),
      documentType,
    );

    // O painel passa a mostrar para onde o documento foi — e, se houve
    // respostas, o estado já atualizado por elas.
    onGenerated({ ...comoDocumento(generation), ...atualizacao, html, entrega });

    if (entrega.via === 'docs') {
      abrirDocumento(entrega.url);
      reset();
      return;
    }

    if (entrega.via === 'download') {
      // Fecha o menu mas mantém o aviso: o download não abre aba, e sem isso
      // o clique parece não ter feito nada.
      setOpen(false);
      setGenerating({ status: 'baixado', arquivo: entrega.arquivo });
      return;
    }

    // Falha da entrega, não da geração: o texto está na tela atrás do menu.
    setGenerating({
      status: 'error',
      documentType,
      message: `Documento gerado, mas a entrega falhou. ${entrega.message}`,
    });
  };

  const generate = (documentType: DocumentType) => {
    if (busy) return;
    setGenerating({ status: 'loading', documentType, etapa: 'gerando' });

    void requestGeneration(source, documentType).then((generation) => {
      if (generation.status !== 'success') {
        setGenerating({ status: 'error', documentType, message: generation.message });
        return;
      }

      // O documento existe. Ele aparece na tela ANTES da entrega — a entrega
      // leva segundos, e o servidor já produziu (e já cobrou) o texto.
      onGenerated(comoDocumento(generation));

      // Há o que perguntar? Pergunta ANTES de entregar: responder depois
      // geraria uma segunda versão do arquivo no Drive.
      if (generation.questions.length > 0) {
        // O menu sai de cena: o formulário ocupa o mesmo lugar, e os dois
        // abertos ao mesmo tempo se sobreporiam.
        setOpen(false);
        setGenerating({ status: 'perguntando', documentType, generation, salvando: false });
        return;
      }

      void finalizar(documentType, generation, generation.html);
    });
  };

  /**
   * Aplica as respostas e entrega o documento atualizado.
   *
   * Nenhum modelo roda nisso: as perguntas são sobre campos ausentes, a
   * resposta é o valor do campo, e o HTML é reconstruído da estrutura. Se o
   * servidor falhar aqui, entrega-se o documento COMO ESTAVA em vez de perder
   * a geração — as lacunas continuam marcadas nele.
   */
  const responder = (
    documentType: DocumentType,
    generation: Extract<GenerationResult, { status: 'success' }>,
    respostas: Resposta[],
  ) => {
    if (respostas.length === 0) {
      void finalizar(documentType, generation, generation.html);
      return;
    }

    setGenerating({ status: 'perguntando', documentType, generation, salvando: true });

    void aplicarRespostas({
      documentType,
      documentData: generation.documentData,
      gaps: generation.gaps,
      answers: respostas,
      title: generation.title,
    }).then((resultado) => {
      if (resultado.status !== 'success') {
        // Entrega o documento COMO ESTAVA em vez de perder a geração — as
        // lacunas continuam marcadas nele, e o painel de resultado deixa
        // responder de novo.
        void finalizar(documentType, generation, generation.html);
        return;
      }
      void finalizar(documentType, generation, resultado.html, {
        documentData: resultado.documentData,
        questions: resultado.questions,
        gaps: resultado.gaps,
      });
    });
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <Button
        variant="primary"
        className="w-full"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => (open ? reset() : setOpen(true))}
      >
        Gerar Documento
      </Button>

      {generating.status === 'perguntando' && (
        <QuestionsForm
          perguntas={generating.generation.questions}
          salvando={generating.salvando}
          onConfirmar={(respostas) =>
            responder(generating.documentType, generating.generation, respostas)
          }
          onPular={() =>
            void finalizar(
              generating.documentType,
              generating.generation,
              generating.generation.html,
            )
          }
        />
      )}

      {generating.status === 'baixado' && (
        // Instrução, e não só confirmação: o arquivo sozinho não vira Google
        // Doc, e quem baixou precisa saber que o próximo passo existe.
        <div className="glass absolute left-0 right-0 top-[calc(100%+8px)] z-50 rounded-panel p-3 shadow-float animate-entry">
          <p className="text-body font-semibold text-foreground">Documento baixado</p>
          <p className="mt-1 text-caption text-muted">{generating.arquivo}</p>
          <p className="mt-2 text-caption text-muted">
            Arraste o arquivo para o Google Drive e abra com Documentos Google — ele
            vira um documento formatado.
          </p>
          <button
            type="button"
            onClick={() => setGenerating({ status: 'idle' })}
            className="mt-3 rounded-control px-3 py-1.5 text-caption font-semibold text-foreground transition-colors duration-200 ease-flow hover:bg-white/[0.07]"
          >
            Entendi
          </button>
        </div>
      )}

      {open && (
        <div className="glass absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-panel p-1.5 shadow-float animate-entry">
          {MENU_ITEMS.map((item) => {
            const emAndamento =
              generating.status === 'loading' && generating.documentType === item.documentType;
            const label = !emAndamento
              ? item.label
              : generating.etapa === 'entregando'
                ? 'Preparando o documento...'
                : `Gerando ${item.label}...`;

            return (
              <button
                key={item.documentType}
                type="button"
                aria-disabled={busy}
                onClick={() => generate(item.documentType)}
                className={`flex w-full items-center rounded-control px-3 py-2.5 text-left text-body font-semibold text-foreground transition-colors duration-200 ease-flow hover:bg-white/[0.07] ${busy ? 'pointer-events-none opacity-50' : ''}`}
              >
                {label}
              </button>
            );
          })}

          {generating.status === 'error' && (
            <p className="mt-1 px-3 pb-1 text-caption text-danger">{generating.message}</p>
          )}
        </div>
      )}
    </div>
  );
}
