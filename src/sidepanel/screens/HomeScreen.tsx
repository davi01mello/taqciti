/**
 * Tela inicial do painel lateral: marca, estado de espera e o histórico
 * completo com busca (título, pessoa ou conteúdo da fala).
 *
 * A geometria vem do `AppShell` como em todas as outras — antes esta tela
 * remontava `h-[100dvh] flex flex-col overflow-hidden` à mão, que é
 * exatamente a duplicação que o AppShell existe para impedir.
 */
import { useMemo, useState } from 'react';
import { useHistory } from '@/features/history/useHistory';
import { AppShell } from '@/shared/ui/AppShell';
import { SearchField } from '@/shared/ui/Field';
import { Wave } from '@/shared/ui/Wave';
import { Wordmark } from '@/shared/ui/Wordmark';
import { countWords, formatCount } from '@/shared/ui/format';
import { HistoryCard } from '../components/HistoryCard';
import { RecordDetail } from '../components/RecordDetail';

interface HomeScreenProps {
  /**
   * Reunião em que a tela já nasce aberta — o alvo de quem clicou em "abrir
   * numa aba" de DENTRO de uma reunião no painel. Ver src/sidepanel/route.ts.
   *
   * Só o valor INICIAL: daí em diante quem manda é a navegação da tela, senão
   * o botão "voltar" seria desfeito no render seguinte.
   */
  initialRecordId?: string | null;
}

export function HomeScreen({ initialRecordId = null }: HomeScreenProps) {
  const records = useHistory();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(initialRecordId);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.participants.some((p) => p.name.toLowerCase().includes(q)) ||
        r.segments.some((s) => s.text.toLowerCase().includes(q)),
    );
  }, [records, query]);

  const totalWords = useMemo(
    () => records.reduce((sum, r) => sum + countWords(r.segments.map((s) => s.text)), 0),
    [records],
  );

  const openRecord = openId ? (records.find((r) => r.id === openId) ?? null) : null;
  if (openRecord) {
    return <RecordDetail record={openRecord} onBack={() => setOpenId(null)} />;
  }

  return (
    <AppShell
      className="animate-fade-in"
      header={
        /*
         * A moldura do app: a faixa de vidro que não rola. É ela que dá a
         * leitura de "aplicativo" em vez de "página" — o conteúdo desliza por
         * baixo de uma superfície que fica parada.
         */
        <header className="glass rounded-b-card px-5 pb-4 pt-6">
          <h1>
            <Wordmark height={29} />
          </h1>
          <p className="mt-2.5 max-w-[300px] text-read leading-relaxed text-muted">
            Entre numa chamada do Google Meet e a transcrição começa sozinha. Sem
            legendas cobrindo a tela, sem apertar nada.
          </p>

          {records.length > 0 && (
            <p className="mt-3 text-caption font-semibold uppercase tracking-wide text-muted/75">
              {records.length}{' '}
              {records.length === 1 ? 'reunião guardada' : 'reuniões guardadas'}
              {totalWords > 0 && ` · ${formatCount(totalWords)} palavras`}
            </p>
          )}

          <div className="mt-4">
            <SearchField
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por título, pessoa ou fala"
              aria-label="Buscar reuniões"
            />
          </div>
        </header>
      }
    >
      <section className="flex min-h-0 flex-1 flex-col px-4 pb-2 pt-4">
        <h2 className="mb-2.5 px-1 text-caption font-semibold uppercase tracking-wide text-muted">
          {query ? `Resultados · ${filtered.length}` : 'Reuniões'}
        </h2>

        {filtered.length === 0 ? (
          <div className="mt-14 flex flex-col items-center gap-4 px-8 text-center">
            <div className="relative grid h-16 w-16 place-items-center">
              <span className="absolute inset-0 rounded-full border border-primary/20" />
              <span className="absolute inset-[7px] rounded-full border border-primary/12" />
              <Wave size={20} tone="dim" />
            </div>
            <p className="max-w-[240px] text-read leading-relaxed text-muted">
              {records.length === 0
                ? 'Nenhuma reunião ainda. Entre num Meet e a captura cuida do resto.'
                : 'Nada encontrado com essa busca.'}
            </p>
          </div>
        ) : (
          /*
           * `tabIndex` na região que rola: sem uma parada de tabulação, quem
           * navega por teclado não tem como dar foco à lista, e PageDown/setas
           * continuam agindo sobre o documento (que não rola). É a diferença
           * entre "a rolagem por teclado não funciona" e funcionar.
           */
          <ul
            tabIndex={0}
            aria-label="Reuniões guardadas"
            className="scroll-region flex-1 space-y-2.5 pb-2 outline-none"
          >
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
    </AppShell>
  );
}
