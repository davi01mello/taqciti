import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { criarGravadorDeNota, gravarNota, lerNota } from '@/features/annotations/notes';
import {
  guardarDocumento,
  lerDocumentos,
  criarGravadorDeDocumento,
} from '@/features/documents/store';
import { limparVinculosDaReuniao } from '@/features/annotations/vinculos';

let storage: ReturnType<typeof installChromeStorageMock>;
beforeEach(() => {
  storage = installChromeStorageMock();
});

describe('edições concorrentes e recuperação', () => {
  it('pausar a digitação não remove espaços e linhas do editor', async () => {
    await gravarNota('teste-1', 'parágrafo\n\n');
    expect((await lerNota('teste-1'))?.texto).toBe('parágrafo\n\n');
  });
  it('trocar rapidamente de reunião preserva ambas as notas', async () => {
    const fila = criarGravadorDeNota(() => {});
    fila.agendar('teste-1', 'primeira');
    fila.agendar('teste-2', 'segunda');
    expect(await fila.descarregar()).toBe(true);
    expect((await lerNota('teste-1'))?.texto).toBe('primeira');
    expect((await lerNota('teste-2'))?.texto).toBe('segunda');
  });

  it('falha em escrita antiga não sobrescreve a edição feita durante a espera', async () => {
    const fila = criarGravadorDeNota(() => {});
    let recusar!: (erro: Error) => void;
    const iniciou = new Promise<void>((resolve) => {
      storage.local.set.mockImplementationOnce(() => {
        resolve();
        return new Promise<void>((_, reject) => {
          recusar = reject;
        });
      });
    });
    fila.agendar('teste-1', 'antiga');
    const salvando = fila.descarregar();
    await iniciou;
    fila.agendar('teste-1', 'mais recente');
    recusar(new Error('quota simulada'));
    expect(await salvando).toBe(false);
    expect(await fila.descarregar()).toBe(true);
    expect((await lerNota('teste-1'))?.texto).toBe('mais recente');
  });

  it('duas criações simultâneas não perdem documentos', async () => {
    await Promise.all([
      guardarDocumento({ title: '[TESTE] A', content: 'A' }),
      guardarDocumento({ title: '[TESTE] B', content: 'B' }),
    ]);
    expect(await lerDocumentos()).toHaveLength(2);
  });

  it('documento removido não recebe confirmação falsa de salvamento', async () => {
    const estados: string[] = [];
    const fila = criarGravadorDeDocumento((e) => estados.push(e));
    fila.agendar('inexistente', { content: 'rascunho' });
    expect(await fila.descarregar()).toBe(false);
    expect(estados).not.toContain('salvo');
    fila.cancelar();
  });

  it('agrega notas antigas sem perder ordem, separação nem originais', async () => {
    await storage.local.set({
      [STORAGE_KEYS.notes]: {
        n1: { meetingId: 'teste-1', texto: 'primeira', updatedAt: 1 },
        n2: { meetingId: 'teste-1', texto: 'segunda', updatedAt: 2 },
        desconhecido: { conteudo: 'preservar' },
      },
    });
    expect((await lerNota('teste-1'))?.texto).toBe('primeira\n\n---\n\nsegunda');
    await gravarNota('teste-1', 'primeira\n\n---\n\nsegunda\neditada');
    expect((await lerNota('teste-1'))?.anteriores?.map((n) => n.texto)).toEqual([
      'primeira',
      'segunda',
    ]);
    expect(
      (storage.local.values[STORAGE_KEYS.notes] as Record<string, unknown>).desconhecido,
    ).toEqual({ conteudo: 'preservar' });
  });

  it('falhar na exclusão preserva reunião, notas e vínculos', async () => {
    await storage.local.set({ [STORAGE_KEYS.history]: [{ id: 'teste-1' }] });
    await gravarNota('teste-1', 'preservar');
    await guardarDocumento({
      title: '[TESTE]',
      content: 'preservar',
      meetingId: 'teste-1',
    });
    storage.local.set.mockRejectedValueOnce(new Error('falha simulada'));
    await expect(limparVinculosDaReuniao('teste-1')).rejects.toThrow();
    expect(storage.local.values[STORAGE_KEYS.history]).toEqual([{ id: 'teste-1' }]);
    expect((await lerNota('teste-1'))?.texto).toBe('preservar');
    expect((await lerDocumentos())[0]?.meetingId).toBe('teste-1');
  });

  it('nenhum documento é descartado ao ultrapassar 200 registros', async () => {
    for (let i = 0; i < 201; i++)
      await guardarDocumento({ title: `[TESTE] ${i}`, content: String(i) });
    expect(await lerDocumentos()).toHaveLength(201);
  });
});
