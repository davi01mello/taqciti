import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveSegment } from '@/shared/types/domain';
import { TranscriptView } from './TranscriptView';

let resizeCallback: ResizeObserverCallback | null = null;

class ResizeObserverMock implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function segment(index: number, text = `fala ${index}`): LiveSegment {
  return {
    captionId: `caption-${index}`,
    speaker: index % 2 === 0 ? 'Ana' : 'Bruno',
    text,
    startOffsetMs: index * 1_000,
    endOffsetMs: index * 1_000 + 500,
  };
}

describe('TranscriptView — acompanhamento ao vivo', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.ResizeObserver = ResizeObserverMock;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resizeCallback = null;
  });

  function render(segments: LiveSegment[]): void {
    act(() => {
      root.render(<TranscriptView segments={segments} live />);
    });
  }

  function scroller(dimensions: { height: number; client: number; top: number }) {
    const element = host.querySelector<HTMLElement>('[tabindex="0"]')!;
    let height = dimensions.height;
    Object.defineProperties(element, {
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, get: () => dimensions.client },
    });
    element.scrollTop = dimensions.top;
    const scrollTo = vi.fn((options: ScrollToOptions | number, y?: number) => {
      element.scrollTop =
        typeof options === 'number' ? Number(y ?? 0) : Number(options.top ?? 0);
      element.dispatchEvent(new Event('scroll'));
    });
    element.scrollTo = scrollTo as HTMLElement['scrollTo'];
    return { element, scrollTo, setHeight: (next: number) => { height = next; } };
  }

  it('permanece colado no fim enquanto o último segmento cresce ou o painel redimensiona', () => {
    render([segment(0)]);
    const view = scroller({ height: 900, client: 200, top: 700 });

    render([segment(0, 'fala progressiva que cresceu para mais uma linha')]);
    expect(view.element.scrollTop).toBe(900);

    view.setHeight(1_050);
    act(() => {
      resizeCallback?.([], {} as ResizeObserver);
    });
    expect(view.element.scrollTop).toBe(1_050);
  });

  it('solta por intenção do usuário, mostra “Novas falas” e retoma no clique', () => {
    render([segment(0), segment(1)]);
    const view = scroller({ height: 1_000, client: 200, top: 800 });

    act(() => {
      view.element.scrollTop = 250;
      view.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }));
    });
    expect(host.textContent).toContain('Novas falas');

    render([segment(0), segment(1), segment(2)]);
    expect(view.element.scrollTop).toBe(250);

    const jump = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Novas falas'),
    )!;
    act(() => jump.click());
    expect(view.scrollTo).toHaveBeenCalledWith({ top: 1_000, behavior: 'smooth' });
    expect(view.element.scrollTop).toBe(1_000);
    expect(host.textContent).not.toContain('Novas falas');
  });

  it('retoma automaticamente quando a pessoa retorna fisicamente ao fim', () => {
    render([segment(0), segment(1)]);
    const view = scroller({ height: 1_000, client: 200, top: 800 });
    act(() => {
      view.element.scrollTop = 100;
      view.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -80 }));
    });
    expect(host.textContent).toContain('Novas falas');

    act(() => {
      view.element.scrollTop = 800;
      view.element.dispatchEvent(new Event('scroll'));
    });
    expect(host.textContent).not.toContain('Novas falas');

    view.setHeight(1_200);
    render([segment(0), segment(1), segment(2)]);
    expect(view.element.scrollTop).toBe(1_200);
  });
});
