/**
 * ToolRegistry — as ferramentas executáveis, com schema, efeito e política.
 *
 * Três trabalhos, nesta ordem:
 *
 *   1. RECORTAR o que uma tarefa pode usar: as ferramentas que o agente declara,
 *      menos as de efeito que o escopo não autoriza. É esse recorte — e só ele —
 *      que vira declaração para o modelo. O que ele não recebe, ele não pede.
 *   2. DECLARAR: a descrição e o JSON Schema saem do mesmo schema zod que valida
 *      o argumento (`z.toJSONSchema`).
 *   3. EXECUTAR uma chamada do modelo: confere se a ferramenta foi oferecida, se
 *      o efeito é permitido, valida os argumentos, roda, e devolve SEMPRE um
 *      objeto — sucesso ou erro estruturado — que volta ao modelo como dado.
 *      Uma exceção aqui nunca derruba a execução: vira `{ erro }` que o modelo
 *      lê e corrige.
 */
import { z } from 'zod/v4';
import type { Escopo } from './contratos';
import type { DeclaracaoDeFerramenta } from './modelo';
import { exigirEfeito } from './politica';
import {
  ErroDeFerramenta,
  type ContextoDeFerramenta,
  type DefinicaoDeFerramenta,
} from './tipos';

const NOME = /^[a-z][a-z0-9_]{1,63}$/;

export class RegistroDeFerramentas {
  private readonly mapa = new Map<string, DefinicaoDeFerramenta>();

  registrar<A>(definicao: DefinicaoDeFerramenta<A>): this {
    if (!NOME.test(definicao.nome))
      throw new Error(`Nome de ferramenta inválido: ${definicao.nome}`);
    if (this.mapa.has(definicao.nome))
      throw new Error(`Ferramenta duplicada: ${definicao.nome}`);
    declarar(definicao as DefinicaoDeFerramenta); // falha no cadastro, e não na primeira chamada
    this.mapa.set(definicao.nome, definicao as DefinicaoDeFerramenta);
    return this;
  }

  obter(nome: string): DefinicaoDeFerramenta | undefined {
    return this.mapa.get(nome);
  }

  nomes(): string[] {
    return [...this.mapa.keys()];
  }

  /**
   * O recorte de uma tarefa. `semDelegacao` tira `delegate_task` quando não há
   * especialista disponível ou a profundidade não permite — o modelo não deve
   * ver uma opção que só devolveria erro.
   */
  recortar(
    permitidas: readonly string[],
    escopo: Escopo,
    opcoes: { semDelegacao: boolean },
  ): DefinicaoDeFerramenta[] {
    return permitidas
      .map((nome) => this.mapa.get(nome))
      .filter((f): f is DefinicaoDeFerramenta => !!f)
      .filter((f) => escopo.efeitos.includes(f.efeito))
      .filter((f) => !(opcoes.semDelegacao && f.requisitos.includes('agentes')));
  }
}

export function declarar(f: DefinicaoDeFerramenta): DeclaracaoDeFerramenta {
  const esquema = z.toJSONSchema(f.schemaDeEntrada, {
    io: 'input',
    unrepresentable: 'throw',
  }) as Record<string, unknown>;
  delete esquema.$schema;
  if (esquema.type !== 'object')
    throw new Error(`${f.nome}: o schema de entrada precisa ser um objeto.`);
  return {
    nome: f.nome,
    descricao: f.descricao,
    parametros: esquema as DeclaracaoDeFerramenta['parametros'],
  };
}

export interface ResultadoDaChamada {
  ok: boolean;
  conteudo: Record<string, unknown>;
  codigoDeErro?: string;
}

function erro(
  codigo: string,
  mensagem: string,
  detalhe?: Record<string, unknown>,
): ResultadoDaChamada {
  return {
    ok: false,
    codigoDeErro: codigo,
    conteudo: { erro: { codigo, mensagem, ...detalhe } },
  };
}

export async function executarChamada(
  oferecidas: readonly DefinicaoDeFerramenta[],
  chamada: { nome: string; argumentos: Record<string, unknown> },
  ctx: ContextoDeFerramenta,
  maxCaracteres: number,
): Promise<ResultadoDaChamada> {
  const f = oferecidas.find((o) => o.nome === chamada.nome);
  if (!f) {
    return erro(
      'ferramenta_nao_disponivel',
      `A ferramenta "${chamada.nome}" não está disponível nesta execução. ` +
        `Disponíveis: ${oferecidas.map((o) => o.nome).join(', ') || 'nenhuma'}.`,
    );
  }

  try {
    exigirEfeito(ctx.tarefa.escopo, f.efeito, f.nome);
  } catch (e) {
    const x = e as ErroDeFerramenta;
    return erro(x.codigo, x.message);
  }

  const lido = f.schemaDeEntrada.safeParse(chamada.argumentos);
  if (!lido.success) {
    const problemas = lido.error.issues
      .slice(0, 4)
      .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('; ');
    return erro(
      'argumentos_invalidos',
      `Argumentos inválidos para ${f.nome} — ${problemas}.`,
    );
  }

  try {
    const saida = await f.executar(lido.data, ctx);
    if (JSON.stringify(saida).length > maxCaracteres) {
      return erro(
        'resultado_grande_demais',
        `O resultado de ${f.nome} passou de ${maxCaracteres} caracteres. Peça um trecho menor.`,
      );
    }
    return { ok: true, conteudo: saida };
  } catch (e) {
    if (e instanceof ErroDeFerramenta) return erro(e.codigo, e.message, e.detalhe);
    return erro(
      'falha_interna',
      `A ferramenta ${f.nome} falhou: ${(e as Error)?.message ?? 'erro'}.`,
    );
  }
}
