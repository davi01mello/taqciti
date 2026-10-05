import { useEffect, useMemo, useState } from 'react';
import { colegasConhecidos, reconhecerColegas } from '@/features/integracoes/colegas';

/**
 * Quem, entre os falantes, é do CITi (ver `features/integracoes/colegas.ts`).
 *
 * Devolve o conjunto de chaves de nome (`chaveDoNome`). Primeiro responde com o
 * que já está guardado — a tela não pisca —, depois confirma no diretório os
 * nomes novos. Em ambiente sem `chrome.storage` (testes de tela), fica vazio.
 */
export function useColegasDoCiti(nomes: readonly string[]): ReadonlySet<string> {
  const unicos = useMemo(() => [...new Set(nomes.filter(Boolean))].sort(), [nomes]);
  const chave = unicos.join('\u0000');
  const [colegas, setColegas] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (unicos.length === 0) return;
    let vivo = true;
    const aplicar = (s: Set<string>) => {
      if (vivo) setColegas((atual) => (mesmo(atual, s) ? atual : s));
    };
    void colegasConhecidos(unicos).then(aplicar).catch(() => undefined);
    void reconhecerColegas(unicos).then(aplicar).catch(() => undefined);
    return () => {
      vivo = false;
    };
    // `chave` representa `unicos`: o efeito só roda quando entra um nome novo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  return colegas;
}

function mesmo(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
