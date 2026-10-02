/**
 * Um `Acervo` em arrays. É contra ele que a disciplina de contexto é
 * verificada.
 *
 * Não é só andaime de teste: enquanto o banco não existe, é ele que faz o
 * endpoint MCP subir e responder de verdade — dá para plugar a Claude num
 * acervo de exemplo e ver o conector funcionando ponta a ponta antes de
 * existir uma linha de SQL. Ver `README.md`.
 *
 * `procurar` devolve TUDO, de propósito: o contrato é "peneira grossa", e
 * para um array em memória a peneira certa é nenhuma — quem ranqueia é
 * `busca.ts`. É isso que faz os testes exercitarem exatamente o mesmo
 * caminho de ranqueamento que roda em produção.
 */
import type { Acervo, IndicePorTipo, ItemPorTipo, TipoDeItem } from './tipos';

export interface ConteudoDoAcervo {
  reuniao?: ItemPorTipo['reuniao'][];
  documento?: ItemPorTipo['documento'][];
  conversa?: ItemPorTipo['conversa'][];
  nota?: ItemPorTipo['nota'][];
}

function indiceDaReuniao(r: ItemPorTipo['reuniao']): IndicePorTipo['reuniao'] {
  return {
    id: r.id,
    titulo: r.titulo,
    inicioMs: r.inicioMs,
    duracaoSegundos: r.duracaoSegundos,
    participantes: r.participantes.length,
    falas: r.falas.length,
  };
}

function indiceDoDocumento(d: ItemPorTipo['documento']): IndicePorTipo['documento'] {
  return {
    id: d.id,
    titulo: d.titulo,
    criadoMs: d.criadoMs,
    ...(d.tipoGerado ? { tipoGerado: d.tipoGerado } : {}),
    caracteres: d.texto.length,
  };
}

function indiceDaConversa(c: ItemPorTipo['conversa']): IndicePorTipo['conversa'] {
  return {
    id: c.id,
    titulo: c.titulo,
    criadaMs: c.criadaMs,
    mensagens: c.mensagens.length,
  };
}

function indiceDaNota(n: ItemPorTipo['nota']): IndicePorTipo['nota'] {
  return {
    id: n.id,
    reuniaoTitulo: n.reuniaoTitulo,
    atualizadaMs: n.atualizadaMs,
    caracteres: n.texto.length,
    marcacoes: Object.values(n.marcacoes).reduce((a, b) => a + b, 0),
    prints: n.prints,
  };
}

export function acervoDeMemoria(conteudo: ConteudoDoAcervo = {}): Acervo {
  const colecoes = {
    reuniao: conteudo.reuniao ?? [],
    documento: conteudo.documento ?? [],
    conversa: conteudo.conversa ?? [],
    nota: conteudo.nota ?? [],
  };

  const paraIndice = {
    reuniao: indiceDaReuniao,
    documento: indiceDoDocumento,
    conversa: indiceDaConversa,
    nota: indiceDaNota,
  };

  return {
    // A dupla conversão é necessária: `colecoes[tipo]` é a UNIÃO dos quatro
    // arrays, e TypeScript não relaciona uma união com o mapeado
    // `ItemPorTipo[T]` sem passar por `unknown`. A chave garante a
    // correspondência.
    async indice<T extends TipoDeItem>(tipo: T) {
      const feitor = paraIndice[tipo] as (i: unknown) => IndicePorTipo[T];
      return (colecoes[tipo] as readonly unknown[]).map(feitor);
    },

    async obter<T extends TipoDeItem>(tipo: T, id: string) {
      const achado = (colecoes[tipo] as readonly { id: string }[]).find((i) => i.id === id);
      return (achado ?? null) as ItemPorTipo[T] | null;
    },

    async procurar<T extends TipoDeItem>(tipo: T) {
      return colecoes[tipo] as unknown as readonly ItemPorTipo[T][];
    },
  };
}
