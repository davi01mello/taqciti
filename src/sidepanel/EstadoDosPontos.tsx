/**
 * "O que falta fechar" — o estado de cada ponto da reunião, na sidebar.
 *
 * Cada ponto mostra o estado (a esclarecer, discutido, a confirmar, decidido,
 * adiado), o responsável e o prazo QUANDO a fala trouxe, e a fala que o
 * sustenta a um clique. Responsável e prazo ausentes aparecem como ausentes: o
 * Taq não os preenche.
 *
 * É uma LEITURA do modelo, conferida em código, e não um registro oficial: a
 * pessoa corrige o estado de qualquer ponto, e a correção só cede a uma fala
 * posterior. Atualizar custa uma chamada ao modelo, por isso é um botão.
 */
import { useState } from 'react';
import {
  ESTADOS_DO_PONTO,
  ROTULO_DO_ESTADO,
  corrigirPontoDaReuniao,
  type EstadoDoPonto,
  type Ponto,
} from '@/features/estado/store';
import type { ResultadoDoRegistro } from '@/features/estado/registrar';
import { podeVirarAcompanhamento, sintetizar } from '@/features/estado/sintese';
import type { EstadoDaReuniao } from '@/features/estado/useEstado';

/** Do que mais pede atenção para o que já está resolvido. */
const ORDEM: Record<EstadoDoPonto, number> = {
  a_confirmar: 0,
  a_esclarecer: 1,
  discutido: 2,
  adiado: 3,
  decidido: 4,
};

