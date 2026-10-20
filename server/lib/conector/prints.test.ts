import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Consultador } from './banco';
import { limparCabecas } from './cabeca';
import { lerCopias } from './copia';
import { MAX_BYTES_DO_PRINT, apagarPrint, gravarPrint, validarPrint } from './prints';
import { garantirPessoa } from './pessoa';

const CORRIDA = `p${Date.now()}`;

/** Bytes que COMEÇAM como um JPEG de verdade, com miolo aleatório (não comprime, como uma foto). */
const jpeg = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(n)]);
const dataUrl = (b: Buffer, mime = 'image/jpeg') => `data:${mime};base64,${b.toString('base64')}`;

const bruto = (b: Buffer, extra: Record<string, unknown> = {}) => ({
  id: 'p1',
  meetingId: 'r1',
  dataUrl: dataUrl(b),
  at: 1_790_000_000_000,
  largura: 1440,
  altura: 900,
  ...extra,
});

const valido = (b: unknown) => {
  const r = validarPrint(b);
  if (!r.ok) throw new Error(r.motivo);
  return r.item;
};

describe('validarPrint', () => {
  it('aceita um JPEG de verdade', () => {
    const b = jpeg(1000);
    const item = valido(bruto(b));
    expect(item.bytes.equals(b)).toBe(true);
    expect(item).toMatchObject({ id: 'p1', reuniaoId: 'r1', mime: 'image/jpeg', largura: 1440, altura: 900 });
  });

  it('aceita png e webp com os bytes certos', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(50)]);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBP'), randomBytes(50)]);
    expect(validarPrint(bruto(png, { dataUrl: dataUrl(png, 'image/png') }))).toMatchObject({ ok: true });
    expect(validarPrint(bruto(webp, { dataUrl: dataUrl(webp, 'image/webp') }))).toMatchObject({ ok: true });
  });

  it('o prefixo não basta: bytes que não são JPEG são recusados', () => {
    const mentira = Buffer.from('isto nao e uma imagem, so diz que e');
    expect(validarPrint(bruto(mentira))).toMatchObject({ ok: false, motivo: expect.stringContaining('bytes') });
  });

  it.each([
    ['tipo que não é imagem', { dataUrl: 'data:text/html;base64,PGgxPg==' }],
    ['svg (pode carregar script)', { dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }],
    ['sem base64', { dataUrl: 'data:image/jpeg,abc' }],
    ['base64 inválido', { dataUrl: 'data:image/jpeg;base64,@@@@' }],
    ['imagem vazia', { dataUrl: 'data:image/jpeg;base64,' }],
    ['id vazio', { id: '' }],
    ['sem reunião', { meetingId: undefined }],
    ['largura absurda', { largura: 999_999 }],
  ])('recusa %s', (_nome, extra) => {
    expect(validarPrint(bruto(jpeg(100), extra))).toMatchObject({ ok: false });
  });

  it('recusa acima do teto', () => {
    expect(validarPrint(bruto(jpeg(MAX_BYTES_DO_PRINT + 10)))).toMatchObject({ ok: false });
  });
});

