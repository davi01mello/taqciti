/**
 * Os CARTÕES de uma resposta do Taq — HOME e sidebar.
 *
 * Cada cartão vem de um payload que uma FERRAMENTA produziu e o runtime
 * validou (`cartaoSchema`); nada aqui interpreta o texto do modelo. Os botões
 * chamam operações reais:
 *
 *   compromissos   "Marcar como concluído" / "Reabrir" → `atualizarCompromisso`
 *   sugestões      "Registrar selecionados" → `registrarCompromissos`
 *   achados        "Marcar resolvido" / "Descartar com motivo" / "Reabrir"
 *   análise        "Corrigir" um item → `corrigirItemDaAnalise`
 *   rascunho       editar e "Copiar"; o envio é só pelo Taq, no chat ("envie")
 *   horários       "Abrir no Google Agenda" (formulário preenchido, sem convidados)
 *
 * Os de registro (compromissos, decisões, achados, análise) são desenhados a
 * partir do storage, no estado de agora: o que foi concluído depois aparece
 * concluído; o que foi apagado aparece como indisponível. Nenhum botão de
 * "Enviar" ou "Agendar" existe, porque nenhuma integração existe.
 */
import { useState, type ReactNode } from 'react';
import type { CartaoDaResposta } from '@/features/taq/contratos';
import type { FonteDaResposta } from '@/home/conversations';
import { editarRascunhoDaResposta } from '@/home/conversations';
import {
  SECOES_DA_ANALISE,
  TITULO_DA_SECAO,
  analiseDesatualizada,
  atualizarCompromisso,
  chaveDoItem,
  corrigirItemDaAnalise,
  mudarEstadoDoAchado,
  registrarCompromissos,
  situacaoDoPrazo,
  type Achado,
  type Compromisso,
  type Decisao,
  type EvidenciaGuardada,
  type SecaoDaAnalise,
} from '@/features/trabalho/store';
import { useTrabalho, useVersoesDasReunioes } from '@/features/trabalho/useTrabalho';
import { ROTULO_DA_AVALIACAO, ROTULO_DA_SITUACAO } from '@/features/taq/captura';
import { linkDoGoogleAgenda } from '@/features/taq/agenda';
import { acharSensiveis, avisosDeExposicao } from '@/features/taq/privacidade';
import { BotaoCopiar } from './BotaoCopiar';
import { CartaoDeTela } from './CartaoDeTela';
import './cartoesDoTaq.css';

type Versoes = ReturnType<typeof useVersoesDasReunioes>;

