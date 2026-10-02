/**
 * As anotações: nota, marcação, print e o aviso no chat.
 *
 * O que se testa aqui são as promessas que o requisito faz por escrito — a
 * marcação sobreviver à legenda ser reescrita, a janela do aviso não reiniciar,
 * a nota não encostar na transcrição — e não o encanamento do storage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';

beforeEach(() => {
  vi.resetModules();
  installChromeStorageMock();
});

describe('notas', () => {
  it('a nota pertence à reunião e volta por ela', async () => {
    const { gravarNota, lerNota } = await import('./notes');
    await gravarNota('m1', 'combinar o escopo com a Ana');
    const nota = await lerNota('m1');
    expect(nota?.texto).toBe('combinar o escopo com a Ana');
    expect(nota?.meetingId).toBe('m1');
    await expect(lerNota('m2')).resolves.toBeNull();
  });

  it('esvaziar a nota a remove em vez de guardar vazio', async () => {
    const { gravarNota, lerNota } = await import('./notes');
    await gravarNota('m1', 'algo');
    await gravarNota('m1', '   ');
    await expect(lerNota('m1')).resolves.toBeNull();
  });

  it('apagar remove a nota inteira, e só a dela', async () => {
    const { gravarNota, apagarNota, lerNota } = await import('./notes');
    await gravarNota('m1', 'a que some');
    await gravarNota('m2', 'a que fica');

    await apagarNota('m1');

    await expect(lerNota('m1')).resolves.toBeNull();
    expect((await lerNota('m2'))?.texto).toBe('a que fica');
    // Sem chave órfã: apagar tira o registro do storage, não o esvazia.
    const guardadas = (await chrome.storage.local.get(STORAGE_KEYS.notes))[
      STORAGE_KEYS.notes
    ] as Record<string, unknown>;
    expect(Object.keys(guardadas)).toEqual(['m2']);
  });

  /*
   * A diferença que justifica `apagarNota` existir ao lado de `gravarNota(id,
   * '')`: esvaziar preserva os `anteriores` — os originais guardados quando
   * registros antigos foram agregados — e a nota volta a aparecer agregada.
   * Apagar leva tudo.
   */
  it('apagar leva junto os originais que esvaziar preservaria', async () => {
    const { apagarNota, lerNota } = await import('./notes');
    await chrome.storage.local.set({
      [STORAGE_KEYS.notes]: {
        antiga: [
          { meetingId: 'm1', texto: 'primeira', updatedAt: 1 },
          { meetingId: 'm1', texto: 'segunda', updatedAt: 2 },
        ],
      },
    });
    expect((await lerNota('m1'))?.anteriores).toHaveLength(2);

    await apagarNota('m1');
    await expect(lerNota('m1')).resolves.toBeNull();
    const guardadas = (await chrome.storage.local.get(STORAGE_KEYS.notes))[
      STORAGE_KEYS.notes
    ] as Record<string, unknown>;
    expect(guardadas).toEqual({});
  });

  /* Apagar não exige a reunião viva: nota órfã é justamente o caso em que
     remover importa mais, e gravar recusaria. */
  it('apaga a nota de uma reunião que já saiu do histórico', async () => {
    const { apagarNota, lerNota } = await import('./notes');
    await chrome.storage.local.set({
      [STORAGE_KEYS.history]: [],
      [STORAGE_KEYS.notes]: { m1: { meetingId: 'm1', texto: 'órfã', updatedAt: 1 } },
    });

    await apagarNota('m1');
    await expect(lerNota('m1')).resolves.toBeNull();
  });

  /* A nota é registro à parte: gravá-la não toca o histórico da reunião. */
  it('gravar nota não escreve no histórico', async () => {
    const { gravarNota } = await import('./notes');
    await gravarNota('m1', 'uma nota');
    const tudo = await chrome.storage.local.get(null);
    expect(Object.keys(tudo)).toEqual([STORAGE_KEYS.notes]);
  });

  it('o gravador junta as teclas numa escrita só', async () => {
    vi.useFakeTimers();
    try {
      const { criarGravadorDeNota, lerNota, AGUARDAR_MS } = await import('./notes');
      const estados: string[] = [];
      const g = criarGravadorDeNota((e) => estados.push(e));

      g.agendar('m1', 'a');
      g.agendar('m1', 'ab');
      g.agendar('m1', 'abc');
      expect(estados.at(-1)).toBe('gravando');

      await vi.advanceTimersByTimeAsync(AGUARDAR_MS + 10);
      expect(estados.at(-1)).toBe('salvo');
      await expect(lerNota('m1')).resolves.toMatchObject({ texto: 'abc' });
    } finally {
      vi.useRealTimers();
    }
  });

  /* Sair da tela não pode perder a última tecla. */
  it('descarregar grava o que ainda estava pendente', async () => {
    vi.useFakeTimers();
    try {
      const { criarGravadorDeNota, lerNota } = await import('./notes');
      const g = criarGravadorDeNota(() => {});
      g.agendar('m1', 'sem esperar o respiro');
      await g.descarregar();
      await expect(lerNota('m1')).resolves.toMatchObject({
        texto: 'sem esperar o respiro',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('marcações', () => {
  it('a marca pertence ao captionId, não ao texto', async () => {
    const { marcarTrecho, lerMarcas } = await import('./marks');
    await marcarTrecho('m1', 'caption-7', 'decisao');
    expect(await lerMarcas('m1')).toEqual({ 'caption-7': 'decisao' });
  });

  /*
   * O caso que o requisito nomeia: a legenda é reescrita enquanto a fala é
   * completada. Como a chave é o `captionId` — estável por linha de legenda —,
   * a marcação continua no mesmo trecho.
   */
  it('sobrevive à legenda ser reescrita', async () => {
    const { marcarTrecho, lerMarcas } = await import('./marks');
    const { applyCaptionChunk } = await import('@/features/transcription/aggregator');

    let segmentos = applyCaptionChunk([], [], {
      captionId: 'c1', speaker: 'Ana', text: 'vamos fechar', atMs: 1000,
    }, 0).segments;
    await marcarTrecho('m1', 'c1', 'destaque');

    // A mesma fala chega mais completa.
    segmentos = applyCaptionChunk(segmentos, [], {
      captionId: 'c1', speaker: 'Ana', text: 'vamos fechar o escopo hoje', atMs: 1400,
    }, 0).segments;

    expect(segmentos[0]?.text).toBe('vamos fechar o escopo hoje');
    expect(segmentos[0]?.captionId).toBe('c1');
    expect((await lerMarcas('m1'))['c1']).toBe('destaque');
  });

  it('trocar e remover a marca', async () => {
    const { marcarTrecho, lerMarcas } = await import('./marks');
    await marcarTrecho('m1', 'c1', 'duvida');
    await marcarTrecho('m1', 'c1', 'acao');
    expect((await lerMarcas('m1'))['c1']).toBe('acao');
    await marcarTrecho('m1', 'c1', null);
    expect(await lerMarcas('m1')).toEqual({});
  });

  it('marcações são por reunião', async () => {
    const { marcarTrecho, lerMarcas } = await import('./marks');
    await marcarTrecho('m1', 'c1', 'decisao');
    expect(await lerMarcas('m2')).toEqual({});
  });

  it('tipo inválido no storage não vira marca', async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.marks]: { m1: { c1: 'estrela' } } });
    const { lerMarcas } = await import('./marks');
    expect(await lerMarcas('m1')).toEqual({});
  });
});

describe('prints', () => {
  const imagem = 'data:image/jpeg;base64,AAAA';

  it('ficam vinculados à reunião', async () => {
    const { guardarPrint, lerPrints } = await import('./shots');
    await guardarPrint('m1', imagem, 1440, 900);
    await guardarPrint('m2', imagem, 800, 600);
    expect(await lerPrints('m1')).toHaveLength(1);
    expect((await lerPrints('m1'))[0]?.meetingId).toBe('m1');
    expect(await lerPrints()).toHaveLength(2);
  });

  it('o mais antigo da reunião sai quando o teto é atingido', async () => {
    const { guardarPrint, lerPrints, MAX_POR_REUNIAO } = await import('./shots');
    for (let i = 0; i < MAX_POR_REUNIAO + 3; i++) {
      await guardarPrint('m1', `${imagem}${i}`, 10, 10);
    }
    expect(await lerPrints('m1')).toHaveLength(MAX_POR_REUNIAO);
  });

  it('apagar remove só o escolhido', async () => {
    const { guardarPrint, apagarPrint, lerPrints } = await import('./shots');
    const a = await guardarPrint('m1', `${imagem}a`, 10, 10);
    await guardarPrint('m1', `${imagem}b`, 10, 10);
    await apagarPrint(a.id);
    const restantes = await lerPrints('m1');
    expect(restantes).toHaveLength(1);
    expect(restantes[0]?.id).not.toBe(a.id);
  });
});

describe('aviso no chat', () => {
  const INICIO = 1_000_000;

  it('oferece dentro do primeiro minuto, capturando', async () => {
    const { estadoDoAviso } = await import('./chatNotice');
    expect(
      estadoDoAviso({ capturando: true, inicioDaReuniao: INICIO, jaEnviado: false, agora: INICIO + 30_000 }),
    ).toBe('oferecer');
  });

  /*
   * A conta é contra o início da REUNIÃO. Reabrir a sidebar aos 90s não pode
   * devolver o atalho — e é exatamente isto que um cronômetro por montagem
   * faria.
   */
  it('passado o minuto, não oferece mais', async () => {
    const { estadoDoAviso } = await import('./chatNotice');
    expect(
      estadoDoAviso({ capturando: true, inicioDaReuniao: INICIO, jaEnviado: false, agora: INICIO + 61_000 }),
    ).toBe('fora');
  });

  it('sem captura acontecendo, não existe atalho', async () => {
    const { estadoDoAviso } = await import('./chatNotice');
    expect(
      estadoDoAviso({ capturando: false, inicioDaReuniao: INICIO, jaEnviado: false, agora: INICIO + 5_000 }),
    ).toBe('inativo');
  });

  it('enviado é enviado, mesmo dentro da janela', async () => {
    const { estadoDoAviso } = await import('./chatNotice');
    expect(
      estadoDoAviso({ capturando: true, inicioDaReuniao: INICIO, jaEnviado: true, agora: INICIO + 5_000 }),
    ).toBe('enviado');
  });

  it('registrar é idempotente — não duplica o envio', async () => {
    const { registrarAvisoEnviado } = await import('./chatNotice');
    await registrarAvisoEnviado('m1');
    const primeiro = (await chrome.storage.local.get(STORAGE_KEYS.chatNotice))[
      STORAGE_KEYS.chatNotice
    ] as Record<string, { at: number }>;
    await registrarAvisoEnviado('m1');
    const segundo = (await chrome.storage.local.get(STORAGE_KEYS.chatNotice))[
      STORAGE_KEYS.chatNotice
    ] as Record<string, { at: number }>;
    expect(segundo['m1']?.at).toBe(primeiro['m1']?.at);
  });

  it('o texto do aviso é um só', async () => {
    const { TEXTO_DO_AVISO } = await import('./chatNotice');
    expect(TEXTO_DO_AVISO).toBe('Estou usando o TaqCiti para transcrever esta reunião.');
  });
});