describe('prints no servidor', () => {
  let pglite: PGlite;
  let pool: Consultador;
  let ana: string;
  let bia: string;
  /** Cada consulta que o servidor fez, para provar o que NÃO foi buscado. */
  let consultas: { texto: string; valores?: readonly unknown[] }[] = [];

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(readFileSync(join(process.cwd(), 'lib', 'conector', 'esquema.sql'), 'utf8'));
    pool = {
      query: (texto, valores) => {
        consultas.push({ texto, valores });
        return pglite.query(texto, valores as unknown[]) as Promise<{ rows: Record<string, unknown>[] }>;
      },
    };
    ana = await garantirPessoa({ googleSub: `${CORRIDA}-a`, email: 'ana@citi.org.br' }, pool);
    bia = await garantirPessoa({ googleSub: `${CORRIDA}-b`, email: 'bia@citi.org.br' }, pool);
  });

  beforeEach(() => {
    consultas = [];
    limparCabecas();
  });

  afterAll(async () => {
    await pglite.close();
  });

  it('volta byte a byte igual, sem as quebras de linha que o encode do Postgres põe', async () => {
    const b = jpeg(120_000);
    await gravarPrint(ana, valido(bruto(b, { id: 'ida-e-volta' })), pool);

    const { itens } = await lerCopias(ana, 0, {}, pool);
    const p = itens.find((i) => i.colecao === 'print' && i.id === 'ida-e-volta');
    expect(p).toBeDefined();
    const corpo = p!.corpo as { dataUrl: string; meetingId: string; at: number; largura: number };
    expect(corpo.dataUrl).toBe(dataUrl(b));
    expect(corpo.dataUrl).not.toContain('\n');
    expect(corpo).toMatchObject({ meetingId: 'r1', at: 1_790_000_000_000, largura: 1440 });
  });

  it('guarda binário, não base64: ocupa o tamanho da imagem', async () => {
    const b = jpeg(50_000);
    await gravarPrint(ana, valido(bruto(b, { id: 'tamanho' })), pool);
    const r = await pool.query('select tamanho, octet_length(bytes) as real from print_local where pessoa_id = $1 and id = $2', [ana, 'tamanho']);
    expect(Number(r.rows[0]!.tamanho)).toBe(b.length);
    expect(Number(r.rows[0]!.real)).toBe(b.length);
  });

  it('apagar deixa lápide e LIBERA a imagem; gravar de novo desfaz', async () => {
    await gravarPrint(ana, valido(bruto(jpeg(5000), { id: 'some' })), pool);
    await apagarPrint(ana, 'some', pool);
    const r = await pool.query('select bytes, tamanho, apagado from print_local where pessoa_id = $1 and id = $2', [ana, 'some']);
    expect(r.rows[0]).toMatchObject({ bytes: null, tamanho: 0, apagado: true });

    const lapide = (await lerCopias(ana, 0, {}, pool)).itens.find((i) => i.id === 'some');
    expect(lapide).toMatchObject({ colecao: 'print', apagado: true, corpo: null });

    await gravarPrint(ana, valido(bruto(jpeg(5000), { id: 'some' })), pool);
    expect((await lerCopias(ana, 0, {}, pool)).itens.find((i) => i.id === 'some')).toMatchObject({ apagado: false });
  });

  it('apagar um print que nunca subiu também deixa lápide (outra máquina pode tê-lo)', async () => {
    await apagarPrint(ana, 'nunca-subiu', pool);
    expect((await lerCopias(ana, 0, {}, pool)).itens.find((i) => i.id === 'nunca-subiu')).toMatchObject({ apagado: true });
  });

  it('isolamento: o print de uma conta nunca aparece para a outra', async () => {
    await gravarPrint(ana, valido(bruto(jpeg(2000), { id: 'so-da-ana' })), pool);
    expect((await lerCopias(bia, 0, {}, pool)).itens.some((i) => i.id === 'so-da-ana')).toBe(false);
  });

  it('a página é cortada pelos tamanhos, e as imagens que não cabem NEM são lidas', async () => {
    const dona = await garantirPessoa({ googleSub: `${CORRIDA}-corte`, email: 'c@citi.org.br' }, pool);
    for (let i = 0; i < 4; i++) await gravarPrint(dona, valido(bruto(jpeg(800_000), { id: `g${i}` })), pool);

    consultas = [];
    const pagina = await lerCopias(dona, 0, { maxBytes: 1_000_000 }, pool);
    expect(pagina.itens).toHaveLength(1);
    expect(pagina.fim).toBe(false);

    // A consulta que traz as imagens recebeu SÓ o `seq` do item escolhido.
    const dasImagens = consultas.find((c) => c.texto.includes("encode(bytes, 'base64')"));
    expect((dasImagens!.valores![1] as string[]).length).toBe(1);

    // E varrendo tudo, as quatro chegam, uma por página, em ordem.
    const vistos: string[] = [];
    let cursor = 0;
    for (let guarda = 0; guarda < 10; guarda++) {
      const p = await lerCopias(dona, cursor, { maxBytes: 1_000_000 }, pool);
      vistos.push(...p.itens.map((i) => i.id));
      cursor = p.proximo;
      if (p.fim) break;
    }
    expect(vistos).toEqual(['g0', 'g1', 'g2', 'g3']);
  });
});
