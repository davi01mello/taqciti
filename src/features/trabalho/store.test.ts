/**
 * Os registros de trabalho contra o storage (mock com `onChanged` de verdade).
 *
 * O que estes casos seguram: reconhecer de novo não duplica, editar exige a
 * revisão lida, dependência não fecha ciclo, decisão revista não apaga a
 * anterior, e prazo vencido não vira acusação. Dados sintéticos.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import {
  atualizarCompromisso,
  corrigirItemDaAnalise,
  guardarAchado,
  guardarAnalise,
  lerTrabalho,
  mudarEstadoDoAchado,
  registrarCompromissos,
  registrarDecisao,
  removerDemonstracao,
  situacaoDoPrazo,
  vincularDependencia,
  type EvidenciaGuardada,
} from './store';

const ev = (trecho: string, registroId = 'm-1', segmento = 0): EvidenciaGuardada => ({
  tipo: 'reuniao',
  registroId,
  titulo: 'Reunião sintética',
  versao: '1:3',
  trecho,
  segmento,
});

beforeEach(() => {
  installChromeStorageMock();
});

describe('compromissos', () => {
  it('reconhecer a mesma tarefa da mesma reunião não duplica, nem desfaz a edição', async () => {
    const novo = {
      descricao: 'Enviar o relatório de métricas',
      responsavel: { nome: 'Ana', confirmado: true },
      prazo: { texto: 'sexta', data: '2026-10-02' },
      reuniaoId: 'm-1',
      evidencias: [ev('Ana envia o relatório de métricas até sexta')],
    };
    const a = await registrarCompromissos([novo], { origem: 'taq' });
    expect(a.criados).toHaveLength(1);
    await atualizarCompromisso(a.criados[0]!.id, 1, { estado: 'concluido' }, { origem: 'pessoa' });

    // Mesma tarefa, com pontuação e caixa diferentes: é a mesma.
    const b = await registrarCompromissos(
      [{ ...novo, descricao: 'enviar o RELATÓRIO de métricas.' }],
      { origem: 'taq' },
    );
    expect(b.criados).toHaveLength(0);
    expect(b.jaExistiam).toHaveLength(1);
    const { compromissos } = await lerTrabalho();
    expect(compromissos).toHaveLength(1);
    expect(compromissos[0]!.estado).toBe('concluido');
  });

  it('sem dono continua sem dono; sem prazo continua sem prazo', async () => {
    const { criados } = await registrarCompromissos(
      [{ descricao: 'Revisar o contrato', responsavel: { nome: '  ', confirmado: false }, prazo: null, evidencias: [] }],
      { origem: 'taq' },
    );
    expect(criados[0]!.responsavel).toBeNull();
    expect(criados[0]!.prazo).toBeNull();
  });

  it('edição exige a revisão lida; conflito não sobrescreve', async () => {
    const { criados } = await registrarCompromissos(
      [{ descricao: 'Publicar a ata', responsavel: null, prazo: null, evidencias: [] }],
      { origem: 'taq' },
    );
    const id = criados[0]!.id;
    expect((await atualizarCompromisso(id, 1, { estado: 'concluido' }, { origem: 'pessoa' })).tipo).toBe('ok');
    const conflito = await atualizarCompromisso(id, 1, { estado: 'cancelado' }, { origem: 'pessoa' });
    expect(conflito.tipo).toBe('conflito');
    expect((await lerTrabalho()).compromissos[0]!.estado).toBe('concluido');
  });

  it('mudança "por evidência" sem trecho é recusada', async () => {
    const { criados } = await registrarCompromissos(
      [{ descricao: 'Ligar para o cliente', responsavel: null, prazo: null, evidencias: [] }],
      { origem: 'taq' },
    );
    const r = await atualizarCompromisso(criados[0]!.id, 1, { estado: 'concluido' }, { origem: 'evidencia' });
    expect(r.tipo).toBe('invalido');
  });

  it('cada mudança fica no histórico, com a origem', async () => {
    const { criados } = await registrarCompromissos(
      [{ descricao: 'Montar o cronograma', responsavel: null, prazo: null, evidencias: [] }],
      { origem: 'taq', execucaoId: 'x1' },
    );
    await atualizarCompromisso(criados[0]!.id, 1, { responsavel: { nome: 'Bruno', confirmado: true } }, { origem: 'pessoa' });
    const [c] = (await lerTrabalho()).compromissos;
    expect(c!.historico.map((h) => [h.acao, h.origem])).toEqual([
      ['registrado', 'taq'],
      ['responsável: sem responsável → Bruno', 'pessoa'],
    ]);
  });

  it('dependência que fecharia ciclo é recusada', async () => {
    const { criados } = await registrarCompromissos(
      [
        { descricao: 'A: liberar acesso ao banco', responsavel: null, prazo: null, evidencias: [] },
        { descricao: 'B: rodar a carga de dados', responsavel: null, prazo: null, evidencias: [] },
        { descricao: 'C: validar o painel', responsavel: null, prazo: null, evidencias: [] },
      ],
      { origem: 'taq' },
    );
    const [a, b, c] = criados.map((x) => x.id) as [string, string, string];
    expect((await vincularDependencia(b, a, { origem: 'pessoa' })).tipo).toBe('ok');
    expect((await vincularDependencia(c, b, { origem: 'pessoa' })).tipo).toBe('ok');
    const ciclo = await vincularDependencia(a, c, { origem: 'pessoa' });
    expect(ciclo.tipo).toBe('invalido');
    expect((await vincularDependencia(a, a, { origem: 'pessoa' })).tipo).toBe('invalido');
  });

  it('prazo vencido sem atualização é "a confirmar", nunca atraso', () => {
    expect(situacaoDoPrazo({ estado: 'aberto', prazo: { texto: 'ontem', data: '2026-09-30' } }, '2026-10-01')).toBe(
      'prazo_passou_a_confirmar',
    );
    expect(situacaoDoPrazo({ estado: 'aberto', prazo: null }, '2026-10-01')).toBe('sem_prazo');
    expect(situacaoDoPrazo({ estado: 'concluido', prazo: { texto: 'ontem', data: '2026-09-30' } }, '2026-10-01')).toBe(
      'encerrado',
    );
  });
});

describe('decisões', () => {
  it('a decisão revista substitui a anterior, que fica no histórico ligada a ela', async () => {
    const r1 = await registrarDecisao(
      { assunto: 'Exportação', texto: 'Entregar exportação em PDF na fase 1', estado: 'confirmada', evidencias: [ev('PDF na fase 1')], reuniaoId: 'm-1' },
      { origem: 'evidencia' },
    );
    if (r1.tipo !== 'ok') throw new Error('falhou');
    const r2 = await registrarDecisao(
      {
        assunto: 'Exportação',
        texto: 'PDF fica para a fase 2',
        estado: 'confirmada',
        evidencias: [ev('o PDF fica para a fase 2', 'm-3')],
        reuniaoId: 'm-3',
        substitui: r1.decisao.id,
        motivo: 'prioridade do painel',
      },
      { origem: 'evidencia' },
    );
    if (r2.tipo !== 'ok') throw new Error('falhou');
    const { decisoes } = await lerTrabalho();
    const antiga = decisoes.find((d) => d.id === r1.decisao.id)!;
    expect(antiga.estado).toBe('substituida');
    expect(antiga.substituidaPor).toBe(r2.decisao.id);
    expect(decisoes.find((d) => d.id === r2.decisao.id)).toMatchObject({ substitui: r1.decisao.id, motivo: 'prioridade do painel' });
  });

  it('proposta não substitui decisão, e decisão já substituída não é substituída de novo', async () => {
    const r1 = await registrarDecisao({ assunto: 'Prazo', texto: 'Entrega dia 10', estado: 'confirmada', evidencias: [] }, { origem: 'pessoa' });
    if (r1.tipo !== 'ok') throw new Error('falhou');
    const proposta = await registrarDecisao(
      { assunto: 'Prazo', texto: 'Talvez dia 15', estado: 'proposta', evidencias: [], substitui: r1.decisao.id },
      { origem: 'pessoa' },
    );
    expect(proposta.tipo).toBe('invalido');
    await registrarDecisao({ assunto: 'Prazo', texto: 'Entrega dia 12', estado: 'confirmada', evidencias: [], substitui: r1.decisao.id }, { origem: 'pessoa' });
    const de_novo = await registrarDecisao(
      { assunto: 'Prazo', texto: 'Entrega dia 20', estado: 'confirmada', evidencias: [], substitui: r1.decisao.id },
      { origem: 'pessoa' },
    );
    expect(de_novo.tipo).toBe('invalido');
  });
});

describe('achados', () => {
  const novo = {
    tipo: 'desalinhamento' as const,
    assunto: 'Exportação em PDF',
    entendimentos: [
      { area: 'Comercial', texto: 'prometeu PDF', evidencia: ev('vamos entregar exportação em PDF', 'm-com') },
      { area: 'Produto', texto: 'escopo só de visualização', evidencia: ev('o escopo é só visualização', 'm-prod') },
    ],
    classificacao: 'possivel' as const,
  };

  it('o mesmo achado não é registrado duas vezes', async () => {
    const a = await guardarAchado(novo, { origem: 'taq' });
    const b = await guardarAchado(novo, { origem: 'taq' });
    expect(b.jaExistia).toBe(true);
    expect(b.achado.id).toBe(a.achado.id);
    expect((await lerTrabalho()).achados).toHaveLength(1);
  });

  it('resolver por evidência exige o trecho; descartar exige motivo; o histórico guarda tudo', async () => {
    const { achado } = await guardarAchado(novo, { origem: 'taq' });
    expect((await mudarEstadoDoAchado(achado.id, 1, { estado: 'resolvido', texto: 'decidido' }, { origem: 'evidencia' })).tipo).toBe(
      'invalido',
    );
    expect((await mudarEstadoDoAchado(achado.id, 1, { estado: 'descartado', texto: '  ' }, { origem: 'pessoa' })).tipo).toBe('invalido');
    const ok = await mudarEstadoDoAchado(
      achado.id,
      1,
      { estado: 'resolvido', texto: 'PDF ficou para a fase 2', evidencia: ev('PDF fica para a fase 2', 'm-3') },
      { origem: 'evidencia' },
    );
    expect(ok.tipo).toBe('ok');
    const [a] = (await lerTrabalho()).achados;
    expect(a!.estado).toBe('resolvido');
    expect(a!.historico.at(-1)).toMatchObject({ acao: 'aberto → resolvido', detalhe: 'PDF ficou para a fase 2' });
  });
});

describe('análises', () => {
  const secoes = {
    visaoGeral: [{ texto: 'Planejamento da sprint', evidencias: [] }],
    decisoes: [{ texto: 'Deploy na sexta', evidencias: [ev('Decidido: deploy na sexta')] }],
    questoes: [],
    riscos: [],
    proximosPassos: [],
  };

  it('uma por reunião: refazer substitui, com a revisão seguinte', async () => {
    const a1 = await guardarAnalise(
      { reuniaoId: 'm-1', versaoDaReuniao: '1:3', instrucoes: 'meeting_analyst', cobertura: { lidos: 2, total: 3 }, secoes, lacunas: [] },
      { origem: 'taq' },
    );
    const a2 = await guardarAnalise(
      { reuniaoId: 'm-1', versaoDaReuniao: '1:4', instrucoes: 'meeting_analyst', cobertura: { lidos: 4, total: 4 }, secoes, lacunas: [] },
      { origem: 'taq' },
    );
    expect(a2.id).toBe(a1.id);
    expect(a2.revisao).toBe(2);
    expect((await lerTrabalho()).analises).toHaveLength(1);
  });

  it('corrigir um item gera revisão e guarda o texto anterior', async () => {
    const a = await guardarAnalise(
      { reuniaoId: 'm-1', versaoDaReuniao: '1:3', instrucoes: 'meeting_analyst', cobertura: { lidos: 3, total: 3 }, secoes, lacunas: [] },
      { origem: 'taq' },
    );
    const r = await corrigirItemDaAnalise(a.id, a.revisao, 'decisoes', 0, 'Deploy mantido na sexta');
    expect(r.tipo).toBe('ok');
    const [salva] = (await lerTrabalho()).analises;
    expect(salva!.secoes.decisoes[0]).toMatchObject({ texto: 'Deploy mantido na sexta', corrigido: true });
    expect(salva!.historico.at(-1)!.detalhe).toBe('Deploy na sexta');
    expect((await corrigirItemDaAnalise(a.id, a.revisao, 'decisoes', 0, 'x')).tipo).toBe('conflito');
  });
});

it('a demonstração sai sem levar registro real', async () => {
  await registrarCompromissos(
    [
      { descricao: 'Real', responsavel: null, prazo: null, evidencias: [] },
      { descricao: 'Demo', responsavel: null, prazo: null, evidencias: [], demo: true },
    ],
    { origem: 'pessoa' },
  );
  expect(await removerDemonstracao()).toBe(1);
  expect((await lerTrabalho()).compromissos.map((c) => c.descricao)).toEqual(['Real']);
});
