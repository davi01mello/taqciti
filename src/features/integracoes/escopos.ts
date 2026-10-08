/**
 * Os escopos OAuth das integrações da organização — declarados num lugar só.
 *
 * O login é a conta Google do CITi (Workspace). Estes são os escopos que o Taq
 * pede, cada um por um motivo que cabe numa linha. A lista completa é o TETO:
 * `chrome.identity.getAuthToken` aceita `scopes` próprios, então cada chamada
 * pede só o que a capacidade precisa (ver `token.ts`).
 *
 * Os passos para registrá-los no Google Cloud estão em
 * `docs/integracoes-google-workspace.md`. Se mudar algo aqui, mude lá.
 */

export const ESCOPO_IDENTIDADE = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

export const ESCOPO_GMAIL_ENVIAR = 'https://www.googleapis.com/auth/gmail.send';
export const ESCOPO_DIRETORIO = 'https://www.googleapis.com/auth/directory.readonly';
export const ESCOPO_AGENDA_EVENTOS = 'https://www.googleapis.com/auth/calendar.events';
export const ESCOPO_AGENDA_LIVRE_OCUPADO = 'https://www.googleapis.com/auth/calendar.freebusy';

/** O que o Taq consegue fazer fora do computador, e do que cada coisa depende. */
export const CAPACIDADES_EXTERNAS = [
  'diretorio',
  'email',
  'agenda_consulta',
  'agenda_eventos',
] as const;
export type CapacidadeExterna = (typeof CAPACIDADES_EXTERNAS)[number];

export const ESCOPOS_POR_CAPACIDADE: Readonly<Record<CapacidadeExterna, readonly string[]>> = {
  /** Achar colegas da MESMA organização (People API, diretório do domínio). */
  diretorio: [ESCOPO_DIRETORIO],
  /** Enviar e-mail como a própria pessoa. Só envia: não lê a caixa de entrada. */
  email: [ESCOPO_GMAIL_ENVIAR],
  /** Ver quando os colegas estão ocupados (só ocupado/livre, sem os títulos). */
  agenda_consulta: [ESCOPO_AGENDA_LIVRE_OCUPADO, ESCOPO_AGENDA_EVENTOS],
  /** Criar, remarcar e cancelar eventos na agenda da própria pessoa. */
  agenda_eventos: [ESCOPO_AGENDA_EVENTOS],
};

/** Tudo o que a conexão pede de uma vez, quando a pessoa conecta a conta. */
export const ESCOPOS_DA_CONEXAO: readonly string[] = [
  ...ESCOPO_IDENTIDADE,
  ESCOPO_GMAIL_ENVIAR,
  ESCOPO_DIRETORIO,
  ESCOPO_AGENDA_EVENTOS,
  ESCOPO_AGENDA_LIVRE_OCUPADO,
];

/** Domínios de conta pessoal: não há "organização" nem diretório do domínio. */
export const DOMINIOS_PESSOAIS: readonly string[] = ['gmail.com', 'googlemail.com'];