function ItemDoPonto({ ponto, meetingId }: { ponto: Ponto; meetingId: string }) {
  const [fonte, setFonte] = useState(false);
  const decidido = ponto.estado === 'decidido' || ponto.estado === 'a_confirmar';
  return (
    <li className={`tq-estado-ponto tq-estado-${ponto.estado}`}>
      <div className="tq-estado-topo">
        <span className="tq-estado-texto">{ponto.texto}</span>
        <label className="tq-estado-corrigir">
          <span className="tq-so-leitor">Estado de “{ponto.texto}”</span>
          <select
            value={ponto.estado}
            onChange={(e) => void corrigirPontoDaReuniao(meetingId, ponto.id, e.target.value as EstadoDoPonto)}
          >
            {ESTADOS_DO_PONTO.map((e) => (
              <option key={e} value={e}>
                {ROTULO_DO_ESTADO[e]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(ponto.dono || ponto.prazo || decidido) && (
        <p className="tq-estado-quem">
          {ponto.dono ? `Responsável: ${ponto.dono}` : 'Responsável não definido'}
          {' · '}
          {ponto.prazo ? `Prazo: ${ponto.prazo}` : 'Prazo não definido'}
        </p>
      )}
      {ponto.nota && <p className="tq-estado-nota">{ponto.nota}</p>}
      {ponto.pessoaNaRevisao !== undefined && <p className="tq-estado-nota">Corrigido por você.</p>}
      {ponto.evidencias.length > 0 && (
        <>
          <button type="button" className="tq-estado-fonte-botao" aria-expanded={fonte} onClick={() => setFonte((v) => !v)}>
            Ver fonte
          </button>
          {fonte && (
            <ul className="tq-estado-fonte" aria-label={`Falas que sustentam “${ponto.texto}”`}>
              {ponto.evidencias.map((e) => (
                <li key={e.segmento}>
                  <span>Fala {e.segmento + 1}</span> “{e.trecho}”
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

const lista = (pontos: readonly Ponto[]) => (
  <ul>
    {pontos.map((p) => (
      <li key={p.id}>
        {p.texto}
        {p.dono || p.prazo ? ` (${[p.dono, p.prazo].filter(Boolean).join(', ')})` : ''}
      </li>
    ))}
  </ul>
);

/**
 * "Fechar a reunião": a síntese sobre o estado já conferido, a frase de
 * fechamento (sugestão do Taq, não fala registrada) e o gesto de registrar um
 * ponto como acompanhamento. Nada vira decisão por aparecer aqui.
 */
function Fechamento({
  estado,
  falasAgora,
  onRegistrar,
}: {
  estado: EstadoDaReuniao;
  falasAgora: number;
  onRegistrar: (ponto: Ponto) => Promise<ResultadoDoRegistro>;
}) {
  const [recibo, setRecibo] = useState<Record<string, string>>({});
  const s = sintetizar(estado.snapshot, falasAgora);
  const fechamento = estado.snapshot?.fechamento;
  const registrar = async (p: Ponto) => {
    const r = await onRegistrar(p);
    setRecibo((x) => ({
      ...x,
      [p.id]:
        r.tipo === 'recusado'
          ? r.motivo
          : r.jaExistia
            ? 'Já estava em Acompanhamento.'
            : 'Registrado em Acompanhamento.',
    }));
  };
  const elegiveis = [...s.decidido, ...s.aConfirmar].filter(podeVirarAcompanhamento);
  return (
    <div className="tq-fechamento">
      {s.limites.map((l) => (
        <p key={l} className="tq-estado-nota">
          {l}
        </p>
      ))}
      {!s.vazia && (
        <>
          {s.decidido.length > 0 && (
            <div>
              <h4>Decidido</h4>
              {lista(s.decidido)}
            </div>
          )}
          {s.aConfirmar.length > 0 && (
            <div>
              <h4>A confirmar (proposto, ninguém fechou)</h4>
              {lista(s.aConfirmar)}
            </div>
          )}
          {s.emAberto.length > 0 && (
            <div>
              <h4>Em aberto</h4>
              {lista(s.emAberto)}
            </div>
          )}
          {s.adiado.length > 0 && (
            <div>
              <h4>Adiado</h4>
              {lista(s.adiado)}
            </div>
          )}
          {s.semResponsavelOuPrazo.length > 0 && (
            <div>
              <h4>Ainda sem definir</h4>
              <ul>
                {s.semResponsavelOuPrazo.map(({ ponto, falta }) => (
                  <li key={ponto.id}>
                    {ponto.texto}: {falta.join(' e ')} não {falta.length > 1 ? 'definidos' : 'definido'}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {fechamento && (
            <blockquote className="tq-apoio-pergunta">
              <span className="tq-apoio-aviso">Sugestão de fechamento — não é uma fala registrada</span>“{fechamento.texto}”
            </blockquote>
          )}
          {elegiveis.length > 0 && (
            <div>
              <h4>Registrar em Acompanhamento</h4>
              <ul className="tq-fechamento-registrar">
                {elegiveis.map((p) => (
                  <li key={p.id}>
                    <span>{p.texto}</span>
                    <button type="button" onClick={() => void registrar(p)}>
                      Registrar como acompanhamento
                    </button>
                    {recibo[p.id] && <span role="status">{recibo[p.id]}</span>}
                  </li>
                ))}
              </ul>
              <p className="tq-estado-nota">
                Só vira acompanhamento o que você registrar aqui. Responsável e prazo entram só se foram ditos.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function EstadoDosPontos({
  meetingId,
  estado,
  aberto,
  onAlternar,
  taqPronto,
  falasAgora = 0,
  onRegistrar,
  fechamentoAberto = false,
  onAlternarFechamento,
}: {
  meetingId: string;
  estado: EstadoDaReuniao;
  aberto: boolean;
  onAlternar: () => void;
  taqPronto: boolean;
  /** Quantas falas a transcrição tem agora: a síntese diz se a leitura ficou para trás. */
  falasAgora?: number;
  onRegistrar?: (ponto: Ponto) => Promise<ResultadoDoRegistro>;
  fechamentoAberto?: boolean;
  onAlternarFechamento?: () => void;
}) {
  const { snapshot, atualizando, erro, lidoAte } = estado;
  const pontos = [...(snapshot?.pontos ?? [])].sort((a, b) => ORDEM[a.estado] - ORDEM[b.estado]);
  const emAberto = pontos.filter((p) => p.estado !== 'decidido').length;
  return (
    <section className="tq-estado" aria-label="O que falta fechar">
      <button type="button" className="tq-estado-cabeca" aria-expanded={aberto} onClick={onAlternar}>
        <span>O que falta fechar</span>
        {snapshot && <span className="tq-estado-conta">{emAberto === 0 ? 'tudo tratado' : `${emAberto} em aberto`}</span>}
      </button>
      {aberto && (
        <div className="tq-estado-corpo">
          {snapshot?.assunto && (
            <p className="tq-estado-assunto">
              Parece que estão falando de: {snapshot.assunto.texto}
            </p>
          )}
          {pontos.length === 0 ? (
            <p className="tq-estado-vazio">
              {snapshot
                ? 'Nenhum ponto ainda. Escreva o que não pode ficar sem encaminhamento em “Preparar” na HOME, ou atualize depois de falarem mais.'
                : 'Ainda não foi lido. Atualize para o Taq dizer onde cada ponto está.'}
            </p>
          ) : (
            <ul className="tq-estado-lista">
              {pontos.map((p) => (
                <ItemDoPonto key={p.id} ponto={p} meetingId={meetingId} />
              ))}
            </ul>
          )}
          {erro && (
            <p className="tq-estado-erro" role="alert">
              Não consegui atualizar: {erro.replace(/[.\s]+$/, '')}. O que estava guardado continua.
            </p>
          )}
          {fechamentoAberto && onRegistrar && (
            <Fechamento estado={estado} falasAgora={falasAgora} onRegistrar={onRegistrar} />
          )}
          <div className="tq-estado-rodape">
            <button type="button" disabled={!taqPronto || atualizando} onClick={() => void estado.atualizar()}>
              {atualizando ? 'Lendo a reunião…' : snapshot ? 'Atualizar' : 'Ler a reunião'}
            </button>
            {onAlternarFechamento && (
              <button type="button" aria-expanded={fechamentoAberto} onClick={onAlternarFechamento}>
                {fechamentoAberto ? 'Esconder o fechamento' : 'Fechar a reunião'}
              </button>
            )}
            {!taqPronto && <span>O assistente não está conectado.</span>}
            {lidoAte !== null && taqPronto && <span>Lido até a fala {lidoAte}. É uma leitura do Taq: corrija se estiver errada.</span>}
          </div>
        </div>
      )}
    </section>
  );
}
