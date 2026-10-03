/**
 * As NOTAS da reunião — agora um editor que abre e recolhe dentro da seção
 * "Transcrição", em vez de uma aba separada.
 *
 * ── Por que deixou de ser uma aba ────────────────────────────────────────
 *
 * Escrever uma nota é uma ação DA reunião, feita enquanto se acompanha o que
 * está sendo dito. Como aba, ela cobria a transcrição inteira para receber uma
 * frase — e voltar exigia lembrar de voltar. Recolhida, ela é um botão na
 * fileira de ações; aberta, é um campo logo abaixo, com a transcrição ainda na
 * tela.
 *
 * ── Recolher não perde nada ──────────────────────────────────────────────
 *
 * O texto não mora aqui: mora no `App`, e o gravador com respiro (ver
 * `features/annotations/notes.ts`) o leva ao storage sozinho. Recolher é só
 * esconder o campo — o rascunho sobrevive a isso, a trocar de seção e ao painel
 * fechar. Um `useState` local aqui dentro perderia a frase pela metade no
 * primeiro clique em "Transcrição".
 *
 * Nunca encosta na transcrição: outra chave no storage, outro registro, e o
 * `.txt` exportado continua sendo só o que foi dito.
 */
import { useEffect, useRef } from 'react';
import type { EstadoDaGravacao } from '@/features/annotations/notes';

/** O campo tem id fixo para o botão da fileira de ações poder lhe dar foco. */
export const EDITOR_DE_NOTA_ID = 'tq-editor-de-nota';

/** O aviso discreto de gravação, igual em toda superfície que edita nota. */
export function EstadoDaNota({ estado }: { estado: EstadoDaGravacao }) {
  return (
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
  );
}

interface Props {
  ativa?: boolean;
  meetingId: string;
  texto: string;
  estado: EstadoDaGravacao;
  onEscrever: (meetingId: string, texto: string) => void;
}

/*
 * Só o campo e uma linha embaixo. O título "Nota desta reunião" e o "Recolher"
 * saíram com a direção "Espectro": a aba já diz o que é, e recolher é voltar à
 * aba Transcrição.
 */
export function EditorDeNota({ ativa = true, meetingId, texto, estado, onEscrever }: Props) {
  const campoRef = useRef<HTMLTextAreaElement | null>(null);

  /*
   * O foco vai para o campo ao ABRIR — e abrir é exatamente montar, porque
   * recolher desmonta. Abrir a nota e ainda ter de clicar no campo seria um
   * gesto a mais numa ação que já é "quero escrever agora".
   */
  useEffect(() => {
    if (!ativa) return;
    // Um quadro depois: o efeito do filho roda ANTES do pai tirar o `inert` da
    // seção, e um foco dado num elemento inerte é ignorado em silêncio.
    const q = requestAnimationFrame(() => campoRef.current?.focus());
    return () => cancelAnimationFrame(q);
  }, [ativa]);

  return (
    <section className="tq-notas" aria-label="Nota desta reunião">
      {estado === 'falhou' && (
        <button
          type="button"
          className="tq-botao-fantasma"
          onClick={() => onEscrever(meetingId, texto)}
        >
          Tentar salvar novamente
        </button>
      )}

      <textarea
        id={EDITOR_DE_NOTA_ID}
        ref={campoRef}
        className="tq-notas-campo"
        value={texto}
        placeholder="Anote algo sobre esta reunião…"
        aria-label="Notas desta reunião"
        onChange={(e) => onEscrever(meetingId, e.target.value)}
      />

      <p className="tq-notas-pe">
        <span>Fica neste computador, separada da transcrição.</span>
        <EstadoDaNota estado={estado} />
      </p>
    </section>
  );
}
