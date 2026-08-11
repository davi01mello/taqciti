/**
 * Título editável inline: clique vira input; Enter ou blur salvam, Esc cancela.
 * Componente puro — quem salva é o pai via onRename.
 */
import { useEffect, useRef, useState } from 'react';

interface EditableTitleProps {
  value: string;
  onRename: (title: string) => void;
  className?: string;
}

export function EditableTitle({ value, onRename, className = '' }: EditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const title = draft.trim();
    if (title.length > 0 && title !== value) onRename(title);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        maxLength={200}
        className={`glass-sunken w-full rounded-control px-2 py-1 outline-none shadow-[inset_0_0_0_1px_rgb(var(--c-primary)/0.45)] ${className}`}
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      title="Clique para renomear"
      className={`w-full truncate rounded-control px-2 py-1 text-left transition-colors duration-200 ease-flow hover:bg-white/[0.06] ${className}`}
    >
      {value}
    </button>
  );
}
