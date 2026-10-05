/**
 * Quando cada capacidade externa está DISPONÍVEL — e por que não está.
 *
 * Quatro estados, os mesmos do catálogo de agentes:
 *
 *   planned                  — não existe código (nenhuma capacidade externa está assim)
 *   implemented_unconfigured — o código existe, falta configuração externa
 *                              (cliente OAuth, conta conectada, escopo, conta de organização)
 *   available                — pode ser oferecida ao modelo
 *   disabled                 — a pessoa desligou
 *
 * "Disponível" é decidido por FATOS verificáveis aqui, nunca pelo modelo: há
 * cliente OAuth nesta build? a conta conectada é de organização (Workspace)?
 * o Google concedeu os escopos que a capacidade precisa? A conexão guarda só
 * e-mail, domínio e escopos — nunca o token.
 */
import { oauthConfigurado } from '@/document/googleDocs';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { readLocal, removeLocal, writeLocal } from '@/shared/services/storage';
import { comTravaLocal } from '@/shared/services/storageLock';
import {
  CAPACIDADES_EXTERNAS,
  DOMINIOS_PESSOAIS,
  ESCOPOS_DA_CONEXAO,
  ESCOPOS_POR_CAPACIDADE,
  type CapacidadeExterna,
} from './escopos';
import { ErroDeIntegracao } from './erros';
import { dependencias } from './google';

export type EstadoDaCapacidade = 'planned' | 'implemented_unconfigured' | 'available' | 'disabled';

export interface ConexaoGuardada {
  /** A conta Google conectada (a do CITi). */
  email: string;
  /** O domínio da organização (Workspace `hd`); vazio = conta pessoal. */
  dominio: string;
  /** Os escopos que o Google de fato concedeu. */
  escopos: string[];
  concedidoEm: number;
  /** Capacidades que a pessoa desligou. */
  desligadas: CapacidadeExterna[];
}

export interface SituacaoDaCapacidade {
  estado: EstadoDaCapacidade;
  /** Em linguagem da pessoa: o que falta. Ausente quando disponível. */
  dependencia?: string;
}

const dominioDoEmail = (email: string) => email.split('@')[1]?.toLowerCase() ?? '';

function normalizar(bruto: unknown): ConexaoGuardada | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const c = bruto as Partial<ConexaoGuardada>;
  if (typeof c.email !== 'string' || !c.email.includes('@')) return null;
  return {
    email: c.email.toLowerCase(),
    dominio: typeof c.dominio === 'string' ? c.dominio.toLowerCase() : '',
    escopos: Array.isArray(c.escopos) ? c.escopos.filter((e): e is string => typeof e === 'string') : [],
    concedidoEm: typeof c.concedidoEm === 'number' ? c.concedidoEm : 0,
    desligadas: Array.isArray(c.desligadas)
      ? c.desligadas.filter((d): d is CapacidadeExterna => (CAPACIDADES_EXTERNAS as readonly string[]).includes(d))
      : [],
  };
}

export async function lerConexao(): Promise<ConexaoGuardada | null> {
  try {
    return normalizar(await readLocal<unknown>(STORAGE_KEYS.integracoes));
  } catch {
    return null;
  }
}

export function situacaoDe(
  capacidade: CapacidadeExterna,
  conexao: ConexaoGuardada | null,
  oauthPronto: boolean = oauthConfigurado(),
): SituacaoDaCapacidade {
  if (conexao?.desligadas.includes(capacidade)) return { estado: 'disabled', dependencia: 'Desligada por você em Conexões.' };
  if (!oauthPronto)
    return {
      estado: 'implemented_unconfigured',
      dependencia: 'Registrar o cliente OAuth do Google desta extensão (docs/integracoes-google-workspace.md).',
    };
  if (!conexao)
    return {
      estado: 'implemented_unconfigured',
      dependencia: 'Conectar a conta Google do CITi em Conexões.',
    };
  if (!conexao.dominio || DOMINIOS_PESSOAIS.includes(conexao.dominio)) {
    // Diretório e agenda de terceiros só existem numa organização. E-mail e
    // agenda própria funcionariam, mas a premissa do produto é a conta CITi.
    return {
      estado: 'implemented_unconfigured',
      dependencia: 'A conta conectada é pessoal. Conecte a conta Google do CITi (Workspace).',
    };
  }
  const faltam = ESCOPOS_POR_CAPACIDADE[capacidade].filter((e) => !conexao.escopos.includes(e));
  // `agenda_consulta` aceita qualquer um dos dois escopos de leitura de agenda.
  const ok =
    capacidade === 'agenda_consulta'
      ? ESCOPOS_POR_CAPACIDADE.agenda_consulta.some((e) => conexao.escopos.includes(e))
      : faltam.length === 0;
  if (!ok)
    return {
      estado: 'implemented_unconfigured',
      dependencia: 'O Google não concedeu todas as permissões. Conecte de novo em Conexões e aceite todas.',
    };
  return { estado: 'available' };
}

