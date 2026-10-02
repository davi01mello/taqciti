/**
 * O que estes testes existem para provar.
 *
 * O requisito do conector não é "as ferramentas funcionam" — é que NENHUMA
 * resposta consiga afogar a janela de contexto, por pior que seja o acervo.
 * Isso não se verifica lendo o código: verifica-se jogando nele um acervo
 * patológico e MEDINDO o que sai.
 *
 * Por isso o arquivo tem duas metades. A primeira é comportamento normal
 * (busca acha, paginação pagina). A segunda — "o teto é real" — constrói uma
 * reunião de seis horas e um documento colado de um PDF e afirma o tamanho
 * de cada resposta em caracteres. É a metade que pega uma regressão de
 * verdade: acrescentar um campo generoso a um envelope passa em todo teste de
 * comportamento e só aparece aqui.
 */
import { describe, expect, it } from 'vitest';
import { acervoDeMemoria } from './acervoDeMemoria';
import { ORCAMENTO, cortar } from './orcamento';
import { dobrar } from './busca';
import {
  ErroDeUso,
  ferramentaBuscar,
  ferramentaConteudo,
  ferramentaLer,
  ferramentaListar,
} from './ferramentas';
import type { ConversaDoAcervo, DocumentoDoAcervo, NotaDoAcervo, ReuniaoDoAcervo } from './tipos';

// ------------------------------------------------------------- fabricantes

const DIA = 86_400_000;
const BASE = Date.UTC(2026, 8, 1);

function reuniao(over: Partial<ReuniaoDoAcervo> = {}): ReuniaoDoAcervo {
  return {
    id: 'r1',
    titulo: 'Planejamento do trimestre',
    inicioMs: BASE,
    duracaoSegundos: 3600,
    participantes: ['Ana Souza', 'Beatriz Lima'],
    falas: [
      { falante: 'Ana Souza', texto: 'Vamos revisar o cronograma.', offsetMs: 0 },
      { falante: 'Beatriz Lima', texto: 'A integração travou nos testes de carga.', offsetMs: 5000 },
      { falante: 'Ana Souza', texto: 'Quem fica responsável pelo deploy?', offsetMs: 9000 },
      { falante: 'Beatriz Lima', texto: 'Eu assumo o deploy na sexta.', offsetMs: 12000 },
    ],
    ...over,
  };
}

function documento(over: Partial<DocumentoDoAcervo> = {}): DocumentoDoAcervo {
  return {
    id: 'd1',
    titulo: 'Ata — Planejamento',
    texto: 'Primeiro parágrafo da ata.\n\nSegundo parágrafo, com a decisão de deploy.',
    criadoMs: BASE + DIA,
    atualizadoMs: BASE + DIA,
    tipoGerado: 'ata',
    reuniaoId: 'r1',
    ...over,
  };
}

function conversa(over: Partial<ConversaDoAcervo> = {}): ConversaDoAcervo {
  return {
    id: 'c1',
    titulo: 'Dúvidas sobre o cronograma',
    criadaMs: BASE + 2 * DIA,
    atualizadaMs: BASE + 2 * DIA,
    mensagens: [
      { autor: 'pessoa', texto: 'O que ficou decidido sobre o deploy?', emMs: BASE },
      { autor: 'assistente', texto: 'Beatriz assumiu o deploy na sexta.', emMs: BASE + 1000 },
    ],
    ...over,
  };
}

function nota(over: Partial<NotaDoAcervo> = {}): NotaDoAcervo {
  return {
    id: 'r1',
    reuniaoId: 'r1',
    reuniaoTitulo: 'Planejamento do trimestre',
    texto: 'Cobrar a Beatriz sobre o deploy na segunda.',
    atualizadaMs: BASE + 3 * DIA,
    marcacoes: { decisao: 2, acao: 1 },
    prints: 3,
    ...over,
  };
}

function acervoCompleto() {
  return acervoDeMemoria({
    reuniao: [reuniao()],
    documento: [documento()],
    conversa: [conversa()],
    nota: [nota()],
  });
}

