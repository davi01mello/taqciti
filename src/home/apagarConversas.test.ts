/**
 * Apagar uma conversa — o que sai e o que fica. Storage real (mock).
 *
 * Seguram dois achados das auditorias:
 *   - rascunhos de e-mail e agenda da conversa apagada ficavam retidos, sem tela
 *     para apagá-los, enquanto as ações JÁ feitas (ou incertas) têm de ficar: são
 *     a trava contra reenvio às cegas;
 *   - o documento criado numa conversa sobrevive à exclusão dela (só perde o
 *     vínculo), e as reuniões não são tocadas.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { guardarDocumento, lerDocumentos } from '@/features/documents/store';
import {
  cancelarRascunho,
  concluirAcao,
  guardarRascunho,
  obterAcao,
  removerRascunhosDasConversas,
  reservarExecucao,
} from '@/features/integracoes/registroDeAcoes';
import { acrescentarMensagem, apagarConversas, lerConversas } from './conversations';

beforeEach(() => {
  installChromeStorageMock();
});

const payload = { assunto: 'Ata', corpo: 'texto do e-mail' };

async function rascunho(chave: string, conversaId: string) {
  return guardarRascunho({ chave, tipo: 'email', execucaoId: 'x1', conversaId, payload });
}

describe('rascunhos de ação externa da conversa apagada', () => {
  it('saem os rascunhos e os cancelados dela; ficam as ações já feitas ou incertas e os de outra conversa', async () => {
    const a = await acrescentarMensagem(null, { texto: 'Prepare o e-mail para a Ana' });
    const b = await acrescentarMensagem(null, { texto: 'Outra conversa' });

    await rascunho('r-aberto', a);
    await rascunho('r-cancelado', a);
    await cancelarRascunho('r-cancelado', a);
    // Já aceito pelo Google: é a trava contra reenvio, não pode sair.
    await rascunho('r-aceito', a);
    await reservarExecucao({ chave: 'r-aceito', tipo: 'email', execucaoId: 'x2', conversaId: a, payload });
    await concluirAcao('r-aceito', { estado: 'aceito', resultado: { idDaMensagem: 'g1' } });
    // Resultado incerto: também fica.
    await rascunho('r-incerto', a);
    await reservarExecucao({ chave: 'r-incerto', tipo: 'email', execucaoId: 'x3', conversaId: a, payload });
    await concluirAcao('r-incerto', { estado: 'desconhecido', erro: { codigo: 'tempo', mensagem: 'sem resposta' } });
    // Rascunho de OUTRA conversa: intocado.
    await rascunho('r-de-outra', b);

    await apagarConversas([a]);

    expect(await obterAcao('r-aberto')).toBeNull();
    expect(await obterAcao('r-cancelado')).toBeNull();
    expect(await obterAcao('r-aceito')).toMatchObject({ estado: 'aceito' });
    expect(await obterAcao('r-incerto')).toMatchObject({ estado: 'desconhecido' });
    expect(await obterAcao('r-de-outra')).toMatchObject({ estado: 'rascunho', conversaId: b });
  });

  it('removerRascunhosDasConversas devolve quantos saíram e não faz nada sem conversa alvo', async () => {
    await rascunho('r1', 'c-1');
    await rascunho('r2', 'c-1');
    await rascunho('r3', 'c-2');
    expect(await removerRascunhosDasConversas([])).toBe(0);
    expect(await removerRascunhosDasConversas(['c-1'])).toBe(2);
    expect(await obterAcao('r3')).toMatchObject({ estado: 'rascunho' });
  });
});

describe('o que sobrevive à exclusão de uma conversa', () => {
  it('o documento criado na conversa continua em Documentos, só sem o vínculo; a reunião não é tocada', async () => {
    const id = await acrescentarMensagem(null, { texto: 'Gere a ata' });
    const doc = await guardarDocumento({ title: 'Ata da sprint', content: 'conteúdo que vale sozinho', conversationId: id });
    await chrome.storage.local.set({
      [STORAGE_KEYS.history]: [{ id: 'm-1', title: 'Sprint', startedAt: 1, segments: [] }],
    });

    const r = await apagarConversas([id]);

    expect(r).toMatchObject({ apagadas: [id], documentosDesvinculados: 1 });
    expect(await lerConversas()).toEqual([]);
    const documentos = await lerDocumentos();
    expect(documentos).toHaveLength(1);
    expect(documentos[0]).toMatchObject({ id: doc.id, content: 'conteúdo que vale sozinho' });
    expect(documentos[0]!.conversationId).toBeUndefined();
    expect((await chrome.storage.local.get(STORAGE_KEYS.history))[STORAGE_KEYS.history]).toHaveLength(1);
  });

  it('o documento de outra conversa mantém o vínculo', async () => {
    const a = await acrescentarMensagem(null, { texto: 'A' });
    const b = await acrescentarMensagem(null, { texto: 'B' });
    await guardarDocumento({ title: 'De A', content: 'a', conversationId: a });
    const deB = await guardarDocumento({ title: 'De B', content: 'b', conversationId: b });
    await apagarConversas([a]);
    const documentos = await lerDocumentos();
    expect(documentos.find((d) => d.id === deB.id)!.conversationId).toBe(b);
  });
});
