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
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PanelPrefs } from '@/shared/types/domain';
import { useMeetingState } from '@/shared/hooks/useMeetingState';
import { PlatformProvider, usePlatform } from '@/shared/platform/context';
import { extensionPlatform } from '@/shared/platform/extension';
import { PanelApp, type PanelCallbacks, type PanelContext } from './ui/PanelApp';
import { getMountPoint } from './ui/mount';
import {
  loadPanelPrefs,
  patchPanelPrefs,
  subscribePanelPrefs,
} from '@/features/panel/prefsStore';

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

  /*
   * O storage manda; este estado é só o espelho dele.
   *
   * A assinatura cobre três origens com um mecanismo só: o próprio painel, o
   * painel de outra aba, e o background gravando `presence: 'open'` quando o
   * ícone da extensão é clicado. É por isso que o clique no ícone abre o painel
   * sem reinjetar nada nem endereçar mensagem a aba nenhuma.
   */
  const [prefs, setPrefs] = useState<PanelPrefs>(initialPrefs);
  useEffect(() => subscribePanelPrefs(setPrefs), []);

  const callbacks: PanelCallbacks = useMemo(
    () => ({
      onPause: () => void platform.send({ type: 'ui/pause' }),
      onResume: () => void platform.send({ type: 'ui/resume' }),
      onFinish: () => void platform.send({ type: 'ui/finish' }),
      onRename: (title) => void platform.send({ type: 'ui/rename', title }),
      onOpenSidePanel: (target) =>
        void platform.send({
          type: 'panel/openRequest',
          view: 'history',
          ...(target?.recordId !== undefined ? { recordId: target.recordId } : {}),
        }),
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
       * Gravar é tudo o que acontece aqui. O valor novo volta pela assinatura
       * acima, que é o mesmo caminho das mudanças vindas de fora — um caminho
       * só, sem cópia local capaz de divergir do que está salvo.
       */
      onPrefsChange: (patch) => void patchPanelPrefs(patch),
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
 * Monta o painel nesta página.
 *
 * As preferências são lidas ANTES de montar. Este script roda em toda página
 * que carrega, e montar no padrão para corrigir no quadro seguinte significaria
 * a cápsula piscando em cada navegação de quem fechou o TaqCITi — a forma
 * visível de "o estado não atravessou".
 *
 * Não existe flag de "por que estou montando". Reabrir, navegar e recarregar
 * chegam aqui como a mesma coisa: ler o que está no storage. É isso que faz a
 * janela voltar exatamente como estava, sem ninguém precisar coordenar nada.
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
