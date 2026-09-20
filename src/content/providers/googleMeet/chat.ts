/**
 * Escrever no chat do Google Meet.
 *
 * ── Por que isto é, e sempre será, o pedaço mais frágil ──────────────────
 *
 * Não existe API para mandar mensagem no chat do Meet. O que existe é o DOM
 * dele, com classes ofuscadas que mudam sem aviso. Então este módulo é uma
 * pilha de fallbacks e uma promessa modesta: ele devolve `false` quando não
 * conseguiu, e quem chama NUNCA mostra confirmação em cima de um `false`. O
 * requisito é explícito sobre isso, e a alternativa (assumir sucesso) seria a
 * pessoa achar que avisou os participantes sem ter avisado.
 *
 * ── Por que o valor não é escrito com `.value = ` ────────────────────────
 *
 * O campo do Meet é controlado por um framework que só reage ao evento de
 * input do navegador. Atribuir `.value` direto muda o DOM e não o estado do
 * componente: a caixa mostra o texto e o botão de enviar continua desabilitado.
 * O caminho que funciona é chamar o setter NATIVO do protótipo e depois
 * despachar um `input` que borbulha — é assim que o framework escuta.
 */
import { queryFirst } from './selectors';

/** Abre o painel de chat. Primeiro que casar, vence. */
const CHAT_TOGGLE_SELECTORS = [
  'button[aria-label*="chat com todos" i]',
  'button[aria-label*="bate-papo" i]',
  'button[aria-label*="chat with everyone" i]',
  'button[aria-label*="chat" i]',
  '[jsname="A5il2e"]',
];

/** O campo de escrita do chat. */
const CHAT_INPUT_SELECTORS = [
  'textarea[aria-label*="enviar uma mensagem" i]',
  'textarea[aria-label*="send a message" i]',
  'textarea[placeholder*="mensagem" i]',
  'textarea[placeholder*="message" i]',
  'div[contenteditable="true"][aria-label*="mensagem" i]',
  'div[contenteditable="true"][aria-label*="message" i]',
  'textarea[jsname="YPqjbf"]',
];

/** O botão de enviar, ao lado do campo. */
const CHAT_SEND_SELECTORS = [
  'button[aria-label*="enviar mensagem" i]',
  'button[aria-label*="send a message" i]',
  'button[aria-label*="send message" i]',
  '[jsname="SoqoBf"]',
];

const ESPERA_MS = 250;
const TENTATIVAS = 16;

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function esperarPor(selectors: readonly string[]): Promise<Element | null> {
  for (let i = 0; i < TENTATIVAS; i++) {
    const achado = queryFirst(document, selectors);
    if (achado) return achado;
    await dormir(ESPERA_MS);
  }
  return null;
}

/** O setter do protótipo, que é o que o framework do Meet observa. */
function escrever(campo: Element, texto: string): boolean {
  if (campo instanceof HTMLTextAreaElement || campo instanceof HTMLInputElement) {
    const proto =
      campo instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (!setter) return false;
    campo.focus();
    setter.call(campo, texto);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  if (campo instanceof HTMLElement && campo.isContentEditable) {
    campo.focus();
    campo.textContent = texto;
    campo.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return true;
  }
  return false;
}

function confirmar(campo: Element): void {
  const botao = queryFirst(document, CHAT_SEND_SELECTORS);
  if (botao instanceof HTMLElement && !botao.hasAttribute('disabled')) {
    botao.click();
    return;
  }
  // Sem botão alcançável, o Enter é o caminho que o próprio Meet oferece.
  for (const type of ['keydown', 'keypress', 'keyup'] as const) {
    campo.dispatchEvent(
      new KeyboardEvent(type, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
}

/**
 * Manda o texto para o chat da reunião. Devolve se conseguiu.
 *
 * "Conseguiu" aqui significa: o campo foi encontrado, recebeu o texto, e o
 * envio foi confirmado com o campo voltando a ficar vazio — que é o único sinal
 * observável de que o Meet aceitou. Um campo que continua com o texto depois do
 * envio é uma falha, e é reportada como tal.
 */
export async function enviarNoChat(texto: string): Promise<boolean> {
  try {
    let campo = queryFirst(document, CHAT_INPUT_SELECTORS);

    if (!campo) {
      const toggle = queryFirst(document, CHAT_TOGGLE_SELECTORS);
      if (!(toggle instanceof HTMLElement)) return false;
      toggle.click();
      campo = await esperarPor(CHAT_INPUT_SELECTORS);
    }
    if (!campo) return false;

    if (!escrever(campo, texto)) return false;
    await dormir(120);
    confirmar(campo);

    // A confirmação observável: o Meet limpa o campo quando aceita a mensagem.
    for (let i = 0; i < 12; i++) {
      await dormir(150);
      const atual =
        campo instanceof HTMLTextAreaElement || campo instanceof HTMLInputElement
          ? campo.value
          : (campo.textContent ?? '');
      if (atual.trim().length === 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}
