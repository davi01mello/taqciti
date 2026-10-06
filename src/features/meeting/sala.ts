/**
 * Qual é a SALA de um endereço do Meet — a regra única, usada pela página e pelo
 * background (os dois precisam concordar, senão o background encerra a captura
 * de uma sala que a página acha que é a mesma).
 *
 * Aceita:
 *   - o código padrão, `abc-defg-hij`, com ou sem barra final;
 *   - o apelido de sala do Workspace (`/sala-do-citi`), que o Meet usa no lugar
 *     do código e que o padrão antigo (3-4-3) simplesmente não reconhecia: quem
 *     entrava por esse link nunca tinha a captura oferecida.
 *
 * Não aceita as páginas do próprio Meet (`/landing`, `/new`, `/lookup/…`).
 * Um apelido só vira "reunião" se a tela tiver o botão de sair (ver o
 * provider); aqui só se diz qual seria o nome da sala.
 */
const CODIGO = /^\/([a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3})\/?$/i;
const APELIDO = /^\/([a-z0-9][a-z0-9_-]{2,62})\/?$/i;

const PAGINAS_DO_MEET = new Set([
  'landing',
  'new',
  'lookup',
  'tel',
  '_meet',
  'whoknows',
  'about',
  'help',
  'calls',
  'settings',
  'ratings',
  'unsupported',
  'error',
  'check',
  'linkredirect',
]);

export function salaDoCaminho(pathname: string): string | null {
  const codigo = CODIGO.exec(pathname);
  if (codigo?.[1]) return codigo[1].toLowerCase();
  const apelido = APELIDO.exec(pathname);
  const nome = apelido?.[1]?.toLowerCase();
  if (!nome || PAGINAS_DO_MEET.has(nome)) return null;
  return nome;
}

/** O código da sala num endereço do Meet, ou `null` se não é uma sala. */
export function salaDaUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'meet.google.com') return null;
    return salaDoCaminho(u.pathname);
  } catch {
    return null;
  }
}
