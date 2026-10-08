import { expect, it } from 'vitest';
import { opcoesDeEscopo } from './escopo';
import type { ArvoreDoDocumento } from './tipos';

const base = { fontes: [], origem: 'agente' as const };
const arvore: ArvoreDoDocumento = {
  revisao: 1,
  titulo: 'T',
  lacunas: [],
  blocos: [
    { ...base, tipo: 'capa', blockId: 'capa', variante: 'padrao', titulo: 'T' },
    { ...base, tipo: 'titulo', blockId: 'a', nivel: 1, texto: 'Contexto' },
    { ...base, tipo: 'paragrafo', blockId: 'a1', texto: 'x' },
    { ...base, tipo: 'titulo', blockId: 'a2', nivel: 2, texto: 'Sub' },
    { ...base, tipo: 'titulo', blockId: 'b', nivel: 1, texto: 'Próximos passos' },
    { ...base, tipo: 'lista', blockId: 'b1', ordenada: false, itens: ['i'] },
  ],
};

it('a capa e cada seção de nível 1 viram uma opção, com os blocos que lhe pertencem', () => {
  expect(opcoesDeEscopo(arvore)).toEqual([
    { id: 'capa', rotulo: 'Capa', blockIds: ['capa'] },
    { id: 'a', rotulo: 'Seção: Contexto', blockIds: ['a', 'a1', 'a2'] },
    { id: 'b', rotulo: 'Seção: Próximos passos', blockIds: ['b', 'b1'] },
  ]);
});

it('sem capa e sem seção, não há o que escopar', () => {
  expect(opcoesDeEscopo({ ...arvore, blocos: [] })).toEqual([]);
});
