/**
 * A quem o TaqCiti serve: contas da organização, e só elas.
 *
 * ── Fail-closed, e por quê ────────────────────────────────────────────────
 *
 * Esta restrição já existia como `TAQCITI_DOMINIO_PERMITIDO`, mas VAZIO
 * significava "qualquer conta Google verificada". Uma variável esquecida num
 * deploy (ou apagada sem querer) abria o produto inteiro — e o acervo guarda
 * transcrição de reunião de gente do CITi. Agora o padrão é `citi.org.br`: a
 * variável só serve para TROCAR o domínio, e deixá-la de fora não abre nada.
 *
 * Abrir de propósito (desenvolvimento, testes) exige dizer isso com todas as
 * letras: `TAQCITI_DOMINIO_PERMITIDO=*`. Um valor que ninguém escreve por
 * acidente.
 *
 * ── O que isto confere, e o que não confere ───────────────────────────────
 *
 * Confere o e-mail (já verificado pelo Google, ver `google.ts`) e, quando o
 * Google informa, o domínio hospedado (`hd`) da conta. NÃO exige o `hd`:
 * contas do CITi que não sejam do Google Workspace não o têm, e exigi-lo
 * trancaria gente legítima do lado de fora. O e-mail é a barreira; `hd` só
 * pode ADICIONAR uma recusa (um `hd` de outra organização nunca passa).
 *
 * Vale para todo caminho que entrega acervo: o login da extensão
 * (`/api/sync` e demais) e o token do conector (Claude/ChatGPT), que é
 * conferido contra o e-mail da dona a cada uso — um token criado quando a
 * regra era frouxa deixa de funcionar para quem não é da organização.
 */

/** O domínio de quem pode usar o TaqCiti, a menos que o ambiente diga outro. */
export const DOMINIO_PADRAO = 'citi.org.br';

/** Valor que desliga a restrição — só para desenvolvimento. */
export const SEM_RESTRICAO = '*';

/**
 * O domínio exigido, ou `null` quando a restrição foi desligada
 * EXPLICITAMENTE. Nunca `null` por omissão.
 */
export function dominioPermitido(): string | null {
  const bruto = process.env.TAQCITI_DOMINIO_PERMITIDO?.trim().toLowerCase();
  if (!bruto) return DOMINIO_PADRAO;
  if (bruto === SEM_RESTRICAO) return null;
  return bruto.replace(/^@/, '');
}

/** O e-mail termina em `@<domínio>`, exatamente (`naoehciti.org.br` não passa). */
export function emailPermitido(email: string | null | undefined): boolean {
  const dominio = dominioPermitido();
  if (dominio === null) return true;
  return typeof email === 'string' && email.trim().toLowerCase().endsWith(`@${dominio}`);
}

/** O `hd` que o Google informou é de OUTRA organização? (Ausente não é.) */
export function dominioHospedadoDeFora(hd: string | null | undefined): boolean {
  const dominio = dominioPermitido();
  if (dominio === null || !hd) return false;
  return hd.trim().toLowerCase() !== dominio;
}

export function mensagemDeRestricao(): string {
  const dominio = dominioPermitido();
  return `O TaqCiti está restrito a contas @${dominio ?? DOMINIO_PADRAO}.`;
}
