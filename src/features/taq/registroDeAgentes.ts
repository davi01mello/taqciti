/**
 * AgentRegistry — identidade, capacidades, disponibilidade e implementação.
 *
 * Duas regras cobradas NO CADASTRO, e não na chamada:
 *
 *   - a ficha é validada (id estável, finalidade, fronteiras…);
 *   - `available` exige executor, e `planned`/`disabled` não podem ter um —
 *     ficha dizendo "disponível" sem implementação é exatamente a
 *     funcionalidade que parece existir e não existe.
 *
 * Tornar um especialista disponível é chamar `ativar(id, executor)` — a mesma
 * porta que os testes usam para registrar um executor de teste, sem tocar no
 * orquestrador nem no runtime.
 */
import { fichaDeAgenteSchema, type FichaDeAgente } from './contratos';
import type { DefinicaoDeAgente, ExecutorDeAgente } from './tipos';

export class RegistroDeAgentes {
  private readonly mapa = new Map<string, DefinicaoDeAgente>();

  registrar(definicao: DefinicaoDeAgente): this {
    // O schema de objeto do zod descarta as chaves que não são da ficha
    // (schemas e executor): a validação olha só o que é dado.
    const lida = fichaDeAgenteSchema.safeParse(definicao);
    const { executor } = definicao;
    if (!lida.success) {
      throw new Error(
        `Ficha inválida para ${definicao.id}: ${lida.error.issues[0]?.message}`,
      );
    }
    if (definicao.estado === 'available' && !executor) {
      throw new Error(`${definicao.id} está "available" sem executor.`);
    }
    if (definicao.estado !== 'available' && executor) {
      throw new Error(`${definicao.id} tem executor mas está "${definicao.estado}".`);
    }
    if (this.mapa.has(definicao.id)) throw new Error(`Agente duplicado: ${definicao.id}`);
    this.mapa.set(definicao.id, definicao);
    return this;
  }

  /** Liga um agente já catalogado a uma implementação. */
  ativar(
    id: string,
    executor: ExecutorDeAgente,
    versaoDasInstrucoes: string | null = null,
  ): this {
    const atual = this.mapa.get(id);
    if (!atual) throw new Error(`Agente desconhecido: ${id}`);
    this.mapa.set(id, { ...atual, estado: 'available', executor, versaoDasInstrucoes });
    return this;
  }

  desativar(id: string): this {
    const atual = this.mapa.get(id);
    if (!atual) throw new Error(`Agente desconhecido: ${id}`);
    this.mapa.set(id, { ...atual, estado: 'disabled', executor: undefined });
    return this;
  }

  obter(id: string): DefinicaoDeAgente | undefined {
    return this.mapa.get(id);
  }

  todos(): FichaDeAgente[] {
    return [...this.mapa.values()].map((a) => fichaDeAgenteSchema.parse(a));
  }

  /** Os que podem ser executados agora — os únicos que o modelo fica sabendo. */
  disponiveis(excluir?: string): FichaDeAgente[] {
    return this.todos().filter((a) => a.estado === 'available' && a.id !== excluir);
  }
}
