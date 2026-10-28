/**
 * A página "Preparar" da HOME: o assistente que vai para TODAS as reuniões.
 *
 * ── Uma configuração, nenhuma reunião específica ──────────────────────────
 *
 * O assistente é um só e se monta ANTES das reuniões (`OQueLevar.tsx`): o
 * Padrão do CITi ou um Personalizado, com os contextos num mapa. Nada é salvo
 * até "Usar este assistente".
 *
 * Até 23/10/2026 a página também preparava UMA reunião (objetivo, o que não
 * pode ficar sem encaminhamento, encontros a retomar). Saiu a pedido do
 * usuário: tudo aqui vale igual para todas as reuniões. O briefing guardado
 * antes continua no storage e indo ao modelo para a reunião dele
 * (`features/conducao/contexto.ts`); só não se cria mais por aqui. Saíram
 * também os textos explicativos que repetiam o que a tela já mostra.
 *
 * Abaixo ficam o que é sobre o assistente como um todo: os ajustes sugeridos
 * pelo retorno dado às sugestões, e o teste numa reunião passada.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { observarConducao, type Conducao } from '@/features/conducao/store';
import { aplicarAjuste, proporAjustes, type PropostaDeAjuste } from '@/features/calibracao/propostas';
import { reproduzirReuniao, type AcaoNoCorte, type RelatorioHistorico } from '@/features/calibracao/historico';
import { observarApoio, registrarDecisaoDeAjuste, type Apoio } from '@/features/apoio/store';
import { criarAdaptadorHttp } from '@/features/taq/modelo';
import type { MeetingRecord, MeetingState } from '@/shared/types/domain';
import { formatDate } from '@/shared/ui/format';
import { OQueLevar, type ReuniaoEmAndamento } from './OQueLevar';
import '@/shared/ui/cartoesDoTaq.css';

function useConducao(): { conducao: Conducao; carregada: boolean } {
  const [estado, setEstado] = useState<{ conducao: Conducao; carregada: boolean }>({
    conducao: { versao: 2, perfil: null, briefings: [], emUso: [] },
    carregada: false,
  });
  useEffect(() => observarConducao((conducao) => setEstado({ conducao, carregada: true })), []);
  return estado;
}

/** A reunião ao vivo, se a captura está de pé (inclusive pausada). */
function emAndamentoDe(m: MeetingState | undefined): ReuniaoEmAndamento | null {
  if (!m?.session) return null;
  if (m.phase !== 'recording' && m.phase !== 'paused' && m.phase !== 'captionsRequired') return null;
  return { reuniaoId: m.session.meetingId, titulo: m.session.title };
}

// ---------------------------------------------------------- ajustes sugeridos

/**
 * "Ajustes sugeridos": o feedback que a pessoa deu sobre as sugestões vira uma
 * proposta específica, mostrando o antes e o depois. Nada muda sozinho: só o
 * botão aplica, e recusar não faz a proposta voltar sem retorno novo.
 */
