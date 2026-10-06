/**
 * O botão do TaqCiti NA BARRA DE BAIXO do Meet, ao lado de microfone, câmera e
 * "sair" — para parecer parte do Meet, e não uma janela por cima dele.
 *
 * ── Frágil de propósito, e com rede ────────────────────────────────────────
 *
 * O Meet não oferece lugar para extensões. A barra é achada pelo botão de sair
 * (o mesmo sinal que a detecção da chamada usa): sobe até o primeiro ancestral
 * que agrupa vários botões e entra logo antes dele. Se o Meet mudar a barra, o
 * botão simplesmente não monta — e `montado()` diz isso ao controller, que então
 * mantém a cápsula flutuante como sempre foi. Nada some junto.
 *
 * O Meet redesenha a barra sem avisar e leva embora o que não é dele, então a
 * posição é CONFERIDA a cada passada (`sincronizar`), e o botão volta ao lugar.
 *
 * Vanilla de propósito: é um botão. Nada de React dentro da barra do Meet.
 */
import { LEAVE_CALL_SELECTORS } from './selectors';

const ID = 'taqciti-botao-na-barra';
const ID_ESTILO = 'taqciti-botao-na-barra-estilo';
const ATRIBUTO = 'data-taqciti-estado';

export type TomDoBotao = 'verde' | 'ambar' | 'vermelho' | 'neutro';

export interface EstadoDoBotao {
  tom: TomDoBotao;
  /** Pulsa: a captura está viva. */
  pulsando: boolean;
  /** O que o leitor de tela e a dica dizem. */
  rotulo: string;
}

const COR: Record<TomDoBotao, string> = {
  verde: '#5ad88a',
  ambar: '#f2c94c',
  vermelho: '#ff6b5e',
  neutro: '#9aa0a6',
};

const ESTILO = `
#${ID} {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin: 0 6px;
  border-radius: 50%;
  background: rgb(60, 64, 67);
  cursor: pointer;
  flex: 0 0 auto;
  transition: background-color 0.15s;
}
#${ID}:hover { background: rgb(77, 81, 86); }
#${ID}:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 2px; }
#${ID} svg { width: 22px; height: 22px; display: block; }
#${ID}[${ATRIBUTO}~="pulsando"] .taqciti-miolo {
  animation: taqciti-pulso 1.6s ease-in-out infinite;
}
@keyframes taqciti-pulso { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) {
  #${ID}[${ATRIBUTO}~="pulsando"] .taqciti-miolo { animation: none; }
}
`;

function visivel(el: Element): boolean {
  return typeof el.checkVisibility !== 'function' || el.checkVisibility();
}

/** Onde a barra está: o pai que agrupa os botões, e o filho antes do qual entrar. */
function acharBarra(): { pai: Element; antes: Element } | null {
  for (const seletor of LEAVE_CALL_SELECTORS) {
    for (const sair of document.querySelectorAll(seletor)) {
      if (!visivel(sair)) continue;
      let no: Element = sair;
      for (let nivel = 0; nivel < 5 && no.parentElement; nivel += 1) {
        const pai: Element = no.parentElement;
        if (pai === document.body) break;
        if (pai.querySelectorAll('button').length >= 4) return { pai, antes: no };
        no = pai;
      }
    }
  }
  return null;
}

function icone(cor: string): string {
  // Um anel e, dentro, o ponto: o "gravar" de sempre, sem texto.
  return (
    `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<circle cx="12" cy="12" r="8.5" fill="none" stroke="#e8eaed" stroke-width="1.6"/>` +
    `<circle class="taqciti-miolo" cx="12" cy="12" r="4.2" fill="${cor}"/></svg>`
  );
}

export class BotaoNaBarra {
  private el: HTMLButtonElement | null = null;
  private ultimo = '';

  constructor(private readonly aoClicar: () => void) {}

  /** O botão está na barra do Meet agora? */
  montado(): boolean {
    return this.el !== null && this.el.isConnected;
  }

  /** Cria, recoloca e atualiza. Devolve se o botão está na barra depois disto. */
  sincronizar(estado: EstadoDoBotao): boolean {
    const barra = acharBarra();
    if (!barra) {
      this.remover();
      return false;
    }
    this.garantirEstilo();
    if (!this.el) this.el = this.criar();
    // Já no lugar certo? Não mexe: reinserir a cada passada piscaria.
    if (this.el.parentElement !== barra.pai || this.el.nextElementSibling !== barra.antes) {
      barra.pai.insertBefore(this.el, barra.antes);
    }
    const chave = `${estado.tom}|${estado.pulsando}|${estado.rotulo}`;
    if (chave !== this.ultimo) {
      this.ultimo = chave;
      this.el.setAttribute(ATRIBUTO, estado.pulsando ? 'pulsando' : 'parado');
      this.el.setAttribute('aria-label', estado.rotulo);
      this.el.title = estado.rotulo;
      this.el.innerHTML = icone(COR[estado.tom]);
    }
    return true;
  }

  remover(): void {
    this.el?.remove();
    this.el = null;
    this.ultimo = '';
    document.getElementById(ID_ESTILO)?.remove();
  }

  private criar(): HTMLButtonElement {
    const botao = document.createElement('button');
    botao.id = ID;
    botao.type = 'button';
    // O clique é tratado aqui, sem `await` antes: é o gesto dele que autoriza o
    // Chrome a abrir a sidebar.
    botao.addEventListener('click', (e) => {
      e.stopPropagation();
      this.aoClicar();
    });
    return botao;
  }

  private garantirEstilo(): void {
    if (document.getElementById(ID_ESTILO)) return;
    const estilo = document.createElement('style');
    estilo.id = ID_ESTILO;
    estilo.textContent = ESTILO;
    document.head.appendChild(estilo);
  }
}
