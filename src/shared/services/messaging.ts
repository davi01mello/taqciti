/**
 * Mensageria tipada entre contextos da extensão. Toda mensagem que entra num
 * handler passa por zod; mensagens malformadas são ignoradas (e logadas em dev).
 */
import type { ExtensionMessage } from '@/shared/types/messages';
import { messageSchema } from '@/shared/types/messages';
import { logger } from './log';

/** Envia uma mensagem ao background (ou broadcast) e tipa a resposta. */
export async function sendMessage<R = unknown>(
  message: ExtensionMessage,
): Promise<R | null> {
  try {
    return (await chrome.runtime.sendMessage(message)) as R;
  } catch (error) {
    // Contexto destino pode não existir (ex.: painel lateral fechado) — esperado.
    logger.debug('sendMessage sem destinatário', { type: message.type, error });
    return null;
  }
}

export type MessageHandler = (
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
) => Promise<unknown> | unknown | undefined;

/**
 * Registra um handler validado. Retornar uma Promise (ou valor) responde à
 * mensagem; retornar `undefined` deixa a resposta para outro listener.
 */
export function onMessage(handler: MessageHandler): () => void {
  const listener = (
    raw: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): boolean => {
    const parsed = messageSchema.safeParse(raw);
    if (!parsed.success) {
      logger.debug('mensagem inválida descartada', { issues: parsed.error.issues });
      return false;
    }
    const result = handler(parsed.data, sender);
    if (result === undefined) return false;
    Promise.resolve(result)
      .then(sendResponse)
      .catch((error) => {
        logger.error('handler de mensagem falhou', error);
        sendResponse({ ok: false, error: 'internal' });
      });
    return true; // resposta assíncrona
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
