/**
 * Onde um pedido de alteração pode mexer, em termos que a pessoa entende: a
 * capa, ou uma seção. Cada opção vira a lista de `blockId` que o servidor usa
 * como escopo — o que ficar fora dela, o servidor recusa tocar.
 */
import type { ArvoreDoDocumento } from './tipos';

export interface OpcaoDeEscopo {
  /** Estável entre revisões enquanto o bloco-âncora existir. */
  id: string;
  rotulo: string;
  /** Os blocos que o pedido pode alterar. */
  blockIds: string[];
}

/** Os trechos alteráveis do documento, na ordem em que aparecem. */
export function opcoesDeEscopo(arvore: ArvoreDoDocumento): OpcaoDeEscopo[] {
  const opcoes: OpcaoDeEscopo[] = [];
  const capa = arvore.blocos.find((b) => b.tipo === 'capa');
  if (capa) opcoes.push({ id: capa.blockId, rotulo: 'Capa', blockIds: [capa.blockId] });

  let atual: OpcaoDeEscopo | null = null;
  for (const bloco of arvore.blocos) {
    if (bloco.tipo === 'titulo' && bloco.nivel === 1) {
      atual = { id: bloco.blockId, rotulo: `Seção: ${bloco.texto}`, blockIds: [bloco.blockId] };
      opcoes.push(atual);
    } else if (bloco.tipo !== 'capa' && atual) {
      atual.blockIds.push(bloco.blockId);
    }
  }
  return opcoes;
}
