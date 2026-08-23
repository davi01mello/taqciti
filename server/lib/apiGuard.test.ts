/**
 * O CORS desta rota já quebrou o produto duas vezes, das duas por acreditar
 * que dava para saber de onde a extensão chama:
 *
 *   1. só `chrome-extension://` — o painel flutuante é content script, e
 *      content script manda a origem da PÁGINA. Nada gerava documento;
 *   2. `chrome-extension://` + `https://meet.google.com` — passou a gerar na
 *      aba do Meet e continuou falhando em todas as outras, porque o painel é
 *      declarado para `<all_urls>` e o histórico abre em qualquer aba.
 *
 * Os dois erros são invisíveis em teste unitário de rota e caros em produção:
 * o navegador bloqueia antes de sair, a extensão só vê um `fetch` que lança, e
 * a mensagem que sobra fala em servidor fora do ar. Daí este arquivo existir.
 */
import { describe, expect, it } from 'vitest';
import { corsHeaders, SHARED_KEY_HEADER } from './apiGuard';

const ORIGEM = 'Access-Control-Allow-Origin';

describe('corsHeaders', () => {
  it('reflete a origem de uma página da extensão', () => {
    const origem = 'chrome-extension://jalebpaefejnbacgncgkailhemkdpnhm';
    expect(corsHeaders(origem)[ORIGEM]).toBe(origem);
  });

  it('reflete a origem do Meet, de onde vem o painel durante a reunião', () => {
    expect(corsHeaders('https://meet.google.com')[ORIGEM]).toBe('https://meet.google.com');
  });

  /*
   * A REGRESSÃO. O painel abre em qualquer aba e o "Gerar Documento" está a um
   * clique do histórico ali dentro — uma lista de origens permitidas precisaria
   * conter a internet, então não existe lista. Se alguém reintroduzir uma, é
   * aqui que estoura, e não na reclamação de quem tentou gerar fora do Meet.
   */
  it.each([
    'https://github.com',
    'https://mail.google.com',
    'http://localhost:5173',
    'https://intranet.cliente.com.br',
  ])('reflete %s — o painel roda em <all_urls>', (origem) => {
    expect(corsHeaders(origem)[ORIGEM]).toBe(origem);
  });

  it('não inventa origem quando a requisição não manda nenhuma', () => {
    // `curl` sem `Origin` chega aqui. Ele não é barrado pelo CORS (nem teria
    // como ser) — quem o recusa é o segredo compartilhado.
    expect(corsHeaders(null)).not.toHaveProperty(ORIGEM);
    expect(corsHeaders('')).not.toHaveProperty(ORIGEM);
  });

  it('nunca manda Allow-Credentials', () => {
    // Refletir qualquer origem É seguro aqui justamente porque não há cookie
    // nem sessão. Com credenciais, o mesmo código viraria um buraco.
    expect(corsHeaders('https://exemplo.com')).not.toHaveProperty(
      'Access-Control-Allow-Credentials',
    );
  });

  it('declara Vary: Origin e o header do segredo, com ou sem origem', () => {
    for (const headers of [corsHeaders(null), corsHeaders('https://exemplo.com')]) {
      expect(headers['Vary']).toBe('Origin');
      expect(headers['Access-Control-Allow-Headers']).toContain(SHARED_KEY_HEADER);
      expect(headers['Access-Control-Allow-Methods']).toContain('POST');
    }
  });
});
