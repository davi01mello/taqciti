/** Avatar de iniciais com gradiente determinístico por nome. Componente puro. */
import { gradientForName, initialsOf } from './format';

interface AvatarProps {
  name: string;
  size?: number;
}

export function Avatar({ name, size = 28 }: AvatarProps) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-[rgba(6,10,14,0.88)] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: gradientForName(name),
      }}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  );
}
