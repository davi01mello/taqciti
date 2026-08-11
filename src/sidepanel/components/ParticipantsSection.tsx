/** Contador de participantes sempre visível + lista expansível com avatares. */
import { useState } from 'react';
import type { Participant } from '@/shared/types/domain';
import { Avatar } from '@/shared/ui/Avatar';
import { Icon } from '@/shared/ui/Icon';

interface ParticipantsSectionProps {
  /** Histórico de presença confirmado ao longo da reunião. */
  attendedMeeting: Participant[];
  /** Leitura reconciliada agora; undefined em snapshot legado. */
  presentNow?: Participant[];
}

export function ParticipantsSection({
  attendedMeeting,
  presentNow,
}: ParticipantsSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const current = presentNow ?? attendedMeeting;
  const count = current.length;
  const attendedCount = attendedMeeting.length;
  const label =
    count === 0
      ? 'Presentes agora ainda não identificados'
      : `${count} presente${count > 1 ? 's' : ''} agora`;
  const detail =
    attendedCount > count
      ? `${attendedCount} participaram no total`
      : 'presença confirmada pelo Meet';

  return (
    <section className="border-t border-borderc px-4 py-1">
      <button
        onClick={() => setExpanded((v) => !v)}
        disabled={attendedCount === 0}
        aria-expanded={expanded}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-control px-2 text-left text-read text-muted transition-colors duration-200 ease-flow hover:bg-white/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-70"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex -space-x-1.5">
            {current.slice(0, 4).map((p) => (
              <Avatar key={p.providerParticipantId ?? p.name} name={p.name} size={22} />
            ))}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium">{label}</span>
            <span className="block truncate text-micro text-muted/65">{detail}</span>
          </span>
        </span>
        {attendedCount > 0 && (
          <Icon
            name="chevron"
            size={16}
            className={`shrink-0 transition-transform duration-200 ease-flow ${expanded ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {expanded && attendedCount > 0 && (
        /*
         * Teto de altura, e não uma lista solta: esta seção vive na faixa
         * FIXA do AppShell, que não rola. Numa reunião com trinta pessoas a
         * lista expandida empurrava a transcrição para fora da tela e não
         * havia como alcançar nem uma nem outra. Com o teto, quem passa do
         * limite é esta lista — e ela rola sozinha.
         */
        <ul
          tabIndex={0}
          className="scroll-region mb-1.5 mt-1 max-h-[168px] space-y-0.5 px-2 outline-none animate-entry"
        >
          {attendedMeeting.map((p) => {
            const here = current.some(
              (entry) =>
                (entry.providerParticipantId &&
                  entry.providerParticipantId === p.providerParticipantId) ||
                (!entry.providerParticipantId && entry.name === p.name),
            );
            return (
            <li
              key={p.providerParticipantId ?? p.name}
              className="flex items-center gap-2.5 py-1 text-read"
            >
              <Avatar name={p.name} size={24} />
              <span className="truncate">{p.name}</span>
              {p.isHost === true && (
                <span className="ml-auto shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-glow">
                  Você
                </span>
              )}
              {!here && (
                <span className="ml-auto shrink-0 text-micro text-muted/55">saiu</span>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
