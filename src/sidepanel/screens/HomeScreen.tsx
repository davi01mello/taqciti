/**
 * Tela inicial do side panel: marca, estado de espera e o histórico completo
 * com busca (título, pessoa ou conteúdo da fala) e detalhe de cada reunião.
 */
import { useMemo, useState } from 'react';
import { getSegmentDisplayText } from '@/shared/types/domain';
import { useHistory } from '@/features/history/useHistory';
import { Icon } from '@/shared/ui/Icon';
import { Wave } from '@/shared/ui/Wave';
import { Wordmark } from '@/shared/ui/Wordmark';
import { countWords, formatCount } from '@/shared/ui/format';
import { HistoryCard } from '../components/HistoryCard';
import { RecordDetail } from '../components/RecordDetail';

export function HomeScreen() {
  const records = useHistory();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.participants.some((p) => p.name.toLowerCase().includes(q)) ||
        r.segments.some(
          (s) => s.status !== 'deleted' && getSegmentDisplayText(s).toLowerCase().includes(q),
        ),
    );
  }, [records, query]);

  // Linhas apagadas (soft-delete) não contam como fala, e a contagem reflete
  // o texto corrigido — mesmo critério de transcriptToText.
  const totalWords = useMemo(
    () =>
      records.reduce(
        (sum, r) =>
          sum +
          countWords(
            r.segments.filter((s) => s.status !== 'deleted').map((s) => getSegmentDisplayText(s)),
          ),
        0,
      ),
    [records],
  );

  const openRecord = openId ? (records.find((r) => r.id === openId) ?? null) : null;
  if (openRecord) {
    return <RecordDetail record={openRecord} onBack={() => setOpenId(null)} />;
  }

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden animate-fade-in">
      <header className="px-5 pb-5 pt-6">
        <h1>
          <Wordmark height={29} />
        </h1>
        <p className="mt-2 max-w-[300px] text-read leading-relaxed text-muted">
          Entre numa chamada do Google Meet e a transcrição começa sozinha. Sem legendas
          cobrindo a tela, sem apertar nada.
        </p>
        {records.length > 0 && (
          <p className="mt-3 text-caption font-semibold uppercase tracking-wide text-muted/80">
            {records.length}{' '}
            {records.length === 1 ? 'reunião guardada' : 'reuniões guardadas'}
            {totalWords > 0 && ` · ${formatCount(totalWords)} palavras`}
          </p>
        )}
      </header>

      <div className="mt-3 px-4">
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted/80">
            <Icon name="search" size={16} />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por título, pessoa ou fala"
            aria-label="Buscar reuniões"
            className="glass-lite h-11 w-full rounded-control pl-10 pr-3.5 text-read text-foreground outline-none transition-shadow duration-200 ease-flow placeholder:text-muted/70 focus:shadow-[inset_0_0_0_1px_rgba(45,219,96,0.5)]"
          />
        </div>
      </div>

      <section className="flex min-h-0 flex-1 flex-col px-4 pb-4">
        <h2 className="mb-2.5 mt-4 px-1 text-caption font-semibold uppercase tracking-wide text-muted">
          {query ? `Resultados · ${filtered.length}` : 'Reuniões'}
        </h2>

        {filtered.length === 0 ? (
          <div className="mt-16 flex flex-col items-center gap-4 px-8 text-center">
            <div className="relative grid h-16 w-16 place-items-center">
              <span className="absolute inset-0 rounded-full border border-primary/25" />
              <span className="absolute inset-[7px] rounded-full border border-primary/15" />
              <Wave size={20} tone="dim" />
            </div>
            <p className="max-w-[240px] text-read leading-relaxed text-muted">
              {records.length === 0
                ? 'Nenhuma reunião ainda. Entre num Meet e a captura cuida do resto.'
                : 'Nada encontrado com essa busca.'}
            </p>
          </div>
        ) : (
          <ul className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pb-2">
            {filtered.map((record) => (
              <HistoryCard
                key={record.id}
                record={record}
                onOpen={() => setOpenId(record.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
