/**
 * Quem é a pessoa dona do acervo.
 *
 * Só a parte de BANCO mora aqui: achar ou criar a linha a partir de uma
 * identidade já verificada. Quem verifica o token do Google contra o Google
 * é outra camada — e essa separação é de propósito, porque é ela que permite
 * testar o acervo inteiro sem rede nenhuma.
 *
 * O contrato é curto e vale ser explícito: `garantirPessoa` CONFIA no que
 * recebe. Chamá-la com um `googleSub` que não foi verificado é entregar o
 * acervo de alguém para quem digitou o nome certo.
 */
import { type Consultador, banco } from './banco';

export interface IdentidadeVerificada {
  /** O `sub` do Google: identificador estável da conta. */
  googleSub: string;
  email: string;
  nome?: string;
}

/**
 * Acha a pessoa pelo `google_sub`, criando se for a primeira vez.
 *
 * `on conflict … do update` em vez de `do nothing` porque o e-mail e o nome
 * podem mudar entre um acesso e outro, e a linha deve refletir a conta atual
 * — o que NÃO muda é o `google_sub`, que é a chave. `vista_em` é atualizado
 * no mesmo comando: uma ida ao banco, e a página Conexões ganha "último
 * acesso" de graça.
 */
export async function garantirPessoa(
  identidade: IdentidadeVerificada,
  pool: Consultador = banco(),
): Promise<string> {
  const { rows } = await pool.query(
    `insert into pessoa (google_sub, email, nome)
     values ($1, $2, $3)
     on conflict (google_sub) do update set
       email = excluded.email,
       nome = coalesce(excluded.nome, pessoa.nome),
       vista_em = now()
     returning id`,
    [identidade.googleSub, identidade.email, identidade.nome ?? null],
  );
  const id = rows[0]?.id;
  if (typeof id !== 'string') {
    throw new Error('garantirPessoa não devolveu id — isto não deveria acontecer.');
  }
  return id;
}
