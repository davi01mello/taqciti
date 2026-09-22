/**
 * O que sai junto com a reunião, e o que fica.
 *
 * Antes desta limpeza, apagar uma reunião deixava nota, marcações e prints no
 * storage indexados por um `meetingId` que não existia mais: invisíveis,
 * inalcançáveis e consumindo cota. Estes testes seguram as duas metades da
 * regra — o que morre com ela morre, e o que é trabalho próprio sobrevive.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { guardarDocumento, lerDocumentos } from '@/features/documents/store';
import { limparVinculosDaReuniao } from './vinculos';

let storage: ReturnType<typeof installChromeStorageMock>;
const ler = <T>(chave: string): T => storage.local.values[chave] as T;

beforeEach(async () => {
  storage = installChromeStorageMock();
  await storage.local.set({
    [STORAGE_KEYS.notes]: {
      'm-1': { meetingId: 'm-1', texto: 'o que eu anotei', updatedAt: 1 },
      'm-2': { meetingId: 'm-2', texto: 'de outra reunião', updatedAt: 1 },
    },
    [STORAGE_KEYS.marks]: {
      'm-1': { c1: 'destaque', c2: 'duvida' },
      'm-2': { c9: 'acao' },
    },
    [STORAGE_KEYS.shots]: [
      { id: 'p1', meetingId: 'm-1', dataUrl: 'data:image/jpeg;base64,A', at: 1, largura: 1, altura: 1 },
      { id: 'p2', meetingId: 'm-2', dataUrl: 'data:image/jpeg;base64,B', at: 2, largura: 1, altura: 1 },
    ],
  });
});

describe('limparVinculosDaReuniao', () => {
  it('leva nota, marcações e prints DAQUELA reunião', async () => {
    const resultado = await limparVinculosDaReuniao('m-1');

    expect(resultado.nota).toBe(true);
    expect(resultado.marcas).toBe(2);
    expect(resultado.prints).toBe(1);

    expect(ler<Record<string, unknown>>(STORAGE_KEYS.notes)['m-1']).toBeUndefined();
    expect(ler<Record<string, unknown>>(STORAGE_KEYS.marks)['m-1']).toBeUndefined();
    expect(ler<Array<{ id: string }>>(STORAGE_KEYS.shots).map((p) => p.id)).toEqual(['p2']);
  });

  it('não encosta no que é de outra reunião', async () => {
    await limparVinculosDaReuniao('m-1');

    const notas = ler<Record<string, { texto: string }>>(STORAGE_KEYS.notes);
    expect(notas['m-2']?.texto).toBe('de outra reunião');
    expect(ler<Record<string, unknown>>(STORAGE_KEYS.marks)['m-2']).toEqual({ c9: 'acao' });
  });

  /* Documento é trabalho próprio: perde o vínculo, nunca o conteúdo. */
  it('preserva os documentos e devolve quantos foram desvinculados', async () => {
    await guardarDocumento({ title: 'Ata', content: 'texto que vale', meetingId: 'm-1' });

    const resultado = await limparVinculosDaReuniao('m-1');

    expect(resultado.documentosDesvinculados).toBe(1);
    const documentos = await lerDocumentos();
    expect(documentos).toHaveLength(1);
    expect(documentos[0]!.content).toBe('texto que vale');
    expect(documentos[0]!.meetingId).toBeUndefined();
  });

  it('reunião sem anexo nenhum não quebra nem inventa escrita', async () => {
    const resultado = await limparVinculosDaReuniao('m-inexistente');

    expect(resultado).toEqual({
      nota: false,
      marcas: 0,
      prints: 0,
      documentosDesvinculados: 0,
    });
  });
});
