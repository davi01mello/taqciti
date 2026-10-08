/**
 * A página "Preparar" da HOME: como a pessoa quer conduzir as reuniões e o que
 * quer alcançar em cada uma.
 *
 * ── Duas partes, uma ordem ────────────────────────────────────────────────
 *
 * 1. O PERFIL ("Como você quer conduzir suas reuniões?"): a pessoa conta com as
 *    próprias palavras, o Taq organiza num resumo, e ela corrige e aprova. O
 *    resumo também se escreve à mão: a preparação não depende de a IA estar de
 *    pé. Nada é salvo até "Usar este assistente".
 * 2. O BRIEFING de uma reunião: o objetivo, o contexto e o que não pode ficar
 *    sem encaminhamento. O objetivo é da pessoa; o título da reunião não vira
 *    objetivo.
 *
 * O que está salvo vem do storage (`features/conducao/store.ts`), com a revisão
 * que a tela leu: se outra aba mudou, o salvar volta como conflito e a tela
 * diz, em vez de sobrescrever.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  atualizarPerfilDoBriefing,
  briefingDaReuniao,
  conteudoDe,
  MODOS_DE_INTERVENCAO,
  observarConducao,
  ROTULO_DO_MODO,
  salvarBriefing,
  salvarPerfil,
  type Conducao,
  type ConteudoDoPerfil,
  type ModoDeIntervencao,
} from '@/features/conducao/store';
import { proporPerfil } from '@/features/conducao/proposta';
import { useTrabalho } from '@/features/trabalho/useTrabalho';
import { criarAdaptadorHttp } from '@/features/taq/modelo';
import type { MeetingRecord } from '@/shared/types/domain';
import { formatDate } from '@/shared/ui/format';
import { Icon } from '@/shared/ui/Icon';
import '@/shared/ui/cartoesDoTaq.css';

const VAZIO: ConteudoDoPerfil = {
  missao: '',
  observar: [],
  intervencao: { modo: 'discreto', estilo: '' },
  contexto: [],
  preferencias: [],
};

const linhas = (t: string): string[] => t.split('\n');
const comoTexto = (l: readonly string[]): string => l.join('\n');

function useConducao(): { conducao: Conducao; carregada: boolean } {
  const [estado, setEstado] = useState<{ conducao: Conducao; carregada: boolean }>({
    conducao: { versao: 1, perfil: null, briefings: [] },
    carregada: false,
  });
  useEffect(() => observarConducao((conducao) => setEstado({ conducao, carregada: true })), []);
  return estado;
}

// ------------------------------------------------------------------- perfil

function PerfilDeConducao({ conducao }: { conducao: Conducao }) {
  const salvo = conducao.perfil;
  const [texto, setTexto] = useState('');
  const [rascunho, setRascunho] = useState<ConteudoDoPerfil>(salvo ? conteudoDe(salvo) : VAZIO);
  const [campos, setCampos] = useState(() => camposDe(salvo ? conteudoDe(salvo) : VAZIO));
  const [fase, setFase] = useState<'ocioso' | 'organizando' | 'salvando'>('ocioso');
  const [aviso, setAviso] = useState('');
  const [comentario, setComentario] = useState('');
  const [editado, setEditado] = useState(false);
  const adaptador = useRef(criarAdaptadorHttp());

  // Perfil salvo em outra aba (ou depois de salvar): a tela segue o que está
  // guardado, a menos que a pessoa esteja no meio de uma edição.
  useEffect(() => {
    if (editado) return;
    const base = salvo ? conteudoDe(salvo) : VAZIO;
    setRascunho(base);
    setCampos(camposDe(base));
  }, [salvo?.revisao]); // eslint-disable-line react-hooks/exhaustive-deps

  const mudar = (p: Partial<typeof campos>) => {
    const novo = { ...campos, ...p };
    setCampos(novo);
    setRascunho({
      missao: novo.missao,
      observar: linhas(novo.observar),
      intervencao: { modo: novo.modo, estilo: novo.estilo },
      contexto: linhas(novo.contexto),
      preferencias: linhas(novo.preferencias),
    });
    setEditado(true);
    setAviso('');
  };

  const organizar = async () => {
    setFase('organizando');
    setAviso('');
    setComentario('');
    const r = await proporPerfil({
      texto,
      atual: rascunho.missao.trim() ? rascunho : (salvo ? conteudoDe(salvo) : null),
      adaptador: adaptador.current,
    });
    setFase('ocioso');
    if (r.tipo === 'ok') {
      setRascunho(r.proposta);
      setCampos(camposDe(r.proposta));
      setEditado(true);
      setComentario(r.comentario);
    } else if (r.tipo === 'sem_proposta') {
      setComentario(r.comentario || 'Não consegui organizar isso. Conte um pouco mais, ou escreva o resumo à mão.');
    } else {
      setAviso(`${r.mensagem} Você pode escrever o resumo à mão.`);
    }
  };

  const usar = async () => {
    setFase('salvando');
    const r = await salvarPerfil(rascunho, salvo?.revisao ?? 0);
    setFase('ocioso');
    if (r.tipo === 'ok') {
      setEditado(false);
      setAviso('');
      setComentario('Pronto: este é o seu assistente.');
    } else if (r.tipo === 'conflito') {
      setAviso('O perfil mudou em outra aba. Confira o que está salvo e salve de novo, se ainda fizer sentido.');
      setEditado(false);
    } else {
      setAviso(r.motivo);
    }
  };

  return (
    <section className="tq-prep-bloco" aria-labelledby="tq-prep-perfil">
      <h2 id="tq-prep-perfil">Como você quer conduzir suas reuniões?</h2>
      <label className="tq-c-campo">
        Conte com suas palavras: que reuniões você conduz, o que precisa alcançar e em que quer ajuda
        <textarea
          rows={4}
          value={texto}
          maxLength={4000}
          placeholder="Ex.: Conduzo reuniões de descoberta. Quero entender a necessidade real antes de falar de funcionalidades. Costumo esquecer de perguntar sobre impacto. Prefiro perguntas curtas, sem interromper toda hora."
          onChange={(e) => setTexto(e.target.value)}
        />
      </label>
      <div className="tq-c-acoes">
        <button
          type="button"
          className="tq-acao"
          disabled={fase !== 'ocioso' || !texto.trim()}
          onClick={() => void organizar()}
        >
          <Icon name="sparkles" size={15} />
          {fase === 'organizando' ? 'Organizando…' : 'Organizar o que entendi'}
        </button>
      </div>
      {comentario && <p className="tq-prep-comentario" role="status">{comentario}</p>}

      <h3>O que o Taq entendeu</h3>
      <p className="tq-prep-dica">Corrija qualquer frase. Nada vale até você usar este assistente.</p>
      <label className="tq-c-campo">
        Em que vou ajudar
        <input value={campos.missao} maxLength={400} onChange={(e) => mudar({ missao: e.target.value })} />
      </label>
      <label className="tq-c-campo">
        O que vou observar (um por linha)
        <textarea rows={3} value={campos.observar} onChange={(e) => mudar({ observar: e.target.value })} />
      </label>
      <fieldset className="tq-prep-modos">
        <legend>Como vou intervir</legend>
        {MODOS_DE_INTERVENCAO.map((m) => (
          <label key={m}>
            <input
              type="radio"
              name="tq-prep-modo"
              checked={campos.modo === m}
              onChange={() => mudar({ modo: m })}
            />
            {ROTULO_DO_MODO[m]}
          </label>
        ))}
      </fieldset>
      <label className="tq-c-campo">
        O jeito, em suas palavras
        <input value={campos.estilo} maxLength={200} onChange={(e) => mudar({ estilo: e.target.value })} />
      </label>
      <label className="tq-c-campo">
        Que contexto vou usar (um por linha)
        <textarea rows={2} value={campos.contexto} onChange={(e) => mudar({ contexto: e.target.value })} />
      </label>
      <label className="tq-c-campo">
        Meu jeito de trabalhar (um por linha)
        <textarea rows={2} value={campos.preferencias} onChange={(e) => mudar({ preferencias: e.target.value })} />
      </label>

      {aviso && <p className="tq-aviso" role="alert">{aviso}</p>}
      <div className="tq-c-acoes">
        <button
          type="button"
          className="tq-acao tq-acao-principal"
          disabled={fase !== 'ocioso' || !rascunho.missao.trim() || (!editado && !!salvo)}
          onClick={() => void usar()}
        >
          <Icon name="check" size={15} />
          {fase === 'salvando' ? 'Salvando…' : 'Usar este assistente'}
        </button>
        {salvo && (
          <span className="tq-prep-dica">
            Salvo (versão {salvo.revisao}). Reuniões já preparadas continuam com a versão que usavam.
          </span>
        )}
      </div>
    </section>
  );
}

function camposDe(c: ConteudoDoPerfil) {
  return {
    missao: c.missao,
    observar: comoTexto(c.observar),
    modo: c.intervencao.modo as ModoDeIntervencao,
    estilo: c.intervencao.estilo,
    contexto: comoTexto(c.contexto),
    preferencias: comoTexto(c.preferencias),
  };
}

// ----------------------------------------------------------------- briefing

function BriefingDaReuniao({
  reuniao,
  conducao,
  outras,
}: {
  reuniao: MeetingRecord;
  conducao: Conducao;
  /** Os outros encontros, para a pessoa escolher de quais retomar. */
  outras: readonly MeetingRecord[];
}) {
  const salvo = briefingDaReuniao(conducao, reuniao.id);
  const { trabalho } = useTrabalho();
  const [objetivo, setObjetivo] = useState(salvo?.objetivo ?? '');
  const [contexto, setContexto] = useState(salvo?.contexto ?? '');
  const [prioridades, setPrioridades] = useState(comoTexto(salvo?.prioridades ?? []));
  const [retomar, setRetomar] = useState<string[]>(salvo?.retomar ?? []);
  /** '' = o mesmo do meu assistente. */
  const [modo, setModo] = useState<ModoDeIntervencao | ''>(salvo?.modo ?? '');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  // Trocou de reunião: a tela passa a mostrar o que está guardado para ela.
  useEffect(() => {
    setObjetivo(salvo?.objetivo ?? '');
    setContexto(salvo?.contexto ?? '');
    setPrioridades(comoTexto(salvo?.prioridades ?? []));
    setRetomar(salvo?.retomar ?? []);
    setModo(salvo?.modo ?? '');
    setAviso('');
  }, [reuniao.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const abertosDe = (id: string) =>
    trabalho.compromissos.filter((c) => c.reuniaoId === id && c.estado === 'aberto' && c.situacao !== 'candidato').length;
  const alternarRetomar = (id: string) =>
    setRetomar((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));

  const salvar = async () => {
    setOcupado(true);
    const r = await salvarBriefing(
      reuniao.id,
      { objetivo, contexto, prioridades: linhas(prioridades), retomar, modo: modo || null },
      salvo?.revisao ?? 0,
    );
    setOcupado(false);
    setAviso(
      r.tipo === 'ok'
        ? 'Preparação salva.'
        : r.tipo === 'conflito'
          ? 'Esta preparação mudou em outra aba. Confira o que está salvo e salve de novo.'
          : r.motivo,
    );
  };

  const perfilAtual = conducao.perfil?.revisao ?? null;
  const desatualizado = !!salvo && salvo.perfilRevisao !== perfilAtual;

  return (
    <div className="tq-prep-briefing">
      <label className="tq-c-campo">
        O resultado que queremos alcançar
        <textarea
          rows={2}
          value={objetivo}
          maxLength={400}
          placeholder="Ex.: Decidir se o piloto começa com uma ou duas unidades."
          onChange={(e) => setObjetivo(e.target.value)}
        />
      </label>
      <label className="tq-c-campo">
        O que já sabemos
        <textarea rows={3} value={contexto} maxLength={800} onChange={(e) => setContexto(e.target.value)} />
      </label>
      <label className="tq-c-campo">
        O que não pode ficar sem encaminhamento (um por linha)
        <textarea rows={3} value={prioridades} onChange={(e) => setPrioridades(e.target.value)} />
      </label>
      {conducao.perfil && (
        <label className="tq-c-campo">
          Como o Taq ajuda nesta reunião
          <select value={modo} onChange={(e) => setModo(e.target.value as ModoDeIntervencao | '')}>
            <option value="">O mesmo do meu assistente ({ROTULO_DO_MODO[conducao.perfil.intervencao.modo]})</option>
            {MODOS_DE_INTERVENCAO.map((m) => (
              <option key={m} value={m}>
                Só nesta reunião: {ROTULO_DO_MODO[m]}
              </option>
            ))}
          </select>
        </label>
      )}
      {outras.length > 0 && (
        <fieldset className="tq-prep-modos">
          <legend>Retomar de encontros anteriores</legend>
          <p className="tq-prep-dica">
            Só entram os que você marcar: o Taq não liga encontros por nome nem por semelhança. Ele leva os combinados
            em aberto e as decisões desses encontros, com data e fonte.
          </p>
          {outras.slice(0, 12).map((o) => (
            <label key={o.id}>
              <input type="checkbox" checked={retomar.includes(o.id)} onChange={() => alternarRetomar(o.id)} />
              {o.title} — {formatDate(o.startedAt)}
              {abertosDe(o.id) > 0 ? ` (${abertosDe(o.id)} em aberto)` : ''}
            </label>
          ))}
        </fieldset>
      )}
      <div className="tq-c-acoes">
        <button type="button" className="tq-acao tq-acao-principal" disabled={ocupado} onClick={() => void salvar()}>
          <Icon name="check" size={15} />
          {ocupado ? 'Salvando…' : 'Salvar a preparação'}
        </button>
        {salvo && !salvo.aprovado && (
          <span className="tq-prep-dica">Sem objetivo informado: o Taq não vai supor um.</span>
        )}
      </div>
      {desatualizado && salvo && (
        <p className="tq-prep-dica">
          Esta reunião usa uma versão anterior do seu assistente.{' '}
          <button
            type="button"
            className="tq-acao"
            onClick={() =>
              void atualizarPerfilDoBriefing(reuniao.id, salvo.revisao).then((r) =>
                setAviso(r.tipo === 'ok' ? 'Agora usa a versão atual do assistente.' : 'Algo mudou; tente de novo.'),
              )
            }
          >
            Usar a versão atual
          </button>
        </p>
      )}
      {aviso && <p className="tq-prep-comentario" role="status">{aviso}</p>}
    </div>
  );
}

function PreparoDeReuniao({ registros, conducao }: { registros: readonly MeetingRecord[]; conducao: Conducao }) {
  const ordenadas = useMemo(() => [...registros].sort((a, b) => b.startedAt - a.startedAt), [registros]);
  const [id, setId] = useState('');
  const escolhida = ordenadas.find((r) => r.id === id) ?? null;
  return (
    <section className="tq-prep-bloco" aria-labelledby="tq-prep-reuniao">
      <h2 id="tq-prep-reuniao">Preparar uma reunião</h2>
      {!ordenadas.length ? (
        <p className="tq-prep-dica">
          Ainda não há reuniões neste computador. Quando houver, escolha uma aqui para dizer o que quer alcançar.
        </p>
      ) : (
        <>
          <label className="tq-c-campo">
            Reunião
            <select value={id} onChange={(e) => setId(e.target.value)}>
              <option value="">Escolha uma reunião…</option>
              {ordenadas.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} — {formatDate(r.startedAt)}
                  {briefingDaReuniao(conducao, r.id) ? ' (preparada)' : ''}
                </option>
              ))}
            </select>
          </label>
          {escolhida && (
            <BriefingDaReuniao
              reuniao={escolhida}
              conducao={conducao}
              outras={ordenadas.filter((r) => r.id !== escolhida.id && r.startedAt <= escolhida.startedAt)}
            />
          )}
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------- página

export function PaginaPreparar({ registros }: { registros: readonly MeetingRecord[] }) {
  const { conducao, carregada } = useConducao();
  return (
    <div className="tq-pagina tq-prep">
      <header className="tq-pagina-topo">
        <h1>Preparar</h1>
        <p>Diga como quer ser ajudado e o que quer alcançar. O Taq sugere, em privado; quem conduz é você.</p>
      </header>
      {!carregada ? (
        <p className="tq-prep-dica" role="status">Carregando…</p>
      ) : (
        <>
          <PerfilDeConducao conducao={conducao} />
          <PreparoDeReuniao registros={registros} conducao={conducao} />
        </>
      )}
    </div>
  );
}
