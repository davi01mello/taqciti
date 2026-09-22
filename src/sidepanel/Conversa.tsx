/**
 * A conversa com o agente, na sidebar.
 *
 * ── A MESMA conversa da HOME ─────────────────────────────────────────────
 *
 * Não há cópia nem sincronização escrita à mão: as duas telas leem e escrevem
 * `taq:conversations` (ver `src/home/conversations.ts`) e assinam a mesma chave
 * do storage. Escrever aqui aparece lá, e vice-versa, porque é o mesmo dado.
 *
 * ── O que é real, e o que não é ──────────────────────────────────────────
 *
 * Sem endpoint de conversa, a ação salva um rascunho no mesmo registro usado
 * pela HOME. A disponibilidade aparece antes da escrita e não há turno falso
 * de resposta. Mensagens, campo e onda rolam juntos; novas gravações só
 * acompanham o fim quando a pessoa já estava lá ou acabou de salvar.
 *
 * ── O contexto é explícito ───────────────────────────────────────────────
 *
 * Quando a pergunta parte de um trecho da transcrição, o trecho aparece ACIMA
 * do campo, nomeado, e pode ser removido antes de enviar. Nada entra no
 * contexto por conta própria — nem a transcrição inteira, nem as notas, nem os
 * prints. Mandar o que estava por perto seria enviar a tela de alguém junto de
 * "como assim?".
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MeetingRecord } from '@/shared/types/domain';
import type { ContextoDaPergunta, Conversation } from '@/home/conversations';
import type { EstadoDoAgente } from '@/features/agent/atividade';
import { Icon } from '@/shared/ui/Icon';
import { AgenteOnda } from '@/shared/ui/AgenteOnda';
import { formatDate } from '@/shared/ui/format';

interface Props {
  conversa: Conversation | null;
  conversas: Conversation[];
  gravando: boolean;
  erro: string | null;
  /** O que o agente está fazendo. Ver features/agent/atividade.ts. */
  agente: EstadoDoAgente;
  contexto: ContextoDaPergunta | null;
  registros: MeetingRecord[];
  rascunho: string;
  onRascunho: (texto: string) => void;
  onEnviar: (texto: string) => Promise<boolean>;
  onLimparContexto: () => void;
  onNova: () => void;
  onEscolher: (id: string) => void;
}

const ALTURA_MAXIMA = 140;

