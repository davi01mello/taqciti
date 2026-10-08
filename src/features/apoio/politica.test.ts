/**
 * A política de intervenção — conta sobre estado, sem relógio nem modelo reais.
 *
 * Seguram as garantias que o plano exige: uma sugestão por vez, nada obsoleto
 * aparece, o mesmo ponto não repete, descarte da pessoa é respeitado, os limites
 * de frequência valem, "sob demanda" e "pausado" ficam em silêncio, e a
 * avaliação pelo modelo tem orçamento.
 */
import { describe, expect, it } from 'vitest';
import {
  CONFIGURACAO_DOS_MODOS,
  FALAS_APOS_DESCARTE,
  FALAS_PARA_REPETIR_UM_PONTO,
  JANELA_DE_VALIDADE_EM_FALAS,
  chaveDoPonto,
  decidir,
  planejar,
  podeAvaliar,
  type EstadoDoLaco,
} from './politica';
import type { Sugestao } from './store';

const T0 = 1_760_000_000_000;
let n = 0;

function sug(p: Partial<Sugestao> = {}): Sugestao {
  n += 1;
  return {
    id: `s${n}`,
    reuniaoId: 'm-1',
    criadoEm: T0,
    revisao: 20,
    tipo: 'pergunta',
    natureza: 'recomendacao',
    texto: 'Vale esclarecer onde o atendimento trava.',
    pergunta: 'Em que momento o atendimento costuma travar hoje?',
    motivo: 'O cliente propôs uma solução antes de descrever o problema.',
    ponto: 'Onde ocorre a espera',
    evidencias: [{ segmento: 18, trecho: 'Acho que precisamos de um aplicativo.' }],
    estado: 'pendente',
    ...p,
  };
}

function estado(p: Partial<EstadoDoLaco> = {}): EstadoDoLaco {
  return { modo: 'discreto', pausado: false, agora: T0, falasConsolidadas: 22, sugestoes: [], ...p };
}