function instante(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function hojeLocal(): string {
  return new Intl.DateTimeFormat('en-CA').format(new Date());
}

// ------------------------------------------------------------------- fontes

/** Uma fonte clicável, com o trecho. Origem apagada vira texto, sem botão. */
export function FonteDoCartao({
  e,
  versoes,
  onAbrirFonte,
}: {
  e: EvidenciaGuardada;
  versoes: Versoes;
  onAbrirFonte: (f: FonteDaResposta) => void;
}) {
  const [aberta, setAberta] = useState(false);
  const indisponivel = e.tipo === 'reuniao' && versoes !== null && !versoes.has(e.registroId);
  const titulo = (e.tipo === 'reuniao' && versoes?.get(e.registroId)?.titulo) || e.titulo;
  const rotulo = `${titulo}${e.offsetMs !== undefined ? ` · ${instante(e.offsetMs)}` : ''}`;
  if (indisponivel) return <span className="tq-c-fonte tq-c-fonte-off">{rotulo} — origem indisponível</span>;
  return (
    <span className="tq-c-fonte-bloco">
      <button
        type="button"
        className="tq-c-fonte"
        aria-expanded={aberta}
        onClick={() => setAberta((v) => !v)}
      >
        {rotulo}
      </button>
      {aberta && (
        <span className="tq-c-trecho">
          <q>{e.trecho}</q>
          <button
            type="button"
            className="tq-c-link"
            onClick={() =>
              onAbrirFonte({
                ref: '',
                tipo: e.tipo,
                registroId: e.registroId,
                titulo,
                trecho: e.trecho,
                ...(e.segmento !== undefined ? { segmento: e.segmento } : {}),
                ...(e.offsetMs !== undefined ? { offsetMs: e.offsetMs } : {}),
              })
            }
          >
            Abrir a origem
          </button>
        </span>
      )}
    </span>
  );
}

function Fontes(props: { evidencias: readonly EvidenciaGuardada[]; versoes: Versoes; onAbrirFonte: (f: FonteDaResposta) => void }) {
  if (!props.evidencias.length) return <span className="tq-c-mudo">informado na conversa, sem trecho</span>;
  return (
    <>
      {props.evidencias.slice(0, 3).map((e, i) => (
        <FonteDoCartao key={`${e.registroId}-${e.segmento ?? i}`} e={e} versoes={props.versoes} onAbrirFonte={props.onAbrirFonte} />
      ))}
    </>
  );
}

function Erro({ texto }: { texto: string | null }) {
  return texto ? (
    <p className="tq-c-erro" role="alert">
      {texto}
    </p>
  ) : null;
}

function Cartao({ titulo, selo, children }: { titulo: string; selo?: string; children: ReactNode }) {
  return (
    <section className="tq-c" aria-label={titulo}>
      <header className="tq-c-cab">
        <h4>{titulo}</h4>
        {selo && <span className="tq-c-selo">{selo}</span>}
      </header>
      {children}
    </section>
  );
}

// ------------------------------------------------------------- compromissos

const ROTULO_DO_ESTADO: Record<Compromisso['estado'], string> = {
  aberto: 'Aberto',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

export function ItemDeCompromisso({
  c,
  todos,
  versoes,
  onAbrirFonte,
}: {
  c: Compromisso;
  todos: readonly Compromisso[];
  versoes: Versoes;
  onAbrirFonte: (f: FonteDaResposta) => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const situacao = situacaoDoPrazo(c, hojeLocal());
  const mudar = async (estado: Compromisso['estado']) => {
    setOcupado(true);
    setErro(null);
    const r = await atualizarCompromisso(c.id, c.revisao, { estado }, { origem: 'pessoa' }).catch(() => null);
    setOcupado(false);
    if (!r) setErro('Não foi possível gravar. Nada mudou.');
    else if (r.tipo === 'conflito') setErro('O compromisso mudou em outra tela. Confira e tente de novo.');
    else if (r.tipo !== 'ok') setErro('Este compromisso não está mais guardado.');
  };
  const aceitar = async () => {
    setOcupado(true);
    setErro(null);
    const r = await atualizarCompromisso(c.id, c.revisao, { situacao: 'aceito' }, { origem: 'pessoa' }).catch(() => null);
    setOcupado(false);
    if (!r) setErro('Não foi possível gravar. Nada mudou.');
    else if (r.tipo === 'conflito') setErro('O compromisso mudou em outra tela. Confira e tente de novo.');
  };
  return (
    <li className={`tq-c-item tq-c-estado-${c.estado}`}>
      <p className="tq-c-titulo">{c.descricao}</p>
      <p className="tq-c-meta">
        <span>{c.responsavel ? `${c.responsavel.nome}${c.responsavel.confirmado ? '' : ' (sugerido)'}` : 'Sem responsável definido'}</span>
        <span>{c.prazo ? c.prazo.texto : 'Sem prazo acordado'}</span>
        <span className="tq-c-pilula">{ROTULO_DO_ESTADO[c.estado]}</span>
        {c.situacao === 'candidato' && (
          <span className="tq-c-pilula tq-c-alerta">Candidato extraído — aguardando revisão</span>
        )}
        {situacao === 'prazo_passou_a_confirmar' && (
          <span className="tq-c-pilula tq-c-alerta">Prazo passou — situação a confirmar</span>
        )}
      </p>
      {c.dependeDe.length > 0 && (
        <p className="tq-c-meta">
          Depende de: {c.dependeDe.map((id) => todos.find((x) => x.id === id)?.descricao ?? '(removido)').join('; ')}
        </p>
      )}
      <p className="tq-c-fontes">
        <Fontes evidencias={c.evidencias} versoes={versoes} onAbrirFonte={onAbrirFonte} />
      </p>
      <div className="tq-c-acoes">
        {c.situacao === 'candidato' && (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void aceitar()}
          >
            Aceitar
          </button>
        )}
        {c.estado === 'aberto' ? (
          <button type="button" disabled={ocupado} onClick={() => void mudar('concluido')}>
            Marcar como concluído
          </button>
        ) : (
          <button type="button" disabled={ocupado} onClick={() => void mudar('aberto')}>
            Reabrir
          </button>
        )}
      </div>
      {c.historico.length > 1 && (
        <details className="tq-c-hist">
          <summary>Histórico ({c.historico.length})</summary>
          <ol>
            {c.historico.map((h, i) => (
              <li key={i}>
                {new Date(h.em).toLocaleDateString('pt-BR')} — {h.acao}
                {h.origem === 'pessoa' ? ' (por você)' : h.origem === 'evidencia' ? ' (por trecho de reunião)' : ''}
              </li>
            ))}
          </ol>
        </details>
      )}
      <Erro texto={erro} />
    </li>
  );
}

function Indisponiveis({ n, nome }: { n: number; nome: string }) {
  return n ? (
    <p className="tq-c-mudo">
      {n} {nome} desta resposta não {n === 1 ? 'está' : 'estão'} mais guardado(s).
    </p>
  ) : null;
}

function CartaoDeCompromissos({ ids, onAbrirFonte }: { ids: string[]; onAbrirFonte: (f: FonteDaResposta) => void }) {
  const { trabalho, carregado } = useTrabalho();
  const versoes = useVersoesDasReunioes();
  if (!carregado) return null;
  const itens = ids.map((id) => trabalho.compromissos.find((c) => c.id === id)).filter((c): c is Compromisso => !!c);
  return (
    <Cartao titulo="Compromissos registrados">
      <ul className="tq-c-lista">
        {itens.map((c) => (
          <ItemDeCompromisso key={c.id} c={c} todos={trabalho.compromissos} versoes={versoes} onAbrirFonte={onAbrirFonte} />
        ))}
      </ul>
      <Indisponiveis n={ids.length - itens.length} nome="compromisso(s)" />
    </Cartao>
  );
}

function CartaoDeSugestoes({
  cartao,
  onAbrirFonte,
}: {
  cartao: Extract<CartaoDaResposta, { tipo: 'sugestoes_de_compromisso' }>;
  onAbrirFonte: (f: FonteDaResposta) => void;
}) {
  const { trabalho } = useTrabalho();
  const versoes = useVersoesDasReunioes();
  const [marcados, setMarcados] = useState<boolean[]>(() => cartao.itens.map(() => true));
  const [estado, setEstado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const jaRegistrado = (descricao: string) =>
    trabalho.compromissos.some((c) => c.chave === chaveDoItem('compromisso', cartao.reuniaoId, descricao));
  const registrar = async () => {
    setErro(null);
    const escolhidos = cartao.itens.filter((_, i) => marcados[i]);
    try {
      const r = await registrarCompromissos(
        escolhidos.map((i) => ({
          descricao: i.descricao,
          responsavel: i.responsavel ? { nome: i.responsavel, confirmado: false } : null,
          prazo: i.prazo ? { texto: i.prazo, ...(i.prazoData ? { data: i.prazoData } : {}) } : null,
          evidencias: i.evidencias,
          ...(cartao.reuniaoId ? { reuniaoId: cartao.reuniaoId } : {}),
        })),
        { origem: 'pessoa' },
      );
      setEstado(
        `Registrado(s): ${r.criados.length}.${r.jaExistiam.length ? ` Já estavam registrados: ${r.jaExistiam.length}.` : ''}`,
      );
    } catch {
      setErro('Não foi possível registrar. Nada foi gravado.');
    }
  };
  return (
    <Cartao titulo="Compromissos sugeridos" selo="Ainda não registrados">
      <ul className="tq-c-lista">
        {cartao.itens.map((item, i) => {
          const registrado = jaRegistrado(item.descricao);
          return (
            <li key={i} className="tq-c-item">
              <label className="tq-c-check">
                <input
                  type="checkbox"
                  checked={registrado || !!marcados[i]}
                  disabled={registrado}
                  onChange={(e) => setMarcados((m) => m.map((v, j) => (j === i ? e.target.checked : v)))}
                />
                <span className="tq-c-titulo">{item.descricao}</span>
              </label>
              <p className="tq-c-meta">
                <span>{item.responsavel ?? 'Sem responsável definido'}</span>
                <span>{item.prazo ?? 'Sem prazo acordado'}</span>
                {registrado && <span className="tq-c-pilula">Registrado</span>}
              </p>
              <p className="tq-c-fontes">
                <Fontes evidencias={item.evidencias} versoes={versoes} onAbrirFonte={onAbrirFonte} />
              </p>
            </li>
          );
        })}
      </ul>
      <div className="tq-c-acoes">
        <button
          type="button"
          disabled={!cartao.itens.some((it, i) => marcados[i] && !jaRegistrado(it.descricao))}
          onClick={() => void registrar()}
        >
          Registrar selecionados
        </button>
      </div>
      {estado && (
        <p className="tq-c-ok" role="status">
          {estado}
        </p>
      )}
      <Erro texto={erro} />
    </Cartao>
  );
}

// ----------------------------------------------------------------- decisões

const ROTULO_DA_DECISAO: Record<Decisao['estado'], string> = {
  confirmada: 'Confirmada',
  proposta: 'Proposta',
  substituida: 'Substituída',
};

export function ItemDeDecisao({
  d,
  todas,
  versoes,
  onAbrirFonte,
}: {
  d: Decisao;
  todas: readonly Decisao[];
  versoes: Versoes;
  onAbrirFonte: (f: FonteDaResposta) => void;
}) {
  const anterior = d.substitui ? todas.find((x) => x.id === d.substitui) : undefined;
  const nova = d.substituidaPor ? todas.find((x) => x.id === d.substituidaPor) : undefined;
  return (
    <li className={`tq-c-item tq-c-decisao-${d.estado}`}>
      <p className="tq-c-titulo">
        {d.assunto}: {d.texto}
      </p>
      <p className="tq-c-meta">
        <span className="tq-c-pilula">{ROTULO_DA_DECISAO[d.estado]}</span>
        <span>{new Date(d.criadoEm).toLocaleDateString('pt-BR')}</span>
      </p>
      {anterior && (
        <p className="tq-c-meta">
          Substitui: “{anterior.texto}”{d.motivo ? ` — motivo: ${d.motivo}` : ''}
        </p>
      )}
      {nova && <p className="tq-c-meta">Substituída por: “{nova.texto}”</p>}
      <p className="tq-c-fontes">
        <Fontes evidencias={d.evidencias} versoes={versoes} onAbrirFonte={onAbrirFonte} />
      </p>
    </li>
  );
}

function CartaoDeDecisoes({ ids, onAbrirFonte }: { ids: string[]; onAbrirFonte: (f: FonteDaResposta) => void }) {
  const { trabalho, carregado } = useTrabalho();
  const versoes = useVersoesDasReunioes();
  if (!carregado) return null;
  const itens = ids.map((id) => trabalho.decisoes.find((d) => d.id === id)).filter((d): d is Decisao => !!d);
  return (
    <Cartao titulo="Decisões">
      <ul className="tq-c-lista">
        {itens.map((d) => (
          <ItemDeDecisao key={d.id} d={d} todas={trabalho.decisoes} versoes={versoes} onAbrirFonte={onAbrirFonte} />
        ))}
      </ul>
      <Indisponiveis n={ids.length - itens.length} nome="decisão(ões)" />
    </Cartao>
  );
}

// ------------------------------------------------------------------ achados

const ROTULO_DO_ACHADO: Record<Achado['estado'], string> = {
  aberto: 'Aberto',
  resolvido: 'Resolvido',
  descartado: 'Descartado',
};

export function ItemDeAchado({
  a,
  versoes,
  onAbrirFonte,
}: {
  a: Achado;
  versoes: Versoes;
  onAbrirFonte: (f: FonteDaResposta) => void;
}) {
  const [acao, setAcao] = useState<Achado['estado'] | null>(null);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const confirmar = async () => {
    if (!acao) return;
    setErro(null);
    const r = await mudarEstadoDoAchado(a.id, a.revisao, { estado: acao, texto: motivo }, { origem: 'pessoa' }).catch(
      () => null,
    );
    if (!r) setErro('Não foi possível gravar. Nada mudou.');
    else if (r.tipo === 'conflito') setErro('O achado mudou em outra tela. Confira e tente de novo.');
    else if (r.tipo === 'invalido') setErro(r.motivo);
    else if (r.tipo === 'inexistente') setErro('Este achado não está mais guardado.');
    else {
      setAcao(null);
      setMotivo('');
    }
  };
  const tipo =
    a.tipo === 'desalinhamento'
      ? a.classificacao === 'possivel'
        ? 'Possível desalinhamento'
        : 'Desalinhamento'
      : a.tipo === 'risco'
        ? 'Risco'
        : 'Lacuna';
  return (
    <li className={`tq-c-item tq-c-achado-${a.estado}`}>
      <p className="tq-c-titulo">{a.assunto}</p>
      <p className="tq-c-meta">
        <span className="tq-c-pilula">{tipo}</span>
        <span className="tq-c-pilula">{ROTULO_DO_ACHADO[a.estado]}</span>
      </p>
      <ul className="tq-c-lados">
        {a.entendimentos.map((e, i) => (
          <li key={i}>
            {e.area && <strong>{e.area}: </strong>}
            {e.texto}{' '}
            <FonteDoCartao e={e.evidencia} versoes={versoes} onAbrirFonte={onAbrirFonte} />
          </li>
        ))}
      </ul>
      {a.impacto && <p className="tq-c-meta">Impacto possível (hipótese): {a.impacto}</p>}
      {a.pergunta && <p className="tq-c-meta">Pergunta sugerida: {a.pergunta}</p>}
      {a.resolucao && <p className="tq-c-meta">Resolução: {a.resolucao.texto}</p>}
      <div className="tq-c-acoes">
        {a.estado === 'aberto' ? (
          <>
            <button type="button" onClick={() => setAcao('resolvido')}>
              Marcar resolvido
            </button>
            <button type="button" onClick={() => setAcao('descartado')}>
              Descartar com motivo
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setAcao('aberto')}>
            Reabrir
          </button>
        )}
      </div>
      {acao && (
        <form
          className="tq-c-motivo"
          onSubmit={(e) => {
            e.preventDefault();
            void confirmar();
          }}
        >
          <label>
            {acao === 'resolvido' ? 'O que resolveu?' : acao === 'descartado' ? 'Por que descartar?' : 'Por que reabrir?'}
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
          </label>
          <button type="submit" disabled={!motivo.trim()}>
            Confirmar
          </button>
          <button type="button" onClick={() => setAcao(null)}>
            Cancelar
          </button>
        </form>
      )}
      <Erro texto={erro} />
    </li>
  );
}

function CartaoDeAchados({ ids, onAbrirFonte }: { ids: string[]; onAbrirFonte: (f: FonteDaResposta) => void }) {
  const { trabalho, carregado } = useTrabalho();
  const versoes = useVersoesDasReunioes();
  if (!carregado) return null;
  const itens = ids.map((id) => trabalho.achados.find((a) => a.id === id)).filter((a): a is Achado => !!a);
  return (
    <Cartao titulo="Achados">
      <ul className="tq-c-lista">
        {itens.map((a) => (
          <ItemDeAchado key={a.id} a={a} versoes={versoes} onAbrirFonte={onAbrirFonte} />
        ))}
      </ul>
      <Indisponiveis n={ids.length - itens.length} nome="achado(s)" />
    </Cartao>
  );
}

// ------------------------------------------------------------------ análise

function CartaoDeAnalise({ id, onAbrirFonte }: { id: string; onAbrirFonte: (f: FonteDaResposta) => void }) {
  const { trabalho, carregado } = useTrabalho();
  const versoes = useVersoesDasReunioes();
  const [editando, setEditando] = useState<{ secao: SecaoDaAnalise; indice: number; texto: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  if (!carregado) return null;
  const a = trabalho.analises.find((x) => x.id === id);
  if (!a)
    return (
      <Cartao titulo="Análise da reunião">
        <p className="tq-c-mudo">Esta análise não está mais guardada (a reunião pode ter sido apagada).</p>
      </Cartao>
    );
  const reuniao = versoes?.get(a.reuniaoId);
  const desatualizada = analiseDesatualizada(a, reuniao?.versao ?? null);
  const salvar = async () => {
    if (!editando) return;
    const r = await corrigirItemDaAnalise(a.id, a.revisao, editando.secao, editando.indice, editando.texto).catch(() => null);
    if (!r || r.tipo !== 'ok')
      setErro(r?.tipo === 'conflito' ? 'A análise mudou em outra tela. Confira e tente de novo.' : 'Não foi possível salvar.');
    else {
      setErro(null);
      setEditando(null);
    }
  };
  return (
    <Cartao
      titulo={`Análise — ${reuniao?.titulo ?? 'reunião indisponível'}`}
      selo={desatualizada ? 'Desatualizada: a transcrição mudou' : undefined}
    >
      <p className="tq-c-meta">
        <span>
          Cobertura: {a.cobertura.lidos} de {a.cobertura.total} segmentos lidos
        </span>
        <span>Revisão {a.revisao}</span>
      </p>
      {a.lacunas.length > 0 && (
        <ul className="tq-c-lacunas">
          {a.lacunas.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
      {SECOES_DA_ANALISE.map((s) => (
        <details key={s} className="tq-c-secao" open={s === 'visaoGeral' || s === 'decisoes'}>
          <summary>
            {TITULO_DA_SECAO[s]} ({a.secoes[s].length})
          </summary>
          {a.secoes[s].length ? (
            <ul className="tq-c-lista">
              {a.secoes[s].map((item, i) => (
                <li key={i} className="tq-c-item">
                  {editando?.secao === s && editando.indice === i ? (
                    <form
                      className="tq-c-motivo"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void salvar();
                      }}
                    >
                      <input
                        aria-label="Texto corrigido"
                        value={editando.texto}
                        onChange={(e) => setEditando({ ...editando, texto: e.target.value })}
                        autoFocus
                      />
                      <button type="submit" disabled={!editando.texto.trim()}>
                        Salvar
                      </button>
                      <button type="button" onClick={() => setEditando(null)}>
                        Cancelar
                      </button>
                    </form>
                  ) : (
                    <p className="tq-c-titulo">
                      {item.texto}
                      {item.corrigido && <span className="tq-c-pilula"> corrigido</span>}{' '}
                      <button type="button" className="tq-c-link" onClick={() => setEditando({ secao: s, indice: i, texto: item.texto })}>
                        Corrigir
                      </button>
                    </p>
                  )}
                  <p className="tq-c-fontes">
                    <Fontes evidencias={item.evidencias} versoes={versoes} onAbrirFonte={onAbrirFonte} />
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="tq-c-mudo">Nada registrado nesta seção.</p>
          )}
        </details>
      ))}
      <Erro texto={erro} />
    </Cartao>
  );
}

// ----------------------------------------------------------------- rascunho

const ROTULO_DO_DESTINATARIO = {
  verificado: 'conferido nos participantes',
  informado: 'endereço informado por você',
  nao_encontrado: 'não encontrado nos participantes',
  ambiguo: 'mais de uma pessoa com esse nome',
} as const;

function CartaoDeRascunho({
  cartao,
  conversaId,
  mensagemId,
  indice,
}: {
  cartao: Extract<CartaoDaResposta, { tipo: 'rascunho_de_mensagem' }>;
  conversaId?: string;
  mensagemId: string;
  indice: number;
}) {
  const [assunto, setAssunto] = useState(cartao.assunto ?? '');
  const [corpo, setCorpo] = useState(cartao.corpo);
  const [salvo, setSalvo] = useState<'salvo' | 'pendente' | 'falhou'>('salvo');
  const alertasVivos = avisosDeExposicao(acharSensiveis(`${assunto}\n${corpo}`));
  const alertas = [...new Set([...cartao.alertas.filter((a) => !a.startsWith('Contém ')), ...alertasVivos])];
  const salvar = async () => {
    if (!conversaId || (assunto === (cartao.assunto ?? '') && corpo === cartao.corpo)) return;
    const ok = await editarRascunhoDaResposta(conversaId, mensagemId, indice, { assunto, corpo }).catch(() => false);
    setSalvo(ok ? 'salvo' : 'falhou');
  };
  const texto = `${assunto ? `Assunto: ${assunto}\n\n` : ''}${corpo}`;
  return (
    <Cartao
      titulo={`Rascunho de ${cartao.canal === 'email' ? 'e-mail' : 'mensagem'}`}
      selo={cartao.publico === 'externo' ? 'Público externo' : 'Interno'}
    >
      {cartao.destinatarios.length > 0 && (
        <ul className="tq-c-destinos" aria-label="Destinatários">
          {cartao.destinatarios.map((d, i) => (
            <li key={i} className={`tq-c-destino tq-c-destino-${d.situacao}`}>
              <strong>{d.nome}</strong>
              {d.endereco && ` <${d.endereco}>`} — {ROTULO_DO_DESTINATARIO[d.situacao]}
              {d.candidatos?.length ? `: ${d.candidatos.join(', ')}` : ''}
            </li>
          ))}
        </ul>
      )}
      {cartao.canal === 'email' && (
        <label className="tq-c-campo">
          Assunto
          <input
            value={assunto}
            onChange={(e) => {
              setAssunto(e.target.value);
              setSalvo('pendente');
            }}
            onBlur={() => void salvar()}
          />
        </label>
      )}
      <label className="tq-c-campo">
        Texto
        <textarea
          rows={Math.min(14, Math.max(5, corpo.split('\n').length + 1))}
          value={corpo}
          onChange={(e) => {
            setCorpo(e.target.value);
            setSalvo('pendente');
          }}
          onBlur={() => void salvar()}
        />
      </label>
      {alertas.length > 0 && (
        <ul className="tq-c-lacunas" aria-label="Alertas">
          {alertas.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      <div className="tq-c-acoes">
        <BotaoCopiar texto={texto} rotulo="Copiar" />
      </div>
      <p className="tq-c-mudo" role="status">
        Nada foi enviado. Quem envia é o Taq, aqui no chat: com a conta do CITi conectada,
        diga “envie”; senão, copie o texto.
        {salvo === 'pendente' ? ' Edição ainda não salva.' : salvo === 'falhou' ? ' A edição não pôde ser salva.' : ''}
      </p>
    </Cartao>
  );
}

// ---------------------------------------------------------------- horários

function CartaoDeEvento({ cartao }: { cartao: Extract<CartaoDaResposta, { tipo: 'sugestao_de_evento' }> }) {
  const detalhes = (o: { rotulo: string }) =>
    [
      cartao.titulo,
      `${o.rotulo} (${cartao.fuso}), ${cartao.duracaoMin} min`,
      cartao.participantes.length ? `Participantes: ${cartao.participantes.join(', ')}` : '',
      cartao.descricao ?? '',
    ]
      .filter(Boolean)
      .join('\n');
  return (
    <Cartao titulo={cartao.titulo} selo="Sugestão de horário — disponibilidade não verificada">
      <p className="tq-c-meta">
        <span>{cartao.duracaoMin} min</span>
        <span>Fuso: {cartao.fuso}</span>
        {cartao.participantes.length > 0 && <span>{cartao.participantes.join(', ')}</span>}
      </p>
      <ul className="tq-c-lista">
        {cartao.opcoes.map((o) => (
          <li key={o.inicio} className="tq-c-item tq-c-opcao">
            <span className="tq-c-titulo">{o.rotulo}</span>
            <span className="tq-c-acoes">
              <a
                className="tq-c-botao-link"
                href={linkDoGoogleAgenda({
                  titulo: cartao.titulo,
                  inicio: o.inicio,
                  fim: o.fim,
                  fuso: cartao.fuso,
                  ...(cartao.descricao ? { descricao: cartao.descricao } : {}),
                })}
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir no Google Agenda
              </a>
              <BotaoCopiar texto={detalhes(o)} rotulo="Copiar detalhes" />
            </span>
          </li>
        ))}
      </ul>
      <p className="tq-c-mudo">
        O link abre o formulário de evento do Google Agenda preenchido, sem convidados. Nada é criado nem enviado
        até você salvar lá.
      </p>
    </Cartao>
  );
}

// ------------------------------------------------------------------ captura

function CartaoDeCaptura({ cartao }: { cartao: Extract<CartaoDaResposta, { tipo: 'estado_da_captura' }> }) {
  return (
    <Cartao titulo={`Captura — ${cartao.titulo}`} selo={ROTULO_DA_SITUACAO[cartao.situacao]}>
      <p className="tq-c-meta">
        <span className="tq-c-pilula">{ROTULO_DA_AVALIACAO[cartao.avaliacao]}</span>
        <span>{cartao.segmentos} segmento(s)</span>
        {cartao.ultimaAtualizacao && (
          <span>Último trecho: {new Date(cartao.ultimaAtualizacao).toLocaleTimeString('pt-BR')}</span>
        )}
      </p>
      {cartao.sinais.length > 0 && (
        <ul className="tq-c-lacunas">
          {cartao.sinais.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      {cartao.intervalos.length > 0 && (
        <p className="tq-c-meta">
          Intervalos sem fala transcrita: {cartao.intervalos.map((i) => `${instante(i.deMs)}–${instante(i.ateMs)}`).join(', ')}
        </p>
      )}
      <p className="tq-c-mudo">
        “Nenhum problema detectado” quer dizer que nenhum contador acusou falha — não que cada palavra foi
        transcrita certo.
      </p>
    </Cartao>
  );
}

// ------------------------------------------------------------ ação externa

const ROTULO_DA_ACAO_EXTERNA = {
  aguardando_confirmacao: 'Aguardando você',
  aceito: 'Aceito pelo Google',
  falhou: 'Não foi feito',
  desconhecido: 'Resultado desconhecido',
} as const;

const NOME_DA_ACAO_EXTERNA = {
  email: 'E-mail',
  evento_criar: 'Evento',
  evento_remarcar: 'Remarcar evento',
  evento_cancelar: 'Cancelar evento',
} as const;

function CartaoDeAcaoExterna({ cartao }: { cartao: Extract<CartaoDaResposta, { tipo: 'acao_externa' }> }) {
  return (
    <Cartao
      titulo={`${NOME_DA_ACAO_EXTERNA[cartao.operacao]} — ${cartao.titulo}`}
      selo={ROTULO_DA_ACAO_EXTERNA[cartao.estado]}
    >
      <ul className="tq-c-lista">
        {cartao.linhas.map((l, i) => (
          <li key={i} className="tq-c-item">
            {l}
          </li>
        ))}
      </ul>
      {cartao.alertas.length > 0 && (
        <ul className="tq-c-lacunas">
          {cartao.alertas.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      {cartao.link && (
        <div className="tq-c-acoes">
          <a href={cartao.link} target="_blank" rel="noreferrer">
            Abrir no Google Agenda
          </a>
        </div>
      )}
      <p className="tq-c-mudo">
        {cartao.estado === 'aguardando_confirmacao'
          ? 'Nada foi enviado. Diga “envie” (ou “pode enviar”) para confirmar.'
          : cartao.estado === 'desconhecido'
            ? 'O Taq não sabe se saiu. Confira antes de pedir de novo: ele não reenvia sozinho.'
            : cartao.estado === 'aceito'
              ? '“Aceito” quer dizer que o Google recebeu o pedido; não que alguém leu ou respondeu.'
              : 'O Google recusou; nada foi enviado nem criado.'}
      </p>
    </Cartao>
  );
}

// ------------------------------------------------------------------ revisão

const ROTULO_DA_FONTE = {
  conferida: 'trecho conferido na fonte',
  alterada: 'trecho não encontrado na fonte atual',
  indisponivel: 'fonte indisponível',
  nao_conferivel: 'não foi possível conferir',
} as const;

function CartaoDeRevisao({
  cartao,
  onAbrirDocumento,
}: {
  cartao: Extract<CartaoDaResposta, { tipo: 'revisao_de_documento' }>;
  onAbrirDocumento: (id: string) => void;
}) {
  return (
    <Cartao titulo={`Revisão — ${cartao.titulo}`}>
      {cartao.problemas.length ? (
        <ul className="tq-c-lista">
          {cartao.problemas.map((p, i) => (
            <li key={i} className={`tq-c-item tq-c-grav-${p.gravidade}`}>
              <span className="tq-c-pilula">{p.gravidade === 'alta' ? 'Alta' : p.gravidade === 'media' ? 'Média' : 'Baixa'}</span>{' '}
              {p.texto}
            </li>
          ))}
        </ul>
      ) : (
        <p className="tq-c-meta">Nenhum problema de estrutura ou de fonte encontrado.</p>
      )}
      {cartao.fontes.length > 0 && (
        <details className="tq-c-secao">
          <summary>Fontes ({cartao.fontes.length})</summary>
          <ul className="tq-c-lista">
            {cartao.fontes.map((f) => (
              <li key={f.numero} className="tq-c-item">
                [{f.numero}] {ROTULO_DA_FONTE[f.situacao]} — {f.texto}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="tq-c-acoes">
        <button type="button" onClick={() => onAbrirDocumento(cartao.documentoId)}>
          Abrir documento
        </button>
      </div>
      <p className="tq-c-mudo">A revisão confere forma e fontes; não diz se o conteúdo está correto.</p>
    </Cartao>
  );
}

// -------------------------------------------------------------------- lista

export function CartoesDoTaq({
  cartoes,
  conversaId,
  mensagemId,
  onAbrirFonte,
  onAbrirDocumento,
}: {
  cartoes: readonly CartaoDaResposta[];
  conversaId?: string;
  mensagemId: string;
  onAbrirFonte: (f: FonteDaResposta) => void;
  onAbrirDocumento: (id: string) => void;
}) {
  return (
    <div className="tq-cartoes">
      {cartoes.map((c, i) => {
        switch (c.tipo) {
          case 'compromissos':
            return <CartaoDeCompromissos key={i} ids={c.ids} onAbrirFonte={onAbrirFonte} />;
          case 'sugestoes_de_compromisso':
            return <CartaoDeSugestoes key={i} cartao={c} onAbrirFonte={onAbrirFonte} />;
          case 'decisoes':
            return <CartaoDeDecisoes key={i} ids={c.ids} onAbrirFonte={onAbrirFonte} />;
          case 'achados':
            return <CartaoDeAchados key={i} ids={c.ids} onAbrirFonte={onAbrirFonte} />;
          case 'analise':
            return <CartaoDeAnalise key={i} id={c.id} onAbrirFonte={onAbrirFonte} />;
          case 'rascunho_de_mensagem':
            return (
              <CartaoDeRascunho key={i} cartao={c} indice={i} mensagemId={mensagemId} {...(conversaId ? { conversaId } : {})} />
            );
          case 'sugestao_de_evento':
            return <CartaoDeEvento key={i} cartao={c} />;
          case 'estado_da_captura':
            return <CartaoDeCaptura key={i} cartao={c} />;
          case 'captura_de_tela':
            return (
              <CartaoDeTela
                key={i}
                cartao={c}
                onAbrirReuniao={(id) =>
                  onAbrirFonte({ ref: '', tipo: 'reuniao', registroId: id, titulo: c.titulo ?? '', trecho: '' })
                }
              />
            );
          case 'acao_externa':
            return <CartaoDeAcaoExterna key={i} cartao={c} />;
          case 'revisao_de_documento':
            return <CartaoDeRevisao key={i} cartao={c} onAbrirDocumento={onAbrirDocumento} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
