/**
 * Registrar um ponto como acompanhamento (compromisso) — a ação AUTORIZADA pela
 * pessoa, no clique.
 *
 * É a ponte do estado da reunião para o trabalho registrado: uma intenção de
 * agir não é um compromisso até a pessoa dizer que é. Por isso só acontece por
 * este gesto, e só para o que foi decidido ou combinado.
 *
 * O que entra vem do ponto, já conferido:
 *   - a descrição é o texto do ponto;
 *   - responsável e prazo só se a fala citada os trouxe (o responsável entra como
 *     "sugerido", não confirmado: quem o atribuiu foi a leitura do Taq);
 *   - a evidência é a fala da transcrição, com o trecho copiado dela.
 * Sem dono ou prazo, o compromisso nasce sem dono ou prazo: "sem dono" fica sem
 * dono. Repetir o clique não duplica (a chave do compromisso é idempotente).
 */
import {
  registrarCompromissos,
  registrarDecisao,
  type Compromisso,
  type Decisao,
  type EvidenciaGuardada,
} from '@/features/trabalho/store';
import { podeVirarAcompanhamento } from './sintese';
import type { Ponto } from './store';

export type ResultadoDoRegistro =
  | { tipo: 'ok'; compromisso: Compromisso; jaExistia: boolean }
  | { tipo: 'recusado'; motivo: string };

export async function registrarPontoComoAcompanhamento(p: {
  reuniao: { id: string; titulo: string };
  ponto: Ponto;
  /** A versão da transcrição que a leitura viu (`<fim>:<falas>`), como as demais evidências da reunião. */
  versao: string;
}): Promise<ResultadoDoRegistro> {
  if (!podeVirarAcompanhamento(p.ponto))
    return { tipo: 'recusado', motivo: 'Só um ponto decidido ou combinado vira acompanhamento.' };
  if (!p.ponto.evidencias.length) return { tipo: 'recusado', motivo: 'Sem fala da reunião que o sustente.' };

  const evidencias: EvidenciaGuardada[] = p.ponto.evidencias.map((e) => ({
    tipo: 'reuniao',
    registroId: p.reuniao.id,
    titulo: p.reuniao.titulo,
    versao: p.versao,
    trecho: e.trecho,
    segmento: e.segmento,
  }));
  const { criados, jaExistiam } = await registrarCompromissos(
    [
      {
        descricao: p.ponto.texto,
        responsavel: p.ponto.dono ? { nome: p.ponto.dono, confirmado: false } : null,
        prazo: p.ponto.prazo ? { texto: p.ponto.prazo } : null,
        reuniaoId: p.reuniao.id,
        evidencias,
        situacao: 'aceito',
      },
    ],
    { origem: 'pessoa' },
  );
  const compromisso = criados[0] ?? jaExistiam[0];
  if (!compromisso) return { tipo: 'recusado', motivo: 'Não foi possível registrar.' };
  return { tipo: 'ok', compromisso, jaExistia: criados.length === 0 };
}

// ------------------------------------------------------------------ decisão

export type ResultadoDoRegistroDeDecisao =
  | { tipo: 'ok'; decisao: Decisao; jaExistia: boolean }
  | { tipo: 'recusado'; motivo: string };

const MAX_TRECHO_DA_DECISAO = 200;

/**
 * Registrar um ponto DECIDIDO como decisão — por clique da pessoa.
 *
 * Só "decidido" (decisão explícita na fala) pode virar decisão registrada;
 * proposta, discussão e adiamento não. O texto da decisão é o assunto seguido da
 * fala que a sustenta, COPIADA da transcrição: o Taq não escreve o que foi
 * decidido por conta própria. Repetir o clique não duplica.
 */
export async function registrarPontoComoDecisao(p: {
  reuniao: { id: string; titulo: string };
  ponto: Ponto;
  versao: string;
}): Promise<ResultadoDoRegistroDeDecisao> {
  if (p.ponto.estado !== 'decidido')
    return { tipo: 'recusado', motivo: 'Só um ponto decidido vira decisão registrada.' };
  const ultima = p.ponto.evidencias.at(-1);
  if (!ultima) return { tipo: 'recusado', motivo: 'Sem fala da reunião que o sustente.' };

  const evidencias: EvidenciaGuardada[] = p.ponto.evidencias.map((e) => ({
    tipo: 'reuniao',
    registroId: p.reuniao.id,
    titulo: p.reuniao.titulo,
    versao: p.versao,
    trecho: e.trecho,
    segmento: e.segmento,
  }));
  const r = await registrarDecisao(
    {
      assunto: p.ponto.texto,
      texto: `${p.ponto.texto}: ${ultima.trecho.slice(0, MAX_TRECHO_DA_DECISAO)}`,
      estado: 'confirmada',
      reuniaoId: p.reuniao.id,
      evidencias,
    },
    { origem: 'pessoa' },
  );
  if (r.tipo === 'invalido') return { tipo: 'recusado', motivo: r.motivo };
  return { tipo: 'ok', decisao: r.decisao, jaExistia: r.jaExistia };
}