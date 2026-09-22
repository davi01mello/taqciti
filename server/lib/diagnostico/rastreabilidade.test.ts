/**
 * A estrutura do insight sugerido.
 *
 * Só forma e validação — não há geração para testar, e não é para haver nesta
 * fase.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { abrirBiblioteca } from './referencias/biblioteca';
import type { Referencia } from './referencias/tipos';
import {
  ROTULO_DO_TIPO,
  TIPOS_DE_INSIGHT,
  citacaoConfere,
  resolverFonte,
  validarInsight,
  type InsightSugerido,
} from './rastreabilidade';

const INSIGHT: InsightSugerido = {
  id: 'insight-1',
  trecho_reuniao: {
    meetingId: 'reuniao-7',
    captionId: 'cap-041',
    texto: 'A migração é o maior risco do projeto, e ninguém está olhando para ela.',
    falante: 'Bruno Lima',
    offsetMs: 1_284_000,
  },
  referencia_usada: 'exemplo-execucao-migracao',
  pergunta_sugerida: 'Quem vai dimensionar a migração dos dados antigos, e até quando?',
  tipo: 'confirmado',
  criado_em: '2026-09-21T00:00:00.000Z',
};

describe('validação', () => {
  it('aceita um insight completo', () => {
    const r = validarInsight(INSIGHT);
    expect(r.ok).toBe(true);
    expect(r.ok && r.valor).toEqual(INSIGHT);
  });

  it('aceita sem os campos opcionais do trecho', () => {
    const r = validarInsight({
      ...INSIGHT,
      trecho_reuniao: { meetingId: 'reuniao-7', texto: 'Ninguém falou de prazo.' },
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.valor.trecho_reuniao.captionId).toBeUndefined();
  });

  /*
   * O trecho é o que torna o insight verificável. Sem ele, o produto afirma
   * algo sobre uma reunião e a pessoa não tem como reencontrar onde foi dito.
   */
  it('recusa insight sem trecho', () => {
    const r = validarInsight({ ...INSIGHT, trecho_reuniao: { meetingId: 'reuniao-7', texto: '  ' } });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erros.join(' ')).toMatch(/não é rastreável/);
  });

  it('recusa insight sem fonte', () => {
    const r = validarInsight({ ...INSIGHT, referencia_usada: '' });
    expect(r.ok === false && r.erros.join(' ')).toMatch(/referencia_usada/);
  });

  it('recusa tipo fora dos dois', () => {
    const r = validarInsight({ ...INSIGHT, tipo: 'talvez' });
    expect(r.ok === false && r.erros.join(' ')).toMatch(/hipotese, confirmado/);
  });

  it('devolve todos os erros de uma vez', () => {
    const r = validarInsight({ tipo: 'nada' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erros.length).toBeGreaterThan(3);
  });

  it('recusa o que nem objeto é', () => {
    expect(validarInsight('insight').ok).toBe(false);
    expect(validarInsight([INSIGHT]).ok).toBe(false);
    expect(validarInsight(null).ok).toBe(false);
  });

  it('offsetMs negativo é recusado', () => {
    const r = validarInsight({
      ...INSIGHT,
      trecho_reuniao: { ...INSIGHT.trecho_reuniao, offsetMs: -1 },
    });
    expect(r.ok === false && r.erros.join(' ')).toMatch(/offsetMs/);
  });

  it('descarta campo que não é do schema', () => {
    const r = validarInsight({ ...INSIGHT, contrabando: 'x' });
    expect(r.ok && r.valor).not.toHaveProperty('contrabando');
  });
});

describe('os dois tipos', () => {
  it('o valor guardado não tem acento; o rótulo de tela tem', () => {
    expect(TIPOS_DE_INSIGHT).toEqual(['hipotese', 'confirmado']);
    expect(ROTULO_DO_TIPO.hipotese).toBe('Hipótese');
  });

  it('confirmado exige que o trecho contenha a citação', () => {
    expect(citacaoConfere(INSIGHT, 'maior risco do projeto')).toBe(true);
    expect(citacaoConfere(INSIGHT, 'o prazo está confortável')).toBe(false);
  });

  it('a comparação ignora espaço e caixa', () => {
    expect(citacaoConfere(INSIGHT, '  MAIOR   RISCO  do projeto ')).toBe(true);
  });

  /*
   * Hipótese não promete citação — ela promete uma pergunta. Cobrar literalidade
   * dela faria o produto só emitir o tipo mais raro.
   */
  it('hipótese não é cobrada por literalidade', () => {
    expect(citacaoConfere({ ...INSIGHT, tipo: 'hipotese' }, 'nada a ver')).toBe(true);
  });
});

describe('a fonte, resolvida contra a biblioteca', () => {
  let pasta: string;
  let caminho: string;

  const REFERENCIA: Referencia = {
    id: 'exemplo-execucao-migracao',
    titulo: 'Migração de dados legados',
    autor: 'Instituto de Teste',
    link: 'https://example.org/migracao',
    data: '2025-05-22',
    categoria: 'avaliar_execucao',
    assunto: 'migração',
    tipo: 'pesquisa',
    quando_aplicar: 'Quando o dado antigo não tem dono.',
  };

  beforeEach(async () => {
    pasta = await mkdtemp(join(tmpdir(), 'taqciti-rastro-'));
    caminho = join(pasta, 'referencias.json');
  });

  afterEach(async () => {
    await rm(pasta, { recursive: true, force: true });
  });

  it('traz a referência citada', async () => {
    const biblioteca = abrirBiblioteca(caminho);
    await biblioteca.criar(REFERENCIA);

    const fonte = await resolverFonte(INSIGHT, biblioteca);
    expect(fonte.ok && fonte.referencia.titulo).toBe('Migração de dados legados');
  });

  /*
   * O caso que não pode virar `undefined` silencioso: a interface promete um
   * botão "Ver fonte", e um insight sem procedência não pode ser desenhado como
   * se tivesse uma.
   */
  it('fonte ausente é uma falha explícita, com o id que faltou', async () => {
    const fonte = await resolverFonte(INSIGHT, abrirBiblioteca(caminho));
    expect(fonte.ok).toBe(false);
    expect(fonte.ok === false && fonte.motivo).toContain('exemplo-execucao-migracao');
  });
});
