/**
 * Como a plataforma chega até as telas.
 *
 * Contexto, e não um singleton de módulo: o singleton pareceria mais simples
 * (uma variável, definida no bootstrap), mas tornaria impossível montar duas
 * superfícies com plataformas diferentes no mesmo processo — que é
 * exatamente o cenário do app nativo durante a transição, com a janela
 * falando pela ponte enquanto o resto ainda fala por `chrome.*`. Também
 * deixaria os testes com estado global entre casos.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { Platform } from './types';

const PlatformContext = createContext<Platform | null>(null);

export function PlatformProvider({
  platform,
  children,
}: {
  platform: Platform;
  children: ReactNode;
}) {
  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>;
}

/**
 * Falta de provider é erro de programação, não estado possível — daí o
 * lançamento em vez de um retorno nulo que cada chamador teria que tratar.
 */
export function usePlatform(): Platform {
  const platform = useContext(PlatformContext);
  if (platform === null) {
    throw new Error(
      'usePlatform foi chamado fora de <PlatformProvider>. Toda raiz de UI ' +
        'precisa montar um provider — ver os main.tsx de cada superfície.',
    );
  }
  return platform;
}
