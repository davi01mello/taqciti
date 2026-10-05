/**
 * As integrações com o Google, SEM falar com o Google: o `fetch`, o token e o
 * relógio são trocados. O que se confere: o que sai na requisição, o que cada
 * resposta vira, e o que NUNCA acontece (reenvio, token em lugar errado, "livre"
 * sem ter visto a agenda).
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { buscarNoDiretorio } from './diretorio';
import { ErroDeIntegracao } from './erros';
import { ESCOPOS_DA_CONEXAO, ESCOPO_GMAIL_ENVIAR } from './escopos';
import { conectarConta, estadoDasCapacidades, ligarCapacidade, situacaoDe, type ConexaoGuardada } from './estado';
import { enviarPeloGmail, limpaCabecalho, montarMime } from './gmail';
import { trocarDependencias } from './google';
import {
  cancelarEvento,
  consultarOcupacao,
  criarEventoNaAgenda,
  idDeEventoDaChave,
  janelasLivres,
} from './calendario';
import {
  concluirAcao,
  guardarRascunho,
  obterAcao,
  reservarExecucao,
  ENVIANDO_VENCE_EM_MS,
} from './registroDeAcoes';

const CONEXAO: ConexaoGuardada = {
  email: 'eu@citi.org.br',
  dominio: 'citi.org.br',
  escopos: [...ESCOPOS_DA_CONEXAO],
  concedidoEm: 1,
  desligadas: [],
};

const resposta = (corpo: unknown, status = 200) =>
  new Response(corpo === undefined ? null : JSON.stringify(corpo), { status });

let restaurar: () => void;
let fetchFalso: ReturnType<typeof vi.fn>;
let descartar: ReturnType<typeof vi.fn>;
let agora = 1_000_000;

beforeEach(() => {
  installChromeStorageMock({
    local: { [STORAGE_KEYS.integracoes]: CONEXAO },
    extra: {
      runtime: { getManifest: () => ({ oauth2: { client_id: 'abc.apps.googleusercontent.com' } }) },
    },
  });
  fetchFalso = vi.fn();
  descartar = vi.fn(async () => undefined);
  agora = 1_000_000;
  restaurar = trocarDependencias({
    fetch: fetchFalso as unknown as typeof fetch,
    token: async () => 'TOKEN-SECRETO',
    descartar: descartar as unknown as (t: string) => Promise<void>,
    agora: () => agora,
  });
});
afterEach(() => restaurar());

describe('a mensagem MIME', () => {
  it('quebra de linha num cabeçalho não vira cabeçalho novo (injeção de Bcc)', () => {
    expect(limpaCabecalho('Reunião\r\nBcc: espiao@fora.com')).toBe('Reunião Bcc: espiao@fora.com');
    const mime = montarMime({
      de: 'eu@citi.org.br',
      para: ['ana@citi.org.br'],
      assunto: 'Oi\r\nBcc: espiao@fora.com',
      corpo: 'texto',
    });
    const cabecalhos = mime.split('\r\n\r\n')[0]!;
    expect(cabecalhos.split('\r\n').some((l) => l.startsWith('Bcc:'))).toBe(false);
  });

  it('assunto com acento vai em UTF-8 codificado; o corpo, em base64', () => {
    const mime = montarMime({ de: 'eu@citi.org.br', para: ['ana@citi.org.br'], assunto: 'Ata da reunião', corpo: 'olá' });
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(mime).toContain('Content-Transfer-Encoding: base64');
    expect(mime).not.toContain('olá');
  });

  it('com anexo, vira multipart com o nome do arquivo sem aspas soltas', () => {
    const mime = montarMime({
      de: 'eu@citi.org.br',
      para: ['ana@citi.org.br'],
      assunto: 'Ata',
      corpo: 'segue',
      anexos: [{ nome: 'ata "final".md', tipo: 'text/markdown', conteudo: new TextEncoder().encode('# Ata') }],
    });
    expect(mime).toMatch(/multipart\/mixed; boundary="taqciti_/);
    expect(mime).toContain('filename="ata _final_.md"');
  });

  it('endereço mal formado é recusado antes de montar', () => {
    expect(() =>
      montarMime({ de: 'eu@citi.org.br', para: ['ana@citi.org.br>, x@y.com'], assunto: 'a', corpo: 'b' }),
    ).toThrow(/Endereço inválido/);
  });
});

describe('o cliente do Google', () => {
  it('o envio leva o token SÓ no cabeçalho, e o corpo é a mensagem codificada', async () => {
    fetchFalso.mockResolvedValue(resposta({ id: 'g-1' }));
    const r = await enviarPeloGmail({ de: 'eu@citi.org.br', para: ['ana@citi.org.br'], assunto: 'Oi', corpo: 'texto' });
    expect(r.idDaMensagem).toBe('g-1');
    const [url, init] = fetchFalso.mock.calls[0]!;
    expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer TOKEN-SECRETO' });
    expect(String((init as RequestInit).body)).not.toContain('TOKEN-SECRETO');
    const raw = JSON.parse(String((init as RequestInit).body)).raw as string;
    const mime = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    expect(mime).toContain('To: ana@citi.org.br');
  });

  it('401: descarta o token e repete UMA vez, com token novo', async () => {
    fetchFalso.mockResolvedValueOnce(resposta({}, 401)).mockResolvedValueOnce(resposta({ id: 'g-2' }));
    const r = await enviarPeloGmail({ de: 'eu@citi.org.br', para: ['ana@citi.org.br'], assunto: 'Oi', corpo: 'x' });
    expect(r.idDaMensagem).toBe('g-2');
    expect(descartar).toHaveBeenCalledWith('TOKEN-SECRETO');
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it('erro de servidor NÃO é repetido e deixa o desfecho incerto', async () => {
    fetchFalso.mockResolvedValue(resposta({}, 503));
    const erro = await enviarPeloGmail({ de: 'eu@citi.org.br', para: ['ana@citi.org.br'], assunto: 'Oi', corpo: 'x' }).catch(
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(ErroDeIntegracao);
    expect((erro as ErroDeIntegracao).codigo).toBe('indisponivel');
    expect((erro as ErroDeIntegracao).desfechoIncerto).toBe(true);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it('tempo esgotado: desfecho incerto, sem repetir', async () => {
    fetchFalso.mockRejectedValue(Object.assign(new Error('abort'), { name: 'AbortError' }));
    const erro = await enviarPeloGmail({ de: 'eu@citi.org.br', para: ['ana@citi.org.br'], assunto: 'Oi', corpo: 'x' }).catch(
      (e: unknown) => e,
    );
    expect((erro as ErroDeIntegracao).codigo).toBe('tempo_esgotado');
    expect((erro as ErroDeIntegracao).desfechoIncerto).toBe(true);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it('4xx é recusa clara: nada foi feito, desfecho NÃO é incerto', async () => {
    fetchFalso.mockResolvedValue(resposta({}, 400));
    const erro = await enviarPeloGmail({ de: 'eu@citi.org.br', para: ['ana@citi.org.br'], assunto: 'Oi', corpo: 'x' }).catch(
      (e: unknown) => e,
    );
    expect((erro as ErroDeIntegracao).desfechoIncerto).toBe(false);
  });

  it('o erro nunca carrega o token', async () => {
    fetchFalso.mockResolvedValue(resposta({}, 403));
    const erro = await enviarPeloGmail({ de: 'eu@citi.org.br', para: ['ana@citi.org.br'], assunto: 'Oi', corpo: 'x' }).catch(
      (e: unknown) => e,
    );
    expect(JSON.stringify(erro) + String((erro as Error).message)).not.toContain('TOKEN-SECRETO');
  });
});

describe('quando cada capacidade está disponível', () => {
  it('sem cliente OAuth: implementada, não configurada, com a dependência concreta', () => {
    const s = situacaoDe('email', CONEXAO, false);
    expect(s.estado).toBe('implemented_unconfigured');
    expect(s.dependencia).toMatch(/cliente OAuth/);
  });

  it('sem conta conectada: pede para conectar', () => {
    expect(situacaoDe('diretorio', null, true)).toMatchObject({ estado: 'implemented_unconfigured' });
    expect(situacaoDe('diretorio', null, true).dependencia).toMatch(/Conectar a conta/);
  });

  it('conta pessoal não tem diretório de organização', () => {
    const pessoal = { ...CONEXAO, email: 'x@gmail.com', dominio: '' };
    expect(situacaoDe('diretorio', pessoal, true).estado).toBe('implemented_unconfigured');
    expect(situacaoDe('diretorio', { ...pessoal, dominio: 'gmail.com' }, true).dependencia).toMatch(/pessoal/);
  });

  it('o Google não concedeu todos os escopos: a capacidade que depende do que faltou não abre', () => {
    const parcial = { ...CONEXAO, escopos: CONEXAO.escopos.filter((e) => e !== ESCOPO_GMAIL_ENVIAR) };
    expect(situacaoDe('email', parcial, true).estado).toBe('implemented_unconfigured');
    expect(situacaoDe('diretorio', parcial, true).estado).toBe('available');
  });

  it('conta do CITi com tudo concedido: disponível; desligar uma capacidade a fecha', async () => {
    expect((await estadoDasCapacidades()).email.estado).toBe('available');
    await ligarCapacidade('email', false);
    const estados = await estadoDasCapacidades();
    expect(estados.email.estado).toBe('disabled');
    expect(estados.agenda_eventos.estado).toBe('available');
  });

  it('conectar a conta guarda e-mail, domínio e os escopos CONCEDIDOS — nunca o token', async () => {
    fetchFalso.mockImplementation(async (url: string) =>
      url.includes('tokeninfo')
        ? resposta({ scope: ESCOPOS_DA_CONEXAO.join(' ') })
        : resposta({ email: 'Bia@CITI.org.br', hd: 'citi.org.br' }),
    );
    const c = await conectarConta();
    expect(c).toMatchObject({ email: 'bia@citi.org.br', dominio: 'citi.org.br' });
    expect(c.escopos).toEqual(expect.arrayContaining([ESCOPO_GMAIL_ENVIAR]));
    const guardado = JSON.stringify(
      (chrome.storage.local as unknown as { values: Record<string, unknown> }).values[STORAGE_KEYS.integracoes],
    );
    expect(guardado).not.toContain('TOKEN-SECRETO');
    // O token vai no corpo do POST do tokeninfo, nunca na URL.
    const tokeninfo = fetchFalso.mock.calls.find((c2) => String(c2[0]).includes('tokeninfo'))!;
    expect(String(tokeninfo[0])).not.toContain('TOKEN-SECRETO');
  });
});

describe('o diretório', () => {
  it('só devolve gente do domínio da conta conectada', async () => {
    fetchFalso.mockResolvedValue(
      resposta({
        people: [
          { names: [{ displayName: 'Ana Souza' }], emailAddresses: [{ value: 'ana.souza@citi.org.br' }] },
          { names: [{ displayName: 'Ana de Fora' }], emailAddresses: [{ value: 'ana@outra.com' }] },
          { names: [{ displayName: 'Ana Souza' }], emailAddresses: [{ value: 'ANA.SOUZA@citi.org.br' }] },
        ],
      }),
    );
    const r = await buscarNoDiretorio('ana');
    expect(r).toEqual([{ nome: 'Ana Souza', email: 'ana.souza@citi.org.br' }]);
    const url = new URL(String(fetchFalso.mock.calls[0]![0]));
    expect(url.pathname).toBe('/v1/people:searchDirectoryPeople');
    expect(url.searchParams.get('query')).toBe('ana');
  });

  it('conta pessoal: erro claro, sem chamada de rede', async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.integracoes]: { ...CONEXAO, dominio: '' } });
    await expect(buscarNoDiretorio('ana')).rejects.toMatchObject({ codigo: 'conta_pessoal' });
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});

describe('a agenda', () => {
  it('agenda que a conta não enxerga é "sem acesso", nunca "livre"', async () => {
    fetchFalso.mockResolvedValue(
      resposta({
        calendars: {
          'a@citi.org.br': { busy: [{ start: '2026-10-08T13:00:00Z', end: '2026-10-08T14:00:00Z' }] },
          'b@citi.org.br': { errors: [{ domain: 'global', reason: 'notFound' }] },
          // 'c' nem aparece na resposta
        },
      }),
    );
    const oc = await consultarOcupacao({
      emails: ['a@citi.org.br', 'b@citi.org.br', 'c@citi.org.br'],
      inicio: '2026-10-08T00:00:00Z',
      fim: '2026-10-09T00:00:00Z',
      fuso: 'America/Recife',
    });
    expect(oc['a@citi.org.br']).toEqual({
      acesso: true,
      ocupado: [{ inicio: '2026-10-08T13:00:00Z', fim: '2026-10-08T14:00:00Z' }],
    });
    expect(oc['b@citi.org.br']!.acesso).toBe(false);
    expect(oc['c@citi.org.br']!.acesso).toBe(false);
  });

  it('janelas livres respeitam quem está ocupado e ignoram quem não tem agenda visível', () => {
    const inicio = Date.parse('2026-10-08T12:00:00Z'); // 9h em Recife
    const fim = Date.parse('2026-10-08T21:00:00Z'); // 18h
    const livres = janelasLivres({
      ocupacao: {
        'a@citi.org.br': { acesso: true, ocupado: [{ inicio: '2026-10-08T12:00:00Z', fim: '2026-10-08T14:00:00Z' }] },
        'b@citi.org.br': { acesso: false, ocupado: [] },
      },
      inicio,
      fim,
      duracaoMin: 60,
      fuso: 'America/Recife',
      max: 3,
    });
    expect(livres[0]!.inicio).toBe('2026-10-08T14:00:00.000Z'); // depois do bloqueio de a
    expect(livres.length).toBeGreaterThan(0);
  });

  it('o id do evento sai da chave: estável, e no alfabeto que o Google aceita', () => {
    const id = idDeEventoDaChave('evento:abc');
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(idDeEventoDaChave('evento:abc')).toBe(id);
    expect(idDeEventoDaChave('evento:abd')).not.toBe(id);
  });

  it('criar de novo com a mesma chave bate no 409 e NÃO cria outro', async () => {
    const existente = { id: idDeEventoDaChave('k'), summary: 'Sync', status: 'confirmed', organizer: { self: true } };
    fetchFalso
      .mockResolvedValueOnce(resposta({ error: { code: 409 } }, 409))
      .mockResolvedValueOnce(resposta(existente));
    const r = await criarEventoNaAgenda({
      chave: 'k',
      titulo: 'Sync',
      inicio: '2026-10-08T14:00:00.000Z',
      fim: '2026-10-08T14:30:00.000Z',
      fuso: 'America/Recife',
      participantes: ['ana@citi.org.br'],
    });
    expect(r.jaExistia).toBe(true);
    const [, init] = fetchFalso.mock.calls[0]!;
    const corpo = JSON.parse(String((init as RequestInit).body));
    expect(corpo.id).toBe(idDeEventoDaChave('k'));
    expect(corpo.start.timeZone).toBe('America/Recife');
    expect(corpo.attendees).toEqual([{ email: 'ana@citi.org.br' }]);
  });

  it('cancelar um evento que já não existe não é erro', async () => {
    fetchFalso.mockResolvedValue(resposta({}, 410));
    await expect(cancelarEvento('abc12345')).resolves.toEqual({ jaCancelado: true });
  });
});

describe('os escopos', () => {
  it('o manifesto repete exatamente os escopos da conexão (teto), e a doc os lista', () => {
    const manifesto = readFileSync('manifest.config.ts', 'utf8');
    const doc = readFileSync('docs/integracoes-google-workspace.md', 'utf8');
    for (const escopo of ESCOPOS_DA_CONEXAO) {
      expect(manifesto, escopo).toContain(`'${escopo}'`);
      // A identidade já está documentada em google-oauth-setup.md; aqui, os da organização.
      if (!escopo.endsWith('userinfo.email') && escopo.startsWith('https://')) expect(doc, escopo).toContain(escopo);
    }
  });
});

describe('o registro das ações (idempotência)', () => {
  const base = { chave: 'email:1', tipo: 'email' as const, execucaoId: 'x1', conversaId: 'c1', payload: { a: 1 } };

  it('a segunda tentativa enquanto a primeira está em curso não envia', async () => {
    expect((await reservarExecucao(base)).tipo).toBe('reservado');
    expect((await reservarExecucao(base)).tipo).toBe('em_andamento');
  });

  it('depois de aceito, repetir devolve "já feito"', async () => {
    await reservarExecucao(base);
    await concluirAcao(base.chave, { estado: 'aceito', resultado: { id: 'g' } });
    expect((await reservarExecucao(base)).tipo).toBe('ja_feito');
  });

  it('desconhecido só repete com pedido explícito', async () => {
    await reservarExecucao(base);
    await concluirAcao(base.chave, { estado: 'desconhecido', erro: { codigo: 'tempo_esgotado', mensagem: 'x' } });
    expect((await reservarExecucao(base)).tipo).toBe('desconhecido');
    expect((await reservarExecucao({ ...base, permitirDesconhecido: true })).tipo).toBe('reservado');
  });

  it('recusa clara (falhou) pode ser tentada de novo', async () => {
    await reservarExecucao(base);
    await concluirAcao(base.chave, { estado: 'falhou', erro: { codigo: 'recusado', mensagem: 'x' } });
    expect((await reservarExecucao(base)).tipo).toBe('reservado');
  });

  it('"enviando" que ninguém concluiu (página morreu) vira desconhecido, não reenvio', async () => {
    await reservarExecucao(base);
    agora += ENVIANDO_VENCE_EM_MS + 1;
    const r = await obterAcao(base.chave);
    expect(r?.estado).toBe('desconhecido');
    expect((await reservarExecucao(base)).tipo).toBe('desconhecido');
  });

  it('rascunho guardado não é sobrescrito depois de enviado, e mantém a execução que o preparou', async () => {
    await guardarRascunho({ ...base, payload: { v: 1 } });
    const novo = await guardarRascunho({ ...base, execucaoId: 'x2', payload: { v: 2 } });
    expect(novo.execucaoId).toBe('x1');
    await reservarExecucao(base);
    await concluirAcao(base.chave, { estado: 'aceito', resultado: {} });
    const depois = await guardarRascunho({ ...base, execucaoId: 'x3', payload: { v: 3 } });
    expect(depois.estado).toBe('aceito');
    expect(depois.payload).toEqual({ a: 1 });
  });
});
