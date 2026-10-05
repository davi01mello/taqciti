/**
 * O erro das integrações — um código que a ferramenta repassa ao modelo e que a
 * interface sabe explicar. Nunca carrega token, cabeçalho nem corpo da resposta:
 * a mensagem é nossa, escrita para a pessoa.
 */
export type CodigoDeErroDeIntegracao =
  /** Não há cliente OAuth registrado nesta build. */
  | 'nao_configurado'
  /** A conta não está conectada, ou não concedeu os escopos que a capacidade precisa. */
  | 'sem_autorizacao'
  /** Conta pessoal: não há diretório da organização. */
  | 'conta_pessoal'
  /** O Google recusou (4xx): nada foi feito. */
  | 'recusado'
  /** Cota ou limite de taxa do Google. */
  | 'limite'
  /** O Google respondeu erro de servidor: o desfecho de uma escrita é incerto. */
  | 'indisponivel'
  /** A chamada não respondeu a tempo: o desfecho de uma escrita é incerto. */
  | 'tempo_esgotado'
  /** Falha de rede no meio da chamada: o desfecho de uma escrita é incerto. */
  | 'sem_rede'
  | 'resposta_invalida';

export class ErroDeIntegracao extends Error {
  readonly codigo: CodigoDeErroDeIntegracao;
  readonly http?: number;

  constructor(codigo: CodigoDeErroDeIntegracao, mensagem: string, http?: number) {
    super(mensagem);
    this.name = 'ErroDeIntegracao';
    this.codigo = codigo;
    if (http !== undefined) this.http = http;
  }

  /**
   * A chamada pode ter chegado ao Google sem que saibamos. Para uma ESCRITA
   * isto é "resultado desconhecido", nunca "falhou": quem reenvia às cegas
   * duplica o e-mail ou o convite.
   */
  get desfechoIncerto(): boolean {
    return (
      this.codigo === 'tempo_esgotado' ||
      this.codigo === 'sem_rede' ||
      this.codigo === 'indisponivel' ||
      this.codigo === 'resposta_invalida'
    );
  }
}
