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
 *
 * ── Apagar ───────────────────────────────────────────────────────────────
 *
 * Um ícone discreto no topo da coluna, só quando há nota, e atrás de uma
 * confirmação que diz o que NÃO vai junto. Apagar não é "selecionar tudo e
 * deletar": aquilo deixa um registro vazio no storage e leva o texto pelo
 * mesmo caminho da gravação automática, sem pergunta nenhuma. Aqui o registro
 * sai inteiro (ver `apagarNota` em `features/annotations/notes.ts`).
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/shared/ui/Icon';
import type { EstadoDaGravacao } from '@/features/annotations/notes';

interface Props {
  meetingId: string;
  tituloDaReuniao: string;
  texto: string;
  estado: EstadoDaGravacao;
  onEscrever: (meetingId: string, texto: string) => void;
  /** Apaga a nota inteira. Resolve `false` quando o storage recusou. */
  onApagar: (meetingId: string) => Promise<boolean>;
}

export function NotasDaReuniao({
  meetingId,
  tituloDaReuniao,
  texto,
  estado,
  onEscrever,
  onApagar,
}: Props) {
  const campoRef = useRef<HTMLTextAreaElement | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState('');

  /*
   * Trocar de reunião fecha a confirmação. Sem isso, a pergunta "apagar as
   * notas de X?" continuaria na tela apontando para a nota de Y — e o clique
   * seguinte apagaria a errada.
   */
  useEffect(() => {
    setConfirmando(false);
    setErro('');
  }, [meetingId]);

  /*
   * Nota vazia não oferece apagar: não há o que remover, e um botão de perigo
   * permanente ao lado de um campo em branco é só ruído com risco.
   */
  const temNota = texto.trim().length > 0;

  return (
    <div className="tq-notas-coluna">
      <div className="tq-coluna-topo">
        <h2>Notas da reunião</h2>
        <div className="tq-coluna-topo-acoes">
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
          {temNota && (
            <button
              type="button"
              className="tq-icone-apagar"
              title="Apagar as notas desta reunião"
              aria-label={`Apagar as notas de ${tituloDaReuniao}`}
              onClick={() => {
                setErro('');
                setConfirmando(true);
              }}
            >
              <Icon name="trash" size={15} />
            </button>
          )}
        </div>
      </div>

      {confirmando && (
        <div
          className="tq-confirma tq-confirma-estreita"
          role="alertdialog"
          aria-label="Apagar as notas?"
        >
          {/* O texto diz o que NÃO vai junto: a transcrição é outro registro,
              e quem apaga a nota costuma temer estar apagando a reunião. */}
          <p>
            <strong>Apagar as notas desta reunião?</strong> O que você escreveu sai
            deste computador para sempre. A transcrição não é afetada.
          </p>
          <div className="tq-acoes">
            <button
              type="button"
              className="tq-acao tq-acao-perigo"
              onClick={() => {
                void onApagar(meetingId).then((ok) => {
                  if (ok) {
                    setConfirmando(false);
                    campoRef.current?.focus();
                  } else setErro('Não foi possível apagar as notas.');
                });
              }}
            >
              Apagar
            </button>
            <button
              type="button"
              className="tq-acao"
              onClick={() => setConfirmando(false)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {erro && (
        <p className="tq-notas-erro" role="alert">
          {erro}
        </p>
      )}
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
