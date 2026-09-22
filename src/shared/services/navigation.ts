const verificacoes = new Set<() => Promise<boolean>>();
export function protegerEdicao(verificar: () => Promise<boolean>) {
  verificacoes.add(verificar);
  return () => {
    verificacoes.delete(verificar);
  };
}
export async function prepararSaida(): Promise<boolean> {
  return (await Promise.all([...verificacoes].map((v) => v()))).every(Boolean);
}
