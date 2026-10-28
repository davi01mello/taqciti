/**
 * O perfil do assistente e o briefing — dados sintéticos.
 *
 * Seguram: nada é salvo sem a pessoa, edição confere a revisão lida, igual não
 * cria revisão, o Padrão do CITi vem do pacote e não se edita, o formato
 * anterior vira contextos, a reunião fica com o perfil com que começou, o
 * objetivo só é "aprovado" quando a pessoa o informa, e entrada fora do
 * formato não vira perfil.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { perfilQueValeParaAReuniao } from './contexto';
import { PADRAO_DO_CITI } from './padrao';
import {
  conteudoDe,
  conteudoDoPadrao,
  briefingDaReuniao,
  fixarPerfilDaReuniao,
  lerConducao,
  normalizarConteudoDoPerfil,
  perfilAtual,
  perfilEmUsoDaReuniao,
  resolverPerfil,
  salvarBriefing,
  salvarPerfil,
  semBriefingDaReuniao,
} from './store';

const PERFIL = {
  missao: 'Apoiar o entendimento de necessidades e critérios de sucesso.',
  observar: ['Processo atual', 'Impacto', 'Restrições'],
  intervencao: { modo: 'discreto', estilo: 'Uma sugestão curta por vez' },
  contexto: ['Histórico do cliente'],
  preferencias: ['Explicar o motivo só quando eu pedir'],
};

beforeEach(() => {
  installChromeStorageMock();
});

/** Um perfil personalizado no formato atual. */
const PESSOAL = {
  base: 'personalizado',
  padraoVersao: 1,
  contextos: [
    { id: 'escopo', nome: 'Escopo do Portal', texto: 'Primeira entrega: cadastro e painel.', ligado: true, origem: 'seu', vaga: 0 },
    { id: 'historico', nome: 'Histórico do cliente', texto: 'Pede mudança perto da entrega.', ligado: false, origem: 'seu', vaga: 4 },
  ],
  buscaNaInternet: true,
  intervencao: { modo: 'discreto' },
};

