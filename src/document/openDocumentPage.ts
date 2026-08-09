/**
 * Abre o site do DocsCiti (server/public/mockup) numa aba nova, pra uma
 * reunião específica — destino do botão "Gerar Documento". Sempre via
 * mensagem pro background, nunca chrome.tabs.create direto: o painel
 * injetado no Meet roda como content script e não tem acesso a chrome.tabs,
 * então rotear tudo por aqui é o que deixa esta função segura de reusar em
 * QUALQUER contexto da extensão (side panel, popup, painel no Meet), sem
 * duplicar lógica nem correr risco de alguém reusar isto de onde
 * chrome.tabs não existe.
 */
import { sendMessage } from '@/shared/services/messaging';

export function openDocumentPage(meetingId: string): void {
  void sendMessage({ type: 'document/openRequest', meetingId });
}
