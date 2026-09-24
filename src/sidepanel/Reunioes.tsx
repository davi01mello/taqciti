/**
 * As reuniões já registradas — o que a seção "Transcrição" mostra quando não
 * há nenhuma em curso.
 *
 * ── Por que aqui, e não numa terceira seção ──────────────────────────────
 *
 * Transcrição é o assunto: a de agora quando existe, as de antes quando não
 * existe. Uma seção "Histórico" separada faria a sidebar ter três seletores
 * para dois assuntos, e obrigaria a escolher entre "ver a transcrição" e "ver
 * as transcrições" — que é a mesma coisa em dois tempos.
 *
 * As CONVERSAS guardadas não estão aqui: elas são o assunto do outro seletor, e
 * o menu de conversas lá dentro já lista todas, com data. Duplicá-las aqui
 * seria a mesma lista em dois lugares, divergindo no primeiro ajuste.
 *
 * ── Por que a nota é editável daqui ──────────────────────────────────────
 *
 * A nota é do registro, não do momento. Reabrir uma reunião de ontem e
 * acrescentar uma linha é o uso normal — e continua sem tocar a transcrição,
 * porque são chaves separadas no storage.
 */
import { useState } from 'react';
import type { MeetingRecord } from '@/shared/types/domain';
import type { Nota, EstadoDaGravacao } from '@/features/annotations/notes';
import { downloadTranscript } from '@/features/history/export';
import { Icon } from '@/shared/ui/Icon';
import {
  formatDate,
  formatDurationHuman,
  formatTime,
  hostName,
  speakerLabel,
} from '@/shared/ui/format';
import { EDITOR_DE_NOTA_ID, EstadoDaNota } from './Notas';
import { AbasDaReuniao, ParteDaReuniao } from './AbasDaReuniao';

interface Props {
  registros: MeetingRecord[];
  carregado: boolean;
  notas: Record<string, Nota>;
  rascunhosNota: Record<string, string>;
  estadoDaNota: EstadoDaGravacao;
  recusada: boolean;
  onEscreverNota: (meetingId: string, texto: string) => void;
  onAbrirNaHome: (recordId?: string) => void;
}

export function Reunioes({
  registros,
  carregado,
  notas,
  rascunhosNota,
  estadoDaNota,
  recusada,
  onEscreverNota,
  onAbrirNaHome,
}: Props) {
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const aberta = abertaId ? (registros.find((r) => r.id === abertaId) ?? null) : null;

  if (aberta) {
    return (
      <DetalheDaReuniao
        registro={aberta}
        nota={rascunhosNota[aberta.id] ?? notas[aberta.id]?.texto ?? ''}
        estadoDaNota={estadoDaNota}
        onEscreverNota={onEscreverNota}
        onVoltar={() => setAbertaId(null)}
        onAbrirNaHome={() => onAbrirNaHome(aberta.id)}
      />
    );
  }

  return (
    <div className="tq-rolavel">
      <div className="tq-reuniao-topo">
        <h2>{recusada ? 'Captura desligada' : 'Nenhuma reunião em curso'}</h2>
        <p className="tq-fino">
          {recusada
            ? 'Esta reunião não está sendo registrada. As anteriores continuam aqui.'
            : 'Entre numa reunião do Google Meet e o TaqCiti pergunta se deve registrá-la.'}
        </p>
      </div>

      {!carregado ? (
        <p className="tq-fino">Lendo o histórico…</p>
      ) : registros.length === 0 ? (
        <p className="tq-fino">
          Nenhuma reunião guardada ainda. Entre num Meet, aceite registrar quando o
          TaqCiti perguntar, e ela aparece aqui.
        </p>
      ) : (
        <ul className="tq-lista">
          {registros.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setAbertaId(r.id)}>
                <strong>{r.title}</strong>
                <small>
                  {formatDate(r.startedAt)} · {formatTime(r.startedAt)} ·{' '}
                  {r.segments.length} trecho{r.segments.length === 1 ? '' : 's'}
                  {notas[r.id] && ' · com nota'}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DetalheDaReuniao({
  registro,
  nota,
  estadoDaNota,
  onEscreverNota,
  onVoltar,
  onAbrirNaHome,
}: {
  registro: MeetingRecord;
  nota: string;
  estadoDaNota: EstadoDaGravacao;
  onEscreverNota: (meetingId: string, texto: string) => void;
  onVoltar: () => void;
  onAbrirNaHome: () => void;
}) {
  const semFala = registro.segments.length === 0;
  const [notasEmFoco, setNotasEmFoco] = useState(false);

  return (
    <div className="tq-rolavel">
      <button type="button" className="tq-voltar" onClick={onVoltar}>
        <Icon name="chevron" size={13} className="tq-girado" />
        Reuniões
      </button>

      <div className="tq-reuniao-topo">
        <h2>{registro.title}</h2>
        <p className="tq-fino">
          {formatDate(registro.startedAt)} · {formatTime(registro.startedAt)} ·{' '}
          {formatDurationHuman(registro.durationSeconds)}
        </p>
      </div>

      <div className="tq-acoes-linha">
        <button
          type="button"
          className="tq-botao-fantasma"
          onClick={() => downloadTranscript(registro)}
          disabled={semFala}
        >
          <Icon name="arrowDown" size={14} />
          Baixar .txt
        </button>
        <button type="button" className="tq-botao-fantasma" onClick={onAbrirNaHome}>
          Abrir na HOME
        </button>
      </div>
      {semFala && (
        <p className="tq-fino">
          Esta reunião não tem transcrição: as legendas do Meet não chegaram a produzir
          fala nenhuma. Não há o que baixar.
        </p>
      )}

      <AbasDaReuniao
        notas={notasEmFoco}
        notaExiste={nota.trim().length > 0}
        onNotas={setNotasEmFoco}
      />
      <div className="tq-reuniao-alternada">
        <ParteDaReuniao ativa={notasEmFoco}>
          <section className="tq-notas">
            <div className="tq-notas-topo">
              <h3>Nota desta reunião</h3>
              <EstadoDaNota estado={estadoDaNota} />
            </div>
            <textarea
              id={EDITOR_DE_NOTA_ID}
              className="tq-notas-campo"
              value={nota}
              placeholder="Anote algo sobre esta reunião…"
              aria-label={`Nota de ${registro.title}`}
              onChange={(e) => onEscreverNota(registro.id, e.target.value)}
            />
          </section>
        </ParteDaReuniao>
        <ParteDaReuniao ativa={!notasEmFoco}>
          {!semFala && (
            <section className="tq-falas tq-falas-estatica">
              {/* Mesma leitura da reunião em curso: a própria fala em verde, as
                  dos outros em cinza, e o nome sempre no cinza da etiqueta. */}
              {registro.segments.map((s) => {
                const nome = s.speaker ?? 'Alguém';
                const rotulo = speakerLabel(nome, hostName(registro.participants));
                return (
                  <article
                    key={s.captionId}
                    className={`tq-fala${rotulo !== nome ? ' minha' : ''}`}
                  >
                    <span className="tq-fala-quem">{rotulo}</span>
                    <span className="tq-fala-texto">{s.text}</span>
                  </article>
                );
              })}
            </section>
          )}
        </ParteDaReuniao>
      </div>
    </div>
  );
}
