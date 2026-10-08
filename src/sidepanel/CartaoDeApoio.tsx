/**
 * O CARTÃO DE APOIO da reunião ao vivo: no máximo UMA sugestão por vez, privada,
 * com o que a pessoa precisa para decidir em um olhar e o que fazer com ela.
 *
 * Três regras visíveis aqui:
 *   - a sugestão é rotulada (recomendação ou interpretação) e a pergunta é dita
 *     "sugestão — não é fala registrada";
 *   - "Usei esta pergunta" não envia nada à reunião e não diz que foi respondida;
 *   - a origem (as falas que sustentam) está a um clique, em "Ver fonte".
 *
 * Sem sugestão, não há cartão: o silêncio é o estado normal. Só há uma linha
 * quieta com a pausa, quando o apoio está ligado.
 */
import { useState } from 'react';
import { ROTULO_DO_TIPO } from '@/features/apoio/store';
import {
  descartarSugestao,
  guardarParaDepois,
  jaFoiResolvido,
  mostrarGuardada,
  pausarSugestoes,
  usarSugestao,
} from '@/features/apoio/acoes';
import type { ApoioAoVivo } from '@/features/apoio/useApoio';
import { ROTULO_DO_MODO } from '@/features/conducao/store';

const ROTULO_DA_NATUREZA = { inferencia: 'Interpretação', recomendacao: 'Recomendação' } as const;
const NOME_DO_MODO = { sob_demanda: 'Sob demanda', discreto: 'Discreto', participativo: 'Participativo' } as const;

export function CartaoDeApoio({ meetingId, apoio }: { meetingId: string; apoio: ApoioAoVivo }) {
  const [fonteAberta, setFonteAberta] = useState(false);
  const [guardadasAbertas, setGuardadasAbertas] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  // Sem perfil, ou "só quando eu chamar": o apoio não age sozinho, e a tela não ocupa espaço.
  if (!apoio.modo || apoio.modo === 'sob_demanda') return null;

  const { naTela, guardadas, pausado } = apoio;
  const agir = async (fn: () => Promise<unknown>) => {
    setOcupado(true);
    setFonteAberta(false);
    try {
      await fn();
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="tq-apoio" aria-label="Apoio à condução">
      <p className="tq-apoio-linha">
        <span title={ROTULO_DO_MODO[apoio.modo]}>
          Apoio {NOME_DO_MODO[apoio.modo].toLowerCase()}
          {pausado ? ' · pausado' : ''}
        </span>
        <button type="button" onClick={() => void pausarSugestoes(meetingId, !pausado)}>
          {pausado ? 'Retomar sugestões' : 'Pausar sugestões'}
        </button>
      </p>

      {naTela && (
        <article className="tq-apoio-cartao" aria-live="polite">
          <header>
            <span className="tq-apoio-tipo">{ROTULO_DO_TIPO[naTela.tipo]}</span>
            <span className="tq-apoio-natureza">{ROTULO_DA_NATUREZA[naTela.natureza]}</span>
          </header>
          <p className="tq-apoio-texto">{naTela.texto}</p>
          {naTela.pergunta && (
            <blockquote className="tq-apoio-pergunta">
              <span className="tq-apoio-aviso">Sugestão de pergunta — não é uma fala registrada</span>
              “{naTela.pergunta}”
            </blockquote>
          )}
          <p className="tq-apoio-motivo">{naTela.motivo}</p>

          {fonteAberta && (
            <ul className="tq-apoio-fonte" aria-label="Falas que sustentam a sugestão">
              {naTela.evidencias.map((e) => (
                <li key={e.segmento}>
                  <span>Fala {e.segmento + 1}</span> “{e.trecho}”
                </li>
              ))}
            </ul>
          )}

          <div className="tq-apoio-acoes">
            {naTela.pergunta && (
              <button type="button" className="principal" disabled={ocupado} onClick={() => void agir(() => usarSugestao(naTela.id))}>
                Usei esta pergunta
              </button>
            )}
            <button type="button" disabled={ocupado} onClick={() => void agir(() => jaFoiResolvido(naTela.id))}>
              Isso já foi resolvido
            </button>
            <button type="button" disabled={ocupado} onClick={() => void agir(() => guardarParaDepois(naTela.id))}>
              Guardar para depois
            </button>
            <button type="button" disabled={ocupado} onClick={() => void agir(() => descartarSugestao(naTela.id))}>
              Descartar
            </button>
            <button type="button" aria-expanded={fonteAberta} onClick={() => setFonteAberta((v) => !v)}>
              Ver fonte
            </button>
          </div>
        </article>
      )}

      {guardadas.length > 0 && (
        <div className="tq-apoio-guardadas">
          <button type="button" aria-expanded={guardadasAbertas} onClick={() => setGuardadasAbertas((v) => !v)}>
            Guardadas para depois ({guardadas.length})
          </button>
          {guardadasAbertas && (
            <ul>
              {guardadas.map((g) => (
                <li key={g.id}>
                  <span>{g.pergunta ?? g.texto}</span>
                  <button
                    type="button"
                    disabled={ocupado || !!naTela}
                    title={naTela ? 'Resolva a sugestão que está na tela primeiro.' : undefined}
                    onClick={() => void agir(() => mostrarGuardada(g.id))}
                  >
                    Mostrar agora
                  </button>
                  <button type="button" disabled={ocupado} onClick={() => void agir(() => descartarSugestao(g.id))}>
                    Descartar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
