/**
 * OS CONTROLES DE DESENVOLVIMENTO — para ver os estados transitórios sem
 * precisar de uma reunião de verdade acontecendo.
 *
 * ── O que isto é, e o que isto nunca faz ─────────────────────────────────
 *
 * É um andaime para avaliar a interface. Ele SOBREPÕE o estado que a sidebar
 * desenha e publica atividade no barramento do agente. Não liga captura, não
 * escreve no estado do background, não chama API nenhuma e não manda mensagem
 * para lugar nenhum.
 *
 * A sobreposição é um ramo só, no `App`: `sobreposicao?.meeting ?? estadoReal`.
 * O estado real continua chegando e continua sendo o que vale assim que a
 * simulação é desligada — não há como a simulação "vazar" para o produto,
 * porque ela nunca escreve onde o produto lê.
 *
 * ── Por que ele grita que é simulação ────────────────────────────────────
 *
 * Porque a coisa mais fácil de fazer errado aqui é confundir uma tela simulada
 * com uma tela funcionando. Enquanto qualquer simulação está ligada, uma faixa
 * fica de pé, em âmbar, dizendo o que está sendo fingido. O requisito é
 * explícito: demonstração não pode apresentar integração ausente como
 * funcional — e o caso mais grave é o do agente, que em produção não existe.
 *
 * ── Por que ele não está na build de produção ────────────────────────────
 *
 * Quem o carrega é um `lazy(() => import(...))` dentro de um ramo
 * `import.meta.env.DEV` (ver `sidepanel/App.tsx`). Com `DEV` falso em tempo de
 * build, o ramo some e este arquivo deixa de ser emitido.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MeetingState, MeetingSessionState, LiveSegment } from '@/shared/types/domain';
import { publicarAtividade, publicarParcial } from '@/features/agent/atividade';
import type { Sobreposicao } from '@/sidepanel/App';
import { DIALOGO, RESPOSTA_LONGA, existeDemo, remover, semear } from './demo';

interface Props {
  estadoReal: MeetingState;
  sobreposicao: Sobreposicao | null;
  onSobrepor: (s: Sobreposicao | null) => void;
}

type Cenario = 'capturando' | 'pausada' | 'interrompida';

const ROTULO: Record<Cenario, string> = {
  capturando: 'Capturando',
  pausada: 'Pausada',
  interrompida: 'Interrompida',
};

/** Ritmo em que as falas entram na transcrição simulada. */
const TRECHO_A_CADA_MS = 1700;
/** Ritmo em que a resposta simulada aparece, em caracteres por passo. */
const PASSO_DA_RESPOSTA = 9;
const RESPOSTA_A_CADA_MS = 40;

const MEETING_ID = 'sim-reuniao';

function sessaoSimulada(quantos: number, inicio: number): MeetingSessionState {
  let offset = 3000;
  const segments: LiveSegment[] = DIALOGO.slice(0, quantos).map(([speaker, text], i) => {
    const duracao = 2000 + text.length * 45;
    const s: LiveSegment = {
      captionId: `sim-cap-${i}`,
      speaker,
      text,
      startOffsetMs: offset,
      endOffsetMs: offset + duracao,
    };
    offset += duracao + 700;
    return s;
  });

  return {
    meetingId: MEETING_ID,
    meetingCode: 'sim-ulad-ora',
    provider: 'google-meet',
    title: 'Simulação · Reunião fictícia',
    tabId: null,
    startedAt: inicio,
    endedAt: null,
    captionsEnabled: true,
    participants: [
      { name: 'Ana Duarte', isHost: true },
      { name: 'Bruno Lima', isHost: false },
      { name: 'Carla Nunes', isHost: false },
      { name: 'Diego Alves', isHost: false },
    ],
    presentNow: [],
    speakersObserved: [],
    segments,
    sealedCaptionIds: [],
    droppedSegments: 0,
    reconnectCount: 0,
    captureDegradedCount: 0,
    captureHealthy: true,
    lastChunkAt: Date.now(),
    wasDiscardedAndRestarted: false,
    captionLanguage: 'pt',
    languageWarningDismissed: false,
    chunksSinceLanguageCheck: 0,
  };
}

