/**
 * `passoDo`: cada ferramenta concluída vira uma linha que a tela mostra —
 * nomeada pela etapa com que ela começou, com o resumo dela, e sem conteúdo.
 */
import { describe, expect, it } from 'vitest';
import { passoDo } from './interface';

const fim = (ok: boolean, resumo: string) =>
  ({ tipo: 'ferramenta_fim', tarefaId: 't', nome: 'search_meetings', ok, duracaoMs: 1, resumo }) as const;

describe('passoDo', () => {
  it('nomeia o passo pela etapa do início, com o resumo', () => {
    const etapas = new Map<string, string>();
    expect(
      passoDo({ tipo: 'ferramenta_inicio', tarefaId: 't', nome: 'search_meetings', etapa: 'Buscando nas reuniões' }, etapas),
    ).toBeNull();
    expect(passoDo(fim(true, '3 resultado(s)'), etapas)).toBe('Buscando nas reuniões · 3 resultado(s)');
  });

  it('falha não mostra o código de erro', () => {
    const etapas = new Map([['search_meetings', 'Buscando nas reuniões']]);
    expect(passoDo(fim(false, 'erro: nao_encontrado'), etapas)).toBe('Buscando nas reuniões · não deu certo');
  });

  it('outros eventos não viram passo', () => {
    expect(passoDo({ tipo: 'modelo', tarefaId: 't', passo: 1 }, new Map())).toBeNull();
  });
});
