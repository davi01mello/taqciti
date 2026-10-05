/**
 * Os avisos do Taq contra o storage (mock com `onChanged` de verdade).
 *
 * O que estes casos seguram: o mesmo evento não vira dois avisos, dispensado
 * continua dispensado ao emitir de novo, o que deixou de valer é resolvido,
 * avisos do organizador não aparecem para quem não é (nem quando é desconhecido),
 * e os produtores só falam do que aconteceu. Dados sintéticos.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import {
  atualizarCompromisso,
  excluirDoTrabalho,
  lerTrabalho,
  registrarCompromissos,
} from '@/features/trabalho/store';
import { aceitarCandidato, definirResponsavel } from './acoes';
import {
  avisosDaExecucao,
  sincronizarAvisoDeCaptura,
  sincronizarAvisosDoAcompanhamento,
} from './produtores';
import {
  avisosVisiveis,
  dispensarAviso,
  emitirAviso,
  lerAvisos,
  marcarComoLidos,
  naoLidos,
  removerAvisosDaConversa,
  resolverAvisos,
} from './store';
import { souOrganizador } from './useAvisos';

beforeEach(() => {
  installChromeStorageMock();
});

const base = {
  chave: 'x:1',
  origem: 'operacao' as const,
  titulo: 'Algo aconteceu',
};

describe('emitir', () => {
  it('o mesmo evento duas vezes é um aviso só, e só o primeiro é novo', async () => {
    const a = await emitirAviso(base);
    const b = await emitirAviso(base);
    expect(a.novo).toBe(true);
    expect(b.novo).toBe(false);
    expect(await lerAvisos()).toHaveLength(1);
  });

  it('o mesmo fato com texto novo atualiza, sem criar outro nem marcar como novo', async () => {
    await emitirAviso({ ...base, status: 'executando' });
    const { aviso } = await emitirAviso({ ...base, status: 'concluido', titulo: 'Pronto' });
    expect((await lerAvisos()).length).toBe(1);
    expect(aviso.status).toBe('concluido');
    expect(aviso.titulo).toBe('Pronto');
  });

  it('dispensado continua dispensado; reabrir o traz de volta', async () => {
    const { aviso } = await emitirAviso(base);
    expect(await dispensarAviso(aviso.id)).toBe(true);
    await emitirAviso(base);
    expect(avisosVisiveis(await lerAvisos())).toHaveLength(0);
    await emitirAviso({ ...base, titulo: 'Mudou', reabrir: true });
    expect(avisosVisiveis(await lerAvisos())).toHaveLength(1);
  });

  it('resolvido sai da lista visível, fica no histórico e volta como novo se o fato voltar', async () => {
    await emitirAviso(base);
    await resolverAvisos(['x:1']);
    const depois = await lerAvisos();
    expect(avisosVisiveis(depois)).toHaveLength(0);
    expect(depois).toHaveLength(1);
    const volta = await emitirAviso(base);
    expect(volta.novo).toBe(true);
    expect(avisosVisiveis(await lerAvisos())).toHaveLength(1);
  });

  it('ler marca como lido, e o indicador conta só o que não foi lido', async () => {
    const { aviso } = await emitirAviso(base);
    await emitirAviso({ ...base, chave: 'x:2' });
    expect(naoLidos(await lerAvisos())).toBe(2);
    await marcarComoLidos([aviso.id]);
    expect(naoLidos(await lerAvisos())).toBe(1);
  });

  it('apagar a conversa leva os avisos que apontavam para ela', async () => {
    await emitirAviso({
      ...base,
      chave: 'pergunta:c1',
      acao: { tipo: 'abrir_conversa', alvoId: 'c1' },
    });
    await emitirAviso({ ...base, chave: 'y:1' });
    expect(await removerAvisosDaConversa(['c1'])).toBe(1);
    expect((await lerAvisos()).map((a) => a.chave)).toEqual(['y:1']);
  });
});

describe('organizador', () => {
  it('só é "sim" com a marca do mecanismo real; sem participantes ou sem marca é desconhecido', () => {
    expect(souOrganizador([{ isHost: true }, { isHost: false }])).toBe(true);
    expect(souOrganizador([{ isHost: false }, { isHost: false }])).toBe(false);
    expect(souOrganizador([{ isHost: null }, { isHost: false }])).toBeNull();
    expect(souOrganizador([])).toBeNull();
    expect(souOrganizador(undefined)).toBeNull();
  });

  it('itens do organizador ficam ocultos para quem não é, e para o desconhecido', async () => {
    await emitirAviso({ ...base, chave: 'a', publico: 'organizador' });
    await emitirAviso({ ...base, chave: 'b', publico: 'todos' });
    const todos = await lerAvisos();
    expect(avisosVisiveis(todos, { souOrganizador: true })).toHaveLength(2);
    expect(avisosVisiveis(todos, { souOrganizador: false }).map((a) => a.chave)).toEqual(['b']);
    expect(avisosVisiveis(todos, { souOrganizador: null }).map((a) => a.chave)).toEqual(['b']);
  });
});

describe('acompanhamento', () => {
  const ev = (segmento: number) => ({
    tipo: 'reuniao' as const,
    registroId: 'm-1',
    titulo: 'Reunião sintética',
    versao: '1:3',
    trecho: 'trecho',
    segmento,
  });

  it('tarefa sem responsável e prazo sem data geram aviso; resolver o problema o resolve', async () => {
    const { criados } = await registrarCompromissos(
      [
        {
          descricao: 'Enviar a proposta',
          responsavel: null,
          prazo: { texto: 'até sexta' },
          reuniaoId: 'm-1',
          evidencias: [ev(0)],
        },
      ],
      { origem: 'taq' },
    );
    const c = criados[0]!;
    await sincronizarAvisosDoAcompanhamento(await lerTrabalho());
    await sincronizarAvisosDoAcompanhamento(await lerTrabalho()); // repetir não duplica
    let chaves = avisosVisiveis(await lerAvisos(), { souOrganizador: true }).map((a) => a.chave).sort();
    expect(chaves).toEqual([`prazo:${c.id}`, `semresp:${c.id}`]);

    const r = await definirResponsavel(c.id, 'Ana Duarte');
    expect(r.ok).toBe(true);
    chaves = avisosVisiveis(await lerAvisos(), { souOrganizador: true }).map((a) => a.chave);
    expect(chaves).toEqual([`prazo:${c.id}`]);
  });

  it('candidato aguarda revisão, e aceitar o resolve sem apagar a fonte', async () => {
    const { criados } = await registrarCompromissos(
      [
        {
          descricao: 'Revisar o contrato',
          responsavel: { nome: 'Ana Duarte', confirmado: true },
          prazo: null,
          reuniaoId: 'm-1',
          evidencias: [ev(1)],
          situacao: 'candidato',
        },
      ],
      { origem: 'taq' },
    );
    await sincronizarAvisosDoAcompanhamento(await lerTrabalho());
    expect(
      avisosVisiveis(await lerAvisos(), { souOrganizador: true }).map((a) => a.chave),
    ).toEqual([`revisar:${criados[0]!.id}`]);

    expect((await aceitarCandidato(criados[0]!.id)).ok).toBe(true);
    const t = await lerTrabalho();
    expect(t.compromissos[0]!.situacao).toBe('aceito');
    expect(avisosVisiveis(await lerAvisos(), { souOrganizador: true })).toHaveLength(0);
  });

  it('concluído não pede nada, e excluir deixa o aviso resolvido', async () => {
    const { criados } = await registrarCompromissos(
      [{ descricao: 'Ligar para o cliente', responsavel: null, prazo: null, reuniaoId: 'm-1', evidencias: [ev(2)] }],
      { origem: 'taq' },
    );
    await sincronizarAvisosDoAcompanhamento(await lerTrabalho());
    expect(avisosVisiveis(await lerAvisos(), { souOrganizador: true })).toHaveLength(1);
    await excluirDoTrabalho('compromissos', criados[0]!.id);
    await sincronizarAvisosDoAcompanhamento(await lerTrabalho());
    expect(avisosVisiveis(await lerAvisos(), { souOrganizador: true })).toHaveLength(0);

    const outro = await registrarCompromissos(
      [{ descricao: 'Mandar o relatório', responsavel: null, prazo: null, reuniaoId: 'm-1', evidencias: [ev(3)] }],
      { origem: 'taq' },
    );
    const t = await lerTrabalho();
    await atualizarCompromisso(outro.criados[0]!.id, t.compromissos[0]!.revisao, { estado: 'concluido' }, { origem: 'pessoa' });
    await sincronizarAvisosDoAcompanhamento(await lerTrabalho());
    expect(avisosVisiveis(await lerAvisos(), { souOrganizador: true })).toHaveLength(0);
  });
});

describe('captura', () => {
  it('aparece enquanto a captura está interrompida e some quando ela volta', async () => {
    const sessao = { meetingId: 'm-1', title: 'Reunião sintética' };
    await sincronizarAvisoDeCaptura({ ...sessao, captureHealthy: false }, 'recording');
    await sincronizarAvisoDeCaptura({ ...sessao, captureHealthy: false }, 'recording');
    expect(avisosVisiveis(await lerAvisos())).toHaveLength(1);
    await sincronizarAvisoDeCaptura({ ...sessao, captureHealthy: true }, 'recording');
    expect(avisosVisiveis(await lerAvisos())).toHaveLength(0);
  });

  it('captura saudável não gera aviso nenhum', async () => {
    await sincronizarAvisoDeCaptura({ meetingId: 'm-1', title: 't', captureHealthy: true }, 'recording');
    expect(await lerAvisos()).toHaveLength(0);
  });
});

describe('execução do Taq', () => {
  const r = {
    execucaoId: 'e1',
    estado: 'concluido',
    documentos: [{ id: 'd1', titulo: 'Ata', acao: 'criado' as const }],
    informacoesAusentes: [],
    erros: [],
  };

  it('documento salvo vira um aviso concluído com a ação de abrir', () => {
    const [a] = avisosDaExecucao(r, { conversaId: 'c1', desfecho: '' });
    expect(a!.status).toBe('concluido');
    expect(a!.acao).toMatchObject({ tipo: 'abrir_documento', alvoId: 'd1' });
  });

  it('pergunta pendente aguarda informação; falha sem nada preservado é falha', () => {
    const [p] = avisosDaExecucao(
      { ...r, documentos: [], pergunta: { motivo: 'Qual projeto?' } },
      { conversaId: 'c1', desfecho: '' },
    );
    expect(p!.status).toBe('aguardando');
    const [f] = avisosDaExecucao(
      { ...r, documentos: [], estado: 'falhou', erros: [{ codigo: 'servidor_inalcancavel' }] },
      { conversaId: 'c1', desfecho: 'Falha de execução.' },
    );
    expect(f!.status).toBe('falhou');
    expect(f!.tecnico).toBe('servidor_inalcancavel');
  });

  it('falha com documento já salvo é parcial: o que foi feito é preservado e dito', () => {
    const lista = avisosDaExecucao(
      { ...r, estado: 'tempo_esgotado' },
      { conversaId: 'c1', desfecho: 'Interrompido.' },
    );
    expect(lista.find((a) => a.chave.startsWith('execucao:'))!.status).toBe('parcial');
    expect(lista.some((a) => a.origem === 'documento')).toBe(true);
  });

  it('o mesmo documento em duas execuções são dois eventos', () => {
    const [a] = avisosDaExecucao(r, { conversaId: 'c1', desfecho: '' });
    const [b] = avisosDaExecucao({ ...r, execucaoId: 'e2' }, { conversaId: 'c1', desfecho: '' });
    expect(a!.chave).not.toBe(b!.chave);
  });
});