export function Conversa({
  conversa,
  conversas,
  gravando,
  erro,
  agente,
  contexto,
  registros,
  rascunho,
  onRascunho,
  onEnviar,
  onLimparContexto,
  onNova,
  onEscolher,
}: Props) {
  const campoRef = useRef<HTMLTextAreaElement | null>(null);
  const rolagemRef = useRef<HTMLDivElement | null>(null);
  /** O bloco do agente: enquanto há resposta chegando, é ele que fica à vista. */
  const agenteRef = useRef<HTMLDivElement | null>(null);
  const noFim = useRef(true);
  const salvando = useRef(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const [ajudaAberta, setAjudaAberta] = useState(false);
  const [salvo, setSalvo] = useState(false);

  const mensagens = conversa?.messages ?? [];
  const total = mensagens.length;

  /** A reunião que esta conversa representa, quando ela nasceu de uma. */
  const reuniaoDaConversa = conversa?.meetingId
    ? (registros.find((r) => r.id === conversa.meetingId) ?? null)
    : null;

  /*
   * Um pedido NOVO volta a acompanhar.
   *
   * `noFim` guarda "esta pessoa está lendo o fim" e é desligado por qualquer
   * rolagem para cima — inclusive a que o próprio navegador provoca quando a
   * sidebar é redimensionada, que é comum aqui. Sem este reinício, quem
   * perguntasse depois de arrastar a borda do painel via a resposta nascer
   * fora da tela e não entendia por quê. Quem acabou de perguntar não está
   * lendo o passado.
   */
  const atividadeAnterior = useRef(agente.atividade);
  if (
    atividadeAnterior.current !== agente.atividade &&
    (agente.atividade === 'preparando' || agente.atividade === 'escrevendo')
  ) {
    noFim.current = true;
  }
  atividadeAnterior.current = agente.atividade;

  /*
   * A rolagem que acompanha — e o que ela acompanha.
   *
   * Enquanto uma resposta chega, o alvo é o BLOCO DO AGENTE, não o fim da
   * coluna. O fim é o compositor, que fica depois das mensagens; perseguir o
   * fim durante uma resposta longa deixava o texto subindo atrás do campo de
   * escrita, e quem estava esperando a resposta via o campo em vez dela.
   *
   * E é `scrollTop` desta coluna, nunca `scrollIntoView`: este segundo rola
   * todo ancestral rolável, inclusive o painel que empilha as duas seções, e
   * um painel com `overflow: hidden` deslocado não tem como voltar.
   */
  useLayoutEffect(() => {
    const col = rolagemRef.current;
    if (!col || !noFim.current) return;

    const bloco = agenteRef.current;
    if (bloco) {
      const sobra = bloco.getBoundingClientRect().bottom - col.getBoundingClientRect().bottom;
      if (sobra > 0) col.scrollTop += sobra + 16;
      return;
    }
    col.scrollTop = col.scrollHeight;
    // `agente` entra porque a linha "preparando…" e o texto que chega mudam a
    // altura do fluxo: sem eles na lista, o que há para acompanhar sairia da
    // tela no instante em que passa a existir.
  }, [total, gravando, conversa?.id, agente.atividade, agente.parcial]);

  useEffect(() => {
    if (!salvo) return;
    const timer = window.setTimeout(() => setSalvo(false), 2200);
    return () => window.clearTimeout(timer);
  }, [salvo]);

  useLayoutEffect(() => {
    const el = campoRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, ALTURA_MAXIMA)}px`;
  }, [rascunho]);

  useEffect(() => {
    if (!menuAberto) return;
    const fechar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuAberto(false);
    };
    document.addEventListener('keydown', fechar);
    return () => document.removeEventListener('keydown', fechar);
  }, [menuAberto]);

  const enviar = async () => {
    const limpo = rascunho.trim();
    if (!limpo || gravando || salvando.current) return;
    salvando.current = true;
    noFim.current = true;
    const ok = await onEnviar(limpo).finally(() => {
      salvando.current = false;
    });
    // Em falha o texto FICA: perder o que se escreveu por causa de uma
    // gravação que não deu certo é o pior desfecho possível aqui.
    if (ok) {
      onRascunho('');
      setSalvo(true);
    }
    campoRef.current?.focus();
  };

  return (
    <div
      className="tq-conversa-col"
      ref={rolagemRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div className={`tq-conversa-conteudo${total === 0 ? ' vazia' : ''}`}>
        {/*
         * O SELETOR DE CONVERSAS — e por que ele tem uma etiqueta fixa em cima.
         *
         * O que este botão mostra é o NOME DA CONVERSA ABERTA, não um rótulo do
         * produto. Só que o nome de uma conversa é a primeira coisa escrita
         * nela: quem começou perguntando "agente" acaba com uma conversa
         * chamada "agente", e o seletor passa a parecer um botão de agente.
         * Aconteceu, e foi lido como duplicidade de ponto de entrada.
         *
         * A etiqueta "Conversa" resolve sem inventar controle novo: ela é
         * constante, o nome varia embaixo dela, e a seta diz que há outras. O
         * ponto de entrada do agente continua sendo um só — o seletor de seção
         * lá em cima (ver `Seletores.tsx`).
         */}
        <div className="tq-conversa-topo">
          <button
            type="button"
            className="tq-seletor-conversa"
            aria-label="Escolher conversa"
            aria-haspopup="menu"
            title={conversa?.title ?? 'Conversas'}
            aria-expanded={menuAberto}
            onClick={() => setMenuAberto((v) => !v)}
          >
            <Icon name="chats" size={18} />
            <span className="tq-seletor-textos">
              <small>Conversa</small>
              <span>{conversa ? conversa.title : 'Nenhuma conversa aberta'}</span>
            </span>
            <Icon name="chevron" size={16} />
          </button>
          <button
            type="button"
            className="tq-nova"
            title="Nova conversa"
            aria-label="Nova conversa"
            onClick={() => {
              onNova();
              setMenuAberto(false);
              setSalvo(false);
              noFim.current = true;
              campoRef.current?.focus();
            }}
          >
            <Icon name="plus" size={20} />
            <span>Nova</span>
          </button>
        </div>

        {menuAberto && (
          <div className="tq-conversa-menu" role="menu">
            {conversas.length === 0 ? (
              <p className="tq-fino">Nenhuma conversa guardada ainda.</p>
            ) : (
              conversas.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={c.id === conversa?.id}
                  className={c.id === conversa?.id ? 'atual' : undefined}
                  onClick={() => {
                    onEscolher(c.id);
                    noFim.current = true;
                    setSalvo(false);
                    setMenuAberto(false);
                  }}
                >
                  <span>{c.title}</span>
                  <small>{formatDate(c.updatedAt)}</small>
                </button>
              ))
            )}
          </div>
        )}

        {reuniaoDaConversa && (
          <p className="tq-contexto-fixo" title="A reunião que esta conversa acompanha">
            <Icon name="history" size={12} /> {reuniaoDaConversa.title}
          </p>
        )}

        {/*
         * O aviso vem ANTES de escrever, não depois de enviar.
         *
         * Saber que não haverá resposta depois de ter formulado a pergunta é
         * saber tarde demais — e a tela ficaria parecendo um chat que falhou, em
         * vez de um chat que ainda não existe. Enquanto não houver rota de
         * conversa no servidor, esta linha fica de pé, o tempo todo.
         */}
        <div className="tq-disponibilidade">
          <span className="tq-sem-ia">Assistente não conectado</span>
          <button
            type="button"
            className="tq-ajuda"
            aria-label="Sobre o assistente não conectado"
            aria-expanded={ajudaAberta}
            aria-controls="tq-ajuda-ia"
            onClick={() => setAjudaAberta((v) => !v)}
          >
            <Icon name="info" size={18} />
          </button>
        </div>
        {ajudaAberta && (
          <p className="tq-ajuda-texto" id="tq-ajuda-ia">
            Ainda não há respostas de IA. Ao salvar, seu texto e o contexto ficam como
            rascunho neste computador, disponíveis também na HOME. Nada é enviado para
            processamento.
          </p>
        )}

        <div className="tq-fluxo">
          <div
            className={`tq-conversa-vazio${total > 0 ? ' recolhido' : ''}`}
            aria-hidden={total > 0}
          >
            <div>
              <img
                src={chrome.runtime.getURL('brand/taqciti-mark.png')}
                alt=""
                draggable={false}
              />
              <h2>Uma ideia começa aqui.</h2>
              <p>Escreva agora. Retome quando quiser.</p>
            </div>
          </div>
          {mensagens.map((m) =>
            m.role === 'assistant' ? (
              /*
               * Uma resposta do agente. Em produção esta ramificação não
               * acontece: sem rota de conversa no servidor, nada grava `role:
               * 'assistant'` (ver home/conversations.ts). Quem produz estas
               * mensagens hoje é a população de demonstração, e por isso o selo
               * abaixo não é enfeite — é o que impede uma resposta fictícia de
               * ser lida como resposta real.
               */
              <div key={m.id} className="tq-turno tq-turno-agente">
                <div className="tq-msg-agente">
                  <AgenteOnda estado="repouso" tamanho={22} />
                  <div>
                    <p className="tq-agente-nome">
                      TaqCiti
                      {m.demo && <span className="tq-selo-demo">Demonstração</span>}
                    </p>
                    <p className="tq-msg-ia">{m.text}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div key={m.id} className="tq-turno">
                {m.contexto && (
                  <p className="tq-contexto-msg">
                    <Icon name="history" size={11} /> {m.contexto.meetingTitle}
                    {m.contexto.excerpt && (
                      <span className="tq-contexto-trecho">
                        &ldquo;{m.contexto.excerpt}&rdquo;
                      </span>
                    )}
                  </p>
                )}
                <p className="tq-msg-voce">{m.text}</p>

                <small className="tq-rascunho-rotulo">Rascunho salvo</small>
              </div>
            ),
          )}

          {/*
           * O que o agente está fazendo AGORA — antes de a resposta existir.
           * Fica no fluxo, no lugar onde a resposta vai nascer, e não numa
           * barra separada: é ali que se está olhando enquanto se espera.
           *
           * Enquanto o texto chega, ele aparece AQUI e não na lista: uma
           * resposta pela metade não é registro, e não deve ser relida como
           * mensagem se a página fechar no meio.
           */}
          {agente.atividade !== 'repouso' && (
            <div className="tq-agente-trabalhando" role="status" ref={agenteRef}>
              <AgenteOnda estado={agente.atividade} tamanho={26} />
              <div>
                <span className="tq-agente-dizendo">
                  {agente.atividade === 'preparando'
                    ? 'Preparando a resposta…'
                    : agente.atividade === 'escrevendo'
                      ? 'Escrevendo…'
                      : agente.atividade === 'concluido'
                        ? 'Resposta concluída.'
                        : agente.atividade === 'falhou'
                          ? 'A resposta falhou. Sua pergunta continua guardada.'
                          : 'Resposta cancelada.'}
                </span>
                {agente.parcial && <p className="tq-msg-ia">{agente.parcial}</p>}
              </div>
            </div>
          )}
        </div>

        {/*
         * Sem onda atrás do campo. Ela era decoração aqui e sinal lá: o que a
         * onda diz é "há captura correndo", e isso se lê na transcrição, onde
         * ela agora mora (ver `OndaDaTranscricao`, em Reuniao.tsx). Atrás do
         * compositor ela só concorria com o texto que se está escrevendo.
         */}
        <div className="tq-escrita-palco">
          {contexto && (
            <div className="tq-contexto-pendente">
              <div>
                <strong>{contexto.meetingTitle}</strong>
                {contexto.excerpt && <span>&ldquo;{contexto.excerpt}&rdquo;</span>}
              </div>
              <button
                type="button"
                title="Tirar o contexto desta pergunta"
                aria-label="Tirar o contexto desta pergunta"
                onClick={onLimparContexto}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          )}

          <form
            className="tq-compositor"
            onSubmit={(e) => {
              e.preventDefault();
              void enviar();
            }}
          >
            <textarea
              ref={campoRef}
              rows={1}
              value={rascunho}
              aria-label="Escrever rascunho"
              aria-describedby="tq-destino-rascunho"
              placeholder={
                contexto ? 'Uma ideia sobre este trecho…' : 'Escreva sua ideia…'
              }
              onChange={(e) => {
                onRascunho(e.target.value);
                setSalvo(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void enviar();
                }
              }}
            />
            <button
              type="submit"
              className="tq-enviar"
              aria-label="Salvar rascunho"
              title="Salvar rascunho"
              disabled={!rascunho.trim() || gravando}
            >
              <Icon name={salvo ? 'check' : 'arrowDown'} size={20} />
            </button>
          </form>
          <div className="tq-escrita-rodape">
            <span id="tq-destino-rascunho">Sem IA · salvar rascunho</span>
            <span role="status">
              {gravando ? 'Salvando…' : salvo ? 'Salvo neste computador' : ''}
            </span>
          </div>
          {erro && (
            <p className="tq-aviso-falha" role="alert">
              {erro} Seu texto continua no campo.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
