/**
 * A dica de roteamento contra os pedidos vistos ao vivo e os da demonstração.
 * Os três primeiros casos são os que o modelo errou em 01/10/2026 (Groq).
 */
import { describe, expect, it } from 'vitest';
import { ESPECIALISTAS } from './catalogo';
import { especialistaIndicado } from './roteamento';
import { montarContextoInicial } from './contexto';
import { installChromeStorageMock } from '@/test/chromeStorageMock';

const TODOS = ESPECIALISTAS.map((a) => a.id);

describe('especialistaIndicado', () => {
  it.each([
    ['Registre os próximos passos da reunião de escopo do Painel Aurora.', 'commitments'],
    ['Na reunião de alinhamento ficou decidido que o PDF fica para a fase 2. Registre essa decisão e resolva o desalinhamento.', 'continuity'],
    ['Analise a reunião de integração de dados do Painel Aurora.', 'meeting_analyst'],
    ['Compare o que o Comercial prometeu ao cliente com o escopo registrado por Produto.', 'handoff_analysis'],
    ['O que mudou desde a última reunião?', 'continuity'],
    ['Registre a decisão: o deploy fica na sexta.', 'continuity'],
    ['Marque como concluído o protótipo.', 'commitments'],
    ['Quem ficou de escrever os critérios?', 'commitments'],
    ['Sugira um horário amanhã à tarde para revisar o escopo.', 'scheduling'],
    ['Prepare um e-mail para a Rita explicando o PDF.', 'communication'],
    ['A captura da reunião de dados está confiável?', 'capture_monitor'],
    ['Prepare-me para a reunião de quinta.', 'context'],
    ['Já discutimos exportação antes?', 'organizational_memory'],
    ['Revise a ata da sprint.', 'quality_review'],
  ])('%s → %s', (pedido, esperado) => {
    expect(especialistaIndicado(pedido, TODOS)).toBe(esperado);
  });

  it('documento nomeado fica com o fluxo de documento; pergunta comum não indica nada', () => {
    expect(especialistaIndicado('Gere a ata com os próximos passos da sprint', TODOS)).toBeNull();
    expect(especialistaIndicado('O que foi falado sobre o deploy?', TODOS)).toBeNull();
  });

  it('não indica especialista indisponível', () => {
    expect(especialistaIndicado('Registre os próximos passos', ['documents'])).toBeNull();
  });
});

describe('contexto do pedido de escrita', () => {
  it('registrar compromisso não fala de documento; pedir ata fala', async () => {
    installChromeStorageMock();
    const escopo = { reunioes: 'todas' as const, documentos: 'todos' as const, conversaId: 'c', efeitos: ['leitura', 'escrita_local'] as const };
    const base = { escopo: { ...escopo, efeitos: [...escopo.efeitos] }, selecionados: [], conversaId: 'c' };
    const { armazenamentoLocal } = await import('./armazenamento');
    const compromissos = await montarContextoInicial(
      { ...base, pedidoOriginal: 'Registre os próximos passos', disponiveis: TODOS },
      armazenamentoLocal,
    );
    expect(compromissos).not.toMatch(/create_document/);
    expect(compromissos).toMatch(/Especialista indicado para este pedido.*commitments/);
    const ata = await montarContextoInicial({ ...base, pedidoOriginal: 'Crie a ata da sprint' }, armazenamentoLocal);
    expect(ata).toMatch(/create_document e update_document estão disponíveis/);
  });
});