describe('perfil', () => {
  it('começa vazio: nada é inventado, e o que vale é o Padrão do CITi', async () => {
    const c = await lerConducao();
    expect(c.perfil).toBeNull();
    expect(c.briefings).toEqual([]);
    expect(perfilAtual(c)).toEqual(conteudoDoPadrao());
    // O padrão não liga o apoio sozinho para ninguém.
    expect(perfilAtual(c).intervencao.modo).toBe('sob_demanda');
  });

  it('o primeiro perfil exige revisão 0 e fica na revisão 1, com histórico', async () => {
    const r = await salvarPerfil(PESSOAL, 0);
    expect(r.tipo).toBe('ok');
    const { perfil } = await lerConducao();
    expect(perfil).toMatchObject({ revisao: 1, base: 'personalizado', buscaNaInternet: true });
    expect(perfil!.contextos.map((x) => [x.nome, x.ligado])).toEqual([
      ['Escopo do Portal', true],
      ['Histórico do cliente', false],
    ]);
    expect(perfil!.historico.map((h) => h.acao)).toEqual(['perfil criado']);
  });

  it('edição com revisão velha dá conflito e não grava', async () => {
    await salvarPerfil(PESSOAL, 0);
    await salvarPerfil({ ...PESSOAL, buscaNaInternet: false }, 1);
    const r = await salvarPerfil({ ...PESSOAL, contextos: [] }, 1);
    expect(r.tipo).toBe('conflito');
    const { perfil } = await lerConducao();
    expect(perfil!.contextos).toHaveLength(2);
    expect(perfil!.buscaNaInternet).toBe(false);
  });

  it('salvar o mesmo conteúdo não cria revisão', async () => {
    await salvarPerfil(PESSOAL, 0);
    const r = await salvarPerfil(PESSOAL, 1);
    expect(r).toMatchObject({ tipo: 'ok', item: { revisao: 1 } });
  });

  it('fora do formato, ou com contexto sem texto, não vira perfil', async () => {
    expect((await salvarPerfil('texto solto', 0)).tipo).toBe('invalido');
    expect((await salvarPerfil({ base: 'outro' }, 0)).tipo).toBe('invalido');
    const semTexto = await salvarPerfil({ ...PESSOAL, contextos: [{ nome: 'Novo contexto', texto: '  ' }] }, 0);
    expect(semTexto).toMatchObject({ tipo: 'invalido' });
    expect((semTexto as { motivo: string }).motivo).toContain('Novo contexto');
    expect((await lerConducao()).perfil).toBeNull();
  });

  it('limpa e limita: nome até 40, texto até 200, no máximo 8, vagas e ids únicos, modo desconhecido vira o do padrão', () => {
    const c = normalizarConteudoDoPerfil({
      ...PESSOAL,
      intervencao: { modo: 'agressivo' },
      contextos: Array.from({ length: 12 }, () => ({ id: 'x', nome: 'N'.repeat(60), texto: 'T'.repeat(300), vaga: 3 })),
    })!;
    expect(c.contextos).toHaveLength(8);
    expect(c.contextos.every((x) => x.nome.length === 40 && x.texto.length === 200)).toBe(true);
    expect(new Set(c.contextos.map((x) => x.vaga)).size).toBe(8);
    expect(new Set(c.contextos.map((x) => x.id)).size).toBe(8);
    expect(c.intervencao.modo).toBe('sob_demanda');
  });

  /*
   * O Padrão do CITi é igual para todos e vem do pacote: o perfil guardado com
   * base no padrão não carrega texto (nem uma versão velha dele); quem lê
   * recebe os contextos de AGORA. Só "ler ao encerrar", consentimento da
   * pessoa, é dela.
   */
  it('com base no padrão, o guardado não carrega contextos e o resolvido traz os do pacote', async () => {
    await salvarPerfil({ base: 'padrao', contextos: [{ nome: 'Intruso', texto: 'x' }], buscaNaInternet: true, lerAoEncerrar: true }, 0);
    const { perfil } = await lerConducao();
    expect(perfil).toMatchObject({ base: 'padrao', contextos: [], buscaNaInternet: false, lerAoEncerrar: true });
    const resolvido = resolverPerfil(conteudoDe(perfil!));
    expect(resolvido.contextos.map((x) => x.nome)).toEqual(PADRAO_DO_CITI.contextos.map((x) => x.nome));
    expect(resolvido.contextos.every((x) => x.ligado && x.origem === 'padrao')).toBe(true);
    expect(resolvido.lerAoEncerrar).toBe(true);
  });

  it('o formato anterior (missão, observar...) é aceito e vira contextos da pessoa', async () => {
    await salvarPerfil(
      { missao: 'Apoiar a descoberta.', observar: ['Impacto'], intervencao: { modo: 'participativo', estilo: '' }, contexto: [], preferencias: [] },
      0,
    );
    const { perfil } = await lerConducao();
    expect(perfil).toMatchObject({ base: 'personalizado', intervencao: { modo: 'participativo' } });
    expect(perfil!.contextos.map((x) => x.nome)).toEqual(['Em que ajudar', 'O que observar']);
  });

  it('"ler ao encerrar" só vale quando a pessoa marcou, e sobrevive ao salvar e ler', async () => {
    expect(normalizarConteudoDoPerfil(PESSOAL)!.lerAoEncerrar).toBeUndefined();
    expect(normalizarConteudoDoPerfil({ ...PESSOAL, lerAoEncerrar: 'sim' })!.lerAoEncerrar).toBeUndefined();
    await salvarPerfil({ ...PESSOAL, lerAoEncerrar: true }, 0);
    const { perfil } = await lerConducao();
    expect(conteudoDe(perfil!).lerAoEncerrar).toBe(true);
    expect(perfilQueValeParaAReuniao(await lerConducao(), null).lerAoEncerrar).toBe(true);
  });
});

/*
 * A reunião começa com a versão do assistente em uso e fica com ela até o fim.
 * Antes, sem briefing, cada leitura pegava o perfil de hoje — e mudar o
 * Preparar no meio da reunião mudava o assistente dela.
 */
describe('o perfil em uso na reunião', () => {
  it('fica com a cópia de quando começou; a mudança vale a partir da próxima', async () => {
    await salvarPerfil(PESSOAL, 0);
    await fixarPerfilDaReuniao('ao-vivo');
    await salvarPerfil({ ...PESSOAL, intervencao: { modo: 'participativo' } }, 1);

    const c = await lerConducao();
    expect(perfilQueValeParaAReuniao(c, 'ao-vivo').intervencao.modo).toBe('discreto');
    expect(perfilEmUsoDaReuniao(c, 'ao-vivo')!.perfilRevisao).toBe(1);
    expect(perfilQueValeParaAReuniao(c, 'a-proxima').intervencao.modo).toBe('participativo');
  });

  it('fixar de novo (a mesma reunião retomada) não troca a cópia', async () => {
    await salvarPerfil(PESSOAL, 0);
    await fixarPerfilDaReuniao('ao-vivo');
    await salvarPerfil({ ...PESSOAL, buscaNaInternet: false }, 1);
    await fixarPerfilDaReuniao('ao-vivo');
    expect(perfilEmUsoDaReuniao(await lerConducao(), 'ao-vivo')!.perfilRevisao).toBe(1);
  });

  it('sem nada salvo, a cópia é o padrão daquela hora, com os contextos, e sobrevive à leitura', async () => {
    await fixarPerfilDaReuniao('ao-vivo');
    const usado = perfilEmUsoDaReuniao(await lerConducao(), 'ao-vivo')!;
    expect(usado.perfilRevisao).toBeNull();
    expect(usado.perfilUsado.base).toBe('padrao');
    expect(usado.perfilUsado.contextos).toHaveLength(PADRAO_DO_CITI.contextos.length);
  });
});

