/**
 * A página "Acompanhamento" da HOME: os compromissos, as decisões e os achados
 * guardados — a mesma fonte (`taq:trabalho`) que os cartões do Taq mostram.
 *
 * Os itens são os mesmos componentes dos cartões, com os mesmos botões e as
 * mesmas operações: concluir aqui aparece concluído na conversa, e vice-versa.
 * Nada aqui chama modelo.
 *
 * ── Três abas, e o "Novo" na ponta ───────────────────────────────────────
 *
 * Uma lista de cada vez, com a contagem no nome da aba. Registrar não depende
 * mais só da conversa: "Novo" abre um formulário curto no topo da lista, no
 * mesmo lugar onde o item vai aparecer. O que nasce à mão fica marcado como
 * da pessoa no histórico do item, sem trecho de reunião — ninguém o inventou.
 *
 * Excluir confirma NO LUGAR do item, sem modal: é o que deixa óbvio qual
 * registro está prestes a sumir.
 */
import { useMemo, useState } from 'react';
import type { FonteDaResposta } from './conversations';
import {
  excluirDoTrabalho,
  guardarAchado,
  registrarCompromissos,
  registrarDecisao,
  situacaoDoPrazo,
  type ListaDoTrabalho,
} from '@/features/trabalho/store';
import { useTrabalho, useVersoesDasReunioes } from '@/features/trabalho/useTrabalho';
import { ItemDeAchado, ItemDeCompromisso, ItemDeDecisao } from '@/shared/ui/CartoesDoTaq';
import { Icon } from '@/shared/ui/Icon';
import '@/shared/ui/cartoesDoTaq.css';

type FiltroDeCompromisso = 'abertos' | 'a_confirmar' | 'todos';

const ABAS: ReadonlyArray<readonly [ListaDoTrabalho, string]> = [
  ['compromissos', 'Compromissos'],
  ['decisoes', 'Decisões'],
  ['achados', 'Achados'],
];

