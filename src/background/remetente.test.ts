import { describe, expect, it } from 'vitest';
import { remetentePermitido } from './remetente';

const ID = 'jalebpaefejnbacgncgkailhemkdpnhm';
const RAIZ = `chrome-extension://${ID}/`;

const pagina = { id: ID, url: `${RAIZ}src/home/index.html` } as chrome.runtime.MessageSender;
const meet = {
  id: ID,
  url: 'https://meet.google.com/abc-defg-hij',
  frameId: 0,
  tab: { id: 7, url: 'https://meet.google.com/abc-defg-hij' },
} as chrome.runtime.MessageSender;
const outroSite = {
  id: ID,
  url: 'https://exemplo.com/',
  frameId: 0,
  tab: { id: 8, url: 'https://exemplo.com/' },
} as chrome.runtime.MessageSender;

const pode = (type: string, sender: chrome.runtime.MessageSender) =>
  remetentePermitido({ type } as { type: never }, sender, ID, RAIZ);

describe('remetentePermitido', () => {
  it('página da extensão manda qualquer comando', () => {
    expect(pode('ui/history/delete', pagina)).toBe(true);
    expect(pode('ui/print', pagina)).toBe(true);
    expect(pode('ui/getState', { ...pagina, tab: { id: 3 } } as chrome.runtime.MessageSender)).toBe(true);
  });

  it('o content script do Meet manda só o que de fato manda', () => {
    expect(pode('meet/chunk', meet)).toBe(true);
    expect(pode('panel/mounted', meet)).toBe(true);
    expect(pode('ui/openSidePanel', meet)).toBe(true);
    expect(pode('ui/getState', meet)).toBe(true);
    expect(pode('ui/print', meet)).toBe(false);
    expect(pode('ui/chatNotice', meet)).toBe(false);
    expect(pode('ui/history/delete', meet)).toBe(false);
    expect(pode('ui/history/restore', meet)).toBe(false);
  });

  it('content script fora do Meet, num iframe, ou de outra extensão não manda nada', () => {
    expect(pode('ui/getState', outroSite)).toBe(false);
    expect(pode('meet/chunk', outroSite)).toBe(false);
    expect(pode('meet/chunk', { ...meet, frameId: 3 } as chrome.runtime.MessageSender)).toBe(false);
    expect(pode('ui/getState', { ...pagina, id: 'outra' } as chrome.runtime.MessageSender)).toBe(false);
  });

  it('http no lugar de https não é o Meet', () => {
    const falso = { ...meet, url: 'http://meet.google.com/x', tab: { id: 7, url: 'http://meet.google.com/x' } };
    expect(pode('meet/chunk', falso as chrome.runtime.MessageSender)).toBe(false);
  });
});