describe('briefing', () => {
  it('o objetivo só é aprovado quando a pessoa o informa', async () => {
    const vazio = await salvarBriefing('m-1', { contexto: 'Cliente novo.' }, 0);
    expect(vazio).toMatchObject({ tipo: 'ok', item: { aprovado: false, objetivo: '' } });
    const com = await salvarBriefing('m-1', { objetivo: 'Decidir se o piloto começa com uma ou duas unidades.' }, 1);
    expect(com).toMatchObject({ tipo: 'ok', item: { aprovado: true, revisao: 2 } });
    const apagado = await salvarBriefing('m-1', { objetivo: '' }, 2);
    expect(apagado).toMatchObject({ tipo: 'ok', item: { aprovado: false } });
  });

  it('conflito de revisão não sobrescreve', async () => {
    await salvarBriefing('m-1', { objetivo: 'A' }, 0);
    const r = await salvarBriefing('m-1', { objetivo: 'B' }, 0);
    expect(r.tipo).toBe('conflito');
    expect(briefingDaReuniao(await lerConducao(), 'm-1')!.objetivo).toBe('A');
  });

  it('um briefing por reunião, sem misturar', async () => {
    await salvarBriefing('m-1', { objetivo: 'A', prioridades: ['Quem levanta os dados?'] }, 0);
    await salvarBriefing('m-2', { objetivo: 'B' }, 0);
    const c = await lerConducao();
    expect(briefingDaReuniao(c, 'm-1')!.prioridades).toEqual(['Quem levanta os dados?']);
    expect(briefingDaReuniao(c, 'm-2')!.prioridades).toEqual([]);
  });

  it('o briefing guarda o perfil de quando foi preparado, e editar o briefing não o troca', async () => {
    await salvarPerfil(PERFIL, 0);
    await salvarBriefing('m-1', { objetivo: 'A' }, 0);
    await salvarPerfil({ ...PERFIL, missao: 'Nova missão.' }, 1);
    await salvarBriefing('m-1', { contexto: 'Mais um detalhe.' }, 1);
    const b = briefingDaReuniao(await lerConducao(), 'm-1')!;
    expect(b.perfilRevisao).toBe(1);
    expect(b.perfilUsado!.contextos[0]!.texto).toBe(PERFIL.missao);
  });

  it('o modo só desta reunião é escolha explícita: não altera o perfil nem as outras reuniões', async () => {
    await salvarPerfil(PERFIL, 0);
    await salvarBriefing('m-1', { objetivo: 'A' }, 0);
    const r = await salvarBriefing('m-1', { modo: 'participativo' }, 1);
    expect(r).toMatchObject({ tipo: 'ok', item: { modo: 'participativo', revisao: 2 } });
    const c = await lerConducao();
    expect(c.perfil!.intervencao.modo).toBe('discreto'); // o perfil continua igual
    expect(briefingDaReuniao(c, 'm-1')!.modo).toBe('participativo');
    await salvarBriefing('m-2', { objetivo: 'B' }, 0);
    expect(briefingDaReuniao(await lerConducao(), 'm-2')!.modo).toBeUndefined();
    // Repetir não cria revisão; `null` volta ao do perfil.
    expect(await salvarBriefing('m-1', { modo: 'participativo' }, 2)).toMatchObject({ item: { revisao: 2 } });
    const volta = await salvarBriefing('m-1', { modo: null }, 2);
    expect(volta).toMatchObject({ tipo: 'ok', item: { revisao: 3 } });
    expect(briefingDaReuniao(await lerConducao(), 'm-1')!.modo).toBeUndefined();
  });

  it('modo desconhecido não é guardado', async () => {
    await salvarBriefing('m-1', { objetivo: 'A', modo: 'agressivo' as never }, 0);
    expect(briefingDaReuniao(await lerConducao(), 'm-1')!.modo).toBeUndefined();
  });

  it('reunião preparada sem perfil salvo guarda o Padrão do CITi, sem revisão', async () => {
    await salvarBriefing('m-1', { objetivo: 'A' }, 0);
    const b = briefingDaReuniao(await lerConducao(), 'm-1')!;
    expect(b.perfilRevisao).toBeNull();
    expect(b.perfilUsado).toEqual(conteudoDoPadrao());
  });

  it('semBriefingDaReuniao tira só o daquela reunião', async () => {
    await salvarBriefing('m-1', { objetivo: 'A' }, 0);
    await salvarBriefing('m-2', { objetivo: 'B' }, 0);
    const { conducao, removidos } = semBriefingDaReuniao(await lerConducao(), 'm-1');
    expect(removidos).toBe(1);
    expect(conducao.briefings.map((b) => b.reuniaoId)).toEqual(['m-2']);
  });
});
