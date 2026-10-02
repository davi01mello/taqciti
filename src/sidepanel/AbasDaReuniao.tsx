/**
 * AS DUAS ABAS da reunião — transcrição e notas.
 *
 * É o ÚNICO caminho para a nota nesta tela. Havia também um botão "Nota" na
 * fileira de ações, abrindo o mesmo editor; ver o cabeçalho de
 * `AcoesDaReuniao.tsx` para por que ele saiu. O selo de "já tem nota" veio com
 * ele: é informação da nota, e agora mora onde se vai até ela.
 */
import { useEffect, useRef, type ReactNode } from 'react';

export function AbasDaReuniao({
  notas,
  notaExiste,
  onNotas,
}: {
  notas: boolean;
  /** Já existe nota guardada para esta reunião: a aba ganha um ponto. */
  notaExiste: boolean;
  onNotas: (valor: boolean) => void;
}) {
  return (
    <div className="tq-reuniao-abas" role="tablist" aria-label="Conteúdo da reunião">
      <button
        type="button"
        role="tab"
        aria-selected={!notas}
        onClick={() => onNotas(false)}
      >
        Transcrição
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={notas}
        aria-controls="tq-editor-de-nota"
        onClick={() => onNotas(true)}
      >
        Notas
        {notaExiste && <span className="tq-aba-selo" aria-label="já tem nota" />}
      </button>
    </div>
  );
}

export function ParteDaReuniao({
  ativa,
  children,
}: {
  ativa: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.inert = !ativa;
  }, [ativa]);
  return (
    <div
      ref={ref}
      className={`tq-reuniao-parte${ativa ? ' ativa' : ''}`}
      aria-hidden={!ativa}
    >
      {children}
    </div>
  );
}