// ------------------------------------------------------------ comportamento

describe('cortar', () => {
  it('não mexe no que já cabe', () => {
    expect(cortar('curto', 100)).toBe('curto');
  });

  it('cai em fronteira de palavra e avisa que cortou', () => {
    const saida = cortar('alfa beta gama delta epsilon', 20);
    expect(saida.length).toBeLessThanOrEqual(20);
    expect(saida.endsWith('[cortado]')).toBe(true);
    // Não entrega palavra pela metade.
    expect(saida).not.toMatch(/[a-z]\[cortado\]$/);
  });

  it('corta seco quando não há espaço nenhum onde cair', () => {
    const saida = cortar('a'.repeat(200), 30);
    expect(saida.length).toBeLessThanOrEqual(30);
    expect(saida.endsWith('[cortado]')).toBe(true);
  });
});

describe('dobrar', () => {
  it('iguala acento e caixa — é o que faz "orcamento" achar "orçamento"', () => {
    expect(dobrar('Orçamento da Reunião')).toBe('orcamento da reuniao');
  });
});

describe('buscar', () => {
  it('acha em todas as coleções e diz a posição do acerto', async () => {
    const r = await ferramentaBuscar(acervoCompleto(), { consulta: 'deploy' });
    expect(r.itens.length).toBeGreaterThanOrEqual(4);
    expect(new Set(r.itens.map((i) => i.tipo))).toEqual(
      new Set(['reuniao', 'documento', 'conversa', 'nota']),
    );
    const naReuniao = r.itens.find((i) => i.tipo === 'reuniao');
    // "deploy" aparece pela primeira vez na fala de índice 2.
    expect(naReuniao?.posicao).toBe(2);
    expect(naReuniao?.id).toBe('reuniao:r1');
  });

  it('a posição devolvida serve direto como `de` em conteudo', async () => {
    const acervo = acervoCompleto();
    const achou = await ferramentaBuscar(acervo, { consulta: 'deploy' });
    const hit = achou.itens.find((i) => i.tipo === 'reuniao')!;
    const corpo = await ferramentaConteudo(acervo, { id: hit.id, de: hit.posicao, quantidade: 1 });
    expect(corpo.itens[0]?.texto).toContain('deploy');
  });

  it('ignora acento na consulta', async () => {
    const r = await ferramentaBuscar(acervoCompleto(), { consulta: 'integracao' });
    expect(r.itens.some((i) => i.tipo === 'reuniao')).toBe(true);
  });

  it('título pesa mais que corpo', async () => {
    const acervo = acervoDeMemoria({
      reuniao: [
        reuniao({ id: 'titulo', titulo: 'Cronograma', falas: [] }),
        reuniao({
          id: 'corpo',
          titulo: 'Outra',
          falas: [{ falante: null, texto: 'cronograma', offsetMs: 0 }],
        }),
      ],
    });
    const r = await ferramentaBuscar(acervo, { consulta: 'cronograma' });
    expect(r.itens[0]?.id).toBe('reuniao:titulo');
  });

  it('casa prefixo de PALAVRA, não pedaço de palavra', async () => {
    // "ana" dentro de "semana" é o falso positivo clássico, e o pior num
    // acervo de reuniões: metade dos termos úteis é nome de gente.
    const acervo = acervoDeMemoria({
      reuniao: [
        reuniao({
          id: 'ruido',
          titulo: 'Retrospectiva',
          falas: [{ falante: null, texto: 'Fechamos na semana passada.', offsetMs: 0 }],
        }),
        reuniao({
          id: 'certa',
          titulo: 'Retrospectiva',
          falas: [{ falante: 'Ana Souza', texto: 'Eu cuido disso.', offsetMs: 0 }],
        }),
      ],
    });
    const r = await ferramentaBuscar(acervo, { consulta: 'ana' });
    expect(r.itens.map((i) => i.id)).toEqual(['reuniao:certa']);
  });

  it('consulta vazia é recusada — enumerar é trabalho de `listar`', async () => {
    await expect(ferramentaBuscar(acervoCompleto(), { consulta: '   ' })).rejects.toBeInstanceOf(
      ErroDeUso,
    );
  });

  it('sem acerto devolve vazio com orientação, não o acervo inteiro', async () => {
    const r = await ferramentaBuscar(acervoCompleto(), { consulta: 'zzzznadaaqui' });
    expect(r.itens).toEqual([]);
    expect(r.aviso).toBeTruthy();
  });

  it('tipo inválido explica quais existem', async () => {
    await expect(
      ferramentaBuscar(acervoCompleto(), { consulta: 'x', tipos: ['reunioes'] }),
    ).rejects.toThrow(/reuniao/);
  });
});

