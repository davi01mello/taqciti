/**
 * Quando a HOME tem permissão para se mexer.
 *
 * Duas perguntas diferentes, e as duas precisam ser respondidas ANTES de
 * qualquer `requestAnimationFrame`:
 *
 *   1. **A pessoa pediu menos movimento?** `prefers-reduced-motion` não é
 *      preferência estética: para quem tem sensibilidade vestibular, uma onda
 *      subindo e descendo sem parar é sintoma, não enfeite. Aqui isso congela
 *      a animação — a onda continua desenhada, parada, porque o pedido é para
 *      reduzir movimento, não para apagar a interface.
 *   2. **A aba está visível?** Uma aba de fundo não deve gastar CPU nem
 *      bateria desenhando o que ninguém vê. O navegador já estrangula o rAF
 *      em aba oculta, mas "estrangulado" não é "parado", e a conta chega
 *      igual num notebook com vinte abas.
 *
 * O `motivo` existe para a UI poder explicar: o botão de pausa precisa dizer
 * se está pausado por escolha de quem clicou ou pela preferência do sistema —
 * um botão que não reage porque o sistema mandou parar parece quebrado.
 */
import { useEffect, useState } from 'react';

export type MotivoDePausa = 'preferencia' | 'aba-oculta' | 'usuario' | null;

export interface EstadoDaAnimacao {
  /** `true` quando o laço de desenho deve avançar o tempo. */
  animando: boolean;
  /** `true` quando o sistema pede menos movimento. */
  movimentoReduzido: boolean;
  motivo: MotivoDePausa;
}

export function useAnimacao(pausadaPeloUsuario: boolean): EstadoDaAnimacao {
  const [movimentoReduzido, setMovimentoReduzido] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [visivel, setVisivel] = useState(() => !document.hidden);

  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const aoMudar = () => setMovimentoReduzido(mq.matches);
    mq.addEventListener('change', aoMudar);
    return () => mq.removeEventListener('change', aoMudar);
  }, []);

  useEffect(() => {
    const aoMudar = () => setVisivel(!document.hidden);
    document.addEventListener('visibilitychange', aoMudar);
    return () => document.removeEventListener('visibilitychange', aoMudar);
  }, []);

  const motivo: MotivoDePausa = movimentoReduzido
    ? 'preferencia'
    : !visivel
      ? 'aba-oculta'
      : pausadaPeloUsuario
        ? 'usuario'
        : null;

  return { animando: motivo === null, movimentoReduzido, motivo };
}
