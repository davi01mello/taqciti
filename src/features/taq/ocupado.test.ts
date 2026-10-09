/**
 * Uma pergunta enviada enquanto o Taq ainda responde a anterior.
 *
 * Antes, `perguntarAoTaq` devolvia `null` em silêncio: a mensagem já estava
 * gravada na conversa e ficava sem resposta e sem nenhum aviso (só a pergunta
 * rápida tratava esse caso). Agora devolve um desfecho que a tela diz, e não
 * atropela a execução em curso.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { acrescentarMensagem, lerConversas } from '@/home/conversations';
import { _definirTaq, mensagemDoDesfecho, perguntarAoTaq } from './interface';

const RESULTADO = {
  execucaoId: 'x1',
  estado: 'concluido',
  resposta: 'Resposta da primeira pergunta.',
  evidencias: [],
  documentos: [],
  informacoesAusentes: [],
  limitacoes: [],
  erros: [],
  metricas: { duracaoMs: 1, passos: 1, chamadasDeFerramenta: 0, uso: { entrada: 1, saida: 1 } },
};

beforeEach(() => {
  installChromeStorageMock();
});

describe('perguntarAoTaq ocupado', () => {
  it('a segunda pergunta recebe um aviso que a tela diz, e a primeira termina normalmente', async () => {
    let liberar!: () => void;
    const executar = () =>
      new Promise((resolve) => {
        liberar = () => resolve(RESULTADO);
      });
    _definirTaq({ orquestrador: { agentes: {}, executar } as never });
    try {
      const id = await acrescentarMensagem(null, { texto: 'Primeira pergunta' });
      const primeira = perguntarAoTaq({ conversaId: id, texto: 'Primeira pergunta' });
      await new Promise((r) => setTimeout(r, 30));

      await acrescentarMensagem(id, { texto: 'Segunda pergunta, enviada com o Taq ocupado' });
      const segunda = await perguntarAoTaq({ conversaId: id, texto: 'Segunda pergunta, enviada com o Taq ocupado' });

      // Não é mais `null` em silêncio: há um desfecho, com um código e uma frase para a pessoa.
      expect(segunda).not.toBeNull();
      expect(segunda!.estado).toBe('falhou');
      expect(segunda!.erros[0]!.codigo).toBe('ocupado');
      expect(segunda!.resposta).toBeUndefined();
      expect(mensagemDoDesfecho(segunda!)).toMatch(/ainda está respondendo a pergunta anterior/);
      expect(mensagemDoDesfecho(segunda!)).toMatch(/Sua mensagem ficou na conversa/);

      // A primeira não foi atropelada: termina e grava a resposta dela.
      liberar();
      const r1 = await primeira;
      expect(r1?.resposta).toBe('Resposta da primeira pergunta.');
      const conversa = (await lerConversas()).find((c) => c.id === id)!;
      expect(conversa.messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
      expect(conversa.messages.filter((m) => m.role === 'user')).toHaveLength(2);
    } finally {
      _definirTaq({ orquestrador: null });
    }
  });

  it('falha ao gravar a resposta também deixa de ser null: a pessoa é avisada', async () => {
    const executar = async () => {
      throw new Error('boom');
    };
    _definirTaq({ orquestrador: { agentes: {}, executar } as never });
    try {
      const id = await acrescentarMensagem(null, { texto: 'Pergunta' });
      const r = await perguntarAoTaq({ conversaId: id, texto: 'Pergunta' });
      expect(r).not.toBeNull();
      // Um erro do orquestrador vira resultado "falhou" pelo caminho normal (a mensagem diz que não pôde ser produzida).
      expect(r!.estado).toBe('falhou');
      expect(mensagemDoDesfecho(r!)).toMatch(/Falha de execução/);
    } finally {
      _definirTaq({ orquestrador: null });
    }
  });
});
