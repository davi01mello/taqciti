/**
 * As decisões de gasto. Dados fictícios, nenhuma chamada — é o ponto de elas
 * serem puras.
 */
import { describe, expect, it } from 'vitest';
import {
  MAXIMO_DE_TERMOS,
  MINIMO_DE_FALAS,
  deveBuscarWeb,
  deveConsultarBiblioteca,
  formatarQueryWeb,
  type ContextoDeDiagnostico,
} from './decisoes';

const TEXTO_LONGO =
  'A migração dos dados antigos é o maior risco do projeto e ninguém está olhando para ela hoje.';

const CONTEXTO: ContextoDeDiagnostico = {
  texto: TEXTO_LONGO,
  assunto: 'migração de dados',
  quantidadeDeFalas: 48,
};

describe('consultar a biblioteca', () => {
  it('sim quando há conteúdo', () => {
    const d = deveConsultarBiblioteca(CONTEXTO);
    expect(d.sim).toBe(true);
    expect(d.motivo).toMatch(/não tem custo/);
  });

  it('não quando a reunião mal aconteceu', () => {
    const d = deveConsultarBiblioteca({ ...CONTEXTO, quantidadeDeFalas: MINIMO_DE_FALAS - 1 });
    expect(d.sim).toBe(false);
    expect(d.motivo).toContain(String(MINIMO_DE_FALAS));
  });

  it('não quando o trecho é curto demais para ter assunto', () => {
    const d = deveConsultarBiblioteca({ texto: 'bom dia' });
    expect(d.sim).toBe(false);
    expect(d.motivo).toMatch(/curto demais/);
  });

  it('sem contagem de falas, decide só pelo texto', () => {
    expect(deveConsultarBiblioteca({ texto: TEXTO_LONGO }).sim).toBe(true);
  });
});

describe('buscar na web', () => {
  const SEM_RESPOSTA = { quantidade: 0, melhorPontuacao: 0 };
  const RESPONDEU = { quantidade: 3, melhorPontuacao: 2 };

  it('sim quando a biblioteca não tem nada', () => {
    const d = deveBuscarWeb(CONTEXTO, SEM_RESPOSTA);
    expect(d.sim).toBe(true);
    expect(d.motivo).toMatch(/não tem nada/);
  });

  it('não quando a biblioteca já respondeu bem', () => {
    const d = deveBuscarWeb(CONTEXTO, RESPONDEU);
    expect(d.sim).toBe(false);
    expect(d.motivo).toMatch(/já respondeu/);
  });

  it('sim quando a biblioteca trouxe pouco', () => {
    const d = deveBuscarWeb(CONTEXTO, { quantidade: 1, melhorPontuacao: 1 });
    expect(d.sim).toBe(true);
    expect(d.motivo).toMatch(/trouxe pouco/);
  });

  /*
   * As três barreiras gratuitas vêm antes da avaliação da biblioteca, e nesta
   * ordem: cache, teto, consulta vazia. Cada uma é uma razão suficiente.
   */
  it('não quando já há cache — mesmo sem a biblioteca ter respondido', () => {
    const d = deveBuscarWeb({ ...CONTEXTO, temCache: true }, SEM_RESPOSTA);
    expect(d.sim).toBe(false);
    expect(d.motivo).toMatch(/cache/);
  });

  it('não quando o teto do diagnóstico acabou', () => {
    const d = deveBuscarWeb({ ...CONTEXTO, buscasRestantes: 0 }, SEM_RESPOSTA);
    expect(d.sim).toBe(false);
    expect(d.motivo).toMatch(/limite de buscas/);
  });

  it('não quando a anonimização não deixou consulta nenhuma', () => {
    const d = deveBuscarWeb(
      {
        texto: 'Ana Duarte, ana@cliente.com, (81) 99999-8888',
        nomesConfidenciais: ['Ana Duarte'],
        buscasRestantes: 3,
      },
      SEM_RESPOSTA,
    );
    expect(d.sim).toBe(false);
    expect(d.motivo).toMatch(/confidencial/);
  });

  it('o cache vence o teto: nenhum dos dois gasta, e o motivo é o mais barato', () => {
    const d = deveBuscarWeb({ ...CONTEXTO, temCache: true, buscasRestantes: 0 }, SEM_RESPOSTA);
    expect(d.motivo).toMatch(/cache/);
  });
});