export default function PainelDeSimulacao({ sobreposicao, onSobrepor }: Props) {
  const [aberto, setAberto] = useState(false);
  const [cenario, setCenario] = useState<Cenario | null>(null);
  const [quantos, setQuantos] = useState(6);
  const [temDemo, setTemDemo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const inicioRef = useRef(Date.now());

  useEffect(() => {
    void existeDemo().then(setTemDemo);
  }, []);

  // A transcrição simulada cresce enquanto o cenário for "capturando". Pausada
  // e interrompida param de receber, que é o comportamento real das duas.
  useEffect(() => {
    if (cenario !== 'capturando') return;
    const t = setInterval(() => {
      setQuantos((n) => (n >= DIALOGO.length ? n : n + 1));
    }, TRECHO_A_CADA_MS);
    return () => clearInterval(t);
  }, [cenario]);

  // Publica a sobreposição a cada mudança de cenário ou de quantidade.
  useEffect(() => {
    if (cenario === null) {
      onSobrepor(null);
      return;
    }
    const sessao = sessaoSimulada(quantos, inicioRef.current);
    const meeting: MeetingState =
      cenario === 'pausada'
        ? { phase: 'paused', session: sessao }
        : cenario === 'interrompida'
          ? { phase: 'recording', session: { ...sessao, captureHealthy: false } }
          : { phase: 'recording', session: sessao };
    onSobrepor({ meeting });
  }, [cenario, quantos, onSobrepor]);

  /** A resposta que aparece em progressão — o `escrevendo` visto de perto. */
  const escrever = useCallback(() => {
    publicarAtividade('escrevendo');
    let i = 0;
    const t = setInterval(() => {
      i += PASSO_DA_RESPOSTA;
      publicarParcial(RESPOSTA_LONGA.slice(0, i));
      if (i >= RESPOSTA_LONGA.length) {
        clearInterval(t);
        publicarAtividade('concluido');
      }
    }, RESPOSTA_A_CADA_MS);
  }, []);

  const simulando = cenario !== null || sobreposicao !== null;

  return (
    <div className="tq-dev">
      {simulando && (
        <p className="tq-dev-faixa" role="status">
          Simulação ligada: {cenario ? ROTULO[cenario].toLowerCase() : 'estado sobreposto'}.
          O que está na tela não é uma reunião real.
        </p>
      )}

      <button
        type="button"
        className="tq-dev-abrir"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        Desenvolvimento {aberto ? '▾' : '▴'}
      </button>

      {aberto && (
        <div className="tq-dev-corpo">
          <p className="tq-dev-aviso">
            Controles de desenvolvimento. Não existem na build de produção. Nada
            aqui chama API nem envia mensagem — a simulação só sobrepõe o que
            esta tela desenha.
          </p>

          <h4>Captura</h4>
          <div className="tq-dev-botoes">
            {(Object.keys(ROTULO) as Cenario[]).map((c) => (
              <button
                key={c}
                type="button"
                className={cenario === c ? 'atual' : undefined}
                onClick={() => {
                  inicioRef.current = Date.now() - 8 * 60 * 1000;
                  setCenario(cenario === c ? null : c);
                }}
              >
                {ROTULO[c]}
              </button>
            ))}
            <button type="button" onClick={() => setCenario(null)} disabled={!simulando}>
              Voltar ao real
            </button>
          </div>
          {cenario === 'capturando' && (
            <p className="tq-dev-nota">
              {quantos} de {DIALOGO.length} falas — entra uma a cada{' '}
              {TRECHO_A_CADA_MS / 1000}s.
            </p>
          )}

          <h4>Agente</h4>
          <div className="tq-dev-botoes">
            <button type="button" onClick={() => publicarAtividade('preparando')}>
              Preparando
            </button>
            <button type="button" onClick={escrever}>
              Escrevendo
            </button>
            <button type="button" onClick={() => publicarAtividade('concluido')}>
              Concluído
            </button>
            <button type="button" onClick={() => publicarAtividade('falhou')}>
              Erro
            </button>
            <button type="button" onClick={() => publicarAtividade('cancelado')}>
              Cancelado
            </button>
            <button type="button" onClick={() => publicarAtividade('repouso')}>
              Repouso
            </button>
          </div>
          <p className="tq-dev-nota">
            Em produção nenhum destes estados acontece: não há rota de conversa
            no servidor, e o agente fica em repouso o tempo todo.
          </p>

          <h4>Dados de demonstração</h4>
          <div className="tq-dev-botoes">
            <button
              type="button"
              disabled={ocupado}
              onClick={() => {
                setOcupado(true);
                void semear()
                  .then(() => setTemDemo(true))
                  .finally(() => setOcupado(false));
              }}
            >
              {temDemo ? 'Semear de novo' : 'Semear'}
            </button>
            <button
              type="button"
              disabled={ocupado || !temDemo}
              onClick={() => {
                setOcupado(true);
                void remover()
                  .then(() => setTemDemo(false))
                  .finally(() => setOcupado(false));
              }}
            >
              Remover
            </button>
          </div>
          <p className="tq-dev-nota">
            Uma reunião, a nota dela, cinco trechos marcados, um print fictício e
            três conversas. Todos com id <code>demo-</code> e título
            &ldquo;Demonstração&rdquo;. Semear duas vezes não duplica; remover não
            toca em nada real.
          </p>
        </div>
      )}
    </div>
  );
}
