/**
 * AS ABAS da reunião — transcrição, notas e prints.
 *
 * São o ÚNICO caminho para a nota e para os prints guardados nesta tela. O
 * botão "Print" da fileira de ações TIRA o print; ver os que já foram tirados é
 * a aba. Antes o botão abria uma seção com outro botão de capturar dentro —
 * dois gestos para o que é um.
 *
 * O ponto de "já tem nota" e a contagem de prints moram na aba: é informação
 * do que está lá dentro, mostrada onde se vai até ela.
 */
import { useEffect, useRef, type ReactNode } from 'react';

export type AbaDaReuniao = 'transcricao' | 'notas' | 'prints';

export function AbasDaReuniao({
  aba,
  onAba,
  notaExiste,
  quantosPrints,
}: {
  aba: AbaDaReuniao;
  onAba: (aba: AbaDaReuniao) => void;
  /** Já existe nota guardada para esta reunião: a aba ganha um ponto. */
  notaExiste: boolean;
  quantosPrints: number;
}) {
  return (
    <div className="tq-reuniao-abas" role="tablist" aria-label="Conteúdo da reunião">
      <button
        type="button"
        role="tab"
        aria-selected={aba === 'transcricao'}
        onClick={() => onAba('transcricao')}
      >
        Transcrição
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={aba === 'notas'}
        aria-controls="tq-editor-de-nota"
        onClick={() => onAba('notas')}
      >
        Notas
        {notaExiste && <span className="tq-aba-selo" aria-label="já tem nota" />}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={aba === 'prints'}
        onClick={() => onAba('prints')}
      >
        Prints
        {quantosPrints > 0 && <span className="tq-aba-conta">{quantosPrints}</span>}
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