describe('decidir', () => {
  it('silêncio é o padrão: sob demanda e pausado nunca mostram sozinhos', () => {
    const c = sug();
    expect(decidir(c, estado({ modo: 'sob_demanda', sugestoes: [c] }))).toEqual({
      acao: 'segurar',
      motivo: 'modo_sob_demanda',
    });
    expect(decidir(c, estado({ pausado: true, sugestoes: [c] }))).toEqual({ acao: 'segurar', motivo: 'pausado' });
  });

  it('uma sugestão em dia e sem impedimento aparece', () => {
    const c = sug();
    expect(decidir(c, estado({ sugestoes: [c] }))).toEqual({ acao: 'mostrar', motivo: 'ok' });
  });

  it('sugestão velha é descartada antes de aparecer, nunca mostrada atrasada', () => {
    const c = sug({ revisao: 20 });
    const dentro = estado({ falasConsolidadas: 20 + JANELA_DE_VALIDADE_EM_FALAS, sugestoes: [c] });
    const fora = estado({ falasConsolidadas: 20 + JANELA_DE_VALIDADE_EM_FALAS + 1, sugestoes: [c] });
    expect(decidir(c, dentro).acao).toBe('mostrar');
    expect(decidir(c, fora)).toEqual({ acao: 'descartar', motivo: 'obsoleta' });
  });

  it('o mesmo ponto não repete enquanto a anterior está na tela', () => {
    const naTela = sug({ estado: 'mostrada', mostradaEm: T0 - 400_000, revisao: 15 });
    const nova = sug({ ponto: 'onde ocorre a espera!' });
    expect(decidir(nova, estado({ sugestoes: [naTela, nova] }))).toEqual({ acao: 'descartar', motivo: 'repetida' });
  });

  it('o mesmo ponto não repete logo depois de usado ou resolvido, mas pode depois de muita conversa', () => {
    const usada = sug({ estado: 'usada', revisao: 10 });
    const cedo = sug({ revisao: 10 + FALAS_PARA_REPETIR_UM_PONTO - 1 });
    const tarde = sug({ revisao: 10 + FALAS_PARA_REPETIR_UM_PONTO });
    const e = (c: Sugestao) => estado({ falasConsolidadas: c.revisao + 1, sugestoes: [usada, c] });
    expect(decidir(cedo, e(cedo)).acao).toBe('descartar');
    expect(decidir(tarde, e(tarde)).acao).toBe('mostrar');
  });

  it('o que a pessoa descartou só volta com conversa nova suficiente', () => {
    const descartada = sug({ estado: 'descartada', revisao: 10 });
    const logo = sug({ revisao: 10 + FALAS_APOS_DESCARTE - 1 });
    const depois = sug({ revisao: 10 + FALAS_APOS_DESCARTE });
    expect(decidir(logo, estado({ falasConsolidadas: logo.revisao + 1, sugestoes: [descartada, logo] }))).toEqual({
      acao: 'descartar',
      motivo: 'recem_descartado',
    });
    expect(decidir(depois, estado({ falasConsolidadas: depois.revisao + 1, sugestoes: [descartada, depois] })).acao).toBe(
      'mostrar',
    );
  });

  it('ponto diferente não é afetado pelo descarte de outro', () => {
    const descartada = sug({ estado: 'descartada', revisao: 20, ponto: 'Impacto no atendimento' });
    const c = sug({ ponto: 'Quem levanta os dados' });
    expect(decidir(c, estado({ sugestoes: [descartada, c] })).acao).toBe('mostrar');
  });

  it('só uma na tela por vez: a segunda espera', () => {
    const naTela = sug({ estado: 'mostrada', mostradaEm: T0 - 10, ponto: 'Outro assunto' });
    const c = sug();
    expect(decidir(c, estado({ sugestoes: [naTela, c] }))).toEqual({ acao: 'segurar', motivo: 'ja_ha_uma_na_tela' });
  });

  it('respeita o intervalo mínimo entre sugestões, por modo', () => {
    const cfgD = CONFIGURACAO_DOS_MODOS.discreto!;
    const cfgP = CONFIGURACAO_DOS_MODOS.participativo!;
    const anterior = sug({ estado: 'usada', mostradaEm: T0, ponto: 'Outro', revisao: 5 });
    const c = sug();
    const em = (ms: number, modo: 'discreto' | 'participativo') =>
      decidir(c, estado({ modo, agora: T0 + ms, sugestoes: [anterior, c] }));
    expect(em(cfgD.intervaloEntreSugestoesMs - 1, 'discreto')).toEqual({ acao: 'segurar', motivo: 'intervalo' });
    expect(em(cfgD.intervaloEntreSugestoesMs, 'discreto').acao).toBe('mostrar');
    // O participativo é mais frequente que o discreto.
    expect(cfgP.intervaloEntreSugestoesMs).toBeLessThan(cfgD.intervaloEntreSugestoesMs);
    expect(em(cfgP.intervaloEntreSugestoesMs, 'participativo').acao).toBe('mostrar');
  });

  it('respeita o limite por hora', () => {
    const cfg = CONFIGURACAO_DOS_MODOS.discreto!;
    const agora = T0 + 3_000_000;
    const mostradas = Array.from({ length: cfg.limitePorHora }, (_, i) =>
      sug({ estado: 'usada', mostradaEm: agora - 200_000 - i * 300_000, ponto: `ponto ${i}`, revisao: 1 }),
    );
    const c = sug({ revisao: 21 });
    expect(decidir(c, estado({ agora, sugestoes: [...mostradas, c] }))).toEqual({
      acao: 'segurar',
      motivo: 'limite_por_hora',
    });
    // Uma hora depois da mais antiga, o orçamento volta.
    const maisTarde = agora + 3_600_000;
    expect(decidir(c, estado({ agora: maisTarde, sugestoes: [...mostradas, c] })).acao).toBe('mostrar');
  });

  it('quem já saiu de pendente não é decidido de novo', () => {
    const c = sug({ estado: 'usada' });
    expect(decidir(c, estado({ sugestoes: [c] }))).toEqual({ acao: 'segurar', motivo: 'nao_pendente' });
  });
});

