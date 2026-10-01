/**
 * O orçamento de UMA execução — compartilhado com tudo que ela delegar.
 *
 * Um objeto só, passado por referência ao especialista, e não uma cópia: é o
 * que faz "delegação não multiplica custo" ser verdade por construção. Um
 * especialista que gaste seis passos deixa dois para o orquestrador terminar.
 */
import type { Limites } from './contratos';

export class Orcamento {
  readonly limites: Limites;
  readonly inicio: number;
  readonly prazo: number;
  passos = 0;
  chamadas = 0;
  uso = { entrada: 0, saida: 0 };

  constructor(limites: Limites, agora: number = Date.now()) {
    this.limites = limites;
    this.inicio = agora;
    this.prazo = agora + limites.tempoMaxMs;
  }

  passosRestantes(): number {
    return this.limites.maxPassos - this.passos;
  }

  chamadasRestantes(): number {
    return this.limites.maxChamadasDeFerramenta - this.chamadas;
  }

  estourouPrazo(agora: number = Date.now()): boolean {
    return agora >= this.prazo;
  }

  somarUso(uso: { entrada: number; saida: number }): void {
    this.uso = {
      entrada: this.uso.entrada + uso.entrada,
      saida: this.uso.saida + uso.saida,
    };
  }
}