describe('listar', () => {
  it('não vaza conteúdo — só título, data e tamanho', async () => {
    const r = await ferramentaListar(acervoCompleto(), { tipo: 'reuniao' });
    const serializado = JSON.stringify(r);
    expect(serializado).not.toContain('travou nos testes de carga');
    expect(r.itens[0]?.resumo).toContain('4 falas');
  });

  it('pagina e encadeia por `proximo`', async () => {
    const muitas = Array.from({ length: 60 }, (_, i) =>
      reuniao({ id: `r${i}`, inicioMs: BASE + i * DIA, falas: [] }),
    );
    const acervo = acervoDeMemoria({ reuniao: muitas });

    const p1 = await ferramentaListar(acervo, { tipo: 'reuniao' });
    expect(p1.total).toBe(60);
    expect(p1.mostrando).toBe(ORCAMENTO.pagina);
    expect(p1.proximo).toBe(ORCAMENTO.pagina);

    const p2 = await ferramentaListar(acervo, { tipo: 'reuniao', de: p1.proximo });
    expect(p2.itens[0]?.id).not.toBe(p1.itens[0]?.id);

    const ultima = await ferramentaListar(acervo, { tipo: 'reuniao', de: 50 });
    expect(ultima.mostrando).toBe(10);
    expect(ultima.proximo).toBeUndefined();
  });

  it('pedir mais que a página não passa da página', async () => {
    const muitas = Array.from({ length: 60 }, (_, i) => reuniao({ id: `r${i}`, falas: [] }));
    const r = await ferramentaListar(acervoDeMemoria({ reuniao: muitas }), {
      tipo: 'reuniao',
      quantidade: 10_000,
    });
    expect(r.mostrando).toBe(ORCAMENTO.pagina);
  });

  it('ordena do mais recente para o mais antigo', async () => {
    const acervo = acervoDeMemoria({
      reuniao: [
        reuniao({ id: 'velha', inicioMs: BASE, falas: [] }),
        reuniao({ id: 'nova', inicioMs: BASE + 10 * DIA, falas: [] }),
      ],
    });
    const r = await ferramentaListar(acervo, { tipo: 'reuniao' });
    expect(r.itens[0]?.id).toBe('reuniao:nova');
  });
});

