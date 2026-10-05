/**
 * A conta do CITi em "Conexões": o que liga o Taq ao diretório da organização,
 * ao e-mail e à agenda.
 *
 * Duas regras de interface, as mesmas do resto da página:
 *
 *   1. NENHUM diálogo do Google sem clique. Abrir a página só LÊ o que já está
 *      guardado (`lerConexao`); a tela de consentimento aparece apenas no
 *      `onClick` de "Conectar conta do CITi".
 *   2. Estado honesto. Cada capacidade mostra se está disponível e, se não
 *      está, a dependência concreta (cliente OAuth, conta, permissão). Nada de
 *      "em breve" quando o código existe.
 */
import { useCallback, useEffect, useState } from 'react';
import { oauthConfigurado } from '@/document/googleDocs';
import { ErroDeIntegracao } from '@/features/integracoes/erros';
import type { CapacidadeExterna } from '@/features/integracoes/escopos';
import {
  conectarConta,
  desconectarConta,
  estadoDasCapacidades,
  lerConexao,
  ligarCapacidade,
  type ConexaoGuardada,
  type SituacaoDaCapacidade,
} from '@/features/integracoes/estado';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { onLocalChange } from '@/shared/services/storage';

const NOME_DA_CAPACIDADE: Record<CapacidadeExterna, string> = {
  diretorio: 'Colegas da organização',
  email: 'Enviar e-mail',
  agenda_consulta: 'Ver agendas',
  agenda_eventos: 'Criar e remarcar eventos',
};

type Estados = Record<CapacidadeExterna, SituacaoDaCapacidade>;

export interface ContaDoCiti {
  carregado: boolean;
  conexao: ConexaoGuardada | null;
  estados: Estados | null;
  ocupado: boolean;
  erro: string | null;
  oauthPronto: boolean;
  conectar: () => Promise<void>;
  desconectar: () => Promise<void>;
  alternar: (capacidade: CapacidadeExterna, ligada: boolean) => Promise<void>;
}

export function useContaDoCiti(): ContaDoCiti {
  const [carregado, setCarregado] = useState(false);
  const [conexao, setConexao] = useState<ConexaoGuardada | null>(null);
  const [estados, setEstados] = useState<Estados | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    const [c, e] = await Promise.all([lerConexao(), estadoDasCapacidades().catch(() => null)]);
    setConexao(c);
    setEstados(e);
    setCarregado(true);
  }, []);

  useEffect(() => {
    void recarregar();
    return onLocalChange(STORAGE_KEYS.integracoes, () => void recarregar());
  }, [recarregar]);

  const executar = useCallback(
    async (acao: () => Promise<unknown>) => {
      setOcupado(true);
      setErro(null);
      try {
        await acao();
      } catch (e) {
        setErro(
          e instanceof ErroDeIntegracao ? e.message : 'Não foi possível concluir. Tente de novo.',
        );
      } finally {
        setOcupado(false);
        await recarregar();
      }
    },
    [recarregar],
  );

  return {
    carregado,
    conexao,
    estados,
    ocupado,
    erro,
    oauthPronto: oauthConfigurado(),
    conectar: () => executar(conectarConta),
    desconectar: () => executar(desconectarConta),
    alternar: (capacidade, ligada) => executar(() => ligarCapacidade(capacidade, ligada)),
  };
}

/** O que abre quando se clica em "Conectar" no cartão da conta do CITi. */
export function FluxoContaDoCiti({ conta, onCancelar }: { conta: ContaDoCiti; onCancelar: () => void }) {
  if (!conta.oauthPronto)
    return (
      <p className="tq-hub-nota">
        Falta registrar o cliente OAuth desta extensão com as permissões de e-mail, diretório e agenda — sem
        ele o Chrome não identifica a sua conta. O roteiro está em{' '}
        <code>docs/integracoes-google-workspace.md</code>.
      </p>
    );
  return (
    <div className="tq-hub-fluxo">
      {conta.erro && <p className="tq-hub-nota tq-hub-falha">{conta.erro}</p>}
      <p className="tq-hub-nota">
        Abre o login do Google — escolha a sua conta do CITi. Com ela, o Taq passa a achar colegas da
        organização, enviar e-mail por você e ver agendas e criar eventos — <b>só quando você pede</b>, e
        mostrando antes o que vai sair quando faltar algo. Ele não lê a sua caixa de entrada.
      </p>
      <div className="tq-acoes">
        <button
          type="button"
          className="tq-acao tq-acao-principal"
          disabled={conta.ocupado}
          onClick={() => void conta.conectar()}
        >
          Conectar conta do CITi
        </button>
        <button type="button" className="tq-acao" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/** A linha em "Conectadas": a conta e, por capacidade, o que está pronto. */
export function LinhaContaDoCiti({ conta }: { conta: ContaDoCiti }) {
  const [confirmando, setConfirmando] = useState(false);
  if (!conta.conexao) return null;
  return (
    <li className="tq-hub-conta-citi">
      <span className="tq-hub-icone" aria-hidden="true">
        <span>@</span>
      </span>
      <div>
        <b>Conta do CITi</b>
        <small>{conta.conexao.email}</small>
        {conta.erro && <small className="tq-hub-falha">{conta.erro}</small>}
        {conta.estados && (
          <ul className="tq-hub-capacidades">
            {(Object.keys(NOME_DA_CAPACIDADE) as CapacidadeExterna[]).map((c) => {
              const s = conta.estados![c];
              return (
                <li key={c}>
                  <span>{NOME_DA_CAPACIDADE[c]}</span>{' '}
                  <small>
                    {s.estado === 'available'
                      ? 'pronto'
                      : s.estado === 'disabled'
                        ? 'desligado por você'
                        : (s.dependencia ?? 'depende de configuração')}
                  </small>{' '}
                  {(s.estado === 'available' || s.estado === 'disabled') && (
                    <button
                      type="button"
                      className="tq-linkish"
                      disabled={conta.ocupado}
                      onClick={() => void conta.alternar(c, s.estado === 'disabled')}
                    >
                      {s.estado === 'available' ? 'Desligar' : 'Ligar'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {confirmando ? (
        <span className="tq-acoes">
          <button
            type="button"
            className="tq-linkish tq-linkish-perigo"
            disabled={conta.ocupado}
            onClick={() => {
              setConfirmando(false);
              void conta.desconectar();
            }}
          >
            Desconectar a conta
          </button>
          <button type="button" className="tq-linkish" onClick={() => setConfirmando(false)}>
            Cancelar
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="tq-linkish"
          disabled={conta.ocupado}
          title="O Taq deixa de enviar e-mail e mexer na agenda. Rascunhos continuam guardados."
          onClick={() => setConfirmando(true)}
        >
          Desconectar
        </button>
      )}
    </li>
  );
}