describe('planejar', () => {
  it('sem candidato que passe, nada aparece', () => {
    expect(planejar(estado())).toEqual({ mostrar: null, descartar: [], substituir: [] });
  });

  it('das que passam, aparece uma: a do objetivo vence a mais nova', () => {
    const doObjetivo = sug({ ponto: 'Quem levanta os dados', doObjetivo: true, revisao: 18 });
    const maisNova = sug({ ponto: 'Impacto', revisao: 21 });
    const p = planejar(estado({ sugestoes: [maisNova, doObjetivo] }));
    expect(p.mostrar?.id).toBe(doObjetivo.id);
    expect(p.substituir.map((s) => s.id)).toEqual([maisNova.id]);
  });

  it('sem objetivo no jogo, a mais nova vence; depois a mais bem sustentada', () => {
    const velha = sug({ ponto: 'A', revisao: 18 });
    const nova = sug({ ponto: 'B', revisao: 21 });
    expect(planejar(estado({ sugestoes: [velha, nova] })).mostrar?.id).toBe(nova.id);
    const pouca = sug({ ponto: 'C', revisao: 21 });
    const muita = sug({
      ponto: 'D',
      revisao: 21,
      evidencias: [
        { segmento: 19, trecho: 'a' },
        { segmento: 20, trecho: 'b' },
      ],
    });
    expect(planejar(estado({ sugestoes: [pouca, muita] })).mostrar?.id).toBe(muita.id);
  });

  it('as obsoletas e repetidas saem com o motivo, e não disputam a tela', () => {
    const velha = sug({ ponto: 'Velha', revisao: 1 });
    const viva = sug({ ponto: 'Viva', revisao: 21 });
    const p = planejar(estado({ falasConsolidadas: 22, sugestoes: [velha, viva] }));
    expect(p.mostrar?.id).toBe(viva.id);
    expect(p.descartar).toEqual([{ sugestao: velha, motivo: 'obsoleta' }]);
  });

  it('com uma na tela, as pendentes esperam (nem aparecem nem morrem)', () => {
    const naTela = sug({ estado: 'mostrada', mostradaEm: T0 - 5, ponto: 'X' });
    const pendente = sug({ ponto: 'Y' });
    const p = planejar(estado({ sugestoes: [naTela, pendente] }));
    expect(p).toEqual({ mostrar: null, descartar: [], substituir: [] });
  });
});

describe('podeAvaliar (orçamento de custo)', () => {
  const base = { modo: 'discreto' as const, pausado: false, agora: T0, falasConsolidadas: 10 };
  const cfg = CONFIGURACAO_DOS_MODOS.discreto!;

  it('sob demanda, pausado ou sem fala consolidada: nunca chama o modelo', () => {
    expect(podeAvaliar({ ...base, modo: 'sob_demanda', ultimaAvaliacao: null })).toBe(false);
    expect(podeAvaliar({ ...base, pausado: true, ultimaAvaliacao: null })).toBe(false);
    expect(podeAvaliar({ ...base, falasConsolidadas: 0, ultimaAvaliacao: null })).toBe(false);
  });

  it('a primeira avaliação é livre; as seguintes exigem tempo E fala nova', () => {
    expect(podeAvaliar({ ...base, ultimaAvaliacao: null })).toBe(true);
    const ultima = { em: T0 - cfg.intervaloEntreAvaliacoesMs, falas: 10 - cfg.falasNovasParaAvaliar };
    expect(podeAvaliar({ ...base, ultimaAvaliacao: ultima })).toBe(true);
    // Passou o tempo, mas sem fala nova.
    expect(podeAvaliar({ ...base, ultimaAvaliacao: { em: T0 - 10 * cfg.intervaloEntreAvaliacoesMs, falas: 10 } })).toBe(false);
    // Fala nova, mas cedo demais.
    expect(podeAvaliar({ ...base, ultimaAvaliacao: { em: T0 - 1000, falas: 0 } })).toBe(false);
  });
});

describe('chaveDoPonto', () => {
  it('compara sem acento, caixa nem pontuação', () => {
    expect(chaveDoPonto('  Onde ocorre a ESPERA?! ')).toBe(chaveDoPonto('onde ocorre a espera'));
    expect(chaveDoPonto('Atenção: prazo')).toBe('atencao prazo');
  });
});
