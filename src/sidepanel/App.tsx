/**
 * Painel lateral: roteia telas pela fase da máquina de estados — a UI reflete o
 * estado, nunca decide transições.
 *
 * A saída larga do TaqCITi, não a principal: quem manda é o painel injetado,
 * que abre em qualquer aba. Aqui cabe ler uma transcrição inteira sem a página
 * por baixo.
 */
import { useMemo } from 'react';
import { useMeetingState } from '@/shared/hooks/useMeetingState';
import { readWideViewRequest } from './route';
import { HomeScreen } from './screens/HomeScreen';
import { LiveScreen } from './screens/LiveScreen';
import { SummaryScreen } from './screens/SummaryScreen';

export function App() {
  const state = useMeetingState();

  /*
   * Lido UMA vez, na montagem. A URL não muda enquanto a aba vive, e reler a
   * cada render só daria a este componente uma dependência de `window` que ele
   * não precisa ter.
   */
  const request = useMemo(() => readWideViewRequest(window.location.search), []);

  /*
   * O pedido explícito vence a fase — e é justamente por não vencer que o botão
   * "Abrir numa aba" do painel parecia não funcionar. Ver src/sidepanel/route.ts.
   */
  if (request.history) return <HomeScreen initialRecordId={request.recordId} />;

  switch (state.phase) {
    case 'idle':
      return <HomeScreen />;
    case 'captionsRequired':
      if (!state.session) return <HomeScreen />;
      return <LiveScreen session={state.session} phase="preparing" />;
    case 'recording':
    case 'paused':
      if (!state.session) return <HomeScreen />;
      return (
        <LiveScreen
          session={state.session}
          phase={state.phase === 'paused' ? 'paused' : 'recording'}
        />
      );
    case 'ended':
      if (!state.session) return <HomeScreen />;
      return <SummaryScreen session={state.session} />;
  }
}
