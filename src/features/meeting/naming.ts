/**
 * Nomeação da reunião — funções puras.
 *
 * Regra do usuário: se a pessoa deu um nome, ele MANDA e nunca é sobrescrito.
 * Só quando não há nome (o Meet entrega "Meet - gbx-hgdk-ywb", que não é nome
 * de nada) a extensão preenche sozinha: pelo cliente na sala, ou pela data.
 */
import type { Participant } from '@/shared/types/domain';
import { firstNameOf, isSelfCaptionLabel } from '@/features/transcription/sanitize';

const MEETING_CODE = /^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/i;

/**
 * Extrai um nome de verdade do `document.title` do Meet, ou `''` quando o que
 * sobra é só o código da sala (sinal para o background auto-nomear).
 *
 * "Meet - gbx-hgdk-ywb" → ""      (código, não é nome)
 * "gbx-hgdk-ywb"        → ""
 * "Kickoff Sympla"      → "Kickoff Sympla"  (nome real do usuário, preservado)
 */
export function cleanMeetingTitle(documentTitle: string, meetingCode: string): string {
  let title = documentTitle.replace(/\s*[-–—]\s*Google Meet.*$/i, '').trim();
  // Prefixo "Meet - " / "Meet: " que o Google coloca antes do código.
  title = title.replace(/^meet\s*[-–—:]\s*/i, '').trim();

  if (title.length === 0) return '';
  if (title.toLowerCase() === meetingCode.toLowerCase()) return '';
  if (MEETING_CODE.test(title)) return '';
  return title;
}

/**
 * Nome automático a partir de quem está na sala além de mim (o cliente).
 * "Reunião com Ana" · "Reunião com Ana e Bruno" · "Reunião com Ana e mais 2".
 * `null` quando ninguém além do anfitrião foi identificado ainda.
 */
export function deriveMeetingTitle(participants: readonly Participant[]): string | null {
  const clients = participants
    .filter((participant) => participant.isHost !== true)
    // "Você" é o rótulo que o Meet dá à PRÓPRIA pessoa antes de o nome real
    // aparecer no DOM. Nunca é cliente, e virava "Reunião com Você".
    .filter((participant) => !isSelfCaptionLabel(participant.name))
    .map((participant) => firstNameOf(participant.name))
    .filter((name) => name.length > 0);

  if (clients.length === 0) return null;
  if (clients.length === 1) return `Reunião com ${clients[0]}`;
  if (clients.length === 2) return `Reunião com ${clients[0]} e ${clients[1]}`;
  return `Reunião com ${clients[0]} e mais ${clients.length - 1}`;
}

/** É um título gerado pela extensão (data ou cliente), não digitado pela pessoa? */
export function isAutoTitle(title: string): boolean {
  return /^reuni[ãa]o\b/i.test(title.trim());
}
