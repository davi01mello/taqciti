/**
 * Uma resposta do Taq, e o que acompanha ela: fontes, documentos produzidos,
 * o que ficou em aberto e as limitações. Usada pela HOME e pela sidebar.
 *
 * ── As fontes são botões ────────────────────────────────────────────────────
 *
 * A conferência do runtime prova que a fonte existe e contém o trecho; não
 * prova que a leitura do Taq está certa. Por isso cada fonte ABRE a origem — a
 * reunião ou o documento — e a nota abaixo da lista diz exatamente isso, sem
 * vender a conferência como garantia.
 *
 * ── Os documentos vêm da ferramenta, não do texto ───────────────────────────
 *
 * A lista "Documento criado" é o que `create_document`/`update_document`
 * confirmaram. Se o modelo escrever "criei o documento" sem ter criado, a
 * lista fica vazia — e é ela que a pessoa clica.
 */
import type { ConversationMessage, FonteDaResposta } from '@/home/conversations';
import type { EstadoDoAgente } from '@/features/agent/atividade';
import { useState } from 'react';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import { BotaoCopiar } from './BotaoCopiar';
import { CartoesDoTaq } from './CartoesDoTaq';
import { semMarcadores } from '@/features/taq/evidencias';
import './respostaDoTaq.css';

const ROTULO_DA_OPERACAO = {
  abrir: 'Aberto',
  renomear: 'Renomeada para',
  apagar: 'Apagada (na lixeira por 30 dias)',
  restaurar: 'Restaurada',
  exportar: 'Transcrição exportada',
} as const;

