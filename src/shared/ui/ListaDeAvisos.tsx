/**
 * Os avisos do Taq — a mesma lista na sidebar (popup do 4º botão) e na HOME
 * (página Acompanhamento).
 *
 * Cada item: o status em palavras, uma linha, a ação que cabe a ele e
 * "Dispensar". Detalhe técnico (agente, ferramenta, código) fica numa área
 * recolhida. As ações de registro (aceitar, definir responsável, completar o
 * prazo) rodam aqui mesmo, no registro; abrir reunião, documento e conversa é
 * da superfície, que sabe navegar.
 *
 * Nada aqui rouba foco: a lista é estática e os resultados das ações são
 * anunciados em `role="status"`.
 */
import { useState } from 'react';
import {
  aceitarCandidato,
  definirPrazo,
  definirResponsavel,
  type ResultadoDaAcao,
} from '@/features/avisos/acoes';
import { dispensarAviso, ROTULO_DO_STATUS, type Aviso } from '@/features/avisos/store';
import './avisosDoTaq.css';

interface Props {
  avisos: readonly Aviso[];
  historico?: readonly Aviso[];
  /** Nomes entre os quais escolher o responsável (os participantes da reunião). */
  participantes?: readonly string[];
  /** Abrir o que o aviso aponta: reunião, documento, conversa, acompanhamento. */
  onAbrir: (aviso: Aviso) => void;
  /** Mensagem quando não há nada. */
  vazio?: string;
}

export function ListaDeAvisos({ avisos, historico = [], participantes = [], onAbrir, vazio }: Props) {
  const [verHistorico, setVerHistorico] = useState(false);
  const [mensagem, setMensagem] = useState('');

  const concluir = (r: ResultadoDaAcao, ok: string) => setMensagem(r.ok ? ok : r.motivo);

  return (
    <div className="tq-avisos">
      {avisos.length ? (
        <ul className="tq-avisos-lista">
          {avisos.map((a) => (
            <ItemDeAviso
              key={a.id}
              aviso={a}
              participantes={participantes}
              onAbrir={onAbrir}
              onResultado={concluir}
            />
          ))}
        </ul>
      ) : (
        <p className="tq-c-mudo">{vazio ?? 'Nada pendente por enquanto.'}</p>
      )}

      <p className="tq-avisos-msg" role="status" aria-live="polite">
        {mensagem}
      </p>

      {historico.length > 0 && (
        <div className="tq-avisos-historico">
          <button
            type="button"
            className="tq-avisos-link"
            aria-expanded={verHistorico}
            onClick={() => setVerHistorico((v) => !v)}
          >
            {verHistorico ? 'Esconder histórico' : `Histórico (${historico.length})`}
          </button>
          {verHistorico && (
            <ul className="tq-avisos-lista tq-avisos-lista-hist">
              {historico.map((a) => (
                <li key={a.id} className="tq-aviso tq-aviso-hist">
                  <span className="tq-aviso-estado">{a.resolvido ? 'Resolvido' : 'Dispensado'}</span>
                  <span className="tq-aviso-titulo">{a.titulo}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ItemDeAviso({
  aviso,
  participantes,
  onAbrir,
  onResultado,
}: {
  aviso: Aviso;
  participantes: readonly string[];
  onAbrir: (a: Aviso) => void;
  onResultado: (r: ResultadoDaAcao, ok: string) => void;
}) {
  const [nome, setNome] = useState('');
  const [data, setData] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const [tipo, alvoId] = [aviso.chave.split(':')[0], aviso.chave.split(':')[1]];
  const rodar = (p: Promise<ResultadoDaAcao>, ok: string) => {
    setOcupado(true);
    void p.then((r) => onResultado(r, ok)).finally(() => setOcupado(false));
  };

  return (
    <li className={`tq-aviso status-${aviso.status}${aviso.lido ? '' : ' novo'}`}>
      <div className="tq-aviso-cab">
        <span className="tq-aviso-estado">{ROTULO_DO_STATUS[aviso.status]}</span>
        {!aviso.lido && <span className="tq-aviso-ponto" aria-label="novo" />}
      </div>
      <p className="tq-aviso-titulo">{aviso.titulo}</p>

      {(aviso.detalhe || aviso.tecnico) && (
        <details className="tq-aviso-detalhe">
          <summary>Detalhes</summary>
          {aviso.detalhe && <p>{aviso.detalhe}</p>}
          {aviso.tecnico && <p className="tq-aviso-tec">{aviso.tecnico}</p>}
        </details>
      )}

      {tipo === 'semresp' && alvoId && participantes.length > 0 && (
        <div className="tq-aviso-linha">
          <label>
            <span className="tq-so-leitor">Responsável</span>
            <select value={nome} onChange={(e) => setNome(e.target.value)}>
              <option value="">Responsável…</option>
              {participantes.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="tq-avisos-acao"
            disabled={!nome || ocupado}
            onClick={() => rodar(definirResponsavel(alvoId, nome), 'Responsável definido.')}
          >
            Definir
          </button>
        </div>
      )}

      {tipo === 'prazo' && alvoId && (
        <div className="tq-aviso-linha">
          <label>
            <span className="tq-so-leitor">Data do prazo</span>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </label>
          <button
            type="button"
            className="tq-avisos-acao"
            disabled={!data || ocupado}
            onClick={() => rodar(definirPrazo(alvoId, data), 'Prazo definido.')}
          >
            Definir
          </button>
        </div>
      )}

      <div className="tq-aviso-linha">
        {tipo === 'revisar' && alvoId && (
          <button
            type="button"
            className="tq-avisos-acao principal"
            disabled={ocupado}
            onClick={() => rodar(aceitarCandidato(alvoId), 'Item aceito.')}
          >
            Aceitar
          </button>
        )}
        {aviso.acao && (
          <button type="button" className="tq-avisos-acao" onClick={() => onAbrir(aviso)}>
            {aviso.acao.rotulo ?? 'Abrir'}
          </button>
        )}
        <button
          type="button"
          className="tq-avisos-link"
          onClick={() => void dispensarAviso(aviso.id)}
        >
          Dispensar
        </button>
      </div>
    </li>
  );
}
