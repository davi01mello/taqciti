/**
 * A navegação lateral: recolhida por padrão, aberta ao encostar na faixa clara.
 *
 * ── Por que o fechamento é adiado ──────────────────────────────────────────
 *
 * Abrir no `pointerenter` e fechar no `pointerleave` pisca. O ponteiro
 * atravessa costuras entre elementos, some por um quadro ao cruzar o gradiente
 * da borda, e cada solavanco desses vira um fecha-abre. O adiamento de ~350ms
 * absorve a travessia: a barra só fecha se o ponteiro ficar fora durante todo
 * esse tempo. Qualquer retorno no meio cancela o temporizador.
 *
 * ── Por que também fecha por foco, e não só por mouse ──────────────────────
 *
 * Quem navega por teclado não tem `pointerleave`. O `focusout` faz o papel
 * equivalente, e o `focus` na faixa abre — sem isso a barra seria alcançável
 * pelo Tab mas invisível, que é pior do que não ser alcançável. O `inert`
 * quando fechada tira os botões da ordem de tabulação: uma barra escondida não
 * pode capturar o Tab de quem está tentando chegar no campo de escrita.
 */
import { useCallback, useEffect, useRef } from 'react';
import { Icon, type IconName } from '@/shared/ui/Icon';

export type Secao = 'assistente' | 'reunioes' | 'documentos' | 'conexoes';

export const SECOES: ReadonlyArray<{ id: Secao; rotulo: string; icone: IconName }> = [
  { id: 'assistente', rotulo: 'Assistente', icone: 'sparkles' },
  { id: 'reunioes', rotulo: 'Reuniões', icone: 'history' },
  { id: 'documentos', rotulo: 'Documentos', icone: 'doc' },
  { id: 'conexoes', rotulo: 'Conexões', icone: 'link' },
];

/** Largura da faixa sensível, em px. Generosa o bastante para ser alcançada
 *  sem mira, estreita o bastante para não abrir sozinha durante a leitura. */
const FAIXA = 30;
const ATRASO_FECHAR = 350;

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
      // Não fecha embaixo do teclado: se o foco está dentro, a pessoa está lá.
      const nav = navRef.current;
      if (nav && nav.contains(document.activeElement)) return;
      onAbrir(false);
    }, ATRASO_FECHAR);
  }, [cancelar, onAbrir]);

  // A faixa é sensível no documento inteiro, não só no elemento: o ponteiro
  // precisa "encontrar" a barra vindo de qualquer lugar da tela.
  useEffect(() => {
    const aoMover = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (e.clientX <= FAIXA) {
        cancelar();
        if (!abertaRef.current) onAbrir(true);
      } else if (abertaRef.current && e.clientX > 290) {
        fecharDepois();
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
        {/* Sem repetir a marca aqui: o cabeçalho já a mostra, no mesmo canto,
            e as duas se sobrepunham quando a barra abria. */}
        <div className="tq-navlinks">
          {SECOES.map((secao) => (
            <button
              key={secao.id}
              type="button"
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
