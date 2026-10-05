/**
 * A conta do CITi em "Conexões": nenhum diálogo do Google sem clique, estado
 * honesto por capacidade, e o token fora do storage. O Google é simulado.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ESCOPOS_DA_CONEXAO } from '@/features/integracoes/escopos';
import { trocarDependencias } from '@/features/integracoes/google';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { FluxoContaDoCiti, LinhaContaDoCiti, useContaDoCiti } from './ContaDoCiti';

function Pagina() {
  const conta = useContaDoCiti();
  if (!conta.carregado) return <p>Verificando…</p>;
  return conta.conexao ? (
    <ul>
      <LinhaContaDoCiti conta={conta} />
    </ul>
  ) : (
    <FluxoContaDoCiti conta={conta} onCancelar={() => undefined} />
  );
}

let host: HTMLDivElement;
let root: Root;
let getAuthToken: ReturnType<typeof vi.fn>;
let restaurar: () => void;

async function montar(oauth: boolean, local: Record<string, unknown> = {}) {
  getAuthToken = vi.fn((_d: unknown, cb: (t: string) => void) => cb('TOKEN-SECRETO'));
  installChromeStorageMock({
    local,
    extra: {
      identity: { getAuthToken, removeCachedAuthToken: vi.fn((_d: unknown, cb: () => void) => cb()) },
      runtime: {
        lastError: undefined,
        getManifest: () => ({
          oauth2: { client_id: oauth ? 'abc.apps.googleusercontent.com' : 'CLIENT_ID_NAO_CONFIGURADO.apps.googleusercontent.com' },
        }),
      },
    },
  });
  restaurar = trocarDependencias({
    // O token e o fetch de verdade seriam do Chrome: aqui a ponte usa o mock acima.
    token: (escopos, o) =>
      new Promise((resolve) => {
        chrome.identity.getAuthToken({ interactive: o.interativo, scopes: [...escopos] }, (t) => resolve(String(t)));
      }),
    fetch: (async (url: string) =>
      String(url).includes('tokeninfo')
        ? new Response(JSON.stringify({ scope: ESCOPOS_DA_CONEXAO.join(' ') }))
        : new Response(JSON.stringify({ email: 'bia@citi.org.br', hd: 'citi.org.br' }))) as unknown as typeof fetch,
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<Pagina />);
  });
}

const botao = (texto: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  restaurar();
});

it('sem cliente OAuth: diz o que falta e não oferece um botão que não faria nada', async () => {
  await montar(false);
  expect(host.textContent).toMatch(/Falta registrar o cliente OAuth/);
  expect(host.textContent).toMatch(/integracoes-google-workspace\.md/);
  expect(botao('Conectar conta do CITi')).toBeUndefined();
  expect(getAuthToken).not.toHaveBeenCalled();
});

it('abrir a página NÃO abre o Google; o clique conecta, e o token não vai ao storage', async () => {
  await montar(true);
  expect(getAuthToken).not.toHaveBeenCalled();
  await act(async () => botao('Conectar conta do CITi')!.click());
  await vi.waitFor(() => expect(host.textContent).toContain('bia@citi.org.br'));
  expect(getAuthToken).toHaveBeenCalledWith(
    expect.objectContaining({ interactive: true, scopes: expect.arrayContaining([...ESCOPOS_DA_CONEXAO]) }),
    expect.any(Function),
  );
  for (const nome of ['Colegas da organização', 'Enviar e-mail', 'Ver agendas', 'Criar e remarcar eventos'])
    expect(host.textContent).toContain(nome);
  expect(host.textContent).not.toMatch(/Conectar conta do CITi/);
  const guardado = JSON.stringify(
    (chrome.storage.local as unknown as { values: Record<string, unknown> }).values,
  );
  expect(guardado).not.toContain('TOKEN-SECRETO');
});

it('desligar uma capacidade a marca como desligada; desconectar pede confirmação e apaga a conexão', async () => {
  await montar(true, {
    [STORAGE_KEYS.integracoes]: {
      email: 'bia@citi.org.br',
      dominio: 'citi.org.br',
      escopos: [...ESCOPOS_DA_CONEXAO],
      concedidoEm: 1,
      desligadas: [],
    },
  });
  await vi.waitFor(() => expect(host.textContent).toContain('pronto'));
  const desligar = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Desligar')!;
  await act(async () => desligar.click());
  await vi.waitFor(() => expect(host.textContent).toContain('desligado por você'));

  await act(async () => botao('Desconectar')!.click());
  expect(
    (chrome.storage.local as unknown as { values: Record<string, unknown> }).values[STORAGE_KEYS.integracoes],
  ).toBeDefined();
  await act(async () => botao('Desconectar a conta')!.click());
  await vi.waitFor(() =>
    expect(
      (chrome.storage.local as unknown as { values: Record<string, unknown> }).values[STORAGE_KEYS.integracoes],
    ).toBeUndefined(),
  );
});
