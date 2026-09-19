/**
 * A conversa do Assistente.
 *
 * ── O que é real aqui, e o que não é ───────────────────────────────────────
 *
 * As mensagens que você escreve são reais: vão para o `chrome.storage.local`
 * (ver `conversations.ts`) e sobrevivem ao recarregar. **As respostas não
 * existem** — o servidor do TaqCiti gera documento a partir de transcrição, e
 * não tem rota de conversa. Então, no lugar onde a resposta apareceria, esta
 * tela mostra um aviso de estado, com a identidade do agente ao lado, dizendo
 * exatamente isso e apontando para o que de fato funciona.
 *
 * A alternativa — inventar uma resposta plausível — foi recusada de propósito.
 * Uma frase genérica ("posso ajudar a organizar as decisões…") é indistinguível
 * de um produto funcionando, e quem testar vai embora achando que conversou.
 *
 * ── A rolagem que não atrapalha ────────────────────────────────────────────
 *
 * Mensagem nova só puxa a rolagem se você já estiver no fim. Lendo algo lá em
 * cima, nada se move — a única coisa que muda é a trilha lateral, que passa a
 * marcar que existe conteúdo novo abaixo. Interromper a leitura para mostrar o
 * que acabou de chegar é o comportamento que mais irrita em interface de chat.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '@/shared/ui/Icon';
import { AgentMark } from './AgentMark';
import type { Conversation } from './conversations';

/** Distância do fim, em px, dentro da qual ainda consideramos "no fim". Um
 *  número, e não zero: rolagem suave e subpixel raramente param em 0 exato. */
const MARGEM_DO_FIM = 48;

interface Props {
  conversa: Conversation | null;
  /** `true` enquanto a mensagem está sendo gravada. */
  gravando: boolean;
  onEnviar: (texto: string, anexos: string[]) => void;
  onNova: () => void;
  /** Sinaliza gesto real da pessoa para a onda do fundo reagir. */
  onPulso: (forca: number) => void;
}

