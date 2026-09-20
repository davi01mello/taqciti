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
 * As mensagens que você escreve são reais e persistem. **As respostas não
 * existem**: o servidor do TaqCiti gera documento a partir de transcrição
 * (`/api/generate`, `/api/ai/secao`) e não tem rota de conversa. Então, no
 * lugar da resposta, esta tela diz exatamente isso — em vez de inventar uma
 * frase plausível, que seria indistinguível de um produto funcionando.
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
import { Icon } from '@/shared/ui/Icon';
import { formatDate } from '@/shared/ui/format';

interface Props {
  conversa: Conversation | null;
  conversas: Conversation[];
  gravando: boolean;
  erro: string | null;
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
  const fimRef = useRef<HTMLDivElement | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);

  const mensagens = conversa?.messages ?? [];
  const total = mensagens.length;

  /** A reunião que esta conversa representa, quando ela nasceu de uma. */
  const reuniaoDaConversa = conversa?.meetingId
    ? (registros.find((r) => r.id === conversa.meetingId) ?? null)
    : null;

  useLayoutEffect(() => {
    fimRef.current?.scrollIntoView({ block: 'end' });
  }, [total, gravando]);

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
    if (!limpo || gravando) return;
    const ok = await onEnviar(limpo);
    // Em falha o texto FICA: perder o que se escreveu por causa de uma
    // gravação que não deu certo é o pior desfecho possível aqui.
    if (ok) onRascunho('');
    campoRef.current?.focus();
  };

  return (
    <div className="tq-conversa-col">
      <div className="tq-conversa-topo">
        <button
          type="button"
          className="tq-linkish"
          aria-expanded={menuAberto}
          onClick={() => setMenuAberto((v) => !v)}
        >
          <Icon name="chats" size={13} />
          {conversa ? conversa.title : 'Nova conversa'}
        </button>
        <button type="button" className="tq-icone" title="Nova conversa" aria-label="Nova conversa" onClick={onNova}>
          <Icon name="plus" size={14} />
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
      <p className="tq-sem-ia" role="status">
        <Icon name="close" size={11} />
        Sem assistente conectado: nada responde por aqui ainda. Sua pergunta e o
        contexto ficam salvos.
      </p>

      <div className="tq-fluxo">
        {total === 0 ? (
          <p className="tq-fino tq-centrado">
            Escreva aqui. Suas mensagens ficam salvas neste computador e aparecem
            também na HOME.
          </p>
        ) : (
          mensagens.map((m, i) => (
            <div key={m.id} className="tq-turno">
              {m.contexto && (
                <p className="tq-contexto-msg">
                  <Icon name="history" size={11} /> {m.contexto.meetingTitle}
                  {m.contexto.excerpt && (
                    <span className="tq-contexto-trecho">&ldquo;{m.contexto.excerpt}&rdquo;</span>
                  )}
                </p>
              )}
              <p className="tq-msg-voce">{m.text}</p>

              {i === total - 1 && (
                <div className="tq-msg-agente">
                  <img
                    src={chrome.runtime.getURL('brand/taqciti-mark.png')}
                    alt=""
                    draggable={false}
                  />
                  <div>
                    <div className="tq-agente-nome">TaqCiti</div>
                    {gravando ? (
                      <p className="tq-msg-ia">Guardando sua mensagem…</p>
                    ) : erro ? (
                      <p className="tq-msg-ia tq-falhou">
                        {erro} Seu texto continua no campo abaixo.
                      </p>
                    ) : (
                      <p className="tq-msg-ia">
                        Ainda não há um assistente de conversa ligado a esta
                        extensão — o servidor do TaqCiti gera documentos a partir
                        das transcrições e não responde mensagens. Sua pergunta
                        ficou salva aqui, com o contexto que você anexou.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={fimRef} />
      </div>

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
          aria-label="Mensagem para o assistente"
          placeholder={contexto ? 'Pergunte sobre este trecho…' : 'Escreva aqui…'}
          onChange={(e) => onRascunho(e.target.value)}
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
          aria-label="Enviar mensagem"
          disabled={!rascunho.trim() || gravando}
        >
          <Icon name="arrowUp" size={15} />
        </button>
      </form>
    </div>
  );
}