describe('ler', () => {
  it('devolve o envelope sem o corpo, e diz como pedir o corpo', async () => {
    const e = await ferramentaLer(acervoCompleto(), 'reuniao:r1');
    expect(e.corpo).toEqual({ unidade: 'falas', total: 4 });
    expect(e.comoLer).toContain('conteudo(id: "reuniao:r1"');
  });

  it('numa reunião grande, o envelope NÃO carrega o corpo', async () => {
    // Com 4 falas a abertura contém a reunião inteira, e isso é correto — o
    // item cabe. O invariante só tem o que dizer quando não cabe.
    const acervo = acervoDeMemoria({
      reuniao: [
        reuniao({
          falas: [
            ...Array.from({ length: 300 }, (_, i) => ({
              falante: 'Ana Souza',
              texto: `Assunto ${i} discutido com algum detalhe.`,
              offsetMs: i * 1000,
            })),
            { falante: 'Beatriz Lima', texto: 'SEGREDO NO FIM DA REUNIÃO', offsetMs: 999_000 },
          ],
        }),
      ],
    });
    const e = await ferramentaLer(acervo, 'reuniao:r1');
    expect(e.corpo.total).toBe(301);
    expect(JSON.stringify(e)).not.toContain('SEGREDO NO FIM');
    expect(JSON.stringify(e).length).toBeLessThanOrEqual(ORCAMENTO.envelope + 600);
  });

  it('separa quem estava de quem falou', async () => {
    const e = await ferramentaLer(
      acervoDeMemoria({
        reuniao: [
          reuniao({
            participantes: ['Ana Souza', 'Beatriz Lima', 'Caio Mendes'],
            falas: [{ falante: 'Ana Souza', texto: 'oi', offsetMs: 0 }],
          }),
        ],
      }),
      'reuniao:r1',
    );
    expect(e.sobre.participantes).toContain('Caio Mendes');
    expect(e.sobre.falaram).toBe('Ana Souza');
  });

  it('a nota conta os prints e diz que a imagem não sai', async () => {
    const e = await ferramentaLer(acervoCompleto(), 'nota:r1');
    expect(e.sobre.prints).toMatch(/^3 /);
    expect(e.sobre.prints).toContain('não são expostas');
  });

  it('id malformado ensina o formato em vez de estourar', async () => {
    await expect(ferramentaLer(acervoCompleto(), 'r1')).rejects.toThrow(/tipo:id/);
  });

  it('id inexistente diz para conferir com listar/buscar', async () => {
    await expect(ferramentaLer(acervoCompleto(), 'reuniao:naoexiste')).rejects.toThrow(/listar/);
  });
});

describe('conteudo', () => {
  it('fatia falas e encadeia por `proximo`', async () => {
    const acervo = acervoCompleto();
    const p1 = await ferramentaConteudo(acervo, { id: 'reuniao:r1', quantidade: 2 });
    expect(p1.unidade).toBe('falas');
    expect(p1.total).toBe(4);
    expect(p1.mostrando).toBe(2);
    expect(p1.proximo).toBe(2);
    expect(p1.itens[0]).toMatchObject({ em: 0, autor: 'Ana Souza' });

    const p2 = await ferramentaConteudo(acervo, { id: 'reuniao:r1', de: p1.proximo });
    expect(p2.itens[0]?.em).toBe(2);
    expect(p2.proximo).toBeUndefined();
  });

  it('fatia documento por caractere, na mesma coordenada que a busca usa', async () => {
    const texto = 'A'.repeat(20_000);
    const acervo = acervoDeMemoria({ documento: [documento({ texto })] });
    const p1 = await ferramentaConteudo(acervo, { id: 'documento:d1' });
    expect(p1.unidade).toBe('caracteres');
    expect(p1.total).toBe(20_000);
    expect(p1.mostrando).toBe(ORCAMENTO.fatia);
    expect(p1.proximo).toBe(ORCAMENTO.fatia);

    const p2 = await ferramentaConteudo(acervo, { id: 'documento:d1', de: p1.proximo });
    expect(p2.itens[0]?.em).toBe(ORCAMENTO.fatia);
  });

  it('`de` além do fim devolve vazio, não erro', async () => {
    const r = await ferramentaConteudo(acervoCompleto(), { id: 'reuniao:r1', de: 999 });
    expect(r.itens).toEqual([]);
    expect(r.total).toBe(4);
  });
});

// ------------------------------------------------------- o teto é real

