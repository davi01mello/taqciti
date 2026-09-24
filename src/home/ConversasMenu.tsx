/**
 * O menu de conversas — o botão discreto do canto superior direito.
 *
 * ── Por que um menu, e não uma barra lateral de conversas ──────────────────
 *
 * A HOME já tem uma navegação lateral, e ela é sobre SEÇÕES. Empilhar uma
 * segunda lista permanente ali dentro misturaria duas hierarquias diferentes
 * ("onde estou" e "qual conversa"). E uma barra superior inteira só para
 * acomodar este controle custaria uma faixa de tela para um botão — o oposto
 * da tela sem molduras que o resto da HOME persegue.
 *
 * ── O que ele garante ──────────────────────────────────────────────────────
 *
 *   - criar uma conversa nova NÃO apaga a anterior: "nova" é um estado, e a
 *     conversa só passa a existir quando a primeira mensagem for gravada;
 *   - a conversa atual é identificada na lista, não adivinhada;
 *   - trocar recupera o conteúdo, porque ele sempre esteve no storage.
 *
 * ── Apagar ─────────────────────────────────────────────────────────────────
 *
 * Aqui, e não numa tela de gerenciamento à parte: a lista é o único lugar onde
 * as conversas antigas aparecem, e mandar alguém a outro lugar para remover o
 * que está vendo é o caminho mais longo possível.
 *
 * O item vira a PERGUNTA no lugar, em vez de abrir uma caixa por cima: um
 * segundo menu flutuante sobre um menu flutuante perde a âncora visual de qual
 * conversa está prestes a sumir. E o menu não se fecha ao apagar — quem apaga
 * uma conversa velha costuma apagar duas.
 *
 * ── Teclado ────────────────────────────────────────────────────────────────
 *
 * Escape fecha e DEVOLVE o foco ao botão que abriu — sem isso o foco cai no
 * `body` e a próxima tabulação recomeça do topo da página, que é a forma mais
 * comum de um menu acessível parecer quebrado. As setas percorrem os itens, e
 * um clique fora fecha.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/shared/ui/Icon';
import { formatDate } from '@/shared/ui/format';
import type { Conversation } from './conversations';

interface Props {
  conversas: Conversation[];
  /** `null` enquanto a conversa nova ainda não recebeu a primeira mensagem. */
  atualId: string | null;
  aberto: boolean;
  onAbrir: (aberto: boolean) => void;
  onNova: () => void;
  onEscolher: (id: string) => void;
  /** Apaga a conversa. Resolve `false` quando o storage recusou. */
  onApagar: (id: string) => Promise<boolean>;
}

export function ConversasMenu({
  conversas,
  atualId,
  aberto,
  onAbrir,
  onNova,
  onEscolher,
  onApagar,
}: Props) {
  const botaoRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  /** A conversa cuja remoção está à espera de confirmação. */
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [erro, setErro] = useState('');

  // Fechar o menu desfaz a pergunta pendente: reabrir já confirmando seria
  // uma pergunta feita numa sessão e respondida noutra.
  useEffect(() => {
    if (!aberto) {
      setConfirmando(null);
      setErro('');
    }
  }, [aberto]);

  const fechar = useCallback(
    (devolverFoco: boolean) => {
      onAbrir(false);
      if (devolverFoco) botaoRef.current?.focus();
    },
    [onAbrir],
  );

  // Foco no primeiro item ao abrir: um menu que abre sem foco dentro obriga
  // quem usa teclado a tabular por ele a partir do botão.
  useEffect(() => {
    if (!aberto) return;
    const primeiro = menuRef.current?.querySelector<HTMLElement>('[data-item]');
    primeiro?.focus();
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        // Escape desfaz um passo de cada vez: primeiro a pergunta, depois o
        // menu. Fechar tudo de uma vez faria o gesto de recuar da confirmação
        // levar embora também a lista que se estava consultando.
        if (confirmando) setConfirmando(null);
        else fechar(true);
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const itens = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[data-item]') ?? [],
      );
      if (itens.length === 0) return;
      e.preventDefault();
      const atual = itens.indexOf(document.activeElement as HTMLElement);
      const passo = e.key === 'ArrowDown' ? 1 : -1;
      const proximo = (atual + passo + itens.length) % itens.length;
      itens[proximo]?.focus();
    };

    const aoClicarFora = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (menuRef.current?.contains(alvo) || botaoRef.current?.contains(alvo)) return;
      fechar(false);
    };

    document.addEventListener('keydown', aoTeclar);
    document.addEventListener('pointerdown', aoClicarFora);
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.removeEventListener('pointerdown', aoClicarFora);
    };
  }, [aberto, fechar, confirmando]);

  return (
    <div className="tq-conversas">
      <button
        ref={botaoRef}
        type="button"
        className="tq-conversas-botao"
        aria-label="Conversas"
        title="Conversas"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls="tq-conversas-menu"
        onClick={() => onAbrir(!aberto)}
      >
        <Icon name="chats" size={16} />
      </button>

      {aberto && (
        <div
          ref={menuRef}
          id="tq-conversas-menu"
          role="menu"
          aria-label="Conversas"
          className="tq-conversas-lista"
        >
          <button
            type="button"
            role="menuitem"
            data-item
            className="tq-conversas-nova"
            onClick={() => {
              onNova();
              fechar(true);
            }}
          >
            <Icon name="plus" size={15} />
            Nova conversa
          </button>

          {conversas.length === 0 ? (
            <p className="tq-conversas-vazio">
              Nenhuma conversa guardada ainda. A primeira nasce quando você
              escrever.
            </p>
          ) : (
            <ul>
              {conversas.map((c) => {
                const atual = c.id === atualId;

                if (confirmando === c.id) {
                  return (
                    <li key={c.id}>
                      <div
                        className="tq-conversas-confirma"
                        role="alertdialog"
                        aria-label={`Apagar a conversa "${c.title}"?`}
                      >
                        <p>
                          Apagar <strong>{c.title}</strong>? As mensagens saem
                          deste computador para sempre.
                        </p>
                        <div className="tq-conversas-confirma-acoes">
                          <button
                            type="button"
                            data-item
                            className="perigo"
                            onClick={() => {
                              void onApagar(c.id).then((ok) => {
                                if (ok) setConfirmando(null);
                                else setErro('Não foi possível apagar a conversa.');
                              });
                            }}
                          >
                            Apagar
                          </button>
                          <button
                            type="button"
                            data-item
                            onClick={() => setConfirmando(null)}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                }

                return (
                  <li key={c.id} className="tq-conversas-linha">
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={atual}
                      data-item
                      className={atual ? 'atual' : undefined}
                      onClick={() => {
                        onEscolher(c.id);
                        fechar(true);
                      }}
                    >
                      <span className="tq-conversas-titulo">{c.title}</span>
                      <span className="tq-conversas-data">
                        {formatDate(c.updatedAt)}
                        {atual && ' · atual'}
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-item
                      className="tq-conversas-apagar"
                      title="Apagar esta conversa"
                      aria-label={`Apagar a conversa "${c.title}"`}
                      onClick={() => {
                        setErro('');
                        setConfirmando(c.id);
                      }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {erro && (
            <p className="tq-conversas-erro" role="alert">
              {erro}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
