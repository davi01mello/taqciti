/**
 * A navegação lateral: recolhida por padrão, aberta ao encostar na faixa clara.
 *
 * ── Por que ela recolhia ao clicar ─────────────────────────────────────────
 *
 * Não era o hover falhando: era a HOME mandando fechar. O `onIr` chamava
 * `setNavAberta(false)` junto com a troca de seção, então todo clique numa
 * seção fechava a barra — mesmo com o ponteiro parado dentro dela. Parecia
 * regressão do hover e era uma linha de código dizendo "feche".
 *
 * Agora quem decide o fechamento é só a posição do ponteiro e o foco. Clicar
 * navega, e nada mais. A barra fecha quando se sai dela.
 *
 * ── Por que a faixa e a barra não podem ter um vão ─────────────────────────
 *
 * A faixa sensível é a MESMA área que a barra ocupa quando aberta: a faixa tem
 * 30px e a barra começa em 0, então atravessar uma para a outra nunca passa por
 * terra de ninguém. A zona de fechamento fica DEPOIS da barra inteira (ver
 * `LIMITE_FECHAR`), com uma folga — antes ela começava em 290px, enquanto a
 * barra tem 268 e uma máscara que a desmancha até lá: o ponteiro cruzava a
 * borda esmaecida e já estava em território de fechar.
 *
 * ── Por que o fechamento é adiado ──────────────────────────────────────────
 *
 * Abrir no `pointerenter` e fechar no `pointerleave` pisca. O ponteiro
 * atravessa costuras entre elementos, some por um quadro ao cruzar o gradiente
 * da borda, e cada solavanco desses vira um fecha-abre. O adiamento absorve a
 * travessia: a barra só fecha se o ponteiro ficar fora durante todo esse tempo.
 *
 * ── Por que a decisão é tomada na HORA DE FECHAR ───────────────────────────
 *
 * Havia um guarda para o teclado: não fechar se o foco estivesse dentro da
 * barra. Ele parecia inofensivo e desligava a barra inteira do mouse — porque
 * CLICAR num link também dá foco a ele. Depois do primeiro clique numa seção,
 * `nav.contains(document.activeElement)` era sempre verdadeiro, o temporizador
 * sempre desistia, e a barra ficava presa aberta para sempre, sem responder
 * mais ao ponteiro. Do lado de fora, isso é "a barra não acompanha o mouse".
 *
 * A correção é perguntar no instante do fechamento, e sobre o que importa:
 *
 *   - o ponteiro está, AGORA, na faixa ou sobre a barra? (posição, não evento)
 *   - existe foco de TECLADO lá dentro? (`:focus-visible`, que um clique de
 *     mouse não satisfaz — é exatamente a distinção que faltava)
 *
 * Decidir por posição, e não por uma sequência de eventos de entrada e saída,
 * também imuniza a barra contra elementos desenhados por cima dela (o
 * cabeçalho, por exemplo): atravessá-los dispara `pointerleave` na barra, mas
 * na hora de fechar o ponteiro continua onde estava.
 *
 * O `inert` quando fechada tira os botões da ordem de tabulação: uma barra
 * escondida não pode capturar o Tab de quem está tentando chegar no campo de
 * escrita.
 */
import { useCallback, useEffect, useRef } from 'react';
import { Icon, type IconName } from '@/shared/ui/Icon';
import type { Secao } from './rota';

export type { Secao };

export const SECOES: ReadonlyArray<{ id: Secao; rotulo: string; icone: IconName }> = [
  { id: 'assistente', rotulo: 'Assistente', icone: 'sparkles' },
  { id: 'reunioes', rotulo: 'Reuniões', icone: 'history' },
  { id: 'documentos', rotulo: 'Documentos', icone: 'doc' },
  { id: 'conexoes', rotulo: 'Conexões', icone: 'link' },
];

/** Largura da faixa sensível, em px. Generosa o bastante para ser alcançada
 *  sem mira, estreita o bastante para não abrir sozinha durante a leitura. */
const FAIXA = 34;
/** Largura da barra (268) mais uma folga — só além disto é "saiu". */
const LIMITE_FECHAR = 316;
const ATRASO_FECHAR = 340;

