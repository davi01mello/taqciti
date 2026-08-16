import { describe, expect, it } from 'vitest';
import { applyAnswers } from './applyAnswers';
import type { DocumentData, Gap } from './documentData';

const base: DocumentData = {
  metadata: {},
  participants: [
    { name: 'Maria', role: 'Gerente de Dados', roleSource: 'meeting', quotes: [] },
    { name: 'João', roleSource: 'unknown', quotes: [] },
  ],
  signature: {},
};

const lacunas: Gap[] = [
  { sectionId: 'identificacao', field: 'metadata.date', question: 'Qual a data?', why: 'x' },
  { sectionId: 'identificacao', field: 'metadata.projectName', question: 'Qual o projeto?', why: 'x' },
  { sectionId: 'participantes', field: 'participants[João].role', question: 'Cargo do João?', why: 'x' },
  { sectionId: 'assinatura', field: 'signature.name', question: 'Quem assina?', why: 'x' },
];

const responder = (field: string, answer: string) => ({
  questionId: `qualquer:${field}`,
  answer,
});

describe('preenchimento de campo', () => {
  it('data e projeto entram no metadata', () => {
    const r = applyAnswers(
      base,
      [responder('metadata.date', '12/08/2026'), responder('metadata.projectName', 'Fênix')],
      lacunas,
    );
    expect(r.data.metadata).toEqual({ date: '12/08/2026', projectName: 'Fênix' });
  });

  it('assinatura entra no signature', () => {
    const r = applyAnswers(
      base,
      [responder('signature.name', 'Ana'), responder('signature.role', 'Gerente')],
      lacunas,
    );
    expect(r.data.signature).toEqual({ name: 'Ana', role: 'Gerente' });
  });

  it('cargo respondido pelo usuário marca roleSource user', () => {
    // A distinção entre "a reunião disse" e "alguém preencheu depois" é do
    // guidance da Ata, e é o que permite saber de onde veio cada cargo num
    // documento já entregue.
    const r = applyAnswers(base, [responder('participants[João].role', 'Analista')], lacunas);
    const joao = r.data.participants!.find((p) => p.name === 'João')!;
    expect(joao.role).toBe('Analista');
    expect(joao.roleSource).toBe('user');
  });

  it('não mexe em quem não foi perguntado', () => {
    const r = applyAnswers(base, [responder('participants[João].role', 'Analista')], lacunas);
    const maria = r.data.participants!.find((p) => p.name === 'Maria')!;
    expect(maria).toEqual(base.participants![0]);
  });

  it('não muta o documento recebido', () => {
    // O chamador guarda o original; mutar em lugar faria o "antes" sumir.
    applyAnswers(base, [responder('participants[João].role', 'Analista')], lacunas);
    expect(base.participants![1]!.role).toBeUndefined();
  });
});

describe('lacunas', () => {
  it('a lacuna respondida sai da lista', () => {
    const r = applyAnswers(base, [responder('metadata.date', '12/08/2026')], lacunas);
    expect(r.gaps.map((g) => g.field)).not.toContain('metadata.date');
    expect(r.gaps).toHaveLength(lacunas.length - 1);
  });

  it('as não respondidas permanecem', () => {
    const r = applyAnswers(base, [], lacunas);
    expect(r.gaps).toEqual(lacunas);
  });

  it('resposta em branco é "não sei", não "apague o campo"', () => {
    // A lacuna permanece, e o documento continua mostrando que falta algo.
    const r = applyAnswers(base, [responder('metadata.date', '   ')], lacunas);
    expect(r.data.metadata?.date).toBeUndefined();
    expect(r.gaps.map((g) => g.field)).toContain('metadata.date');
  });
});

describe('resposta sem onde entrar', () => {
  it('afirmação descartada volta como não aplicada, não some', () => {
    // Ela pergunta se algo deve constar e com que redação — isso não é
    // preencher campo, é refazer a seção.
    const orfa = responder('decisions[0]', 'Sim, com esta redação.');
    const r = applyAnswers(base, [orfa], lacunas);
    expect(r.naoAplicadas).toEqual([orfa]);
    expect(r.aplicadas).toEqual([]);
  });

  it('participante que não existe mais não é criado', () => {
    // Criá-lo aqui acrescentaria alguém à ata por causa de uma pergunta órfã.
    const r = applyAnswers(base, [responder('participants[Fantasma].role', 'X')], lacunas);
    expect(r.data.participants!.map((p) => p.name)).toEqual(['Maria', 'João']);
    expect(r.naoAplicadas).toHaveLength(1);
  });
});

describe('formato do questionId', () => {
  it('aceita o id completo `secao:campo` que a API devolve', () => {
    const r = applyAnswers(
      base,
      [{ questionId: 'identificacao:metadata.date', answer: '12/08/2026' }],
      lacunas,
    );
    expect(r.data.metadata?.date).toBe('12/08/2026');
  });
});
