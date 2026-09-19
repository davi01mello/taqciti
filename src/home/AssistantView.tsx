/**
 * A conversa do Assistente — e o campo de escrita, no MESMO fluxo dela.
 *
 * ── O que é real aqui, e o que não é ───────────────────────────────────────
 *
 * As mensagens que você escreve são reais: vão para o `chrome.storage.local`
 * (ver `conversations.ts`) e sobrevivem ao recarregar. **As respostas não
 * existem** — o servidor do TaqCiti gera documento a partir de transcrição, e
 * não tem rota de conversa. Então, no lugar onde a resposta apareceria, esta
 * tela mostra um estado honesto, com a identidade do agente ao lado.
 *
 * A alternativa — inventar uma resposta plausível — foi recusada de propósito.
 * Uma frase genérica ("posso ajudar a organizar as decisões…") é indistinguível
 * de um produto funcionando, e quem testar vai embora achando que conversou.
 *
 * ── Por que não há caixa de rolagem aqui dentro ────────────────────────────
 *
 * Havia: o histórico rolava numa caixa de 46vh e o compositor ficava preso
 * embaixo dela, sempre visível. Isso faz o compositor e a onda parecerem
 * colados na janela, e não parte da página — subir para reler deixava os dois
 * plantados no mesmo lugar, como um rodapé.
 *
 * Agora conversa, escrita e onda são um fluxo só, e quem rola é a PÁGINA.
 * Subir tira a escrita e a onda da área visível, como em qualquer página;
 * voltar ao fim as encontra de novo. Nada aqui usa `position: fixed` nem
 * `sticky`, e não existe segunda cópia da animação acompanhando a leitura.
 *
 * ── A rolagem que não atrapalha ────────────────────────────────────────────
 *
 * Mensagem nova só puxa a rolagem se você já estiver no fim. Lendo algo lá em
 * cima, nada se move. Interromper a leitura para mostrar o que acabou de
 * chegar é o comportamento que mais irrita em interface de chat. A exceção é
 * quem ACABOU de enviar: aí a rolagem acompanha, porque ver o que se enviou é
 * o motivo de ter enviado.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '@/shared/ui/Icon';
import { AgentMark } from './AgentMark';
import type { Conversation } from './conversations';

/** Distância do fim, em px, dentro da qual ainda consideramos "no fim". */
const MARGEM_DO_FIM = 96;
/** Altura máxima do campo antes de ele passar a rolar por dentro. */
const ALTURA_MAXIMA = 168;

interface Props {
  conversa: Conversation | null;
  /** `true` enquanto a mensagem está sendo gravada — é o estado real. */
  gravando: boolean;
  /** `null` quando o último envio deu certo; a mensagem do erro, quando não. */
  erro: string | null;
  /** Rascunho da conversa atual, preservado ao trocar de conversa. */
  rascunho: string;
  onRascunho: (texto: string) => void;
  /** Resolve `true` se a mensagem foi mesmo gravada. */
  onEnviar: (texto: string, anexos: string[]) => Promise<boolean>;
  /** O campo ganhou ou perdeu a atenção — é o que faz a onda subir e descer. */
  onEscrevendo: (escrevendo: boolean) => void;
  /** Sinaliza gesto real da pessoa para a onda do fundo reagir. */
  onPulso: (forca: number) => void;
}