/**
 * `:focus-visible` existe neste motor?
 *
 * É a pergunta que separa "chegou aqui pelo teclado" de "clicou com o mouse".
 * Onde ela não existe (jsdom, motores antigos), `querySelector` lança em vez de
 * devolver `null` — e aí o guarda de teclado simplesmente não entra, que é o
 * padrão certo: sem ele, quem manda é a posição do ponteiro, e nenhuma barra
 * fica presa aberta.
 */
const SUPORTA_FOCUS_VISIBLE = (() => {
  try {
    document.querySelector(':focus-visible');
    return true;
  } catch {
    return false;
  }
})();

interface Props {
  ativa: Secao;
  aberta: boolean;
  onAbrir: (aberta: boolean) => void;
  onIr: (secao: Secao) => void;
}

export function SideNav({ ativa, aberta, onAbrir, onIr }: Props) {
  const navRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const abertaRef = useRef(aberta);
  abertaRef.current = aberta;
  /** Onde o ponteiro está de verdade. Começa longe: sem mouse, nada segura. */
  const xRef = useRef(Number.POSITIVE_INFINITY);

  const cancelar = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fecharDepois = useCallback(() => {
    cancelar();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      // O ponteiro ainda está na faixa ou sobre a barra: a pessoa está aqui.
      if (xRef.current <= LIMITE_FECHAR) return;
      // Foco de TECLADO lá dentro: idem. Um clique de mouse não conta — foi
      // contá-lo que deixava a barra presa aberta depois de cada navegação.
      const nav = navRef.current;
      if (SUPORTA_FOCUS_VISIBLE && nav?.querySelector(':focus-visible')) return;
      onAbrir(false);
    }, ATRASO_FECHAR);
  }, [cancelar, onAbrir]);

  // A faixa é sensível no documento inteiro, não só no elemento: o ponteiro
  // precisa "encontrar" a barra vindo de qualquer lugar da tela.
  useEffect(() => {
    const aoMover = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      xRef.current = e.clientX;
      if (e.clientX <= FAIXA) {
        cancelar();
        if (!abertaRef.current) onAbrir(true);
      } else if (abertaRef.current && e.clientX > LIMITE_FECHAR) {
        fecharDepois();
      } else {
        // Entre a borda da barra e o limite: território dela. Um temporizador
        // em curso aqui seria o fechamento disparado por um tremor de mão.
        cancelar();
      }
    };
    window.addEventListener('pointermove', aoMover, { passive: true });
    return () => window.removeEventListener('pointermove', aoMover);
  }, [cancelar, fecharDepois, onAbrir]);

  useEffect(() => cancelar, [cancelar]);

  return (
    <>
      <button
        type="button"
        className="tq-edge"
        aria-label={aberta ? 'Fechar navegação' : 'Abrir navegação'}
        aria-expanded={aberta}
        aria-controls="tq-nav"
        onClick={() => onAbrir(!aberta)}
        onFocus={() => onAbrir(true)}
      />

      <nav
        id="tq-nav"
        ref={navRef}
        className="tq-nav"
        aria-label="Navegação principal"
        // `inert` fora da ordem de tabulação quando fechada. O atributo é
        // booleano no DOM; o React o repassa como tal desde a 19, e como
        // string vazia aqui para não depender dessa versão.
        {...(aberta ? {} : { inert: '' })}
        onPointerEnter={cancelar}
        onPointerLeave={fecharDepois}
        onFocusCapture={cancelar}
        onBlurCapture={fecharDepois}
      >
        {/* Sem repetir a marca aqui: o cabeçalho já a mostra, no mesmo canto. */}
        <div className="tq-navlinks">
          {SECOES.map((secao) => (
            <button
              key={secao.id}
              type="button"
              // Navegar, e SÓ navegar. Fechar aqui era o bug.
              onClick={() => onIr(secao.id)}
              {...(ativa === secao.id ? { 'aria-current': 'page' as const } : {})}
            >
              <Icon name={secao.icone} size={16} />
              {secao.rotulo}
            </button>
          ))}
        </div>

        <div className="tq-navfoot">Menos ruído. Mais conversa.</div>
      </nav>
    </>
  );
}
