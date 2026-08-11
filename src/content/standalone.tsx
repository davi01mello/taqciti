/**
 * O painel TaqCITi fora do Meet — a mesma janelinha sem moldura, agora em
 * qualquer aba, aberta pelo ícone da extensão.
 *
 * ── Por que isto não é o ContentController ─────────────────────────────────
 *
 * O controller do Meet existe para MEXER na página: ligar as legendas, escondê-
 * las da tela, ler as falas do DOM, recortar a captura ao retomar uma pausa.
 * Nada disso tem sentido numa aba qualquer — não há reunião ali para observar.
 * O que sobra é o que o painel já fazia sozinho: refletir o estado global e
 * devolver intenções. Isso cabe num componente lendo a camada de plataforma,
 * sem classe nenhuma no meio.
 *
 * A captura continua exclusiva do Meet. Este painel não grava: mostra o
 * histórico e, quando há uma reunião viva NA OUTRA ABA, comanda essa captura à
 * distância. Pausar, retomar, renomear e finalizar são mensagens para o
 * background — que é o dono do estado, e a razão de isso funcionar sem o
 * provider por perto.
 */
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PanelPrefs } from '@/shared/types/domain';
import { useMeetingState } from '@/shared/hooks/useMeetingState';
import { PlatformProvider, usePlatform } from '@/shared/platform/context';
import { extensionPlatform } from '@/shared/platform/extension';
import { PanelApp, type PanelCallbacks, type PanelContext } from './ui/PanelApp';
import { getMountPoint } from './ui/mount';
import { loadPanelPrefs, savePanelPrefs } from '@/features/panel/prefs';

/*
 * Tudo aqui é a resposta a "esta aba é o Meet?" — e não é.
 *
 * `inMeeting: false` não é só informativo: é o que apaga do painel os botões
 * que dependem do DOM do Meet (o toggle das legendas nativas, o "tentar
 * capturar de novo"). Sem esse corte eles apareceriam e não fariam nada, que é
 * pior do que não existirem.
 */
const AWAY_FROM_MEET: PanelContext = {
  inMeeting: false,
  captionsAutoFailed: false,
  // Irrelevante fora do Meet — não há legenda nativa nesta aba para esconder.
  nativeCaptionsHidden: false,
  captureHealthy: true,
};

function StandalonePanel({ initialPrefs }: { initialPrefs: PanelPrefs }) {
  const platform = usePlatform();
  const state = useMeetingState();
  const [prefs, setPrefs] = useState<PanelPrefs>(initialPrefs);

  const callbacks: PanelCallbacks = useMemo(
    () => ({
      onPause: () => void platform.send({ type: 'ui/pause' }),
      onResume: () => void platform.send({ type: 'ui/resume' }),
      onFinish: () => void platform.send({ type: 'ui/finish' }),
      onRename: (title) => void platform.send({ type: 'ui/rename', title }),
      onOpenSidePanel: () => void platform.send({ type: 'panel/openRequest' }),
      onCloseEnded: () => void platform.send({ type: 'ui/reset' }),
      onDismissLanguageWarning: () =>
        void platform.send({ type: 'ui/dismissLanguageWarning' }),

      /*
       * As que exigem o DOM do Meet. Ficam como no-op em vez de sumirem da
       * interface porque `PanelCallbacks` é o contrato do painel inteiro: quem
       * as dispara é código que `AWAY_FROM_MEET` já impede de renderizar aqui.
       */
      onResumeCapture: () => {},
      onToggleNativeCaptions: () => {},
      onEnableCaptions: () => {},

      /*
       * O estado precisa acompanhar o que foi salvo: o painel lê posição,
       * tamanho e o "fechado" da prop, sem cópia interna. Gravar sem atualizar
       * aqui deixaria a janela sem reagir ao próprio controle que a comanda.
       */
      onPrefsChange: (patch) => {
        setPrefs((current) => {
          const next = { ...current, ...patch };
          savePanelPrefs(next);
          return next;
        });
      },
    }),
    [platform],
  );

  return (
    <PanelApp
      state={state}
      ctx={AWAY_FROM_MEET}
      prefs={prefs}
      callbacks={callbacks}
    />
  );
}

/**
 * Monta o painel nesta aba.
 *
 * As preferências são lidas ANTES de montar, ao contrário do que acontece no
 * Meet: lá a cápsula precisa aparecer o quanto antes e uma correção de posição
 * logo depois passa despercebida no meio do carregamento da página. Aqui o
 * painel nasce por um clique, numa página parada — montar na posição padrão e
 * pular para a salva no quadro seguinte seria visível.
 *
 * Não há flag de "abriu por clique" aqui, de propósito. Quem sabe o motivo da
 * injeção é o background: no clique do ícone ele grava `presence: 'open'` ANTES
 * de injetar, e na reinjeção depois de navegar não grava nada. Os dois casos
 * chegam aqui como a mesma coisa — ler o que está no storage — e é isso que faz
 * a janela voltar exatamente como estava depois de trocar de página.
 */
export function startStandalonePanel(): void {
  void loadPanelPrefs().then((prefs) => {
    createRoot(getMountPoint()).render(
      <PlatformProvider platform={extensionPlatform}>
        <StandalonePanel initialPrefs={prefs} />
      </PlatformProvider>,
    );
  });
}
