/**
 * A coleção de documentos.
 *
 * O que estes testes protegem é o que o requisito chama de "não apresentar
 * falha como sucesso" e "o download contém a versão salva": o registro só
 * existe depois de a gravação resolver, o `updatedAt` é o da gravação, e
 * desvincular nunca apaga.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import {
  apagarDocumento,
  atualizarDocumento,
  criarGravadorDeDocumento,
  desvincularDaReuniao,
  documentosDaReuniao,
  guardarDocumento,
  lerDocumentos,
  observarDocumentos,
  type DocumentoGuardado,
} from './store';

let storage: ReturnType<typeof installChromeStorageMock>;

const guardados = () =>
  storage.local.values[STORAGE_KEYS.documents] as DocumentoGuardado[];

beforeEach(() => {
  storage = installChromeStorageMock();
});

describe('guardar', () => {
  it('grava com id próprio, datas e a origem declarada', async () => {
    const doc = await guardarDocumento({
      title: 'Ata do kickoff',
      content: '# Ata\n\nDecidido…',
      meetingId: 'm-1',
      tipo: 'Ata de Reunião',
      origem: 'gerado',
    });

    expect(doc.id).toBeTruthy();
    expect(doc.createdAt).toBe(doc.updatedAt);
    expect(doc.origem).toBe('gerado');
    expect(guardados()).toHaveLength(1);
    expect(guardados()[0]!.content).toContain('Decidido');
  });

  it('não deixa documento sem nome nenhum na lista', async () => {
    const doc = await guardarDocumento({ title: '   ', content: 'x' });
    expect(doc.title).toBe('Documento sem título');
  });

  /*
   * Quem gerou precisa SABER que não salvou. Engolir a falha aqui faria a tela
   * dizer "Salvo" sobre um documento que não existe em lugar nenhum.
   */
  it('propaga a falha de gravação em vez de engoli-la', async () => {
    storage.local.set.mockRejectedValueOnce(new Error('quota'));
    await expect(guardarDocumento({ title: 'A', content: 'B' })).rejects.toThrow();
  });

  it('lista do mais recente para o mais antigo', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    await guardarDocumento({ title: 'Primeiro', content: 'a' });
    vi.setSystemTime(2000);
    await guardarDocumento({ title: 'Segundo', content: 'b' });
    vi.useRealTimers();

    expect((await lerDocumentos()).map((d) => d.title)).toEqual(['Segundo', 'Primeiro']);
  });
});

describe('atualizar', () => {
  it('muda o conteúdo e sobe o updatedAt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const doc = await guardarDocumento({ title: 'A', content: 'antigo' });
    vi.setSystemTime(5000);
    const depois = await atualizarDocumento(doc.id, { content: 'novo' });
    vi.useRealTimers();

    expect(depois?.content).toBe('novo');
    expect(depois?.updatedAt).toBe(5000);
    expect(depois?.createdAt).toBe(1000);
  });

  it('renomear preserva o conteúdo e o vínculo', async () => {
    const doc = await guardarDocumento({
      title: 'Nome velho',
      content: 'conteúdo',
      meetingId: 'm-1',
    });
    const depois = await atualizarDocumento(doc.id, { title: 'Nome novo' });

    expect(depois?.title).toBe('Nome novo');
    expect(depois?.content).toBe('conteúdo');
    expect(depois?.meetingId).toBe('m-1');
  });

  it('documento que não existe devolve null em vez de criar um', async () => {
    expect(await atualizarDocumento('nao-existe', { title: 'X' })).toBeNull();
    expect(await lerDocumentos()).toHaveLength(0);
  });
});

describe('o gravador com respiro', () => {
  it('acumula título e conteúdo escritos dentro do mesmo respiro', async () => {
    vi.useFakeTimers();
    const doc = await guardarDocumento({ title: 'A', content: 'a' });
    const estados: string[] = [];
    const gravador = criarGravadorDeDocumento((e) => estados.push(e));

    gravador.agendar(doc.id, { title: 'B' });
    gravador.agendar(doc.id, { content: 'b' });
    await vi.advanceTimersByTimeAsync(800);
    vi.useRealTimers();

    const salvo = (await lerDocumentos())[0]!;
    // As duas alterações, numa gravação só: mudar o nome e depois o texto não
    // pode fazer a segunda escrita apagar a primeira.
    expect(salvo.title).toBe('B');
    expect(salvo.content).toBe('b');
    expect(estados).toContain('salvo');
  });

  it('descarregar grava o que estava pendente, sem esperar o respiro', async () => {
    const doc = await guardarDocumento({ title: 'A', content: 'a' });
    const gravador = criarGravadorDeDocumento(() => {});

    gravador.agendar(doc.id, { content: 'última tecla' });
    await gravador.descarregar();

    expect((await lerDocumentos())[0]!.content).toBe('última tecla');
  });

  it('uma falha vira estado "falhou", nunca "salvo"', async () => {
    const doc = await guardarDocumento({ title: 'A', content: 'a' });
    const estados: string[] = [];
    const gravador = criarGravadorDeDocumento((e) => estados.push(e));

    storage.local.set.mockRejectedValueOnce(new Error('quota'));
    gravador.agendar(doc.id, { content: 'b' });
    await gravador.descarregar();

    expect(estados).toContain('falhou');
    expect(estados).not.toContain('salvo');
  });
});

describe('vínculo com a reunião', () => {
  it('separa os documentos de uma reunião dos demais', async () => {
    await guardarDocumento({ title: 'Da reunião', content: 'x', meetingId: 'm-1' });
    await guardarDocumento({ title: 'De outra', content: 'y', meetingId: 'm-2' });
    await guardarDocumento({ title: 'Sem origem', content: 'z' });

    const todos = await lerDocumentos();
    expect(documentosDaReuniao(todos, 'm-1').map((d) => d.title)).toEqual(['Da reunião']);
  });

  /*
   * Desvincular NÃO apaga. O documento é trabalho próprio, e sumir com ele
   * junto da reunião seria a perda silenciosa que o requisito proíbe.
   */
  it('desvincular preserva o documento e tira só o vínculo', async () => {
    await guardarDocumento({ title: 'Da reunião', content: 'importante', meetingId: 'm-1' });
    await guardarDocumento({ title: 'De outra', content: 'y', meetingId: 'm-2' });

    const quantos = await desvincularDaReuniao('m-1');

    expect(quantos).toBe(1);
    const todos = await lerDocumentos();
    expect(todos).toHaveLength(2);
    const orfao = todos.find((d) => d.title === 'Da reunião')!;
    expect(orfao.content).toBe('importante');
    expect('meetingId' in orfao).toBe(false);
    // A outra reunião não é tocada.
    expect(todos.find((d) => d.title === 'De outra')!.meetingId).toBe('m-2');
  });
});

describe('observar', () => {
  it('emite o valor atual e cada mudança', async () => {
    const visto: number[] = [];
    const parar = observarDocumentos((lista) => visto.push(lista.length));
    await vi.waitFor(() => expect(visto.length).toBeGreaterThan(0));

    await guardarDocumento({ title: 'A', content: 'a' });
    await vi.waitFor(() => expect(visto.at(-1)).toBe(1));

    parar();
  });
});

describe('apagar', () => {
  it('tira só o documento pedido', async () => {
    const a = await guardarDocumento({ title: 'A', content: 'a' });
    await guardarDocumento({ title: 'B', content: 'b' });

    await apagarDocumento(a.id);

    expect((await lerDocumentos()).map((d) => d.title)).toEqual(['B']);
  });
});
