import { describe, expect, it, vi } from 'vitest';
import { openDocumentPage } from './openDocumentPage';

describe('openDocumentPage', () => {
  it('manda document/openRequest com o meetingId — nunca chrome.tabs direto, funciona em qualquer contexto', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    openDocumentPage('meeting-123');
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'document/openRequest',
      meetingId: 'meeting-123',
    });

    vi.unstubAllGlobals();
  });
});
