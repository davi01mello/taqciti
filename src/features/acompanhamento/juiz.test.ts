/**
 * O juiz dos acompanhamentos. A escolha é da IA (aqui, roteirizada); o que se
 * segura é o que o código garante: só id oferecido, nunca além das vagas, e
 * nenhuma escolha de reserva quando o julgamento falha.
 */
import { describe, expect, it, vi } from 'vitest';
import { ErroDoModelo, type AdaptadorDeModelo, type RespostaDoTurno } from '@/features/taq/modelo';
import { aplicarJulgamento, julgarAcompanhamentos } from './juiz';

const candidatos = ['a', 'b', 'c', 'd'].map((id) => ({ id, descricao: `Tarefa ${id}` }));
const reuniao = { id: 'm-1', titulo: 'Reunião' };
const base = { uso: { entrada: 1, saida: 1 }, provedor: 't', modelo: 't', instrucoesVersao: 'acompanhamento-v1', latenciaMs: 1 };
const chamando = (argumentos: Record<string, unknown>): RespostaDoTurno => ({
  ...base,
  tipo: 'ferramentas',
  texto: '',
  chamadas: [{ id: '1', nome: 'escolher_acompanhamentos', argumentos }],
});
const adaptadorCom = (r: RespostaDoTurno | Error): AdaptadorDeModelo => ({
  turno: vi.fn(async () => {
    if (r instanceof Error) throw r;
    return r;
  }),
});

describe('aplicarJulgamento', () => {
  const oferecidos = new Set(['a', 'b', 'c', 'd']);

  it('respeita a ordem da IA, ignora id inventado e repetido, e corta nas vagas', () => {
    const r = aplicarJulgamento(
      { escolhidos: [{ id: 'd', motivo: ' x ' }, { id: 'zz', motivo: '' }, { id: 'd', motivo: '' }, { id: 'a', motivo: '' }, { id: 'b', motivo: '' }], descartados: [] },
      oferecidos,
      2,
    );
    expect(r.escolhidos).toEqual([{ id: 'd', motivo: 'x' }, { id: 'a', motivo: '' }]);
  });

  it('descartado que também foi escolhido, ou que não existe, não aparece', () => {
    const r = aplicarJulgamento(
      { escolhidos: [{ id: 'a', motivo: '' }], descartados: [{ id: 'a', motivo: '' }, { id: 'q', motivo: '' }, { id: 'b', motivo: 'repetido' }] },
      oferecidos,
      3,
    );
    expect(r.descartados).toEqual([{ id: 'b', motivo: 'repetido' }]);
  });
});

describe('julgarAcompanhamentos', () => {
  it('manda a instrução do juiz, as vagas e o que a reunião já tem', async () => {
    const adaptador = adaptadorCom(chamando({ escolhidos: [{ id: 'b', motivo: 'tem dono' }] }));
    const r = await julgarAcompanhamentos({ adaptador, reuniao, candidatos, existentes: ['Já combinado'], vagas: 2 });
    expect(r).toMatchObject({ tipo: 'ok', julgamento: { escolhidos: [{ id: 'b' }] } });
    const pedido = vi.mocked(adaptador.turno).mock.calls[0]![0];
    expect(pedido.instrucoes).toBe('acompanhamento-v1');
    expect(pedido.contexto).toMatch(/Vagas livres: 2/);
    expect(pedido.contexto).toMatch(/Já combinado/);
  });

  it('IA que escolhe zero é um julgamento válido', async () => {
    const r = await julgarAcompanhamentos({ adaptador: adaptadorCom(chamando({ escolhidos: [] })), reuniao, candidatos, existentes: [], vagas: 3 });
    expect(r).toEqual({ tipo: 'ok', julgamento: { escolhidos: [], descartados: [] } });
  });

  it('sem vagas ou sem candidatos, nem chama a IA', async () => {
    const adaptador = adaptadorCom(chamando({ escolhidos: [{ id: 'a' }] }));
    await julgarAcompanhamentos({ adaptador, reuniao, candidatos, existentes: [], vagas: 0 });
    await julgarAcompanhamentos({ adaptador, reuniao, candidatos: [], existentes: [], vagas: 3 });
    expect(adaptador.turno).not.toHaveBeenCalled();
  });

  it('falha do provedor ou resposta fora do formato: erro, e nenhum escolhido de reserva', async () => {
    const cota = await julgarAcompanhamentos({
      adaptador: adaptadorCom(new ErroDoModelo('limite_do_provedor', 'Cota esgotada.')),
      reuniao,
      candidatos,
      existentes: [],
      vagas: 3,
    });
    expect(cota).toMatchObject({ tipo: 'erro', codigo: 'limite_do_provedor' });
    const torta = await julgarAcompanhamentos({
      adaptador: adaptadorCom({ ...base, tipo: 'final', texto: 'fica com os três primeiros', chamadas: [] }),
      reuniao,
      candidatos,
      existentes: [],
      vagas: 3,
    });
    expect(torta).toMatchObject({ tipo: 'erro', codigo: 'julgamento_invalido' });
  });
});