function AjustesSugeridos({ conducao, apoio }: { conducao: Conducao; apoio: Apoio }) {
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  if (!conducao.perfil || apoio.feedback.length === 0) return null;
  const perfil = conducao.perfil;
  const propostas = proporAjustes({ feedback: apoio.feedback, perfil, decisoes: apoio.ajustes });

  const decidir = async (p: PropostaDeAjuste, aplicar: boolean) => {
    setOcupado(true);
    setAviso('');
    try {
      if (aplicar) {
        const r = await aplicarAjuste(perfil, p);
        if (r.tipo === 'conflito') {
          setAviso('O assistente mudou em outra aba. Confira o que está salvo; a proposta continua aqui se ainda fizer sentido.');
          return;
        }
        if (r.tipo === 'invalido') {
          setAviso(r.motivo);
          return;
        }
        setAviso('Ajuste aplicado: o assistente tem uma nova versão.');
      }
      await registrarDecisaoDeAjuste(p.tipo);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="tq-prep-bloco" aria-labelledby="tq-prep-ajustes">
      <h2 id="tq-prep-ajustes">Ajustes sugeridos</h2>
      {propostas.length === 0 ? (
        <p className="tq-prep-dica">Nenhum ajuste por enquanto.</p>
      ) : (
        propostas.map((p) => (
          <div key={p.tipo} className="tq-prep-ajuste">
            <h3>{p.titulo}</h3>
            <p className="tq-prep-comentario">{p.porque}</p>
            <p className="tq-prep-dica">
              <strong>Hoje:</strong> {p.antes}
              <br />
              <strong>Passaria a:</strong> {p.depois}
            </p>
            <div className="tq-c-acoes">
              <button type="button" className="tq-acao tq-acao-principal" disabled={ocupado} onClick={() => void decidir(p, true)}>
                Aplicar ao meu assistente
              </button>
              <button type="button" className="tq-acao" disabled={ocupado} onClick={() => void decidir(p, false)}>
                Agora não
              </button>
            </div>
          </div>
        ))
      )}
      {aviso && <p className="tq-prep-comentario" role="status">{aviso}</p>}
    </section>
  );
}

// ---------------------------------------------------------- teste histórico

const mmss = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const ROTULO_DA_ACAO: Record<AcaoNoCorte, string> = {
  mostrou: 'Sugeriria',
  silencio: 'Silêncio (o assistente avaliou e não havia o que dizer)',
  esperou: 'Esperou (o orçamento de atenção ou de chamadas não deixou avaliar)',
  erro: 'Erro do provedor',
  sem_orcamento: 'Parou: teto de chamadas do teste',
};

/**
 * "Testar numa reunião passada": reproduz a reunião por cortes de tempo com o seu
 * assistente atual, para ver o que ele teria sugerido. A cada corte só existe o
 * que já tinha sido dito. Envia trechos da reunião ao provedor, por isso só roda
 * quando você clica, e para quando você cancela.
 */
function TesteHistorico({ registros }: { registros: readonly MeetingRecord[] }) {
  const candidatas = useMemo(
    () => [...registros].filter((r) => r.segments.length >= 6).sort((a, b) => b.startedAt - a.startedAt),
    [registros],
  );
  const [id, setId] = useState('');
  const [rodando, setRodando] = useState<{ feito: number; total: number } | null>(null);
  const [relatorio, setRelatorio] = useState<RelatorioHistorico | null>(null);
  const [erro, setErro] = useState('');
  const controle = useRef<AbortController | null>(null);
  const adaptador = useRef(criarAdaptadorHttp());
  const escolhida = candidatas.find((r) => r.id === id) ?? null;

  const reproduzir = async () => {
    if (!escolhida) return;
    controle.current = new AbortController();
    setRelatorio(null);
    setErro('');
    setRodando({ feito: 0, total: 0 });
    try {
      const r = await reproduzirReuniao({
        adaptador: adaptador.current,
        reuniao: { id: escolhida.id, titulo: escolhida.title },
        falas: escolhida.segments,
        sinal: controle.current.signal,
        aoAndar: (feito, total) => setRodando({ feito, total }),
      });
      setRelatorio(r);
    } catch (e) {
      setErro((e as Error)?.message ?? 'Não foi possível reproduzir a reunião.');
    } finally {
      setRodando(null);
    }
  };

  if (!candidatas.length) return null;
  return (
    <section className="tq-prep-bloco" aria-labelledby="tq-prep-historico">
      <h2 id="tq-prep-historico">Testar o assistente numa reunião passada</h2>
      {/* A explicação do método saiu; o aviso de privacidade fica. */}
      <p className="tq-prep-dica">
        <strong>Envia trechos da reunião ao provedor de IA</strong>; só roda quando você clica.
      </p>
      <label className="tq-c-campo">
        Reunião para reproduzir
        <select value={id} disabled={!!rodando} onChange={(e) => setId(e.target.value)}>
          <option value="">Escolha uma reunião…</option>
          {candidatas.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title} — {formatDate(r.startedAt)}
            </option>
          ))}
        </select>
      </label>
      <div className="tq-c-acoes">
        <button type="button" className="tq-acao" disabled={!escolhida || !!rodando} onClick={() => void reproduzir()}>
          {rodando ? `Reproduzindo… ${rodando.feito}${rodando.total ? ` de ${rodando.total}` : ''}` : 'Reproduzir'}
        </button>
        {rodando && (
          <button type="button" className="tq-acao" onClick={() => controle.current?.abort()}>
            Cancelar
          </button>
        )}
      </div>
      {erro && <p className="tq-aviso" role="alert">{erro}</p>}
      {relatorio && (
        <div className="tq-prep-relatorio" aria-label="Relatório do teste">
          <p className="tq-prep-comentario">
            {relatorio.avaliacoes} {relatorio.avaliacoes === 1 ? 'avaliação' : 'avaliações'}, {relatorio.sugestoesMostradas}{' '}
            {relatorio.sugestoesMostradas === 1 ? 'sugestão que apareceria' : 'sugestões que apareceriam'}
            {relatorio.erros ? `, ${relatorio.erros} com erro` : ''}.
            {relatorio.paradoPeloTeto ? ' O teste parou no teto de chamadas: o resto da reunião não foi avaliado.' : ''}
            {relatorio.fontesValidas ? ' Todas as fontes citadas existiam no corte.' : ' Atenção: alguma fonte citada não existia no corte.'}
          </p>
          <ol className="tq-prep-linhas">
            {relatorio.linhas.map((l) => (
              <li key={l.noInstanteMs} className={`tq-prep-linha tq-prep-${l.acao}`}>
                <span className="tq-prep-instante">{mmss(l.noInstanteMs)}</span> — {ROTULO_DA_ACAO[l.acao]}
                {l.sugestao && (
                  <blockquote className="tq-apoio-pergunta">
                    {l.sugestao.pergunta ? `“${l.sugestao.pergunta}”` : l.sugestao.texto}
                    <span className="tq-apoio-aviso">
                      sobre “{l.sugestao.ponto}” · fala{l.sugestao.falasCitadas.length > 1 ? 's' : ''}{' '}
                      {l.sugestao.falasCitadas.map((n) => n + 1).join(', ')} · o assistente tinha lido até a fala {l.falasConsolidadas}
                    </span>
                  </blockquote>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------- página

export function PaginaPreparar({
  registros,
  reuniao,
}: {
  registros: readonly MeetingRecord[];
  /** O estado da reunião ao vivo: com uma em andamento, a tela avisa que a mudança vale para a próxima. */
  reuniao?: MeetingState;
}) {
  const { conducao, carregada } = useConducao();
  const [apoio, setApoio] = useState<Apoio>({ versao: 1, sugestoes: [], feedback: [], pausadas: {}, medicoes: {}, ajustes: {} });
  useEffect(() => observarApoio(setApoio), []);
  return (
    <div className="tq-pagina tq-prep">
      <header className="tq-pagina-topo">
        <h1>Preparar</h1>
      </header>
      {!carregada ? (
        <p className="tq-prep-dica" role="status">Carregando…</p>
      ) : (
        <>
          <OQueLevar conducao={conducao} emAndamento={emAndamentoDe(reuniao)} />
          <AjustesSugeridos conducao={conducao} apoio={apoio} />
          {conducao.perfil && <TesteHistorico registros={registros} />}
        </>
      )}
    </div>
  );
}
