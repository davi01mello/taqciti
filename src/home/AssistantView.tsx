/**
 * A conversa do Assistente — e o campo de escrita, no MESMO fluxo dela.
 *
 * ── O que é real aqui, e o que não é ───────────────────────────────────────
 *
 * As mensagens que você escreve são reais: vão para o `chrome.storage.local`
 * (ver `conversations.ts`) e sobrevivem ao recarregar. As respostas são do Taq
 * (`features/taq/`), gravadas só quando a execução produziu texto, com as
 * fontes conferidas e os documentos que as ferramentas confirmaram.
 *
 * Sem servidor configurado, não há resposta — e a tela diz isso ANTES da
 * escrita, com o motivo que o servidor deu. Nenhuma resposta é inventada para a
 * tela parecer completa: uma frase genérica é indistinguível de um produto
 * funcionando, e quem testar vai embora achando que conversou.
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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/shared/ui/Icon';
import type { EstadoDoAgente } from '@/features/agent/atividade';
import { anunciarEscrita } from '@/features/agent/escuta';
import type { DisponibilidadeDoTaq } from '@/features/taq/interface';
import { EstadoDaExecucao, RespostaDoTaq } from '@/shared/ui/RespostaDoTaq';
import { BotaoCopiar } from '@/shared/ui/BotaoCopiar';
import { TrilhaDaConversa, marcasDasMensagens } from '@/shared/ui/TrilhaDaConversa';
import { MarcaDoTaq } from '@/shared/ui/MarcaDoTaq';
import type { Conversation, FonteDaResposta } from './conversations';

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
  /** O Taq está pronto? Vem do servidor — ver `useDisponibilidadeDoTaq`. */
  taq: DisponibilidadeDoTaq;
  onVerificarDeNovo: () => void;
  /** O que o Taq está fazendo agora. */
  agente: EstadoDoAgente;
  /** Como a última execução terminou, quando não deixou resposta. */
  desfecho: string | null;
  onCancelar: () => void;
  onAbrirFonte: (fonte: FonteDaResposta) => void;
  onAbrirDocumento: (id: string) => void;
  /** Desfazer uma exclusão feita pelo Taq (lixeira). */
  onDesfazer?: (id: string) => Promise<boolean>;
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
  taq,
  onVerificarDeNovo,
  agente,
  desfecho,
  onCancelar,
  onAbrirFonte,
  onAbrirDocumento,
  onDesfazer,
}: Props) {
  const trabalhando =
    agente.atividade === 'preparando' || agente.atividade === 'escrevendo';
  const campoRef = useRef<HTMLTextAreaElement | null>(null);
  const arquivoRef = useRef<HTMLInputElement | null>(null);
  const noFimRef = useRef(true);

  const [anexos, setAnexos] = useState<string[]>([]);
  const [menuAberto, setMenuAberto] = useState(false);

  // Pela lista, não pela conversa: a gravação troca o array de mensagens,
  // mas pode devolver o mesmo objeto de conversa.
  const mensagensGravadas = conversa?.messages;
  const mensagens = useMemo(() => mensagensGravadas ?? [], [mensagensGravadas]);
  const total = mensagens.length;
  const vazia = total === 0;
  /** A resposta acabou de chegar e a execução ainda não voltou ao repouso. */
  const respostaChegando =
    mensagens.at(-1)?.role === 'assistant' &&
    (trabalhando || agente.atividade === 'concluido');

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
  }, [total, gravando, agente.atividade, agente.etapa]);

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
    if (!limpo || gravando || trabalhando) return;

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

  /*
   * O histórico, memorizado. Cada tecla muda o rascunho (e a onda do fundo),
   * e re-renderizar o Markdown de todas as respostas a cada letra derrubava
   * quadros da marca animada. Digitar não está nas dependências.
   */
  const historico = useMemo(
    () => (
      <ol className="tq-turnos" aria-label="Histórico da conversa">
        {mensagens.map((m, i) => {
          const ultima = i === total - 1;
          if (m.role === 'assistant') {
            return (
              <li key={m.id} className="tq-turno" data-tq-turno={m.id}>
                <div className="tq-turno-agente">
                  {/* Só a resposta que acabou de chegar se mexe: ela se
                          refaz no ícone. As antigas são o ícone parado. */}
                  <MarcaDoTaq
                    estado={ultima && respostaChegando ? 'concluido' : 'repouso'}
                    vivo={ultima && respostaChegando}
                    ouve={ultima}
                    tamanho={32}
                  />
                  <div className="tq-resposta-texto">
                    <div className="tq-agente-nome">
                      Taq
                      {m.demo && <span className="tq-selo-demo"> · Demonstração</span>}
                    </div>
                    <RespostaDoTaq
                      mensagem={m}
                      {...(conversa ? { conversaId: conversa.id } : {})}
                      onAbrirFonte={onAbrirFonte}
                      onAbrirDocumento={onAbrirDocumento}
                      onDesfazer={onDesfazer}
                      onAbrirReuniao={(id) =>
                        onAbrirFonte({
                          ref: '',
                          tipo: 'reuniao',
                          registroId: id,
                          titulo: '',
                          trecho: '',
                        })
                      }
                      onEscolherOpcao={
                        ultima && !trabalhando && !gravando && taq.fase === 'pronto'
                          ? (texto) => void onEnviar(texto, [])
                          : undefined
                      }
                    />
                  </div>
                </div>
              </li>
            );
          }
          return (
            <li key={m.id} className="tq-turno tq-turno-voce" data-tq-turno={m.id}>
              <p className="tq-bolha">{m.text}</p>
              <div className="tq-voce-acoes">
                <BotaoCopiar texto={m.text} rotulo="Copiar sua mensagem" />
              </div>
              {m.attachments?.length ? (
                <p className="tq-anexos-msg">
                  {m.attachments.join(' · ')} — guardado só o nome; o arquivo não foi
                  enviado a lugar nenhum.
                </p>
              ) : null}

              {/* O estado pertence ao ÚLTIMO turno da pessoa: é dele que se
                      está à espera. */}
              {ultima && (
                <div className="tq-turno-agente">
                  <MarcaDoTaq
                    estado={gravando ? 'preparando' : agente.atividade}
                    vivo={gravando || agente.atividade !== 'repouso'}
                    sinal={agente.parcial ? agente.parcial.length : (agente.etapa ?? '')}
                    ouve
                    tamanho={32}
                  />
                  <div className="tq-resposta-texto">
                    <div className="tq-agente-nome">Taq</div>
                    {gravando ? (
                      <p className="tq-indisponivel">Guardando sua mensagem…</p>
                    ) : erro ? (
                      <p className="tq-indisponivel tq-falhou">
                        {erro} Seu texto continua no campo abaixo — dá para tentar de
                        novo.
                      </p>
                    ) : taq.fase === 'pronto' ? (
                      <EstadoDaExecucao
                        agente={agente}
                        desfecho={desfecho}
                        onCancelar={onCancelar}
                      />
                    ) : (
                      <p className="tq-indisponivel">
                        Sua mensagem ficou salva aqui. O assistente não respondeu porque{' '}
                        {motivoSemTaq(taq)}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    ),
    [
      conversa,
      mensagens,
      total,
      gravando,
      trabalhando,
      erro,
      taq,
      agente,
      desfecho,
      respostaChegando,
      onAbrirFonte,
      onAbrirDocumento,
      onDesfazer,
      onEnviar,
      onCancelar,
    ],
  );

  return (
    <section className="tq-palco" aria-label="Conversa com o assistente">
      <div className="tq-conversa">
        {vazia ? (
          <div className="tq-abertura">
            <h1>O que vamos organizar?</h1>
            <p>Pergunte sobre suas reuniões e documentos, ou peça um documento.</p>
          </div>
        ) : (
          historico
        )}
        {!vazia && (
          <TrilhaDaConversa itens={marcasDasMensagens(mensagens)} rolador={null} />
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
              anunciarEscrita();
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
              disabled={!rascunho.trim() || gravando || trabalhando}
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

        {/*
         * O estado da IA, dito ANTES de escrever.
         *
         * Descobrir que não haverá resposta depois de ter formulado a pergunta
         * é descobrir tarde demais — e faz a tela parecer um chat que falhou,
         * em vez de um chat que ainda não existe.
         */}
        <AvisoDoTaq taq={taq} onVerificarDeNovo={onVerificarDeNovo} />
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

/** O motivo de não haver resposta, dito como o servidor disse. */
function motivoSemTaq(taq: DisponibilidadeDoTaq): string {
  switch (taq.fase) {
    case 'verificando':
      return 'ainda estava verificando o servidor quando você enviou.';
    case 'pendente':
      return `a configuração está pendente: ${taq.motivos.join(' ')}`;
    case 'inalcancavel':
      return 'o servidor do TaqCiti não respondeu.';
    default:
      return '';
  }
}

/**
 * O estado da IA, dito ANTES de escrever — e, quando pronto, o que sai do
 * computador. Guardar localmente não é processar localmente: os trechos que o
 * Taq consulta vão ao provedor, pelo servidor, e isto precisa estar escrito
 * onde se escreve.
 */
function AvisoDoTaq({
  taq,
  onVerificarDeNovo,
}: {
  taq: DisponibilidadeDoTaq;
  onVerificarDeNovo: () => void;
}) {
  if (taq.fase === 'pronto') {
    return (
      <p className="tq-com-ia" role="status">
        Taq conectado. Os trechos que ele consulta vão ao provedor de IA.
      </p>
    );
  }
  return (
    <p className="tq-sem-ia" role="status">
      {taq.fase === 'verificando'
        ? 'Verificando o assistente…'
        : taq.fase === 'pendente'
          ? `Taq com configuração pendente: ${taq.motivos.join(' ')}`
          : 'Taq fora do ar. Sua mensagem fica salva.'}
      {taq.fase !== 'verificando' && (
        <>
          {' '}
          <button type="button" className="tq-linkish" onClick={onVerificarDeNovo}>
            verificar de novo
          </button>
        </>
      )}
    </p>
  );
}
