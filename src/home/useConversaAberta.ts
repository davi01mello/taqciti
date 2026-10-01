/**
 * Qual conversa está aberta — a mesma regra na HOME e na sidebar.
 *
 * Sem escolha, abre a mais recente, e ela passa a ser a ESCOLHIDA: daí em
 * diante a tela sabe qual está mostrando. É isso que permite o caso que a
 * regra antiga ("sem escolha = a mais recente") errava em silêncio — a conversa
 * aberta é apagada (pela outra tela, pelo menu, ou pelo próprio Taq) e a tela
 * passava a mostrar OUTRA conversa como se nada tivesse acontecido. Agora ela
 * vai para o estado de conversa nova, limpa.
 *
 * "Sumiu" só vale para a conversa que a tela já viu na lista: a recém-criada
 * ainda não chegou pelo observador de storage, e não pode ser dada como apagada.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Conversation } from './conversations';

export function useConversaAberta(conversas: readonly Conversation[]) {
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [iniciandoNova, setIniciandoNova] = useState(false);
  const vistas = useRef(new Set<string>());

  const sumiu =
    conversaId !== null &&
    vistas.current.has(conversaId) &&
    !conversas.some((c) => c.id === conversaId);

  const conversa = useMemo(
    () =>
      iniciandoNova || sumiu
        ? null
        : (conversas.find((c) => c.id === conversaId) ?? conversas[0] ?? null),
    [conversas, conversaId, iniciandoNova, sumiu],
  );

  useEffect(() => {
    for (const c of conversas) vistas.current.add(c.id);
  }, [conversas]);

  useEffect(() => {
    if (sumiu) {
      setConversaId(null);
      setIniciandoNova(true);
    } else if (conversaId === null && conversa && !iniciandoNova) {
      // A mais recente, mostrada por padrão, vira a escolhida.
      setConversaId(conversa.id);
    }
  }, [sumiu, conversaId, conversa, iniciandoNova]);

  const escolher = useCallback((id: string) => {
    setConversaId(id);
    setIniciandoNova(false);
  }, []);
  const nova = useCallback(() => {
    setConversaId(null);
    setIniciandoNova(true);
  }, []);

  return { conversa, conversaId, escolher, nova };
}
