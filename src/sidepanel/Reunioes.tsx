/**
 * As reuniões já registradas — o histórico da sidebar.
 *
 * ── Uma lista limpa, uma leitura limpa ───────────────────────────────────
 *
 * Direção "Espectro" (02/10/2026): a lista tem só título, data, hora e
 * duração. Abrir uma reunião mostra APENAS a transcrição dela — voltar, título,
 * a linha de informações e as falas. Sem botões, sem abas, sem notas.
 *
 * O que saiu daqui não sumiu do produto: baixar o .txt, as notas e tudo o que
 * se faz COM uma reunião guardada moram na HOME, que tem tela para isso. A
 * sidebar é a coluna de acompanhar; a HOME é a mesa de trabalho.
 *
 * ── Por que aqui, e não numa terceira seção ──────────────────────────────
 *
 * Transcrição é o assunto da seção "Reunião": a de agora quando existe, as de
 * antes quando não existe (ou pelo ícone de lista, no topo). Um terceiro
 * seletor faria a sidebar ter três botões para dois assuntos.
 */
import type { MeetingRecord } from '@/shared/types/domain';
import { Icon } from '@/shared/ui/Icon';
import {
  formatDate,
  formatDurationHuman,
  formatOffset,
  formatTime,
  hostName,
  speakerLabel,
} from '@/shared/ui/format';

interface Props {
  registros: MeetingRecord[];
  carregado: boolean;
  /** "Agora não" nesta participação: a lista diz isso, em uma linha. */
  recusada: boolean;
  /** A reunião aberta. Levantada para o `App`: "Finalizar" abre a recém-salva. */
  abertaId: string | null;
  onAbrir: (id: string | null) => void;
}

export function Reunioes({ registros, carregado, recusada, abertaId, onAbrir }: Props) {
  const aberta = abertaId ? (registros.find((r) => r.id === abertaId) ?? null) : null;

  if (aberta) {
    return <DetalheDaReuniao registro={aberta} onVoltar={() => onAbrir(null)} />;
  }

  return (
    <div className="tq-rolavel tq-historico">
      <div className="tq-secao-cabeca">
        <h2 className="tq-secao-titulo">Reuniões</h2>
        <p className="tq-fino">
          {recusada
            ? 'Captura desligada nesta reunião. As anteriores continuam aqui.'
            : 'As reuniões guardadas neste computador, da mais recente para a mais antiga.'}
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
              <button type="button" onClick={() => onAbrir(r.id)}>
                <strong>{r.title}</strong>
                <span className="tq-lista-meta">
                  {formatDate(r.startedAt)} <span className="tq-relogio">{formatTime(r.startedAt)}</span>{' '}
                  {formatDurationHuman(r.durationSeconds)}
                </span>
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
  onVoltar,
}: {
  registro: MeetingRecord;
  onVoltar: () => void;
}) {
  const eu = hostName(registro.participants);
  const total = registro.segments.length;

  return (
    <div className="tq-rolavel tq-detalhe">
      <button type="button" className="tq-voltar" onClick={onVoltar}>
        <Icon name="chevron" size={13} className="tq-girado" />
        Reuniões
      </button>

      <div className="tq-reuniao-topo">
        <h2>{registro.title}</h2>
        <p className="tq-reuniao-meta">
          <span>{formatDate(registro.startedAt)}</span>
          <span className="tq-relogio">{formatTime(registro.startedAt)}</span>
          <span>{formatDurationHuman(registro.durationSeconds)}</span>
          <span>
            {total} {total === 1 ? 'fala' : 'falas'}
          </span>
        </p>
      </div>

      {total === 0 ? (
        <p className="tq-fino">
          Esta reunião não tem transcrição: as legendas do Meet não chegaram a produzir
          fala nenhuma.
        </p>
      ) : (
        <section className="tq-falas tq-falas-estatica" aria-label="Transcrição">
          {/* A mesma leitura da reunião ao vivo: você em verde, os outros em
              roxo, falas seguidas da mesma pessoa sem repetir o nome. */}
          {registro.segments.map((s, i) => {
            const nome = s.speaker ?? 'Alguém';
            const rotulo = speakerLabel(nome, eu);
            const seguida = i > 0 && registro.segments[i - 1]?.speaker === s.speaker;
            return (
              <article
                key={s.captionId}
                className={`tq-fala${rotulo !== nome ? ' minha' : ''}${
                  seguida ? ' seguida' : ''
                }`}
              >
                <span className="tq-fala-quem">
                  <span className="tq-fala-nome">{rotulo}</span>
                  <span className="tq-fala-hora">{formatOffset(s.startOffsetMs)}</span>
                </span>
                <span className="tq-fala-texto">{s.text}</span>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
