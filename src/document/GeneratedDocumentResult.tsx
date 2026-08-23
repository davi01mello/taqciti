/**
 * O painel do documento depois de gerado.
 *
 * Responde, nesta ordem, as três perguntas que alguém tem ao ver a ata
 * aparecer: **para onde ela foi**, **o que ficou faltando**, e **o que ela
 * diz**.
 *
 * As duas primeiras existiam só como efeito colateral — o arquivo caía na
 * pasta de downloads sem aviso, e as perguntas passavam uma vez e sumiam se a
 * pessoa pulasse. Aqui elas viram superfície: a entrega é declarada e
 * repetível, e o que ficou por responder continua respondível enquanto o
 * documento estiver na tela.
 */
import { useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { aplicarRespostas, type Resposta } from './answers';
import { baixarComoHtml, baixarComoPdf } from './baixarDocumento';
import { oauthConfigurado } from './googleDocs';
import { QuestionsForm } from './QuestionsForm';
import {
  DOCUMENT_TYPE_LABELS,
  nomeDoDocumento,
  type DocumentoPronto,
  type GenerationSource,
} from './generateDocument';

interface GeneratedDocumentResultProps {
  documento: DocumentoPronto;
  /** A reunião de origem — o nome do arquivo sai dela. */
  source: GenerationSource;
  /** Devolve o documento atualizado quando o usuário responde algo. */
  onAtualizado: (documento: DocumentoPronto) => void;
  /**
   * `true` = a página larga de 760px; `false` (padrão) = o painel de 396px.
   * Mesma justificativa de `QuestionsForm` para não ser um breakpoint.
   */
  ampla?: boolean;
}

/** Abre em aba nova onde há API de abas; cai para `window.open` no content
 *  script, que é o outro contexto onde este painel vive. */
function abrir(url: string): void {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    void chrome.tabs.create({ url });
    return;
  }
  window.open(url, '_blank', 'noopener');
}

export function GeneratedDocumentResult({
  documento,
  source,
  onAtualizado,
  ampla = false,
}: GeneratedDocumentResultProps) {
  const [respondendo, setRespondendo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const nome = nomeDoDocumento(source, documento.documentType, documento.projectName);
  const pendentes = documento.questions.length;
  const urlDoDocs = documento.entrega?.via === 'docs' ? documento.entrega.url : '';

  const copiar = async () => {
    await navigator.clipboard.writeText(documento.content);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1600);
  };

  const responder = (respostas: Resposta[]) => {
    if (respostas.length === 0) {
      setRespondendo(false);
      return;
    }
    setSalvando(true);
    setErro(null);

    void aplicarRespostas({
      documentType: documento.documentType,
      documentData: documento.documentData,
      gaps: documento.gaps,
      answers: respostas,
      title: documento.title,
    }).then((resultado) => {
      setSalvando(false);
      if (resultado.status !== 'success') {
        setErro(resultado.message);
        return;
      }
      setRespondendo(false);
      onAtualizado({
        ...documento,
        html: resultado.html,
        pdf: resultado.pdf,
        documentData: resultado.documentData,
        questions: resultado.questions,
        gaps: resultado.gaps,
      });
    });
  };

  return (
    <section className="mt-6 border-t border-borderc pt-6 animate-entry">
      <p className="mb-3 text-caption font-semibold uppercase tracking-wide text-muted">
        Documento gerado — {DOCUMENT_TYPE_LABELS[documento.documentType]}
      </p>
      <h2 className="mb-3 text-title font-bold">{documento.title}</h2>

      <Entregue entrega={documento.entrega} onAbrir={abrir} />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {documento.entrega?.via === 'docs' && (
          <Button variant="primary" size="compact" onClick={() => abrir(urlDoDocs)}>
            Abrir no Google Docs
          </Button>
        )}
        <Button
          variant="secondary"
          size="compact"
          onClick={() =>
            documento.pdf ? baixarComoPdf(documento.pdf, nome) : baixarComoHtml(documento.html, nome)
          }
        >
          <Icon name="arrowDown" size={13} />
          Baixar documento
        </Button>
        <Button variant="secondary" size="compact" onClick={() => void copiar()}>
          {copiado ? 'Copiado ✓' : 'Copiar texto'}
        </Button>
      </div>

      {pendentes > 0 && !respondendo && (
        /*
         * A BARRA DAS PERGUNTAS — o único convite a agir deste painel, e o que
         * estava invisível.
         *
         * Era `border-borderc bg-white/[0.03]`: 1,05:1 de fundo e 1,30:1 de
         * borda contra o painel. WCAG 1.4.11 pede 3:1 para o que identifica um
         * controle, e o texto dentro dela lia bem — daí o sintoma ser "não
         * consigo ver que aquilo é um botão", não "não consigo ler".
         *
         * Subir o fundo não resolve: para o PREENCHIMENTO chegar a 3:1 sobre
         * este fundo seria preciso branco a ~0,34 de alpha, uma caixa cinza
         * clara que não pertence a esta linguagem. Quem carrega o contraste é a
         * BORDA, e ela passa a ser do acento: `primary/50` dá 3,14:1 sobre a
         * página e 3,11:1 sobre o painel flutuante. O tint verde por trás não
         * entra pela luminância — entra pelo MATIZ, que é o que faz o olho achar
         * a coisa numa tela escura. Os dois juntos dizem "isto é uma ação", que
         * é o que a barra é.
         */
        <button
          type="button"
          onClick={() => setRespondendo(true)}
          className={`mb-4 flex w-full items-center justify-between gap-3 rounded-panel border border-primary/50 bg-primary/[0.12] text-left shadow-sm transition-colors duration-200 ease-flow hover:bg-primary/[0.18] ${
            ampla ? 'px-5 py-4' : 'px-3 py-2.5'
          }`}
        >
          <span>
            <span className={`block font-semibold text-foreground ${ampla ? 'text-title' : 'text-body'}`}>
              {pendentes === 1
                ? '1 informação não estava na reunião'
                : `${pendentes} informações não estavam na reunião`}
            </span>
            <span className={`mt-0.5 block text-muted ${ampla ? 'text-body' : 'text-caption'}`}>
              Elas aparecem marcadas no documento. Responder atualiza o arquivo.
            </span>
          </span>
          <Icon
            name="chevron"
            size={ampla ? 16 : 14}
            className="-rotate-90 shrink-0 text-primary"
          />
        </button>
      )}

      {respondendo && (
        // O formulário é o mesmo do fluxo de geração — não há duas telas de
        // pergunta para divergirem. `relative` porque ali ele é flutuante e
        // aqui mora no corpo do painel.
        <div className="relative mb-4">
          <QuestionsForm
            perguntas={documento.questions}
            salvando={salvando}
            onConfirmar={responder}
            onPular={() => setRespondendo(false)}
            inline
            ampla={ampla}
          />
        </div>
      )}

      {erro && <p className="mb-3 text-caption text-danger">{erro}</p>}

      <p className="whitespace-pre-wrap text-read text-foreground/90">{documento.content}</p>
    </section>
  );
}

