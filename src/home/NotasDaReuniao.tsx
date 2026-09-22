/**
 * As NOTAS da reunião, ao lado da transcrição.
 *
 * ── Nota é um agregado da reunião, não um documento ──────────────────────
 *
 * Não há título a inventar, objeto a criar nem reunião a escolher numa lista:
 * abrir a reunião JÁ dá acesso às notas dela, vazias ou não. O campo está
 * sempre ali, e escrever nele é a única coisa que se precisa fazer.
 *
 * Por isso elas também não entram na coleção de Documentos (ver
 * `features/documents/store.ts`): promovê-las a documento criaria duas
 * superfícies editando o mesmo texto com regras diferentes, e obrigaria a
 * pessoa a decidir o que é anotação e o que é documento antes de escrever a
 * primeira linha.
 *
 * ── A MESMA nota da sidebar ──────────────────────────────────────────────
 *
 * Sem cópia e sem sincronização escrita à mão: esta tela e a sidebar usam
 * `features/annotations/notes.ts`, assinam a mesma chave do storage e gravam
 * no mesmo lugar, indexado por `meetingId`. Renomear a reunião não mexe no
 * vínculo, porque o vínculo é o id e não o nome.
 *
 * O texto e o gravador NÃO moram aqui: moram em quem renderiza esta coluna.
 * Em largura estreita ela alterna com a transcrição, e um `useState` local
 * perderia a frase pela metade na primeira troca.
 */
import { useRef } from 'react';
import type { EstadoDaGravacao } from '@/features/annotations/notes';

interface Props {
  meetingId: string;
  tituloDaReuniao: string;
  texto: string;
  estado: EstadoDaGravacao;
  onEscrever: (meetingId: string, texto: string) => void;
}

export function NotasDaReuniao({
  meetingId,
  tituloDaReuniao,
  texto,
  estado,
  onEscrever,
}: Props) {
  const campoRef = useRef<HTMLTextAreaElement | null>(null);

  return (
    <div className="tq-notas-coluna">
      <div className="tq-coluna-topo">
        <h2>Notas da reunião</h2>
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
      {estado === 'falhou' && (
        <button
          type="button"
          className="tq-acao"
          onClick={() => onEscrever(meetingId, texto)}
        >
          Tentar salvar novamente
        </button>
      )}

      {/*
       * Um `textarea` comum, e é isso que se quer: seleção, copiar, colar,
       * desfazer e todo atalho de edição do sistema funcionam sem que nada
       * aqui precise reimplementá-los. Os textos decorativos da HOME é que não
       * são selecionáveis — o campo de escrita nunca entrou nessa regra.
       */}
      <textarea
        ref={campoRef}
        className="tq-notas-campo"
        value={texto}
        placeholder="Anote algo sobre esta reunião…"
        aria-label={`Notas de ${tituloDaReuniao}`}
        spellCheck
        onChange={(e) => onEscrever(meetingId, e.target.value)}
      />

      <p className="tq-coluna-rodape">Salvas neste computador.</p>
    </div>
  );
}
