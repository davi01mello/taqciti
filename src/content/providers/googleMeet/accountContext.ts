import type { MeetAccountContext } from '@/shared/types/domain';

const EMAIL_PATTERN = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/i;

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

function isGoogleAccountControl(element: Element, label: string): boolean {
  if (element.hasAttribute('data-email')) return true;
  const normalized = normalize(label);
  return (
    normalized.includes('google account') ||
    normalized.includes('conta do google') ||
    normalized.includes('manage your google account') ||
    normalized.includes('gerenciar sua conta do google')
  );
}

function displayNameFromLabel(label: string, email: string): string | null {
  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withoutEmail = label.replace(new RegExp(escapedEmail, 'i'), ' ');
  const cleaned = withoutEmail
    .replace(/\b(?:google account|conta do google|manage your google account|gerenciar sua conta do google)\b/gi, ' ')
    .replace(/[():,|·]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 2 && cleaned.length <= 120 ? cleaned : null;
}

/**
 * Lê somente controles semânticos da conta Google. Texto solto da página (ou
 * da legenda) nunca é considerado, ainda que contenha um endereço de e-mail.
 * A conta percebida é contexto visual; não autentica nem autoriza o produto.
 */
export function readMeetAccountContext(root: ParentNode = document): MeetAccountContext | null {
  const controls = root.querySelectorAll(
    '[data-email], button[aria-label], [role="button"][aria-label], a[aria-label]',
  );
  for (const element of controls) {
    if (element.closest('[aria-live="polite"], [aria-live="assertive"]')) continue;
    const label = [
      element.getAttribute('aria-label'),
      element.getAttribute('data-email'),
      element.getAttribute('title'),
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ');
    if (!isGoogleAccountControl(element, label)) continue;
    const email = label.match(EMAIL_PATTERN)?.[0]?.toLocaleLowerCase('en-US') ?? null;
    if (!email) continue;
    return {
      email,
      displayName: displayNameFromLabel(label, email),
      observedAt: Date.now(),
      source: 'meet_account_control',
      confidence: 0.95,
    };
  }
  return null;
}
