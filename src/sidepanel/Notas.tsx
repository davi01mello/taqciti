/**
 * As NOTAS da reunião.
 *
 * Um campo, e o que a pessoa escreve nele. Não é transcrição e nunca encosta
 * nela: é outro registro, com outra chave, vinculado ao `meetingId` (ver
 * features/annotations/notes.ts). O `.txt` exportado da reunião continua sendo
 * só o que foi dito.
 *
 * ── Por que não há botão de salvar ───────────────────────────────────────
 *
 * Numa reunião ninguém clica em salvar. O texto é gravado sozinho, com um
 * respiro entre as teclas, e o estado da gravação aparece discreto ao lado do
 * título — "salvo" quando deu, e uma frase clara quando não deu. Um "salvando…"
 * piscando a cada palavra seria mais ruidoso do que informativo; por isso o
 * estado só aparece depois que algo acontece.
 */
import type { EstadoDaGravacao } from '@/features/annotations/notes';

interface Props {
  /** `null` quando não há reunião: não existe nota sem reunião a que pertencer. */
  meetingId: string | null;
  titulo: string | null;
  texto: string;
  estado: EstadoDaGravacao;
  onEscrever: (meetingId: string, texto: string) => void;
}

export function Notas({ meetingId, titulo, texto, estado, onEscrever }: Props) {
  if (meetingId === null) {
    return (
      <div className="tq-vazio-centro">
        <h2>Nada para anotar ainda</h2>
        <p>
          As notas pertencem a uma reunião. Quando uma começar a ser registrada,
          este é o lugar de escrever sobre ela.
        </p>
      </div>
    );
  }

  return (
    <div className="tq-notas">
      <div className="tq-notas-topo">
        <h2>Notas{titulo ? ` · ${titulo}` : ''}</h2>
        <span
          className={`tq-notas-estado${estado === 'falhou' ? ' falhou' : ''}`}
          role="status"
        >
          {estado === 'gravando'
            ? 'salvando…'
            : estado === 'salvo'
              ? 'salvo'
              : estado === 'falhou'
                ? 'não foi possível salvar'
                : ''}
        </span>
      </div>

      <textarea
        className="tq-notas-campo"
        value={texto}
        placeholder="O que você quer lembrar desta reunião…"
        aria-label="Notas desta reunião"
        onChange={(e) => onEscrever(meetingId, e.target.value)}
      />

      <p className="tq-fino">
        As notas ficam guardadas separadas da transcrição, neste computador, e
        aparecem depois no histórico — aqui e na HOME.
      </p>
    </div>
  );
}