export function AssistantView({ conversa, gravando, onEnviar, onNova, onPulso }: Props) {
  const fluxoRef = useRef<HTMLDivElement | null>(null);
  const campoRef = useRef<HTMLTextAreaElement | null>(null);
  const arquivoRef = useRef<HTMLInputElement | null>(null);
  const itensRef = useRef<Array<HTMLElement | null>>([]);
  const noFimRef = useRef(true);

  const [texto, setTexto] = useState('');
  const [anexos, setAnexos] = useState<string[]>([]);
  const [menuAberto, setMenuAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);

  const mensagens = conversa?.messages ?? [];
  const total = mensagens.length;

  /** Qual mensagem está no alto da área visível — é isso que a trilha marca. */
  const recalcular = useCallback(() => {
    const fluxo = fluxoRef.current;
    if (!fluxo) return;
    noFimRef.current =
      fluxo.scrollHeight - fluxo.scrollTop - fluxo.clientHeight <= MARGEM_DO_FIM;

    const limite = fluxo.scrollTop + fluxo.clientHeight * 0.4;
    let indice = 0;
    itensRef.current.forEach((el, i) => {
      if (el && el.offsetTop <= limite) indice = i;
    });
    setAtivo(indice);
  }, []);

  // `total` nas dependências não é decoração: na primeira renderização a
  // conversa ainda não chegou do storage, `.tq-fluxo` não existe, e o efeito
  // saía sem assinar nada. Sem `total`, ele nunca mais rodava — a trilha
  // ficava congelada na posição calculada uma única vez, com `scrollTop`
  // ainda em zero. Foi o que a medição no navegador mostrou: 18 mensagens,
  // rolagem no fim, e o tracinho ativo marcando a segunda.
  useEffect(() => {
    const fluxo = fluxoRef.current;
    if (!fluxo) return;
    fluxo.addEventListener('scroll', recalcular, { passive: true });
    return () => fluxo.removeEventListener('scroll', recalcular);
  }, [recalcular, total]);

  // Depois de pintar, decide se acompanha. `useLayoutEffect` porque medir
  // altura depois do paint entregaria a posição do quadro anterior.
  useLayoutEffect(() => {
    const fluxo = fluxoRef.current;
    if (!fluxo) return;
    if (noFimRef.current) {
      // `behavior: 'auto'` explícito porque o CSS do fluxo pede rolagem suave,
      // e ela vale também para `scrollTop = …`. Com suavidade, abrir a tela num
      // histórico longo mostra o MEIO da conversa enquanto a animação corre —
      // foi o que apareceu na verificação em janela estreita. Suave continua
      // valendo para o gesto da pessoa (os cliques na trilha pedem 'smooth').
      fluxo.scrollTo({ top: fluxo.scrollHeight, behavior: 'auto' });
    }
    recalcular();

    // Segunda passada no quadro seguinte: a marca do agente é um `<canvas>` e
    // o texto pode reflow, então a altura final às vezes só existe depois do
    // paint. Sem isso, o fim da conversa fica ~50px acima do fim de verdade.
    const id = requestAnimationFrame(() => {
      if (noFimRef.current) fluxo.scrollTo({ top: fluxo.scrollHeight, behavior: 'auto' });
      recalcular();
    });
    return () => cancelAnimationFrame(id);
  }, [total, recalcular]);

  const enviar = () => {
    const limpo = texto.trim();
    if (!limpo || gravando) return;
    // Quem envia quer ver o que enviou: forçamos o acompanhamento da rolagem
    // neste caso específico, mesmo que a pessoa estivesse lendo acima.
    noFimRef.current = true;
    onEnviar(limpo, anexos);
    setTexto('');
    setAnexos([]);
    onPulso(1);
    const campo = campoRef.current;
    if (campo) {
      campo.style.height = 'auto';
      campo.focus();
    }
  };

  const irPara = (indice: number) => {
    const el = itensRef.current[indice];
    const fluxo = fluxoRef.current;
    if (!el || !fluxo) return;
    fluxo.scrollTo({ top: Math.max(0, el.offsetTop - 24), behavior: 'smooth' });
  };

  const escolherArquivos = (aceita: string) => {
    const input = arquivoRef.current;
    if (!input) return;
    input.accept = aceita;
    input.click();
    setMenuAberto(false);
  };

  const vazia = total === 0;

  return (
    <section className="tq-assistente" aria-label="Conversa com o assistente">
      {vazia ? (
        <div className="tq-abertura">
          <h1>O que vamos organizar?</h1>
          <p>Suas mensagens ficam salvas neste computador.</p>
        </div>
      ) : (
        <div className="tq-fluxo-topo">
          <button type="button" className="tq-linkish" onClick={onNova}>
            Nova conversa
          </button>
        </div>
      )}

      {!vazia && (
        <div className="tq-fluxo-wrap">
          <div
            className="tq-fluxo"
            ref={fluxoRef}
            role="log"
            aria-label="Histórico da conversa"
            tabIndex={0}
          >
            {mensagens.map((m, i) => {
              const ultima = i === total - 1;
              return (
                <article
                  key={m.id}
                  className={`tq-turno${ultima ? ' tq-turno-ultimo' : ''}`}
                  ref={(el) => {
                    itensRef.current[i] = el;
                  }}
                >
                  <p className="tq-voce">{m.text}</p>
                  {m.attachments?.length ? (
                    <p className="tq-anexos-msg">
                      {m.attachments.join(' · ')} — guardado só o nome; o arquivo
                      não foi enviado a lugar nenhum.
                    </p>
                  ) : null}

                  {/* O lugar da resposta. Enquanto não há assistente conectado,
                      ele carrega o estado real em vez de um texto inventado. */}
                  {ultima && (
                    <div className="tq-resposta">
                      <AgentMark animada={ultima} processando={gravando} tamanho={34} />
                      <div className="tq-resposta-texto">
                        <div className="tq-agente-nome">TaqCiti</div>
                        <p className="tq-indisponivel">
                          Ainda não há um assistente de conversa ligado a esta
                          extensão — o servidor do TaqCiti gera documentos a
                          partir das transcrições, e não responde mensagens.
                          Sua mensagem ficou salva aqui.
                        </p>
                        <p className="tq-indisponivel-dica">
                          O que já funciona de verdade: <strong>Reuniões</strong>{' '}
                          com as transcrições capturadas e <strong>Documentos</strong>{' '}
                          para gerar a ata a partir delas.
                        </p>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {/* Trilha: um tracinho por mensagem real, não por porcentagem. */}
          <div className="tq-trilha" role="group" aria-label="Posição na conversa">
            {mensagens.map((m, i) => (
              <button
                key={m.id}
                type="button"
                className="tq-tick"
                aria-label={`Ir para a mensagem ${i + 1} de ${total}`}
                aria-pressed={i === ativo}
                onClick={() => irPara(i)}
              />
            ))}
          </div>
        </div>
      )}

      <form
        className="tq-compositor"
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        <textarea
          ref={campoRef}
          rows={1}
          value={texto}
          aria-label="Mensagem para o assistente"
          placeholder={vazia ? 'Escreva aqui…' : 'Continue a conversa…'}
          onChange={(e) => {
            setTexto(e.target.value);
            const el = e.target;
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
            onPulso(0.45);
          }}
          onKeyDown={(e) => {
            // `isComposing`: em teclado com IME o Enter confirma o candidato,
            // e enviar aí engoliria a palavra pela metade.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              enviar();
            }
          }}
        />

        {anexos.length > 0 && (
          <p className="tq-anexos" role="status">
            {anexos.join(' · ')} — só o nome acompanha a mensagem.
            <button type="button" className="tq-linkish" onClick={() => setAnexos([])}>
              remover
            </button>
          </p>
        )}

        <div className="tq-compositor-pe">
          <span>Enter envia · Shift+Enter quebra linha</span>
          <button
            type="submit"
            className="tq-enviar"
            aria-label="Enviar mensagem"
            disabled={!texto.trim() || gravando}
          >
            <Icon name="arrowUp" size={16} />
          </button>
        </div>
      </form>

      <div className="tq-rodape-acoes">
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
        <button
          type="button"
          className="tq-mais"
          aria-label="Anexar imagem ou documento"
          aria-expanded={menuAberto}
          aria-controls="tq-anexo-menu"
          onClick={() => setMenuAberto((v) => !v)}
        >
          <Icon name="plus" size={18} />
        </button>
      </div>

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
