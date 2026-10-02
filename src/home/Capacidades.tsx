/**
 * "O que o Taq faz" — o estado de cada capacidade, para quem usa.
 *
 * A fonte é o MESMO registro que o orquestrador consulta para decidir o que
 * oferecer ao modelo (`criarRegistroPadrao`): o que aparece aqui como
 * disponível é exatamente o que o Taq pode executar. Especialista que usa
 * modelo depende do servidor de IA; os determinísticos funcionam sem ele.
 *
 * As integrações de envio e de agenda não existem nesta versão, e por isso
 * não há botão "Conectar" para elas: um botão que não inicia fluxo real seria
 * exatamente o controle decorativo que o produto não pode ter.
 */
import { useMemo } from 'react';
import { criarRegistroPadrao } from '@/features/taq/orquestrador';
import type { DisponibilidadeDoTaq } from '@/features/taq/interface';

function estadoDe(
  a: { estado: string; usaModelo: boolean },
  taq: DisponibilidadeDoTaq,
): { rotulo: string; classe: string } {
  if (a.estado === 'disabled') return { rotulo: 'Desativado', classe: 'off' };
  if (a.estado !== 'available') return { rotulo: 'Em desenvolvimento', classe: 'off' };
  if (!a.usaModelo) return { rotulo: 'Disponível (sem IA)', classe: 'ok' };
  if (taq.fase === 'pronto') return { rotulo: 'Disponível', classe: 'ok' };
  if (taq.fase === 'verificando') return { rotulo: 'Verificando…', classe: 'off' };
  return { rotulo: 'Precisa de configuração do servidor de IA', classe: 'pendente' };
}

export function Capacidades({ taq }: { taq: DisponibilidadeDoTaq }) {
  const agentes = useMemo(
    () => criarRegistroPadrao().todos().filter((a) => a.id !== 'taq'),
    [],
  );
  const emDesenvolvimento = agentes.filter((a) => a.estado === 'planned');
  return (
    <section className="tq-capacidades" aria-labelledby="tq-cap-titulo">
      <h2 className="tq-secao-titulo" id="tq-cap-titulo">
        O que o Taq faz
      </h2>
      <p className="tq-meta">
        {taq.fase === 'pronto'
          ? `Assistente conectado (${taq.provedor}, ${taq.modelo}). Os trechos que ele consulta vão ao provedor de IA.`
          : taq.fase === 'pendente'
            ? `Assistente com configuração pendente: ${taq.motivos.join(' ')}`
            : taq.fase === 'inalcancavel'
              ? 'O servidor do assistente não respondeu. As funções sem IA continuam disponíveis.'
              : 'Verificando o assistente…'}
      </p>
      <ul className="tq-cap-lista">
        {agentes
          .filter((a) => a.estado !== 'planned')
          .map((a) => {
            const e = estadoDe(a, taq);
            return (
              <li key={a.id} className={`tq-cap tq-cap-${e.classe}`}>
                <strong>{a.nome}</strong>
                <span className="tq-cap-estado">{e.rotulo}</span>
                <span className="tq-cap-desc">{a.descricao}</span>
              </li>
            );
          })}
      </ul>
      {emDesenvolvimento.length > 0 && (
        <p className="tq-meta">Em desenvolvimento: {emDesenvolvimento.map((a) => a.nome).join(', ')}.</p>
      )}

      <h2 className="tq-secao-titulo">Integrações</h2>
      <ul className="tq-cap-lista">
        <li className="tq-cap tq-cap-off">
          <strong>Envio de e-mail e mensagens</strong>
          <span className="tq-cap-estado">Não disponível nesta versão</span>
          <span className="tq-cap-desc">
            O Taq prepara rascunhos para você copiar ou abrir no seu programa de e-mail. Nada é enviado pelo
            TaqCiti.
          </span>
        </li>
        <li className="tq-cap tq-cap-off">
          <strong>Calendário</strong>
          <span className="tq-cap-estado">Não disponível nesta versão</span>
          <span className="tq-cap-desc">
            O Taq sugere horários no seu fuso e abre o formulário do Google Agenda preenchido, sem convidados. Ele
            não consulta a disponibilidade de ninguém nem cria eventos.
          </span>
        </li>
      </ul>
    </section>
  );
}
