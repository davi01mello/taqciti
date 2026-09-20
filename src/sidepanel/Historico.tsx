/**
 * O histórico na sidebar: conversas, reuniões e as notas de cada uma.
 *
 * ── Por que o .txt não tem um botão solto ────────────────────────────────
 *
 * "Baixar transcrição" fora do contexto de uma reunião é um botão que baixa
 * algo indeterminado — a última? a que está aberta? Aqui a ação PERTENCE a uma
 * reunião: você escolhe qual na lista, e dentro dela existe o download. Uma
 * reunião sem fala capturada não esconde o botão: ela o mostra desligado, com a
 * razão escrita ao lado, porque "não aparece" é indistinguível de "quebrou".
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
import type { Conversation } from '@/home/conversations';
import { downloadTranscript } from '@/features/history/export';
import { Icon } from '@/shared/ui/Icon';
import { formatDate, formatDurationHuman, formatTime } from '@/shared/ui/format';

interface Props {
  registros: MeetingRecord[];
  carregado: boolean;
  notas: Record<string, Nota>;
  conversas: Conversation[];
  rascunhosNota: Record<string, string>;
  estadoDaNota: EstadoDaGravacao;
  onAbrirConversa: (id: string) => void;
  onEscreverNota: (meetingId: string, texto: string) => void;
  onAbrirNaHome: (recordId?: string) => void;
}

type Guia = 'reunioes' | 'conversas';

export function Historico({
  registros,
  carregado,
  notas,
  conversas,
  rascunhosNota,
  estadoDaNota,
  onAbrirConversa,
  onEscreverNota,
  onAbrirNaHome,
}: Props) {
  const [guia, setGuia] = useState<Guia>('reunioes');
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
      <div className="tq-guias" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={guia === 'reunioes'}
          className={guia === 'reunioes' ? 'atual' : undefined}
          onClick={() => setGuia('reunioes')}
        >
          Reuniões
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={guia === 'conversas'}
          className={guia === 'conversas' ? 'atual' : undefined}
          onClick={() => setGuia('conversas')}
        >
          Conversas
        </button>
      </div>

      {guia === 'reunioes' &&
        (!carregado ? (
          <p className="tq-fino">Lendo o histórico…</p>
        ) : registros.length === 0 ? (
          <p className="tq-fino">
            Nenhuma reunião guardada ainda. Entre num Meet, aceite registrar
            quando o TaqCiti perguntar, e ela aparece aqui.
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
        ))}

      {guia === 'conversas' &&
        (conversas.length === 0 ? (
          <p className="tq-fino">
            Nenhuma conversa guardada ainda. A primeira nasce quando você
            escrever.
          </p>
        ) : (
          <ul className="tq-lista">
            {conversas.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onAbrirConversa(c.id)}>
                  <strong>{c.title}</strong>
                  <small>
                    {formatDate(c.updatedAt)} · {c.messages.length}{' '}
                    {c.messages.length === 1 ? 'mensagem' : 'mensagens'}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        ))}
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

  return (
    <div className="tq-rolavel">
      <button type="button" className="tq-voltar" onClick={onVoltar}>
        <Icon name="chevron" size={13} className="tq-girado" />
        Histórico
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
          Esta reunião não tem transcrição: as legendas do Meet não chegaram a
          produzir fala nenhuma. Não há o que baixar.
        </p>
      )}

      <section className="tq-notas">
        <div className="tq-notas-topo">
          <h3>Nota desta reunião</h3>
          <span
            className={`tq-notas-estado${estadoDaNota === 'falhou' ? ' falhou' : ''}`}
            role="status"
          >
            {estadoDaNota === 'gravando'
              ? 'salvando…'
              : estadoDaNota === 'salvo'
                ? 'salvo'
                : estadoDaNota === 'falhou'
                  ? 'não foi possível salvar'
                  : ''}
          </span>
        </div>
        <textarea
          className="tq-notas-campo"
          value={nota}
          placeholder="Escrever uma nota sobre esta reunião…"
          aria-label={`Nota de ${registro.title}`}
          onChange={(e) => onEscreverNota(registro.id, e.target.value)}
        />
      </section>

      {!semFala && (
        <section className="tq-falas tq-falas-estatica">
          {registro.segments.map((s) => (
            <article key={s.captionId} className="tq-fala">
              <span className="tq-fala-quem">{s.speaker ?? 'Alguém'}</span>
              <span className="tq-fala-texto">{s.text}</span>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