/**
 * Para onde o documento foi.
 *
 * Declarado, e não deduzido pelo usuário: no caminho de download o arquivo cai
 * na pasta sem nada acontecer na tela, e sem esta linha o clique parece não
 * ter surtido efeito.
 */
function Entregue({
  entrega,
  onAbrir,
}: {
  entrega: DocumentoPronto['entrega'];
  onAbrir: (url: string) => void;
}) {
  /*
   * As quatro tarjas ficam em superfície de verdade, e as duas neutras saem do
   * `bg-white/[0.03]` inventado para o `.glass-subtle` da escala — o degrau
   * "item de lista, controle secundário", que é o papel delas. `tokens.css` já
   * pedia isso ("nenhum componente inventa o seu `rgba()`"), e 0,03 ficava
   * ABAIXO do degrau mais baixo do sistema.
   *
   * Elas continuam mais quietas que a barra das perguntas, e isso é de
   * propósito: aqui é ESTADO, ali é AÇÃO. Uniformizar as duas coisas resolveria
   * a visibilidade destruindo a hierarquia — o que o olho precisa achar nesta
   * tela é o que ainda falta responder, não o aviso de que o arquivo baixou.
   */
  const base = 'mb-3 flex items-start gap-2 rounded-panel px-3 py-2 text-caption';

  if (!entrega) {
    return (
      <p className={`${base} glass-subtle text-muted`}>
        <Icon name="chevron" size={13} className="mt-0.5 shrink-0 animate-spin-slow" />
        Preparando a entrega...
      </p>
    );
  }

  if (entrega.via === 'docs') {
    return (
      <p className={`${base} bg-primary/10 text-foreground`}>
        <Icon name="check" size={13} className="mt-0.5 shrink-0 text-primary" />
        <span>
          Criado no seu Google Docs.{' '}
          <button
            type="button"
            onClick={() => onAbrir(entrega.url)}
            className="font-semibold text-primary underline-offset-2 hover:underline"
          >
            Abrir
          </button>
        </span>
      </p>
    );
  }

  if (entrega.via === 'download') {
    const ehPdf = entrega.arquivo.endsWith('.pdf');
    return (
      <p className={`${base} glass-subtle text-foreground`}>
        <Icon name="check" size={13} className="mt-0.5 shrink-0 text-primary" />
        <span>
          Baixado como <span className="font-semibold">{entrega.arquivo}</span>.
          {!ehPdf && (
            <span className="mt-0.5 block text-muted">
              Arraste para o Google Drive e abra com Documentos Google.
              {!oauthConfigurado() && ' O envio direto ainda não foi configurado neste ambiente.'}
            </span>
          )}
        </span>
      </p>
    );
  }

  return (
    <p className={`${base} bg-danger/10 text-danger`}>
      <Icon name="close" size={13} className="mt-0.5 shrink-0" />
      <span>
        O documento foi gerado, mas a entrega falhou.
        <span className="mt-0.5 block text-danger/85">{entrega.message}</span>
        <span className="mt-0.5 block text-muted">
          Use &quot;Baixar documento&quot; acima — o texto não se perdeu.
        </span>
      </span>
    </p>
  );
}
