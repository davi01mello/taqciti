/**
 * Conferência DETERMINÍSTICA de um envio, antes de qualquer envio: os
 * destinatários e os anexos são os que a pessoa autorizou, existem e estão no
 * escopo da conversa?
 *
 * É conta, não opinião, e não envia nada. Quem prepara e quem executa um envio
 * (`communication`) chama isto antes de mostrar a prévia e de novo antes de
 * executar, para que o que foi autorizado seja exatamente o que sai:
 *
 *   - endereço só vale se a pessoa o escreveu ou o escolheu num diretório real
 *     (`enderecosAutorizados`); nome nenhum vira endereço por adivinhação;
 *   - com `dominioDaOrganizacao`, endereço de fora é apontado — não bloqueado
 *     em silêncio: sai como `fora_da_organizacao` para a pessoa decidir;
 *   - anexo precisa existir, estar no escopo e ter conteúdo.
 *
 * `bloqueia` separa o que impede o envio (sem destinatário, endereço inválido
 * ou não autorizado, anexo inexistente ou fora do escopo) do que só avisa.
 */
import type { DocumentoGuardado } from '@/features/documents/store';
import type { MeetingRecord } from '@/shared/types/domain';
import type { Escopo } from './contratos';
import { podeLerDocumento, podeLerReuniao } from './politica';
import { revisarDocumento } from './revisao';

export interface DestinatarioDoEnvio {
  nome?: string;
  email: string;
}

export interface AnexoDoEnvio {
  tipo: 'documento' | 'transcricao';
  id: string;
}

export type CodigoDaConferencia =
  | 'sem_destinatario'
  | 'sem_anexo'
  | 'endereco_invalido'
  | 'endereco_repetido'
  | 'endereco_nao_autorizado'
  | 'fora_da_organizacao'
  | 'anexo_inexistente'
  | 'anexo_fora_do_escopo'
  | 'anexo_vazio'
  | 'documento_com_pendencia';

export interface ProblemaDoEnvio {
  codigo: CodigoDaConferencia;
  bloqueia: boolean;
  texto: string;
}

export interface ConferenciaDoEnvio {
  /** Nada que bloqueie. Avisos podem existir. */
  ok: boolean;
  problemas: ProblemaDoEnvio[];
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function normalizarEndereco(email: string): string {
  return email.trim().toLowerCase();
}

export function conferirEnvio(p: {
  destinatarios: readonly DestinatarioDoEnvio[];
  anexos: readonly AnexoDoEnvio[];
  escopo: Escopo;
  documentos: readonly DocumentoGuardado[];
  reunioes: readonly MeetingRecord[];
  /** Os endereços que a pessoa escreveu ou escolheu no diretório. Ausente: não confere a origem. */
  enderecosAutorizados?: readonly string[];
  /** `citi.org.br`, por exemplo. Ausente: não confere o domínio. */
  dominioDaOrganizacao?: string;
}): ConferenciaDoEnvio {
  const problemas: ProblemaDoEnvio[] = [];
  const bloqueia = (codigo: CodigoDaConferencia, texto: string) =>
    problemas.push({ codigo, bloqueia: true, texto });
  const avisa = (codigo: CodigoDaConferencia, texto: string) =>
    problemas.push({ codigo, bloqueia: false, texto });

  if (!p.destinatarios.length) bloqueia('sem_destinatario', 'Nenhum destinatário foi indicado.');
  if (!p.anexos.length) bloqueia('sem_anexo', 'Nada para enviar: nenhum documento ou transcrição foi indicado.');

  const vistos = new Set<string>();
  const autorizados = p.enderecosAutorizados
    ? new Set(p.enderecosAutorizados.map(normalizarEndereco))
    : null;
  const dominio = p.dominioDaOrganizacao?.trim().toLowerCase().replace(/^@/, '');
  for (const d of p.destinatarios) {
    const endereco = normalizarEndereco(d.email);
    const rotulo = d.nome ? `${d.nome} <${d.email.trim()}>` : d.email.trim();
    if (!EMAIL.test(endereco)) {
      bloqueia('endereco_invalido', `“${rotulo}” não é um endereço de e-mail válido.`);
      continue;
    }
    if (vistos.has(endereco)) {
      avisa('endereco_repetido', `O endereço ${endereco} aparece mais de uma vez; sairá uma vez só.`);
      continue;
    }
    vistos.add(endereco);
    if (autorizados && !autorizados.has(endereco)) {
      bloqueia(
        'endereco_nao_autorizado',
        `O endereço ${endereco} não foi escrito nem escolhido pela pessoa: não pode ser usado.`,
      );
    }
    if (dominio && !endereco.endsWith(`@${dominio}`)) {
      avisa('fora_da_organizacao', `${endereco} é de fora da organização (@${dominio}).`);
    }
  }

  for (const a of p.anexos) {
    if (a.tipo === 'documento') {
      const doc = p.documentos.find((d) => d.id === a.id);
      if (!doc) {
        bloqueia('anexo_inexistente', `O documento ${a.id} não existe mais.`);
        continue;
      }
      if (!podeLerDocumento(p.escopo, doc)) {
        bloqueia('anexo_fora_do_escopo', `O documento “${doc.title}” está fora do escopo desta conversa.`);
        continue;
      }
      if (!doc.content.trim()) {
        bloqueia('anexo_vazio', `O documento “${doc.title}” está vazio.`);
        continue;
      }
      const altas = revisarDocumento(doc, p.reunioes).problemas.filter((x) => x.gravidade === 'alta');
      if (altas.length)
        avisa(
          'documento_com_pendencia',
          `“${doc.title}” ainda tem ${altas.length} pendência(s) graves (${altas.map((x) => x.texto).join(' ')})`,
        );
    } else {
      const r = p.reunioes.find((x) => x.id === a.id);
      if (!r) {
        bloqueia('anexo_inexistente', `A reunião ${a.id} não existe mais.`);
        continue;
      }
      if (!podeLerReuniao(p.escopo, r.id)) {
        bloqueia('anexo_fora_do_escopo', `A transcrição de “${r.title}” está fora do escopo desta conversa.`);
        continue;
      }
      if (!r.segments.length) bloqueia('anexo_vazio', `A reunião “${r.title}” não tem transcrição.`);
    }
  }

  return { ok: !problemas.some((x) => x.bloqueia), problemas };
}