describe('a consulta que sai da máquina', () => {
  it('tira o nome dos participantes, inclusive o primeiro nome sozinho', () => {
    const { query, removidos } = formatarQueryWeb({
      texto: 'Ana Duarte disse que a Ana vai fechar o desenho até sexta.',
      nomesConfidenciais: ['Ana Duarte'],
    });

    expect(query).not.toMatch(/ana/i);
    expect(query).not.toMatch(/duarte/i);
    expect(removidos).toContain('nome');
    // O assunto sobrevive: tirar o nome não pode esvaziar a pergunta.
    expect(query).toContain('desenho');
  });

  it('tira e-mail, telefone, documento, link e código de sala', () => {
    const { query, removidos } = formatarQueryWeb({
      texto:
        'Contato ana@cliente.com.br, telefone (81) 99999-8888, CNPJ 12.345.678/0001-90, ' +
        'link https://cliente.example.com/contrato, sala abc-defg-hij, sobre prazo.',
    });

    expect(query).not.toContain('@');
    expect(query).not.toMatch(/99999/);
    expect(query).not.toMatch(/12\.345/);
    expect(query).not.toContain('https');
    expect(query).not.toMatch(/abc-defg-hij/);
    expect(removidos).toEqual(
      expect.arrayContaining(['e-mail', 'url', 'telefone', 'documento', 'código de sala']),
    );
    expect(query).toContain('prazo');
  });

  it('o assunto vem na frente do texto', () => {
    const { query } = formatarQueryWeb({ texto: TEXTO_LONGO, assunto: 'risco de migração' });
    expect(query.startsWith('risco migracao') || query.startsWith('risco')).toBe(true);
  });

  it('descarta palavra vazia e repetição', () => {
    const { query } = formatarQueryWeb({ texto: 'o prazo e o prazo do projeto e o risco' });
    expect(query.split(' ')).toEqual(['prazo', 'projeto', 'risco']);
  });

  it('não passa do teto de termos', () => {
    const { query } = formatarQueryWeb({
      texto: Array.from({ length: 40 }, (_, i) => `termo${i}`).join(' '),
    });
    expect(query.split(' ')).toHaveLength(MAXIMO_DE_TERMOS);
  });

  it('texto só de dado confidencial vira consulta vazia, e não um resto', () => {
    const { query } = formatarQueryWeb({
      texto: 'Bruno Lima — bruno@cliente.com — (81) 98888-7777',
      nomesConfidenciais: ['Bruno Lima'],
    });
    expect(query).toBe('');
  });

  it('nome com acento e caixa diferente também sai', () => {
    const { query } = formatarQueryWeb({
      texto: 'A CARLA e a Carla Nunes falaram do prazo.',
      nomesConfidenciais: ['Carla Nunes'],
    });
    expect(query).not.toMatch(/carla/i);
    expect(query).toContain('prazo');
  });

  /*
   * Uma palavra de duas letras num nome ("Di", uma partícula como "de") não
   * vira filtro: barraria substrings demais do texto útil.
   */
  it('partícula curta do nome não apaga o texto inteiro', () => {
    const { query } = formatarQueryWeb({
      texto: 'Maria de Souza falou sobre o desenho de telas e o prazo de entrega.',
      nomesConfidenciais: ['Maria de Souza'],
    });
    expect(query).toContain('desenho');
    expect(query).toContain('prazo');
    expect(query).not.toMatch(/maria|souza/i);
  });
});
