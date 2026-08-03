/**
 * Wrapper do chrome.sidePanel para as UIs. Chamado a partir de um gesto do
 * usuário (clique no popup), onde a API permite abrir o painel.
 */

export async function openSidePanelInCurrentWindow(): Promise<void> {
  const win = await chrome.windows.getCurrent();
  if (win.id !== undefined) {
    await chrome.sidePanel.open({ windowId: win.id });
  }
}
