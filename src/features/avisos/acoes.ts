/**
 * O que a pessoa faz a partir de um aviso — direto no registro, sem modelo.
 *
 * Aceitar um candidato, definir o responsável e completar o prazo são edições
 * dela, e usam as mesmas funções do acompanhamento (`atualizarCompromisso`),
 * com a revisão que acabaram de ler: se o item mudou no meio, o conflito volta
 * como resultado e nada é sobrescrito. Como o pedido é inequívoco, UMA nova
 * tentativa é feita com a revisão atual — e só uma.
 *
 * Depois de cada edição os avisos do acompanhamento são reconciliados, então o
 * aviso resolvido sai da lista sem esperar outra superfície.
 */
import {
  atualizarCompromisso,
  lerTrabalho,
  type MudancaDeCompromisso,
} from '@/features/trabalho/store';
import { sincronizarAvisosDoAcompanhamento } from './produtores';

export type ResultadoDaAcao = { ok: true } | { ok: false; motivo: string };

async function editar(id: string, mudanca: MudancaDeCompromisso): Promise<ResultadoDaAcao> {
  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    const t = await lerTrabalho();
    const c = t.compromissos.find((x) => x.id === id);
    if (!c) return { ok: false, motivo: 'Este item não existe mais.' };
    const r = await atualizarCompromisso(id, c.revisao, mudanca, { origem: 'pessoa' });
    if (r.tipo === 'ok') {
      await sincronizarAvisosDoAcompanhamento(await lerTrabalho());
      return { ok: true };
    }
    if (r.tipo === 'invalido') return { ok: false, motivo: r.motivo };
    if (r.tipo === 'inexistente') return { ok: false, motivo: 'Este item não existe mais.' };
  }
  return { ok: false, motivo: 'O item mudou enquanto você editava. Tente de novo.' };
}

export const aceitarCandidato = (id: string) => editar(id, { situacao: 'aceito' });

export function definirResponsavel(id: string, nome: string): Promise<ResultadoDaAcao> {
  const limpo = nome.trim();
  if (!limpo) return Promise.resolve({ ok: false, motivo: 'Escolha quem fica responsável.' });
  // A pessoa escolheu: o responsável é confirmado por ela.
  return editar(id, { responsavel: { nome: limpo, confirmado: true } });
}

/** `data` no formato `AAAA-MM-DD` (o do campo de data). */
export function definirPrazo(id: string, data: string): Promise<ResultadoDaAcao> {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  if (!m) return Promise.resolve({ ok: false, motivo: 'Informe uma data válida.' });
  return editar(id, { prazo: { texto: `${m[3]}/${m[2]}/${m[1]}`, data } });
}
