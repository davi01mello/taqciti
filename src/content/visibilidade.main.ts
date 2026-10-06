/**
 * Mantém o Meet "visível" enquanto a captura roda — roda no mundo da PÁGINA.
 *
 * ── Por que existe ───────────────────────────────────────────────────────────
 *
 * A transcrição só andava com a aba do Meet à frente. Em aba de fundo o Chrome
 * diz à página que ela está escondida (`document.hidden`, `visibilityState`,
 * evento `visibilitychange`), e o Meet, que respeita isso para poupar CPU e
 * rede, para de atualizar as legendas no DOM. Sem DOM novo, não há o que ler.
 *
 * Aqui a página passa a ouvir "visível" — SÓ enquanto o TaqCiti está capturando
 * esta reunião. Fora disso, devolve o valor verdadeiro e não mexe em nada: o
 * Meet se comporta como sempre, e nenhuma outra aba é tocada (o script só roda
 * em meet.google.com).
 *
 * É melhor-esforço, e é dito assim: o Chrome ainda pode limitar timers e
 * quadros de uma aba escondida, coisa que nenhum script de página desfaz. Se a
 * transcrição ainda falhar com a aba atrás, a saída é pôr a reunião em janela
 * própria, visível ao lado das outras.
 *
 * ── O interruptor ────────────────────────────────────────────────────────────
 *
 * O content script (mundo isolado) liga e desliga com um evento no `document`,
 * que atravessa os dois mundos. Este arquivo não importa nada: ele é entregue
 * como está, e roda em `document_start`, antes de o Meet registrar o que quer.
 */
const EVENTO = 'taqciti:visibilidade';
const SINTETICO = '__taqcitiSintetico';

let ativa = false;

function sobrescrever(prop: 'hidden' | 'visibilityState' | 'webkitHidden' | 'webkitVisibilityState'): void {
  const original = Object.getOwnPropertyDescriptor(Document.prototype, prop);
  if (!original?.get) return;
  const falso = prop === 'hidden' || prop === 'webkitHidden' ? false : 'visible';
  Object.defineProperty(Document.prototype, prop, {
    configurable: true,
    enumerable: original.enumerable ?? true,
    get(this: Document) {
      return ativa ? falso : (original.get as () => unknown).call(this);
    },
  });
}

sobrescrever('hidden');
sobrescrever('visibilityState');
sobrescrever('webkitHidden');
sobrescrever('webkitVisibilityState');

// Com o interruptor ligado, o evento REAL de "escondida" não chega ao Meet. O
// sintético (nosso, para ele reler o estado) passa.
const barrar = (e: Event): void => {
  if (ativa && !(e as unknown as Record<string, unknown>)[SINTETICO]) e.stopImmediatePropagation();
};
window.addEventListener('visibilitychange', barrar, true);
document.addEventListener('visibilitychange', barrar, true);

document.addEventListener(EVENTO, (e) => {
  const quer = Boolean((e as CustomEvent<{ ativa?: boolean }>).detail?.ativa);
  if (quer === ativa) return;
  ativa = quer;
  // O Meet já pode ter reagido a "escondida": pede que ele releia o estado.
  const evento = new Event('visibilitychange');
  (evento as unknown as Record<string, unknown>)[SINTETICO] = true;
  document.dispatchEvent(evento);
});