function instante(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${seg}` : `${m}:${seg}`;
}

interface Props {
  mensagem: ConversationMessage;
  onAbrirFonte: (fonte: FonteDaResposta) => void;
  onAbrirDocumento: (id: string) => void;
  /**
   * Clique numa opção de pergunta: envia a `mensagem` dela como a próxima
   * mensagem da pessoa. Ausente = as opções aparecem, mas não são clicáveis
   * (a pergunta já foi respondida, ou nada responde agora).
   */
  onEscolherOpcao?: (mensagem: string) => void;
  /** Abrir a reunião afetada por uma operação. Ausente = só o nome. */
  onAbrirReuniao?: (id: string) => void;
  /** Desfazer uma exclusão que está na lixeira. Resolve `true` se voltou. */
  onDesfazer?: (id: string) => Promise<boolean>;
  /** A conversa da mensagem — o rascunho de mensagem é editado dentro dela. */
  conversaId?: string;
}

export function RespostaDoTaq({
  mensagem,
  onAbrirFonte,
  onAbrirDocumento,
  onEscolherOpcao,
  onAbrirReuniao,
  onDesfazer,
  conversaId,
}: Props) {
  const {
    fontes = [],
    documentos = [],
    emAberto = [],
    limitacoes = [],
    desfecho,
    pergunta,
    copiavel,
    operacoes = [],
  } = mensagem;
  const [copiado, setCopiado] = useState(false);
  /** Estado do Desfazer, por operação. Some ao recarregar — o fato fica na lixeira. */
  const [desfeitos, setDesfeitos] = useState<Record<string, 'desfazendo' | 'desfeito' | 'falhou'>>({});
  return (
    <div className="tq-resp">
      {desfecho === 'parcial' && <p className="tq-resp-selo">Resposta parcial</p>}
      {desfecho === 'interrompido' && <p className="tq-resp-selo">Interrompido</p>}
      <div className="tq-resp-texto">
        <Markdown
          texto={mensagem.text}
          onCitar={(ref) => {
            const fonte = fontes.find((f) => f.ref === ref);
            if (fonte) onAbrirFonte(fonte);
          }}
        />
      </div>

      {mensagem.cartoes && mensagem.cartoes.length > 0 && (
        <CartoesDoTaq
          cartoes={mensagem.cartoes}
          mensagemId={mensagem.id}
          {...(conversaId ? { conversaId } : {})}
          onAbrirFonte={onAbrirFonte}
          onAbrirDocumento={onAbrirDocumento}
        />
      )}

      {pergunta && pergunta.opcoes.length > 0 && (
        <ul className="tq-resp-opcoes" aria-label="Opções">
          {pergunta.opcoes.map((o) => (
            <li key={o.mensagem}>
              <button
                type="button"
                disabled={!onEscolherOpcao}
                onClick={() => onEscolherOpcao?.(o.mensagem)}
              >
                <strong>{o.rotulo}</strong>
                {o.descricao && <span>{o.descricao}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {copiavel && (
        <div className="tq-resp-copiavel">
          <pre>{copiavel}</pre>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(copiavel).then(
                () => setCopiado(true),
                () => setCopiado(false),
              );
            }}
          >
            {copiado ? 'Copiado' : 'Copiar texto'}
          </button>
          <p className="tq-resp-nota">
            Nada foi enviado ao Claude: copie e cole lá, se quiser. Confira o texto antes.
          </p>
        </div>
      )}

      {operacoes.length > 0 && (
        <ul className="tq-resp-docs" aria-label="Operações">
          {operacoes.map((o, i) => {
            // Conversa apagada não tem lixeira: o rótulo não promete volta.
            const feito =
              o.tipo === 'conversa' && o.acao === 'apagar'
                ? 'Conversa apagada'
                : ROTULO_DA_OPERACAO[o.acao];
            const rotulo = `${o.ok ? feito : 'Não concluído'}: `;
            const abrir =
              o.ok && o.acao !== 'apagar' && o.tipo !== 'conversa'
                ? o.tipo === 'reuniao'
                  ? onAbrirReuniao && (() => onAbrirReuniao(o.id))
                  : () => onAbrirDocumento(o.id)
                : undefined;
            return (
              <li key={`${o.id}-${i}`}>
                {abrir ? (
                  <button type="button" onClick={abrir}>
                    <span>
                      {rotulo}
                      <strong>{o.titulo}</strong>
                    </span>
                  </button>
                ) : (
                  <p className={o.ok ? 'tq-resp-op' : 'tq-resp-op tq-resp-op-falha'}>
                    {rotulo}
                    <strong>{o.titulo}</strong>
                    {o.acao === 'apagar' && o.ok && o.desfazivel && onDesfazer && (
                      <>
                        {' '}
                        {desfeitos[o.id] === 'desfeito' ? (
                          <span className="tq-resp-desfeito">— restaurada.</span>
                        ) : (
                          <button
                            type="button"
                            className="tq-resp-desfazer"
                            disabled={desfeitos[o.id] === 'desfazendo'}
                            onClick={() => {
                              setDesfeitos((d) => ({ ...d, [o.id]: 'desfazendo' }));
                              void onDesfazer(o.id).then((ok) =>
                                setDesfeitos((d) => ({ ...d, [o.id]: ok ? 'desfeito' : 'falhou' })),
                              );
                            }}
                          >
                            {desfeitos[o.id] === 'falhou' ? 'Não deu — tentar de novo' : 'Desfazer'}
                          </button>
                        )}
                      </>
                    )}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {documentos.length > 0 && (
        <ul className="tq-resp-docs" aria-label="Documentos produzidos">
          {documentos.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => onAbrirDocumento(d.id)}>
                <Icon name="doc" size={14} />
                <span>
                  {d.acao === 'criado' ? 'Criado para revisão' : 'Documento atualizado'}:{' '}
                  <strong>{d.titulo}</strong>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {emAberto.length > 0 && (
        <div className="tq-resp-aberto">
          <strong>Em aberto</strong>
          <ul>
            {emAberto.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      )}

      {fontes.length > 0 && (
        <details className="tq-resp-fontes">
          <summary>Fontes ({fontes.length})</summary>
          <ol>
            {fontes.map((f) => (
              <li key={f.ref}>
                <button
                  type="button"
                  onClick={() => onAbrirFonte(f)}
                  title={f.tipo === 'reuniao' ? 'Abrir a reunião' : 'Abrir o documento'}
                >
                  <span className="tq-resp-ref">[{f.ref}]</span>
                  <span className="tq-resp-origem">
                    {f.titulo}
                    {f.offsetMs !== undefined && ` · ${instante(f.offsetMs)}`}
                  </span>
                  <q>{f.trecho}</q>
                </button>
              </li>
            ))}
          </ol>
          <p className="tq-resp-nota">
            Conferido: cada fonte existe e contém o trecho. A leitura do trecho é do Taq —
            abra a origem para confirmar.
          </p>
        </details>
      )}

      {limitacoes.length > 0 && <p className="tq-resp-limites">{limitacoes.join(' ')}</p>}

      {mensagem.text.trim() && (
        <div className="tq-resp-acoes">
          {/* Sem os `[rN]`: fora desta tela eles não apontam para nada. */}
          <BotaoCopiar texto={semMarcadores(mensagem.text).trim()} rotulo="Copiar a resposta" />
        </div>
      )}
    </div>
  );
}

/**
 * O que o Taq está fazendo agora, ou como a última execução terminou quando
 * ela não deixou resposta. Com o botão de cancelar enquanto trabalha.
 */
export function EstadoDaExecucao({
  agente,
  desfecho,
  onCancelar,
}: {
  agente: EstadoDoAgente;
  /** A frase do desfecho sem resposta (falhou, cancelado, interrompido). */
  desfecho: string | null;
  onCancelar: () => void;
}) {
  if (agente.atividade === 'preparando' || agente.atividade === 'escrevendo') {
    return (
      <div className="tq-exec" role="status">
        <span className="tq-exec-etapa">{agente.etapa ?? 'Preparando'}…</span>
        <button type="button" className="tq-exec-cancelar" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    );
  }
  if (agente.atividade === 'concluido') {
    return (
      <p className="tq-exec tq-exec-fim" role="status">
        Concluído.
      </p>
    );
  }
  if (
    desfecho &&
    (agente.atividade === 'falhou' ||
      agente.atividade === 'cancelado' ||
      agente.atividade === 'interrompido')
  ) {
    return (
      <p
        className={`tq-exec${agente.atividade === 'falhou' ? ' tq-exec-falha' : ''}`}
        role="alert"
      >
        {desfecho} Sua pergunta continua na conversa.
      </p>
    );
  }
  return null;
}