describe('o teto é real', () => {
  /** Seis horas de reunião: ~2.200 falas. O pior caso plausível. */
  function reuniaoMonstro(): ReuniaoDoAcervo {
    return reuniao({
      id: 'monstro',
      titulo: 'Maratona de planejamento',
      duracaoSegundos: 6 * 3600,
      participantes: Array.from({ length: 40 }, (_, i) => `Participante ${i}`),
      falas: Array.from({ length: 2_200 }, (_, i) => ({
        falante: `Participante ${i % 40}`,
        texto:
          `Fala ${i} sobre o deploy e o cronograma, com bastante texto para que ` +
          `nenhum teto passe despercebido por ser generoso demais na média.`,
        offsetMs: i * 9_000,
      })),
    });
  }

  const monstruoso = () =>
    acervoDeMemoria({
      reuniao: Array.from({ length: 12 }, (_, i) => ({
        ...reuniaoMonstro(),
        id: `monstro${i}`,
        inicioMs: BASE + i * DIA,
      })),
      documento: [documento({ texto: 'palavra '.repeat(200_000) })],
      conversa: [
        conversa({
          mensagens: Array.from({ length: 900 }, (_, i) => ({
            autor: (i % 2 === 0 ? 'pessoa' : 'assistente') as 'pessoa' | 'assistente',
            texto: `Mensagem ${i} falando de deploy. `.repeat(20),
            emMs: BASE + i,
          })),
        }),
      ],
      nota: [nota({ texto: 'anotação comprida sobre o deploy. '.repeat(5_000) })],
    });

  const tamanho = (r: unknown) => JSON.stringify(r).length;

  it('buscar no pior acervo cabe no teto', async () => {
    const r = await ferramentaBuscar(monstruoso(), { consulta: 'deploy' });
    expect(tamanho(r)).toBeLessThanOrEqual(ORCAMENTO.resposta);
    expect(r.itens.length).toBeLessThanOrEqual(ORCAMENTO.hits);
  });

  it('listar no pior acervo cabe no teto', async () => {
    for (const tipo of ['reuniao', 'documento', 'conversa', 'nota']) {
      const r = await ferramentaListar(monstruoso(), { tipo, quantidade: 10_000 });
      expect(tamanho(r), tipo).toBeLessThanOrEqual(ORCAMENTO.resposta);
    }
  });

  it('ler no pior acervo cabe no teto', async () => {
    for (const id of ['reuniao:monstro0', 'documento:d1', 'conversa:c1', 'nota:r1']) {
      const e = await ferramentaLer(monstruoso(), id);
      expect(tamanho(e), id).toBeLessThanOrEqual(ORCAMENTO.resposta);
    }
  });

  it('conteudo no pior acervo cabe no teto, mesmo pedindo tudo', async () => {
    for (const id of ['reuniao:monstro0', 'documento:d1', 'conversa:c1', 'nota:r1']) {
      const r = await ferramentaConteudo(monstruoso(), { id, de: 0, quantidade: 10_000 });
      expect(tamanho(r), id).toBeLessThanOrEqual(ORCAMENTO.resposta);
    }
  });

  it('a fatia para por CARACTERE quando as falas são longas', async () => {
    // Quarenta falas caberiam pela contagem; não cabem pelo tamanho. É este
    // caso que um teto só de itens deixaria passar.
    const acervo = acervoDeMemoria({
      reuniao: [
        reuniao({
          falas: Array.from({ length: 100 }, (_, i) => ({
            falante: 'Ana',
            texto: 'x'.repeat(1_000),
            offsetMs: i,
          })),
        }),
      ],
    });
    const r = await ferramentaConteudo(acervo, { id: 'reuniao:r1', quantidade: 40 });
    expect(r.mostrando).toBeLessThan(40);
    expect(r.aviso).toContain('caracteres');
    expect(r.proximo).toBe(r.mostrando);
  });

  it('percorrer a reunião inteira por fatias termina e não pula nada', async () => {
    const acervo = acervoDeMemoria({ reuniao: [reuniaoMonstro()] });
    let de: number | undefined = 0;
    let lidas = 0;
    let voltas = 0;
    while (de !== undefined) {
      const r = await ferramentaConteudo(acervo, { id: 'reuniao:monstro', de });
      // Cada fatia começa exatamente onde a anterior parou.
      expect(r.itens[0]?.em).toBe(lidas);
      lidas += r.mostrando;
      de = r.proximo;
      if (++voltas > 500) throw new Error('paginação não terminou');
    }
    expect(lidas).toBe(2_200);
  });
});
