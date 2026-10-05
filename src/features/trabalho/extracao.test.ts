/**
 * A extração incremental de compromissos da legenda — dados sintéticos.
 *
 * Seguram: só sai o que a fala diz (responsável, prazo), nome de fora da reunião
 * não vira responsável, pergunta não é combinado, falas instáveis esperam,
 * reprocessar e revisar a legenda não duplicam, o que a pessoa corrigiu ou
 * excluiu não volta, e a frequência é limitada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import {
  criarExtratorIncremental,
  extrairCandidatos,
  registrarCandidatos,
  type EntradaDaExtracao,
} from './extracao';
import { atualizarCompromisso, excluirDoTrabalho, lerTrabalho } from './store';

const INICIO = new Date('2026-10-05T12:00:00Z').getTime();

const fala = (speaker: string | null, text: string, i = 0) => ({
  speaker,
  text,
  startOffsetMs: i * 5000,
});

function entrada(
  segmentos: ReturnType<typeof fala>[],
  extra: Partial<EntradaDaExtracao> = {},
): EntradaDaExtracao {
  return {
    reuniaoId: 'm-1',
    titulo: 'Reunião sintética',
    inicio: INICIO,
    segmentos,
    participantes: [{ name: 'Ana Duarte' }, { name: 'Bruno Lima' }],
    encerrada: true,
    ...extra,
  };
}

beforeEach(() => {
  installChromeStorageMock();
});

describe('o que vira candidato', () => {
  it('"eu vou…" atribui a quem falou, e o prazo é o escrito', () => {
    const [c] = extrairCandidatos(
      entrada([fala('Ana Duarte', 'Eu vou enviar a proposta até sexta.')]),
    );
    expect(c!.novo.responsavel).toEqual({ nome: 'Ana Duarte', confirmado: true });
    expect(c!.novo.prazo).toEqual({ texto: 'até sexta' });
    expect(c!.novo.situacao).toBe('candidato');
    expect(c!.novo.evidencias[0]).toMatchObject({ registroId: 'm-1', segmento: 0 });
  });

  it('só vira data quando o prazo é dia/mês explícito', () => {
    const [c] = extrairCandidatos(
      entrada([fala('Bruno Lima', 'Eu vou revisar o contrato até 15/10.')]),
    );
    expect(c!.novo.prazo).toEqual({ texto: 'até 15/10', data: '2026-10-15' });
    const [inv] = extrairCandidatos(
      entrada([fala('Bruno Lima', 'Eu vou revisar o contrato até 31/02.')]),
    );
    expect(inv!.novo.prazo!.data).toBeUndefined();
  });

  it('terceiro só é responsável se for participante, pelo primeiro nome', () => {
    const [ok] = extrairCandidatos(entrada([fala('Bruno Lima', 'Ana vai preparar a apresentação.')]));
    expect(ok!.novo.responsavel).toEqual({ nome: 'Ana Duarte', confirmado: false });
    const fora = extrairCandidatos(entrada([fala('Bruno Lima', 'Marcos vai preparar a apresentação.')]));
    expect(fora).toHaveLength(0);
  });

  it('combinado geral fica sem responsável; pergunta e frase curta não contam', () => {
    const [c] = extrairCandidatos(
      entrada([fala('Ana Duarte', 'Ficou combinado revisar os números do trimestre.')]),
    );
    expect(c!.novo.responsavel).toBeNull();
    expect(c!.novo.prazo).toBeNull();
    expect(
      extrairCandidatos(
        entrada([
          fala('Ana Duarte', 'Quem vai enviar a proposta para o cliente?'),
          fala('Ana Duarte', 'Eu vou.'),
          fala('Ana Duarte', 'O tempo hoje está bom para todo mundo aqui.'),
        ]),
      ),
    ).toHaveLength(0);
  });

  it('falante sem nome não vira responsável', () => {
    const [c] = extrairCandidatos(entrada([fala(null, 'Eu vou enviar a proposta amanhã de manhã.')]));
    expect(c!.novo.responsavel).toBeNull();
  });

  it('ao vivo, as duas últimas falas ainda não estão consolidadas', () => {
    const segs = [
      fala('Ana Duarte', 'Eu vou enviar a proposta até sexta.', 0),
      fala('Bruno Lima', 'Eu vou revisar o contrato até 15/10.', 1),
      fala('Ana Duarte', 'Combinado, obrigada a todos por hoje então.', 2),
    ];
    expect(extrairCandidatos(entrada(segs, { encerrada: false }))).toHaveLength(1);
    expect(extrairCandidatos(entrada(segs, { encerrada: true }))).toHaveLength(2);
  });
});

describe('idempotência e correção humana', () => {
  const segs = [fala('Ana Duarte', 'Eu vou enviar a proposta até sexta.')];

  it('reprocessar a reunião não duplica', async () => {
    const a = await registrarCandidatos(entrada(segs));
    const b = await registrarCandidatos(entrada(segs));
    expect(a.criados).toHaveLength(1);
    expect(b.criados).toHaveLength(0);
    expect((await lerTrabalho()).compromissos).toHaveLength(1);
  });

  it('a legenda revista com outras palavras, na mesma fala, não duplica', async () => {
    await registrarCandidatos(entrada(segs));
    await registrarCandidatos(
      entrada([fala('Ana Duarte', 'Eu vou mandar a proposta comercial até sexta-feira.')]),
    );
    expect((await lerTrabalho()).compromissos).toHaveLength(1);
  });

  it('a edição da pessoa não é desfeita pela reextração', async () => {
    await registrarCandidatos(entrada(segs));
    const c = (await lerTrabalho()).compromissos[0]!;
    await atualizarCompromisso(
      c.id,
      c.revisao,
      { descricao: 'Proposta comercial (corrigida)', estado: 'concluido', situacao: 'aceito' },
      { origem: 'pessoa' },
    );
    await registrarCandidatos(entrada(segs));
    const depois = (await lerTrabalho()).compromissos;
    expect(depois).toHaveLength(1);
    expect(depois[0]!.descricao).toBe('Proposta comercial (corrigida)');
    expect(depois[0]!.estado).toBe('concluido');
  });

  it('o que a pessoa excluiu não volta, nem com outras palavras', async () => {
    await registrarCandidatos(entrada(segs));
    const c = (await lerTrabalho()).compromissos[0]!;
    await excluirDoTrabalho('compromissos', c.id);
    await registrarCandidatos(entrada(segs));
    await registrarCandidatos(entrada([fala('Ana Duarte', 'Eu vou mandar a proposta até sexta-feira.')]));
    expect((await lerTrabalho()).compromissos).toHaveLength(0);
  });

  it('nada é concluído nem cancelado pela extração', async () => {
    await registrarCandidatos(entrada(segs));
    const c = (await lerTrabalho()).compromissos[0]!;
    expect(c.estado).toBe('aberto');
    expect(c.situacao).toBe('candidato');
  });
});

describe('frequência', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('várias mudanças dentro do intervalo viram uma execução ao fim dele', async () => {
    let agora = 0;
    const registrar = vi.fn(async () => ({ criados: [], jaExistiam: [] }));
    const ex = criarExtratorIncremental({ intervaloMs: 20_000, agora: () => agora, registrar });
    const segs = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        fala('Ana Duarte', `Eu vou enviar o item número ${i} até sexta.`, i),
      );

    ex.aoMudar(entrada(segs(4), { encerrada: false }));
    await vi.advanceTimersByTimeAsync(0);
    expect(registrar).toHaveBeenCalledTimes(1);

    agora = 5_000;
    ex.aoMudar(entrada(segs(5), { encerrada: false }));
    agora = 8_000;
    ex.aoMudar(entrada(segs(6), { encerrada: false }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(registrar).toHaveBeenCalledTimes(1);

    agora = 20_000;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(registrar).toHaveBeenCalledTimes(2);
    ex.parar();
  });

  it('sem fala consolidada nova, não processa de novo', async () => {
    const registrar = vi.fn(async () => ({ criados: [], jaExistiam: [] }));
    const ex = criarExtratorIncremental({ intervaloMs: 1000, agora: () => 0, registrar });
    const e = entrada([fala('Ana Duarte', 'Eu vou enviar o item até sexta.')], { encerrada: true });
    ex.aoMudar(e);
    await vi.advanceTimersByTimeAsync(0);
    ex.aoMudar(e);
    await vi.advanceTimersByTimeAsync(5000);
    expect(registrar).toHaveBeenCalledTimes(1);
    ex.parar();
  });
});
