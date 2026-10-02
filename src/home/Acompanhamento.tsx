/**
 * A página "Acompanhamento" da HOME: os compromissos, as decisões e os achados
 * guardados — a mesma fonte (`taq:trabalho`) que os cartões do Taq mostram.
 *
 * Os itens são os mesmos componentes dos cartões, com os mesmos botões e as
 * mesmas operações: concluir aqui aparece concluído na conversa, e vice-versa.
 * Nada aqui chama modelo. Registrar é pela conversa com o Taq ("registre os
 * próximos passos da reunião X") ou pelo botão do cartão de sugestões.
 */
import { useMemo, useState } from 'react';
import type { FonteDaResposta } from './conversations';
import { situacaoDoPrazo } from '@/features/trabalho/store';
import { useTrabalho, useVersoesDasReunioes } from '@/features/trabalho/useTrabalho';
import { ItemDeAchado, ItemDeCompromisso, ItemDeDecisao } from '@/shared/ui/CartoesDoTaq';
import '@/shared/ui/cartoesDoTaq.css';

type FiltroDeCompromisso = 'abertos' | 'a_confirmar' | 'todos';

function normal(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function PaginaAcompanhamento({ onAbrirFonte }: { onAbrirFonte: (f: FonteDaResposta) => void }) {
  const { trabalho, carregado } = useTrabalho();
  const versoes = useVersoesDasReunioes();
  const [filtro, setFiltro] = useState<FiltroDeCompromisso>('abertos');
  const [pessoa, setPessoa] = useState('');
  const [todasAsDecisoes, setTodasAsDecisoes] = useState(false);
  const [todosOsAchados, setTodosOsAchados] = useState(false);
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

  return (
    <div className="tq-pagina tq-acompanhamento">
      <header className="tq-pagina-topo">
        <h1>Acompanhamento</h1>
        <p>
          Compromissos, decisões e achados guardados neste computador. Para registrar, peça ao Taq na conversa —
          por exemplo, “registre os próximos passos da reunião de ontem”.
        </p>
      </header>

      <section className="tq-c" aria-labelledby="tq-acomp-compromissos">
        <header className="tq-c-cab">
          <h4 id="tq-acomp-compromissos">Compromissos ({compromissos.length})</h4>
        </header>
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
          <ul className="tq-c-lista">
            {compromissos.map((c) => (
              <ItemDeCompromisso key={c.id} c={c} todos={trabalho.compromissos} versoes={versoes} onAbrirFonte={onAbrirFonte} />
            ))}
          </ul>
        ) : (
          <p className="tq-c-mudo">
            {trabalho.compromissos.length
              ? 'Nenhum compromisso com esse filtro.'
              : 'Nenhum compromisso registrado ainda. Isso não quer dizer que não houve combinados — só que nenhum foi registrado.'}
          </p>
        )}
      </section>

      <section className="tq-c" aria-labelledby="tq-acomp-decisoes">
        <header className="tq-c-cab">
          <h4 id="tq-acomp-decisoes">Decisões ({decisoes.length})</h4>
        </header>
        <label className="tq-c-check">
          <input type="checkbox" checked={todasAsDecisoes} onChange={(e) => setTodasAsDecisoes(e.target.checked)} />
          <span>Mostrar também as substituídas</span>
        </label>
        {decisoes.length ? (
          <ul className="tq-c-lista">
            {decisoes.map((d) => (
              <ItemDeDecisao key={d.id} d={d} todas={trabalho.decisoes} versoes={versoes} onAbrirFonte={onAbrirFonte} />
            ))}
          </ul>
        ) : (
          <p className="tq-c-mudo">Nenhuma decisão registrada.</p>
        )}
      </section>

      <section className="tq-c" aria-labelledby="tq-acomp-achados">
        <header className="tq-c-cab">
          <h4 id="tq-acomp-achados">Achados ({achados.length})</h4>
        </header>
        <label className="tq-c-check">
          <input type="checkbox" checked={todosOsAchados} onChange={(e) => setTodosOsAchados(e.target.checked)} />
          <span>Mostrar também os resolvidos e descartados</span>
        </label>
        {achados.length ? (
          <ul className="tq-c-lista">
            {achados.map((a) => (
              <ItemDeAchado key={a.id} a={a} versoes={versoes} onAbrirFonte={onAbrirFonte} />
            ))}
          </ul>
        ) : (
          <p className="tq-c-mudo">Nenhum achado aberto.</p>
        )}
      </section>
    </div>
  );
}
