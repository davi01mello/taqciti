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
import { guardarAnalise, lerTrabalho, registrarCompromissos } from '@/features/trabalho/store';
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
      analises: 0,
      avisos: 0,
      briefings: 0,
      sugestoes: 0,
      estados: 0,
    });
  });

  /* O estado dos pontos é leitura da transcrição: vai com a reunião. */
  it('leva o estado dos pontos da reunião e deixa o das outras', async () => {
    await storage.local.set({
      [STORAGE_KEYS.estado]: {
        'm-1': { reuniaoId: 'm-1', revisao: 5, pontos: [] },
        'm-2': { reuniaoId: 'm-2', revisao: 7, pontos: [] },
      },
    });

    const resultado = await limparVinculosDaReuniao('m-1');

    expect(resultado.estados).toBe(1);
    expect(Object.keys(ler<Record<string, unknown>>(STORAGE_KEYS.estado))).toEqual(['m-2']);
  });

  /* Sugestão de condução é derivada da transcrição: vai com a reunião, feedback junto. */
  it('leva as sugestões de condução da reunião e o feedback delas', async () => {
    await storage.local.set({
      [STORAGE_KEYS.apoio]: {
        versao: 1,
        sugestoes: [
          { id: 's1', reuniaoId: 'm-1' },
          { id: 's2', reuniaoId: 'm-2' },
        ],
        feedback: [
          { id: 'f1', reuniaoId: 'm-1' },
          { id: 'f2', reuniaoId: 'm-2' },
        ],
      },
    });

    const resultado = await limparVinculosDaReuniao('m-1');

    expect(resultado.sugestoes).toBe(1);
    const guardado = ler<{ sugestoes: Array<{ id: string }>; feedback: Array<{ id: string }> }>(STORAGE_KEYS.apoio);
    expect(guardado.sugestoes.map((s) => s.id)).toEqual(['s2']);
    expect(guardado.feedback.map((f) => f.id)).toEqual(['f2']);
  });

  /* O briefing é escrito sobre a reunião e vai com ela; o perfil é da pessoa e fica. */
  it('leva o briefing da reunião e preserva o perfil de condução', async () => {
    await storage.local.set({
      [STORAGE_KEYS.conducao]: {
        versao: 1,
        perfil: { missao: 'Apoiar a descoberta.', revisao: 1 },
        briefings: [
          { reuniaoId: 'm-1', objetivo: 'A' },
          { reuniaoId: 'm-2', objetivo: 'B' },
        ],
      },
    });

    const resultado = await limparVinculosDaReuniao('m-1');

    expect(resultado.briefings).toBe(1);
    const guardado = ler<{ perfil: { missao: string }; briefings: Array<{ reuniaoId: string }> }>(
      STORAGE_KEYS.conducao,
    );
    expect(guardado.briefings.map((b) => b.reuniaoId)).toEqual(['m-2']);
    expect(guardado.perfil.missao).toBe('Apoiar a descoberta.');
  });

  /* Aviso é derivado da reunião: um "Ver" para reunião apagada seria órfão. */
  it('leva os avisos da reunião e deixa os das outras', async () => {
    const aviso = (id: string, reuniaoId?: string) => ({
      id,
      chave: `k-${id}`,
      ...(reuniaoId ? { reuniaoId } : {}),
    });
    await storage.local.set({
      [STORAGE_KEYS.avisos]: {
        versao: 1,
        itens: [aviso('a1', 'm-1'), aviso('a2', 'm-2'), aviso('a3')],
      },
    });

    const resultado = await limparVinculosDaReuniao('m-1');

    expect(resultado.avisos).toBe(1);
    expect(
      ler<{ itens: Array<{ id: string }> }>(STORAGE_KEYS.avisos).itens.map((a) => a.id),
    ).toEqual(['a2', 'a3']);
  });

  /* A análise morre com a reunião; o compromisso, que é registro próprio, fica. */
  it('leva a análise da reunião e preserva os compromissos dela', async () => {
    const evidencia = {
      tipo: 'reuniao' as const,
      registroId: 'm-1',
      titulo: 'Reunião 1',
      versao: '1:3',
      trecho: 'Ana envia o relatório',
      segmento: 0,
    };
    await registrarCompromissos(
      [{ descricao: 'Enviar o relatório', responsavel: null, prazo: null, reuniaoId: 'm-1', evidencias: [evidencia] }],
      { origem: 'pessoa' },
    );
    await guardarAnalise(
      {
        reuniaoId: 'm-1',
        versaoDaReuniao: '1:3',
        instrucoes: 'analyst-v1',
        cobertura: { lidos: 3, total: 3 },
        secoes: { visaoGeral: [], decisoes: [], questoes: [], riscos: [], proximosPassos: [] },
        lacunas: [],
      },
      { origem: 'taq' },
    );
    await guardarAnalise(
      {
        reuniaoId: 'm-2',
        versaoDaReuniao: '1:1',
        instrucoes: 'analyst-v1',
        cobertura: { lidos: 1, total: 1 },
        secoes: { visaoGeral: [], decisoes: [], questoes: [], riscos: [], proximosPassos: [] },
        lacunas: [],
      },
      { origem: 'taq' },
    );

    const resultado = await limparVinculosDaReuniao('m-1');

    expect(resultado.analises).toBe(1);
    const trabalho = await lerTrabalho();
    expect(trabalho.analises.map((a) => a.reuniaoId)).toEqual(['m-2']);
    expect(trabalho.compromissos).toHaveLength(1);
    expect(trabalho.compromissos[0]!.estado).toBe('aberto');
  });
});