export async function estadoDasCapacidades(): Promise<Record<CapacidadeExterna, SituacaoDaCapacidade>> {
  const conexao = await lerConexao();
  const pronto = oauthConfigurado();
  return Object.fromEntries(
    CAPACIDADES_EXTERNAS.map((c) => [c, situacaoDe(c, conexao, pronto)]),
  ) as Record<CapacidadeExterna, SituacaoDaCapacidade>;
}

/** As capacidades que podem ser oferecidas ao modelo agora. */
export async function capacidadesDisponiveis(): Promise<Set<CapacidadeExterna>> {
  try {
    const estados = await estadoDasCapacidades();
    return new Set(CAPACIDADES_EXTERNAS.filter((c) => estados[c].estado === 'available'));
  } catch {
    return new Set();
  }
}

// ------------------------------------------------------------------ conectar

/**
 * Conecta a conta: abre o consentimento do Google (precisa de um gesto na
 * tela), confere o que foi CONCEDIDO e guarda e-mail, domínio e escopos.
 */
export async function conectarConta(): Promise<ConexaoGuardada> {
  const d = dependencias();
  const token = await d.token(ESCOPOS_DA_CONEXAO, { interativo: true });
  const autenticado = { Authorization: `Bearer ${token}` };

  let escopos: string[] = [];
  let email = '';
  let dominio = '';
  try {
    // POST com o token no corpo: não vai para a URL, que é o que ferramentas de log guardam.
    const info = await d.fetch('https://oauth2.googleapis.com/tokeninfo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: token }).toString(),
    });
    if (info.ok) {
      const j = (await info.json()) as { scope?: string };
      escopos = (j.scope ?? '').split(/\s+/).filter(Boolean);
    }
    const perfil = await d.fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: autenticado });
    if (perfil.ok) {
      const p = (await perfil.json()) as { email?: string; hd?: string };
      email = (p.email ?? '').toLowerCase();
      dominio = (p.hd ?? '').toLowerCase();
    }
  } catch {
    throw new ErroDeIntegracao('sem_rede', 'Não foi possível confirmar a conta com o Google.');
  }
  if (!email)
    throw new ErroDeIntegracao('sem_autorizacao', 'O Google não informou o e-mail da conta conectada.');
  // Sem `hd` o Google diz que a conta não é de Workspace. O domínio do e-mail só
  // vale quando não é de conta pessoal.
  if (!dominio && !DOMINIOS_PESSOAIS.includes(dominioDoEmail(email))) dominio = dominioDoEmail(email);

  const guardada: ConexaoGuardada = { email, dominio, escopos, concedidoEm: d.agora(), desligadas: [] };
  await comTravaLocal(STORAGE_KEYS.integracoes, async () => {
    const anterior = await lerConexao();
    await writeLocal(STORAGE_KEYS.integracoes, {
      ...guardada,
      // Quem religa uma conta mantém o que tinha desligado, se a conta é a mesma.
      desligadas: anterior?.email === email ? anterior.desligadas : [],
    });
  });
  return (await lerConexao()) ?? guardada;
}

export async function desconectarConta(): Promise<void> {
  const d = dependencias();
  await comTravaLocal(STORAGE_KEYS.integracoes, () => removeLocal(STORAGE_KEYS.integracoes));
  try {
    const token = await d.token(ESCOPOS_DA_CONEXAO, { interativo: false });
    await d.descartar(token);
  } catch {
    // Sem token em cache: nada a descartar.
  }
}

export async function ligarCapacidade(capacidade: CapacidadeExterna, ligada: boolean): Promise<void> {
  await comTravaLocal(STORAGE_KEYS.integracoes, async () => {
    const atual = await lerConexao();
    if (!atual) return;
    const sem = atual.desligadas.filter((c) => c !== capacidade);
    await writeLocal(STORAGE_KEYS.integracoes, { ...atual, desligadas: ligada ? sem : [...sem, capacidade] });
  });
}
