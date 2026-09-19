/**
 * O cursor desenhado, e as quatro maneiras de sair da janela.
 *
 * O que se observa é a classe `tq-pointer-in` no `body`, porque ela é o
 * contrato inteiro: enquanto ela existe há ponto desenhado e o CSS esconde o
 * cursor do sistema; sem ela é o contrário. Um ponto "preso na tela" é
 * exatamente esta classe tendo sobrado.
 *
 * `pointerleave` no `window` sozinho não cobria nenhum destes casos — era a
 * causa do desenho ficando congelado no último lugar.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PointerLayer } from './PointerLayer';

let host: HTMLDivElement;
let root: Root;

const aceso = () => document.body.classList.contains('tq-pointer-in');

function mover(x = 40, y = 40, pointerType = 'mouse') {
  window.dispatchEvent(
    new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType }),
  );
}

async function montar() {
  await act(async () => {
    root.render(<PointerLayer comMovimento />);
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.classList.remove('tq-pointer-in');
  vi.unstubAllGlobals();
});

describe('a camada acende com o ponteiro', () => {
  it('nasce apagada e acende ao primeiro movimento', async () => {
    await montar();
    expect(aceso()).toBe(false);

    await act(async () => mover());
    expect(aceso()).toBe(true);
  });

  it('um toque não acende cursor nenhum', async () => {
    await montar();
    await act(async () => mover(40, 40, 'touch'));
    expect(aceso()).toBe(false);
  });
});

describe('as quatro saídas', () => {
  it.each([
    [
      'sair do documento (inclusive para a barra do navegador)',
      () =>
        document.dispatchEvent(
          new PointerEvent('pointerout', { bubbles: true, relatedTarget: null }),
        ),
    ],
    [
      'sair pela borda da página',
      () => document.documentElement.dispatchEvent(new PointerEvent('pointerleave')),
    ],
    ['a janela perder o foco', () => window.dispatchEvent(new Event('blur'))],
    [
      'a aba deixar de estar visível',
      () => {
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        document.dispatchEvent(new Event('visibilitychange'));
      },
    ],
  ])('apaga ao %s', async (_nome, sair) => {
    await montar();
    await act(async () => mover());
    expect(aceso()).toBe(true);

    await act(async () => {
      sair();
    });
    expect(aceso()).toBe(false);
  });

  it('volta a acender quando o ponteiro retorna', async () => {
    await montar();
    await act(async () => mover());
    await act(async () => window.dispatchEvent(new Event('blur')));
    expect(aceso()).toBe(false);

    await act(async () => mover(120, 90));
    expect(aceso()).toBe(true);
  });

  /* Desmontar sem limpar deixaria a página com `cursor: none` e nada no lugar. */
  it('desmontar não deixa a classe para trás', async () => {
    await montar();
    await act(async () => mover());
    expect(aceso()).toBe(true);

    await act(async () => root.unmount());
    expect(aceso()).toBe(false);

    // O `afterEach` desmonta de novo; com a raiz já desmontada isso lançaria.
    root = createRoot(host);
  });
});

describe('o ponto não tem atraso; o anel tem', () => {
  it('o ponto vai para a posição exata do mouse', async () => {
    await montar();
    await act(async () => mover(200, 150));

    const ponto = host.querySelector<HTMLElement>('.tq-dot');
    expect(ponto?.style.transform).toBe('translate(200px, 150px)');
  });

  /*
   * Na primeira entrada o anel é reposicionado junto: sem isso ele nasceria na
   * posição de onde o ponteiro saiu da última vez e atravessaria a tela.
   */
  it('o anel não atravessa a tela ao reentrar', async () => {
    await montar();
    await act(async () => mover(200, 150));
    await act(async () => window.dispatchEvent(new Event('blur')));
    await act(async () => mover(600, 400));

    const anel = host.querySelector<HTMLElement>('.tq-halo');
    expect(anel?.style.transform).toContain('translate(600px, 400px)');
  });
});
