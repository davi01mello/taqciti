/**
 * O que estes testes protegem: a conversa é REAL — grava, sobrevive, e não
 * inventa resposta nenhuma.
 *
 * O último caso é o mais importante e o menos óbvio: nada aqui deve produzir
 * uma mensagem de `role: 'assistant'`. Não há backend de conversa, e o dia em
 * que alguém "melhorar a experiência" acrescentando uma resposta amigável,
 * este teste quebra e explica por quê.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import {
  acrescentarMensagem,
  apagarConversa,
  lerConversas,
  observarConversas,
  tituloDe,
} from './conversations';

describe('conversas do assistente', () => {
  beforeEach(() => {
    installChromeStorageMock();
  });

  it('a primeira mensagem cria a conversa e vira o título', async () => {
    const id = await acrescentarMensagem(null, { texto: '  Organizar a daily  ' });

    const conversas = await lerConversas();
    expect(conversas).toHaveLength(1);
    expect(conversas[0]?.id).toBe(id);
    expect(conversas[0]?.title).toBe('Organizar a daily');
    expect(conversas[0]?.messages).toHaveLength(1);
    expect(conversas[0]?.messages[0]?.text).toBe('Organizar a daily');
  });

  it('a mensagem seguinte entra na mesma conversa, em ordem', async () => {
    const id = await acrescentarMensagem(null, { texto: 'primeira' });
    await acrescentarMensagem(id, { texto: 'segunda' });

    const conversas = await lerConversas();
    expect(conversas).toHaveLength(1);
    expect(conversas[0]?.messages.map((m) => m.text)).toEqual(['primeira', 'segunda']);
  });

  it('NUNCA grava uma resposta de assistente — não há backend que a produza', async () => {
    const id = await acrescentarMensagem(null, { texto: 'e aí?' });
    await acrescentarMensagem(id, { texto: 'alguém responde?' });

    const conversas = await lerConversas();
    const papeis = conversas.flatMap((c) => c.messages.map((m) => m.role));
    expect(papeis.every((p) => p === 'user')).toBe(true);
  });

  it('a conversa mexida vai para o topo da lista', async () => {
    const antiga = await acrescentarMensagem(null, { texto: 'conversa antiga' });
    await acrescentarMensagem(null, { texto: 'conversa nova' });
    await acrescentarMensagem(antiga, { texto: 'voltei na antiga' });

    const conversas = await lerConversas();
    expect(conversas[0]?.id).toBe(antiga);
  });

  it('guarda o nome do anexo, e só o nome', async () => {
    await acrescentarMensagem(null, {
      texto: 'segue o arquivo',
      attachments: ['ata.pdf'],
    });

    const [conversa] = await lerConversas();
    const mensagem = conversa?.messages[0];
    expect(mensagem?.attachments).toEqual(['ata.pdf']);
    // Nada de conteúdo de arquivo: não há para onde enviá-lo, e guardar bytes
    // no storage da extensão seria encher o disco por nada.
    expect(JSON.stringify(mensagem)).not.toContain('data:');
  });

  it('sobrevive a lixo no storage sem derrubar a tela', async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.conversations]: [null, { id: 'x' }, 'texto solto'],
    });
    await expect(lerConversas()).resolves.toEqual([]);
  });

  it('observar emite o valor atual e cada mudança', async () => {
    const vistos: number[] = [];
    const parar = observarConversas((c) => vistos.push(c.length));

    // A primeira emissão é assíncrona (leitura do storage).
    await new Promise((r) => setTimeout(r, 0));
    expect(vistos).toEqual([0]);

    await acrescentarMensagem(null, { texto: 'oi' });
    expect(vistos.at(-1)).toBe(1);

    parar();
    await acrescentarMensagem(null, { texto: 'depois de parar' });
    expect(vistos.at(-1)).toBe(1);
  });

  it('apagar tira só a conversa pedida', async () => {
    const a = await acrescentarMensagem(null, { texto: 'a' });
    await acrescentarMensagem(null, { texto: 'b' });

    await apagarConversa(a);
    const conversas = await lerConversas();
    expect(conversas.map((c) => c.title)).toEqual(['b']);
  });

  it('título longo é cortado, título vazio tem reserva', () => {
    expect(tituloDe('x'.repeat(200))).toHaveLength(60);
    expect(tituloDe('   ')).toBe('Conversa sem título');
  });
});