function normal(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function PaginaAcompanhamento({ onAbrirFonte }: { onAbrirFonte: (f: FonteDaResposta) => void }) {
  const { trabalho, carregado } = useTrabalho();
  const versoes = useVersoesDasReunioes();
  const [aba, setAba] = useState<ListaDoTrabalho>('compromissos');
  const [filtro, setFiltro] = useState<FiltroDeCompromisso>('abertos');
  const [pessoa, setPessoa] = useState('');
  const [todasAsDecisoes, setTodasAsDecisoes] = useState(false);
  const [todosOsAchados, setTodosOsAchados] = useState(false);
  const [novoAberto, setNovoAberto] = useState(false);
  const [excluindo, setExcluindo] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const hoje = new Intl.DateTimeFormat('en-CA').format(new Date());

  const compromissos = useMemo(
    () =>
      trabalho.compromissos
        .filter((c) =>
          filtro === 'todos'
            ? true
            : filtro === 'abertos'
              ? c.estado === 'aberto'
              : situacaoDoPrazo(c, hoje) === 'prazo_passou_a_confirmar',
        )
        .filter((c) => !pessoa.trim() || normal(c.responsavel?.nome ?? '').includes(normal(pessoa.trim()))),
    [trabalho.compromissos, filtro, pessoa, hoje],
  );
  const decisoes = trabalho.decisoes.filter((d) => todasAsDecisoes || d.estado !== 'substituida');
  const achados = trabalho.achados.filter((a) => todosOsAchados || a.estado === 'aberto');

  if (!carregado) return <div className="tq-pagina" aria-busy="true" />;

  const contagem: Record<ListaDoTrabalho, number> = {
    compromissos: trabalho.compromissos.filter((c) => c.estado === 'aberto').length,
    decisoes: trabalho.decisoes.filter((d) => d.estado !== 'substituida').length,
    achados: trabalho.achados.filter((a) => a.estado === 'aberto').length,
  };

  const trocarAba = (nova: ListaDoTrabalho) => {
    setAba(nova);
    setNovoAberto(false);
    setExcluindo(null);
    setErro('');
  };

  /** O item, com a lixeira — ou, no lugar dele, a pergunta de excluir. */
  const linha = (id: string, rotulo: string, item: React.ReactNode) =>
    excluindo === id ? (
      <div key={id} className="tq-acomp-confirma" role="alertdialog" aria-label={`Excluir "${rotulo}"?`}>
        <p>
          Excluir &ldquo;{rotulo}&rdquo;? Sai do acompanhamento deste computador. A reunião de
          origem não é afetada.
        </p>
        <div className="tq-acoes">
          <button
            type="button"
            className="tq-acao tq-acao-perigo"
            onClick={() =>
              void excluirDoTrabalho(aba, id)
                .then(() => setExcluindo(null))
                .catch(() => setErro('Não foi possível excluir.'))
            }
          >
            Excluir
          </button>
          <button type="button" className="tq-acao" onClick={() => setExcluindo(null)}>
            Cancelar
          </button>
        </div>
      </div>
    ) : (
      <div key={id} className="tq-acomp-linha">
        <ul className="tq-c-lista">{item}</ul>
        <button
          type="button"
          className="tq-acomp-lixo"
          title={`Excluir "${rotulo}"`}
          aria-label={`Excluir "${rotulo}"`}
          onClick={() => {
            setNovoAberto(false);
            setExcluindo(id);
          }}
        >
          <Icon name="trash" size={15} />
        </button>
      </div>
    );

  return (
    <div className="tq-pagina tq-acompanhamento">
      <header className="tq-pagina-topo">
        <h1>Acompanhamento</h1>
        <p>O que saiu das reuniões e precisa de alguém. Registre aqui com “Novo”, ou peça ao Taq na conversa.</p>
      </header>

      <div className="tq-acomp-abas" role="tablist" aria-label="O que acompanhar">
        {ABAS.map(([id, nome]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={aba === id}
            onClick={() => trocarAba(id)}
          >
            {nome}
            <span className="tq-acomp-conta">{contagem[id]}</span>
          </button>
        ))}
        <button
          type="button"
          className="tq-acomp-novo"
          aria-expanded={novoAberto}
          onClick={() => {
            setExcluindo(null);
            setNovoAberto((v) => !v);
          }}
        >
          <Icon name="plus" size={14} />
          Novo
        </button>
      </div>

      {erro && <p role="alert">{erro}</p>}
      {novoAberto && (
        <FormularioNovo
          aba={aba}
          onFeito={() => setNovoAberto(false)}
          onErro={setErro}
        />
      )}

      {aba === 'compromissos' && (
        <section className="tq-c" aria-label="Compromissos">
          <div className="tq-c-acoes" role="group" aria-label="Filtrar compromissos">
            {(
              [
                ['abertos', 'Abertos'],
                ['a_confirmar', 'Prazo passou — a confirmar'],
                ['todos', 'Todos'],
              ] as const
            ).map(([id, rotulo]) => (
              <button key={id} type="button" aria-pressed={filtro === id} onClick={() => setFiltro(id)}>
                {rotulo}
              </button>
            ))}
            <label className="tq-c-campo tq-acomp-pessoa">
              Responsável
              <input value={pessoa} onChange={(e) => setPessoa(e.target.value)} placeholder="Nome" />
            </label>
          </div>
          {compromissos.length ? (
            <div className="tq-acomp-lista">
              {compromissos.map((c) =>
                linha(
                  c.id,
                  c.descricao,
                  <ItemDeCompromisso c={c} todos={trabalho.compromissos} versoes={versoes} onAbrirFonte={onAbrirFonte} />,
                ),
              )}
            </div>
          ) : (
            <p className="tq-c-mudo">
              {trabalho.compromissos.length
                ? 'Nenhum compromisso com esse filtro.'
                : 'Nenhum compromisso registrado ainda. Use “Novo” para registrar um.'}
            </p>
          )}
        </section>
      )}

      {aba === 'decisoes' && (
        <section className="tq-c" aria-label="Decisões">
          <label className="tq-c-check">
            <input type="checkbox" checked={todasAsDecisoes} onChange={(e) => setTodasAsDecisoes(e.target.checked)} />
            <span>Mostrar também as substituídas</span>
          </label>
          {decisoes.length ? (
            <div className="tq-acomp-lista">
              {decisoes.map((d) =>
                linha(
                  d.id,
                  d.texto,
                  <ItemDeDecisao d={d} todas={trabalho.decisoes} versoes={versoes} onAbrirFonte={onAbrirFonte} />,
                ),
              )}
            </div>
          ) : (
            <p className="tq-c-mudo">Nenhuma decisão registrada.</p>
          )}
        </section>
      )}

      {aba === 'achados' && (
        <section className="tq-c" aria-label="Achados">
          <label className="tq-c-check">
            <input type="checkbox" checked={todosOsAchados} onChange={(e) => setTodosOsAchados(e.target.checked)} />
            <span>Mostrar também os resolvidos e descartados</span>
          </label>
          {achados.length ? (
            <div className="tq-acomp-lista">
              {achados.map((a) =>
                linha(a.id, a.assunto, <ItemDeAchado a={a} versoes={versoes} onAbrirFonte={onAbrirFonte} />),
              )}
            </div>
          ) : (
            <p className="tq-c-mudo">Nenhum achado aberto.</p>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * Registrar à mão. Os campos são os que a lista mostra, e nada é obrigatório
 * além do principal: um compromisso sem responsável continua "sem responsável",
 * nunca preenchido por suposição.
 */
function FormularioNovo({
  aba,
  onFeito,
  onErro,
}: {
  aba: ListaDoTrabalho;
  onFeito: () => void;
  onErro: (mensagem: string) => void;
}) {
  const [principal, setPrincipal] = useState('');
  const [segundo, setSegundo] = useState('');
  const [terceiro, setTerceiro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const pessoa = { origem: 'pessoa' as const };

  const campos: Record<ListaDoTrabalho, [string, string?, string?]> = {
    compromissos: ['O que precisa ser feito', 'Quem', 'Até quando, ex.: sex, 09/10'],
    decisoes: ['O que foi decidido', 'Sobre o quê (opcional)'],
    achados: ['O desencontro', 'Pergunta para destravar (opcional)'],
  };
  const [p1, p2, p3] = campos[aba];

  const salvar = async () => {
    const texto = principal.trim();
    if (!texto || salvando) return;
    setSalvando(true);
    onErro('');
    try {
      if (aba === 'compromissos') {
        await registrarCompromissos(
          [
            {
              descricao: texto,
              responsavel: segundo.trim() ? { nome: segundo.trim(), confirmado: true } : null,
              prazo: terceiro.trim() ? { texto: terceiro.trim() } : null,
              evidencias: [],
            },
          ],
          pessoa,
        );
      } else if (aba === 'decisoes') {
        const r = await registrarDecisao(
          { assunto: segundo.trim() || texto, texto, estado: 'confirmada', evidencias: [] },
          pessoa,
        );
        if (r.tipo === 'invalido') throw new Error(r.motivo);
      } else {
        await guardarAchado(
          {
            tipo: 'desalinhamento',
            assunto: texto,
            entendimentos: [],
            classificacao: 'possivel',
            ...(segundo.trim() ? { pergunta: segundo.trim() } : {}),
          },
          pessoa,
        );
      }
      onFeito();
    } catch {
      onErro('Não foi possível registrar neste computador.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <form
      className="tq-acomp-form"
      data-tq-escrita
      onSubmit={(e) => {
        e.preventDefault();
        void salvar();
      }}
    >
      <input
        className="principal"
        autoFocus
        value={principal}
        placeholder={p1}
        aria-label={p1}
        onChange={(e) => setPrincipal(e.target.value)}
      />
      {p2 && <input value={segundo} placeholder={p2} aria-label={p2} onChange={(e) => setSegundo(e.target.value)} />}
      {p3 && <input value={terceiro} placeholder={p3} aria-label={p3} onChange={(e) => setTerceiro(e.target.value)} />}
      <div className="tq-acoes">
        <button type="submit" className="tq-acao tq-acao-principal" disabled={!principal.trim() || salvando}>
          Salvar
        </button>
        <button type="button" className="tq-acao" onClick={onFeito}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