export function AssistantView({
  conversa,
  gravando,
  erro,
  rascunho,
  onRascunho,
  onEnviar,
  onEscrevendo,
  onPulso,
}: Props) {
  const campoRef = useRef<HTMLTextAreaElement | null>(null);
  const arquivoRef = useRef<HTMLInputElement | null>(null);
  const noFimRef = useRef(true);

  const [anexos, setAnexos] = useState<string[]>([]);
  const [menuAberto, setMenuAberto] = useState(false);

  const mensagens = conversa?.messages ?? [];
  const total = mensagens.length;
  const vazia = total === 0;

  // Onde a página está. Lido do documento, porque é ele que rola agora.
  useEffect(() => {
    const aoRolar = () => {
      const doc = document.documentElement;
      noFimRef.current =
        window.innerHeight + window.scrollY >= doc.scrollHeight - MARGEM_DO_FIM;
    };
    aoRolar();
    window.addEventListener('scroll', aoRolar, { passive: true });
    return () => window.removeEventListener('scroll', aoRolar);
  }, []);

  // Depois de pintar, decide se acompanha. `useLayoutEffect` porque medir
  // altura depois do paint entregaria a posição do quadro anterior.
  useLayoutEffect(() => {
    if (!noFimRef.current) return;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
    // Segunda passada no quadro seguinte: a marca do agente é um `<canvas>` e o
    // texto pode refluir, então a altura final às vezes só existe depois do
    // paint. Sem isso, o fim da conversa fica ~50px acima do fim de verdade.
    const id = requestAnimationFrame(() => {
      if (noFimRef.current) {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
      }
    });
    return () => cancelAnimationFrame(id);
  }, [total, gravando]);

  /** Mantém a altura do campo colada no conteúdo, até o teto. */
  const ajustarAltura = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, ALTURA_MAXIMA)}px`;
  };

  useLayoutEffect(() => {
    const campo = campoRef.current;
    if (campo) ajustarAltura(campo);
  }, [rascunho]);

  const enviar = async () => {
    const limpo = rascunho.trim();
    // Mensagem vazia não vai. Nem espaço, nem quebra de linha sozinha.
    if (!limpo || gravando) return;

    noFimRef.current = true;
    onPulso(1);
    const ok = await onEnviar(limpo, anexos);
    // Em falha, o texto FICA: perder o que se escreveu por causa de uma
    // gravação que não deu certo é o pior desfecho possível aqui.
    if (!ok) return;
    onRascunho('');
    setAnexos([]);
    campoRef.current?.focus();
  };

  const escolherArquivos = (aceita: string) => {
    const input = arquivoRef.current;
    if (!input) return;
    input.accept = aceita;
    input.click();
    setMenuAberto(false);
  };

  return (
    <section className="tq-palco" aria-label="Conversa com o assistente">
      <div className="tq-conversa">
        {vazia ? (
          <div className="tq-abertura">
            <h1>O que vamos organizar?</h1>
            <p>Suas mensagens ficam salvas neste computador.</p>
          </div>
        ) : (
          <ol className="tq-turnos" aria-label="Histórico da conversa">
            {mensagens.map((m, i) => (
              <li key={m.id} className="tq-turno tq-turno-voce">
                <p className="tq-bolha">{m.text}</p>
                {m.attachments?.length ? (
                  <p className="tq-anexos-msg">
                    {m.attachments.join(' · ')} — guardado só o nome; o arquivo não
                    foi enviado a lugar nenhum.
                  </p>
                ) : null}

                {/* A resposta pertence ao ÚLTIMO turno: é dela que se está à
                    espera. Repetir o mesmo aviso sob cada mensagem encheria a
                    conversa de uma frase que não muda. */}
                {i === total - 1 && (
                  <div className="tq-turno-agente">
                    <MarcaDaResposta processando={gravando} />
                    <div className="tq-resposta-texto">
                      <div className="tq-agente-nome">TaqCiti</div>
                      {gravando ? (
                        <p className="tq-indisponivel">Guardando sua mensagem…</p>
                      ) : erro ? (
                        <p className="tq-indisponivel tq-falhou">
                          {erro} Seu texto continua no campo abaixo — dá para tentar
                          de novo.
                        </p>
                      ) : (
                        <>
                          <p className="tq-indisponivel">
                            Ainda não há um assistente de conversa ligado a esta
                            extensão — o servidor do TaqCiti gera documentos a partir
                            das transcrições, e não responde mensagens. Sua mensagem
                            ficou salva aqui.
                          </p>
                          <p className="tq-indisponivel-dica">
                            O que já funciona de verdade: <strong>Reuniões</strong>{' '}
                            com as transcrições capturadas e <strong>Documentos</strong>{' '}
                            para gerar a ata a partir delas.
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/*
       * A ESCRITA. Sem barra, sem caixa, sem linha divisória: só o texto sobre o
       * ambiente, com a onda atrás. `data-tq-escrita` marca a área onde o cursor
       * personalizado acende verde — e só ela, para o brilho continuar
       * significando "aqui se escreve".
       */}
      <form
        className="tq-escrita"
        data-tq-escrita
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
      >
        <div className="tq-campo">
          <textarea
            ref={campoRef}
            rows={1}
            value={rascunho}
            aria-label="Mensagem para o assistente"
            placeholder={vazia ? 'Escreva aqui…' : 'Continue a conversa…'}
            onFocus={() => onEscrevendo(true)}
            onBlur={() => onEscrevendo(false)}
            onChange={(e) => {
              onRascunho(e.target.value);
              ajustarAltura(e.target);
              onEscrevendo(true);
              onPulso(0.4);
            }}
            onKeyDown={(e) => {
              // `isComposing`: em teclado com IME o Enter confirma o candidato,
              // e enviar aí engoliria a palavra pela metade.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void enviar();
              }
            }}
          />

          <div className="tq-campo-acoes">
            <button
              type="button"
              className="tq-mais"
              aria-label="Anexar imagem ou documento"
              aria-expanded={menuAberto}
              aria-controls="tq-anexo-menu"
              onClick={() => setMenuAberto((v) => !v)}
            >
              <Icon name="plus" size={17} />
            </button>
            <button
              type="submit"
              className="tq-enviar"
              aria-label="Enviar mensagem"
              disabled={!rascunho.trim() || gravando}
            >
              <Icon name="arrowUp" size={16} />
            </button>
          </div>
        </div>

        {anexos.length > 0 && (
          <p className="tq-anexos" role="status">
            {anexos.join(' · ')} — só o nome acompanha a mensagem.
            <button type="button" className="tq-linkish" onClick={() => setAnexos([])}>
              remover
            </button>
          </p>
        )}

        {menuAberto && (
          <div className="tq-anexo-menu" id="tq-anexo-menu">
            <button type="button" onClick={() => escolherArquivos('image/*')}>
              <Icon name="image" size={15} /> Imagem
            </button>
            <button
              type="button"
              onClick={() => escolherArquivos('.pdf,.doc,.docx,.txt,.md,.csv')}
            >
              <Icon name="doc" size={15} /> Documento
            </button>
            <p>Os arquivos ficam neste computador. Não há para onde enviá-los ainda.</p>
          </div>
        )}

        <p className="tq-dica-teclas">Enter envia · Shift+Enter quebra linha</p>
      </form>

      <input
        ref={arquivoRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const nomes = Array.from(e.target.files ?? []).map((f) => f.name);
          if (nomes.length) setAnexos((atual) => [...atual, ...nomes]);
          e.target.value = '';
        }}
      />
    </section>
  );
}

/**
 * O indicador da mensagem da IA, amarrado ao que está ACONTECENDO.
 *
 * Enquanto a operação real corre, a marca animada — ondas girando. Quando ela
 * termina, o ícone oficial do TaqCiti entra por cima, com uma transição de
 * opacidade. Os dois ficam montados e empilhados de propósito: trocar de
 * elemento faria a marca sumir por um quadro antes de o ícone aparecer.
 *
 * Nenhum temporizador participa disso. O que decide é `processando`, que vem do
 * estado real da gravação — não de um `setTimeout` fingindo latência.
 */
function MarcaDaResposta({ processando }: { processando: boolean }) {
  return (
    <span
      className={`tq-marca${processando ? ' processando' : ''}`}
      aria-hidden="true"
    >
      <AgentMark animada={processando} processando={processando} tamanho={32} />
      <img src={chrome.runtime.getURL('brand/taqciti-mark.png')} alt="" draggable={false} />
    </span>
  );
}
