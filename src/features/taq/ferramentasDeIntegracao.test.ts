/**
 * E-mail, diretório e agenda pelo Taq — ponta a ponta, com o armazenamento
 * local de verdade (mock do chrome.storage) e o Google trocado por um roteador
 * de respostas. Dados sintéticos. NENHUM e-mail ou convite sai daqui.
 *
 * O que se prova: a ferramenta só existe quando a capacidade está disponível; o
 * efeito vem da frase da pessoa; endereço inventado não passa; sem pedido claro
 * há prévia e a confirmação só vale numa mensagem seguinte; tempo esgotado vira
 * "desconhecido" e não reenvia; "sem acesso" nunca vira "livre".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import type { MeetingRecord } from '@/shared/types/domain';
import { ESCOPOS_DA_CONEXAO, ESCOPO_GMAIL_ENVIAR } from '@/features/integracoes/escopos';
import type { ConexaoGuardada } from '@/features/integracoes/estado';
import { trocarDependencias } from '@/features/integracoes/google';
import { armazenamentoLocal } from './armazenamento';
import { LIMITES_PADRAO, type CartaoDaResposta, type Tarefa } from './contratos';
import { LivroDeEvidencias } from './evidencias';
import {
  CAPACIDADE_DA_FERRAMENTA,
  FERRAMENTAS_DE_INTEGRACAO,
  cancelEvent,
  createEvent,
  ferramentasDeIntegracaoDisponiveis,
  listAvailability,
  rescheduleEvent,
  searchDirectory,
  sendEmail,
} from './ferramentasDeIntegracao';
import { efeitosDoPedido } from './politica';
import { RegistroDeFerramentas, executarChamada } from './registroDeFerramentas';
import type { ContextoDeFerramenta, DefinicaoDeFerramenta } from './tipos';

const CONEXAO: ConexaoGuardada = {
  email: 'eu@citi.org.br',
  dominio: 'citi.org.br',
  escopos: [...ESCOPOS_DA_CONEXAO],
  concedidoEm: 1,
  desligadas: [],
};

const ANA = { names: [{ displayName: 'Ana Souza' }], emailAddresses: [{ value: 'ana.souza@citi.org.br' }] };
const ANA_LIMA = { names: [{ displayName: 'Ana Lima' }], emailAddresses: [{ value: 'ana.lima@citi.org.br' }] };
const BRUNO = { names: [{ displayName: 'Bruno Costa' }], emailAddresses: [{ value: 'bruno.costa@citi.org.br' }] };

const REUNIAO: MeetingRecord = {
  id: 'm-1',
  title: '[TESTE] Planejamento da sprint',
  startedAt: 0,
  endedAt: 600_000,
  durationSeconds: 600,
  participants: [],
  segments: [
    { captionId: 'a', speaker: 'Ana', text: 'Fechamos o escopo.', startOffsetMs: 0, endOffsetMs: 2_000 },
  ],
  status: 'ready',
  metadata: { capturedCaptions: true, droppedSegments: 0, reconnectCount: 0, wasDiscardedAndRestarted: false },
};

type Rota = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

let chamadas: Array<{ url: string; init?: RequestInit }>;
let rotaExtra: Rota | null;
let restaurar: () => void;
let docId: string;
let execucao = 0;

const noGmail = () => chamadas.filter((c) => c.url.includes('gmail.googleapis.com'));
const noCalendario = (metodo?: string) =>
  chamadas.filter((c) => c.url.includes('/calendar/v3/') && (!metodo || c.init?.method === metodo));

function diretorio(url: string): Response {
  const q = (new URL(url).searchParams.get('query') ?? '').toLowerCase();
  const todos = [ANA, ANA_LIMA, BRUNO];
  const achados = todos.filter(
    (p) =>
      p.names[0]!.displayName.toLowerCase().includes(q) || p.emailAddresses[0]!.value.toLowerCase().includes(q),
  );
  return json({ people: achados });
}

async function instalar(conexao: ConexaoGuardada | null = CONEXAO): Promise<void> {
  installChromeStorageMock({
    local: {
      [STORAGE_KEYS.history]: [REUNIAO],
      ...(conexao ? { [STORAGE_KEYS.integracoes]: conexao } : {}),
    },
    extra: { runtime: { getManifest: () => ({ oauth2: { client_id: 'abc.apps.googleusercontent.com' } }) } },
  });
  chamadas = [];
  rotaExtra = null;
  restaurar = trocarDependencias({
    fetch: (async (url: string, init?: RequestInit) => {
      chamadas.push({ url: String(url), ...(init ? { init } : {}) });
      if (String(url).includes('people:searchDirectoryPeople')) return diretorio(String(url));
      if (rotaExtra) return rotaExtra(String(url), init);
      return json({});
    }) as unknown as typeof fetch,
    token: async () => 'TOKEN-SECRETO',
    descartar: async () => undefined,
  });
  const { documento } = await armazenamentoLocal.criarDocumento(
    { title: 'Ata da sprint', content: '# Ata\nDecidimos fechar o escopo.', formato: 'markdown', tipo: 'ata' },
    { execucaoId: 'seed', chave: 'seed-1' },
  );
  docId = documento.id;
}

function ctx(
  pedido: string,
  opcoes: { efeitos?: Array<'leitura' | 'acao_externa'>; cartoes?: CartaoDaResposta[]; execucaoId?: string } = {},
): ContextoDeFerramenta {
  execucao += 1;
  const cartoes = opcoes.cartoes ?? [];
  const tarefa = {
    execucaoId: opcoes.execucaoId ?? `x${execucao}`,
    tarefaId: `t${execucao}`,
    conversaId: 'c1',
    agenteId: 'communication',
    objetivo: pedido,
    pedidoOriginal: pedido,
    entrada: {},
    selecionados: [],
    escopo: {
      reunioes: 'todas',
      documentos: 'todos',
      conversaId: 'c1',
      efeitos: opcoes.efeitos ?? efeitosDoPedido(pedido),
    },
    limites: LIMITES_PADRAO,
    profundidade: 1,
    sinal: new AbortController().signal,
  } as unknown as Tarefa;
  return {
    tarefa,
    armazenamento: armazenamentoLocal,
    livro: new LivroDeEvidencias(),
    registrarDocumento: () => undefined,
    registrarAusentes: () => undefined,
    registrarPergunta: () => undefined,
    registrarCopiavel: () => undefined,
    registrarOperacao: () => undefined,
    registrarEscritas: () => undefined,
    registrarCartao: (c) => {
      cartoes.push(c);
    },
    registrarRespostaFinal: () => undefined,
  };
}

const rodar = <A>(f: DefinicaoDeFerramenta<A>, args: unknown, c: ContextoDeFerramenta) =>
  f.executar(f.schemaDeEntrada.parse(args), c);

/** O MIME que foi para o Gmail, decodificado. */
function mimeEnviado(i = -1): string {
  const c = noGmail().at(i)!;
  const raw = JSON.parse(String(c.init!.body)).raw as string;
  const bin = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

/** O texto de uma parte base64 do MIME (anexo ou corpo). */
function partesDecodificadas(mime: string): string[] {
  return [...mime.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g)].map((m) =>
    new TextDecoder().decode(Uint8Array.from(atob(m[1]!.replace(/\s+/g, '')), (ch) => ch.charCodeAt(0))),
  );
}

beforeEach(async () => {
  execucao = 0;
  await instalar();
});
afterEach(() => restaurar());

describe('quando as ferramentas existem para o modelo', () => {
  it('com a conta do CITi conectada, todas; sem conta, nenhuma', async () => {
    expect((await ferramentasDeIntegracaoDisponiveis()).map((f) => f.nome).sort()).toEqual(
      FERRAMENTAS_DE_INTEGRACAO.map((f) => f.nome).sort(),
    );
    restaurar();
    await instalar(null);
    expect(await ferramentasDeIntegracaoDisponiveis()).toEqual([]);
  });

  it('escopo que o Google não concedeu esconde só a ferramenta que dependia dele', async () => {
    restaurar();
    await instalar({ ...CONEXAO, escopos: CONEXAO.escopos.filter((e) => e !== ESCOPO_GMAIL_ENVIAR) });
    const nomes = (await ferramentasDeIntegracaoDisponiveis()).map((f) => f.nome);
    expect(nomes).not.toContain('send_email');
    expect(nomes).toEqual(expect.arrayContaining(['search_directory', 'create_event', 'list_availability']));
  });

  it('toda ferramenta da família declara a capacidade de que depende', () => {
    for (const f of FERRAMENTAS_DE_INTEGRACAO) expect(CAPACIDADE_DA_FERRAMENTA[f.nome], f.nome).toBeTruthy();
  });

  it('o recorte do registro tira o que o efeito do pedido não autoriza', async () => {
    const registro = new RegistroDeFerramentas();
    for (const f of await ferramentasDeIntegracaoDisponiveis()) registro.registrar(f);
    const nomes = (pedido: string) =>
      registro
        .recortar(
          ['search_directory', 'send_email', 'create_event', 'list_availability'],
          ctx(pedido).tarefa.escopo,
          { semDelegacao: true },
        )
        .map((f) => f.nome)
        .sort();
    expect(nomes('o que decidimos na reunião?')).toEqual(['list_availability', 'search_directory']);
    expect(nomes('envie a ata para a Ana Souza')).toContain('send_email');
  });

  it('chamar send_email sem o efeito é recusado e nada sai', async () => {
    const c = ctx('o que decidimos na reunião?');
    const r = await executarChamada(
      [sendEmail as unknown as DefinicaoDeFerramenta],
      { nome: 'send_email', argumentos: { destinatarios: [{ nome: 'Ana Souza' }], assunto: 'a', corpo: 'b' } },
      c,
      20_000,
    );
    expect(r.ok).toBe(false);
    expect(r.codigoDeErro).toBe('efeito_nao_autorizado');
    expect(chamadas).toHaveLength(0);
  });
});

describe('o diretório', () => {
  it('devolve nome e e-mail reais, e manda perguntar quando são vários', async () => {
    const r = await rodar(searchDirectory, { consulta: 'ana' }, ctx('quem é a Ana?'));
    expect(r.total).toBe(2);
    expect(r.aviso).toMatch(/pergunte qual/);
    const um = await rodar(searchDirectory, { consulta: 'bruno' }, ctx('quem é o Bruno?'));
    expect(um.pessoas).toEqual([{ nome: 'Bruno Costa', email: 'bruno.costa@citi.org.br' }]);
  });
});

describe('enviar e-mail', () => {
  const PEDIDO_CLARO = 'envie a ata da sprint para a Ana Souza';

  it('pedido claro (quem, o quê): envia uma vez, com o anexo, e diz "aceito", não "entregue"', async () => {
    rotaExtra = () => json({ id: 'g-1' });
    const cartoes: CartaoDaResposta[] = [];
    const r = await rodar(
      sendEmail,
      { destinatarios: [{ nome: 'Ana Souza' }], assunto: 'Ata da sprint', corpo: 'Segue a ata.', anexos: [{ tipo: 'documento', id: docId }] },
      ctx(PEDIDO_CLARO, { cartoes }),
    );
    expect(r.enviado).toBe('aceito_pelo_google');
    expect(r.entrega_confirmada).toBe(false);
    expect(noGmail()).toHaveLength(1);
    const mime = mimeEnviado();
    expect(mime).toContain('To: ana.souza@citi.org.br');
    expect(mime).toContain('From: eu@citi.org.br');
    expect(partesDecodificadas(mime).join('\n')).toContain('Decidimos fechar o escopo.');
    expect(cartoes.at(-1)).toMatchObject({ tipo: 'acao_externa', estado: 'aceito', operacao: 'email' });
    // O token não aparece em nada que o modelo ou a tela vejam.
    expect(JSON.stringify([r, cartoes])).not.toContain('TOKEN-SECRETO');
  });

  it('o mesmo pedido de novo (retry do modelo, outra execução) não envia segunda vez', async () => {
    rotaExtra = () => json({ id: 'g-1' });
    const args = { destinatarios: [{ nome: 'Ana Souza' }], assunto: 'Ata da sprint', corpo: 'Segue a ata.', anexos: [{ tipo: 'documento', id: docId }] };
    await rodar(sendEmail, args, ctx(PEDIDO_CLARO));
    const segunda = await rodar(sendEmail, args, ctx(PEDIDO_CLARO));
    expect(segunda.enviado).toBe('ja_aceito');
    expect(noGmail()).toHaveLength(1);
  });

  it('chamadas simultâneas com o mesmo conteúdo: uma só sai', async () => {
    let liberar!: () => void;
    const portao = new Promise<void>((r) => {
      liberar = r;
    });
    rotaExtra = async () => {
      await portao;
      return json({ id: 'g-1' });
    };
    const args = { destinatarios: [{ nome: 'Ana Souza' }], assunto: 'Ata da sprint', corpo: 'Segue a ata.', anexos: [{ tipo: 'documento', id: docId }] };
    const a = rodar(sendEmail, args, ctx(PEDIDO_CLARO));
    const b = rodar(sendEmail, args, ctx(PEDIDO_CLARO));
    await vi.waitFor(() => expect(noGmail().length).toBeGreaterThan(0));
    liberar();
    const [ra, rb] = await Promise.all([a, b]);
    expect(noGmail()).toHaveLength(1);
    expect([ra.enviado, rb.enviado].sort()).toEqual(['aceito_pelo_google', 'em_andamento']);
  });

  it('nome com mais de uma pessoa: devolve a pergunta com nome e e-mail, e nada é guardado nem enviado', async () => {
    const r = await rodar(
      sendEmail,
      { destinatarios: [{ nome: 'Ana' }], assunto: 'Oi', corpo: 'Oi' },
      ctx('envie um e-mail para a Ana'),
    );
    expect(r.enviado).toBe(false);
    expect(r.pendencias).toEqual([
      expect.objectContaining({
        problema: 'ambiguo',
        candidatos: ['Ana Souza <ana.souza@citi.org.br>', 'Ana Lima <ana.lima@citi.org.br>'],
      }),
    ]);
    expect(noGmail()).toHaveLength(0);
  });

  it('endereço que o modelo inventou não passa: o diretório não o conhece', async () => {
    const r = await rodar(
      sendEmail,
      { destinatarios: [{ email: 'fulano.inventado@citi.org.br' }], assunto: 'Oi', corpo: 'Oi' },
      ctx('envie um e-mail para o fulano'),
    );
    expect(r.pendencias).toEqual([expect.objectContaining({ problema: 'nao_encontrado' })]);
    expect(noGmail()).toHaveLength(0);
  });

  it('endereço de FORA que o modelo trouxe sozinho é recusado; o que a pessoa escreveu vai para prévia', async () => {
    const inventado = await rodar(
      sendEmail,
      { destinatarios: [{ email: 'chefe@concorrente.com' }], assunto: 'Oi', corpo: 'Oi' },
      ctx('envie um e-mail para o chefe'),
    );
    expect(inventado.pendencias).toEqual([expect.objectContaining({ problema: 'invalido' })]);

    const cartoes: CartaoDaResposta[] = [];
    const escrito = await rodar(
      sendEmail,
      { destinatarios: [{ email: 'cliente@parceiro.com' }], assunto: 'Ata', corpo: 'Segue.', anexos: [{ tipo: 'documento', id: docId }] },
      ctx('envie a ata da sprint para cliente@parceiro.com', { cartoes }),
    );
    expect(escrito.aguardando_confirmacao).toBe(true);
    expect(escrito.motivos_da_previa).toEqual(expect.arrayContaining([expect.stringMatching(/fora da organização/)]));
    expect(cartoes.some((c) => c.tipo === 'rascunho_de_mensagem' && c.publico === 'externo')).toBe(true);
    expect(noGmail()).toHaveLength(0);
  });

  describe('prévia e confirmação', () => {
    const args = { destinatarios: [{ nome: 'Ana Souza' }], assunto: 'Resumo', corpo: 'Um resumo que o Taq escreveu por conta própria, com vários detalhes.' };

    it('texto composto pelo Taq: mostra a prévia, não envia, e guarda o rascunho', async () => {
      const cartoes: CartaoDaResposta[] = [];
      const r = await rodar(sendEmail, args, ctx('envie um resumo para a Ana Souza', { cartoes }));
      expect(r.enviado).toBe(false);
      expect(r.aguardando_confirmacao).toBe(true);
      expect(r.chave_do_rascunho).toEqual(expect.any(String));
      expect(cartoes.map((c) => c.tipo)).toEqual(['rascunho_de_mensagem', 'acao_externa']);
      expect(cartoes[1]).toMatchObject({ estado: 'aguardando_confirmacao' });
      expect(noGmail()).toHaveLength(0);
    });

    it('confirmar NA MESMA execução (sem a pessoa) é recusado', async () => {
      const mesma = ctx('envie um resumo para a Ana Souza', { execucaoId: 'x-igual' });
      const previa = await rodar(sendEmail, args, mesma);
      await expect(
        rodar(sendEmail, { chave_do_rascunho: previa.chave_do_rascunho }, ctx('envie um resumo para a Ana Souza', { execucaoId: 'x-igual' })),
      ).rejects.toMatchObject({ codigo: 'confirmacao_na_mesma_execucao' });
      expect(noGmail()).toHaveLength(0);
    });

    it('mensagem seguinte sem confirmação não envia; "pode enviar" envia EXATAMENTE o rascunho', async () => {
      rotaExtra = () => json({ id: 'g-9' });
      const previa = await rodar(sendEmail, args, ctx('envie um resumo para a Ana Souza'));
      await expect(
        rodar(sendEmail, { chave_do_rascunho: previa.chave_do_rascunho }, ctx('hmm, deixa eu pensar')),
      ).rejects.toMatchObject({ codigo: 'sem_confirmacao' });
      expect(noGmail()).toHaveLength(0);

      // O modelo tenta mudar o texto na confirmação: o que vale é o guardado.
      const r = await rodar(
        sendEmail,
        { chave_do_rascunho: previa.chave_do_rascunho, corpo: 'TEXTO TROCADO', destinatarios: [{ nome: 'Bruno Costa' }] },
        ctx('pode enviar'),
      );
      expect(r.enviado).toBe('aceito_pelo_google');
      const mime = mimeEnviado();
      expect(mime).toContain('To: ana.souza@citi.org.br');
      expect(mime).not.toContain('bruno.costa');
      expect(partesDecodificadas(mime).join('\n')).toContain('resumo que o Taq escreveu');
      expect(partesDecodificadas(mime).join('\n')).not.toContain('TEXTO TROCADO');
      expect(noGmail()).toHaveLength(1);

      // Confirmar de novo não reenvia.
      await expect(
        rodar(sendEmail, { chave_do_rascunho: previa.chave_do_rascunho }, ctx('pode enviar')),
      ).rejects.toMatchObject({ codigo: 'ja_feito' });
      expect(noGmail()).toHaveLength(1);
    });

    it('chave de outra conversa, ou inexistente, não confirma nada', async () => {
      await expect(rodar(sendEmail, { chave_do_rascunho: 'email:inventada' }, ctx('pode enviar'))).rejects.toMatchObject({
        codigo: 'rascunho_desconhecido',
      });
    });

    it('anexo que mudou depois da prévia: não envia a versão nova sem a pessoa ver', async () => {
      const comAnexo = { ...args, corpo: 'Segue.', anexos: [{ tipo: 'documento' as const, id: docId }], destinatarios: [{ nome: 'Ana Lima' }] };
      const previa = await rodar(sendEmail, comAnexo, ctx('envie a ata da sprint para a Ana'));
      expect(previa.aguardando_confirmacao).toBe(true);
      const doc = await armazenamentoLocal.obterDocumento(docId);
      await armazenamentoLocal.editarDocumento(docId, doc!.updatedAt, { content: '# Ata\nEDITADA depois da prévia.' });
      await expect(
        rodar(sendEmail, { chave_do_rascunho: previa.chave_do_rascunho }, ctx('pode enviar')),
      ).rejects.toMatchObject({ codigo: 'anexo_mudou' });
      expect(noGmail()).toHaveLength(0);
    });
  });

  describe('resultado incerto', () => {
    const args = { destinatarios: [{ nome: 'Ana Souza' }], assunto: 'Ata da sprint', corpo: 'Segue a ata.', anexos: [{ tipo: 'documento' as const, id: docId }] };

    it('timeout: "desconhecido", rascunho preservado, e NENHUM reenvio sozinho', async () => {
      rotaExtra = () => {
        throw Object.assign(new Error('abort'), { name: 'AbortError' });
      };
      const cartoes: CartaoDaResposta[] = [];
      const a = await rodar(sendEmail, { ...args, anexos: [{ tipo: 'documento', id: docId }] }, ctx(PEDIDO_CLARO, { cartoes }));
      expect(a.enviado).toBe('desconhecido');
      expect(a.aviso).toMatch(/NÃO reenvie/);
      expect(cartoes.at(-1)).toMatchObject({ tipo: 'acao_externa', estado: 'desconhecido' });

      // A pessoa pede o mesmo de novo: continua desconhecido, sem nova chamada.
      const b = await rodar(sendEmail, { ...args, anexos: [{ tipo: 'documento', id: docId }] }, ctx(PEDIDO_CLARO));
      expect(b.enviado).toBe('desconhecido');
      expect(noGmail()).toHaveLength(1);

      // Só com "reenvie mesmo assim" tenta de novo.
      rotaExtra = () => json({ id: 'g-2' });
      const c = await rodar(sendEmail, { ...args, anexos: [{ tipo: 'documento', id: docId }] }, ctx('reenvie mesmo assim a ata da sprint para a Ana Souza'));
      expect(c.enviado).toBe('aceito_pelo_google');
      expect(noGmail()).toHaveLength(2);
    });

    it('recusa do Google (4xx): "não enviado", e dá para tentar de novo depois', async () => {
      rotaExtra = () => json({}, 400);
      const a = await rodar(sendEmail, { ...args, anexos: [{ tipo: 'documento', id: docId }] }, ctx(PEDIDO_CLARO));
      expect(a.enviado).toBe(false);
      expect(a.aviso).toMatch(/preservado/);
      rotaExtra = () => json({ id: 'g-3' });
      const b = await rodar(sendEmail, { ...args, anexos: [{ tipo: 'documento', id: docId }] }, ctx(PEDIDO_CLARO));
      expect(b.enviado).toBe('aceito_pelo_google');
    });
  });

  it('transcrição de reunião em andamento vai marcada como PARCIAL, com aviso', async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [{ ...REUNIAO, status: 'recording' }] });
    rotaExtra = () => json({ id: 'g-4' });
    const cartoes: CartaoDaResposta[] = [];
    await rodar(
      sendEmail,
      { destinatarios: [{ nome: 'Ana Souza' }], assunto: 'Transcrição', corpo: 'Segue.', anexos: [{ tipo: 'transcricao', id: 'm-1' }] },
      ctx('envie a transcrição da reunião para a Ana Souza', { cartoes }),
    );
    expect(partesDecodificadas(mimeEnviado()).join('\n')).toMatch(/TRANSCRIÇÃO PARCIAL/);
    expect(JSON.stringify(cartoes)).toMatch(/PARCIAL/);
  });

  it('dado sensível no que vai sair: prévia com o alerta, mesmo com pedido claro', async () => {
    const r = await rodar(
      sendEmail,
      { destinatarios: [{ nome: 'Ana Souza' }], assunto: 'Dados', corpo: 'O CPF dele é 529.982.247-25.', anexos: [{ tipo: 'documento', id: docId }] },
      ctx('envie a ata da sprint para a Ana Souza'),
    );
    expect(r.aguardando_confirmacao).toBe(true);
    expect((r.alertas as string[]).join(' ')).toMatch(/CPF/i);
    expect(noGmail()).toHaveLength(0);
  });

  it('documento fora do escopo da conversa não é anexado', async () => {
    const c = ctx('envie a ata da sprint para a Ana Souza');
    c.tarefa.escopo.documentos = 'vinculados';
    await expect(
      rodar(
        sendEmail,
        { destinatarios: [{ nome: 'Ana Souza' }], assunto: 'Ata', corpo: 'Segue.', anexos: [{ tipo: 'documento', id: docId }] },
        c,
      ),
    ).rejects.toMatchObject({ codigo: 'fora_do_escopo' });
    expect(noGmail()).toHaveLength(0);
  });
});

describe('agenda', () => {
  const FUTURO = '2099-03-10';

  it('disponibilidade: quem a conta não enxerga é "sem acesso", e o aviso diz que é desconhecido', async () => {
    rotaExtra = (url) =>
      url.endsWith('/freeBusy')
        ? json({
            calendars: {
              'eu@citi.org.br': { busy: [] },
              'ana.souza@citi.org.br': { errors: [{ reason: 'notFound' }] },
            },
          })
        : json({});
    const r = await rodar(
      listAvailability,
      { participantes: [{ nome: 'Ana Souza' }], data_inicio: FUTURO },
      ctx('quando a Ana Souza está livre?'),
    );
    expect(r.sem_acesso).toEqual(['Ana Souza']);
    expect(r.aviso).toMatch(/DESCONHECIDA/);
    expect(JSON.stringify(r.por_pessoa)).toContain('"agenda_visivel":false');
  });

  it('o pedido diz horário e convidado: cria direto, no fuso explícito, e o Google envia o convite', async () => {
    rotaExtra = (url, init) =>
      url.includes('/freeBusy')
        ? json({ calendars: { 'ana.souza@citi.org.br': { busy: [] } } })
        : init?.method === 'POST'
          ? json({ id: 'ev1', summary: 'Retro', htmlLink: 'https://calendar.google.com/event?eid=1', status: 'confirmed' })
          : json({});
    const cartoes: CartaoDaResposta[] = [];
    const r = await rodar(
      createEvent,
      { titulo: 'Retro', data: FUTURO, hora: '14:00', duracao_min: 45, participantes: [{ nome: 'Ana Souza' }] },
      ctx(`marque a retro dia ${FUTURO} às 14h com a Ana Souza`, { cartoes }),
    );
    expect(r.criado).toBe('criado');
    const post = noCalendario('POST').find((c) => c.url.includes('/events?sendUpdates=all'))!;
    const corpo = JSON.parse(String(post.init!.body));
    expect(corpo.attendees).toEqual([{ email: 'ana.souza@citi.org.br' }]);
    expect(corpo.start.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Recife');
    expect(cartoes.at(-1)).toMatchObject({ tipo: 'acao_externa', estado: 'aceito', operacao: 'evento_criar' });
  });

  it('horário só deduzido: prévia; nada é criado até a pessoa dizer "pode marcar"', async () => {
    rotaExtra = (url, init) =>
      url.includes('/freeBusy')
        ? json({ calendars: { 'ana.souza@citi.org.br': { busy: [] } } })
        : init?.method === 'POST'
          ? json({ id: 'ev2', summary: 'Retro', status: 'confirmed' })
          : json({});
    const previa = await rodar(
      createEvent,
      { titulo: 'Retro', data: FUTURO, hora: '14:00', participantes: [{ nome: 'Ana Souza' }] },
      ctx('marque a retro com a Ana Souza'),
    );
    expect(previa.aguardando_confirmacao).toBe(true);
    expect(noCalendario('POST').filter((c) => c.url.includes('/events?'))).toHaveLength(0);
    const feito = await rodar(createEvent, { chave_do_rascunho: previa.chave_do_rascunho }, ctx('pode marcar'));
    expect(feito.criado).toBe('criado');
    expect(noCalendario('POST').filter((c) => c.url.includes('/events?'))).toHaveLength(1);
  });

  it('evento no passado é recusado; fala da reunião não concede o efeito', async () => {
    await expect(
      rodar(createEvent, { titulo: 'Retro', data: '2001-01-01', hora: '10:00' }, ctx('marque a retro às 10h')),
    ).rejects.toMatchObject({ codigo: 'horario_passado' });
    // O efeito vem da frase da pessoa: uma pergunta de leitura não o traz.
    expect(efeitosDoPedido('o que combinamos sobre marcar a retro?')).not.toContain('acao_externa');
  });

  it('só remarca e cancela evento que a pessoa organiza', async () => {
    rotaExtra = () => json({ id: 'evx', summary: 'Evento de outra pessoa', status: 'confirmed', organizer: { self: false }, attendees: [] });
    await expect(
      rodar(rescheduleEvent, { evento_id: 'evx12345', data: FUTURO, hora: '10:00' }, ctx('remarque o evento às 10h')),
    ).rejects.toMatchObject({ codigo: 'evento_de_outra_pessoa' });
    await expect(rodar(cancelEvent, { evento_id: 'evx12345' }, ctx('cancele o evento'))).rejects.toMatchObject({
      codigo: 'evento_de_outra_pessoa',
    });
    expect(noCalendario('PATCH')).toHaveLength(0);
    expect(noCalendario('DELETE')).toHaveLength(0);
  });

  it('cancelar evento com convidados: SEMPRE prévia, e só com "pode cancelar" cancela', async () => {
    rotaExtra = (_url, init) =>
      init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : json({
            id: 'ev3abcde',
            summary: 'Alinhamento de escopo',
            status: 'confirmed',
            organizer: { self: true },
            attendees: [{ email: 'ana.souza@citi.org.br' }],
          });
    const previa = await rodar(
      cancelEvent,
      { evento_id: 'ev3abcde' },
      ctx('cancele o alinhamento de escopo'),
    );
    expect(previa.aguardando_confirmacao).toBe(true);
    expect(noCalendario('DELETE')).toHaveLength(0);
    const feito = await rodar(cancelEvent, { chave_do_rascunho: previa.chave_do_rascunho }, ctx('pode cancelar'));
    expect(feito.feito).toBe('cancelado');
    expect(noCalendario('DELETE')).toHaveLength(1);
    expect(noCalendario('DELETE')[0]!.url).toContain('sendUpdates=all');
  });

  it('timeout ao criar: "desconhecido"; repetir o pedido não cria outro', async () => {
    rotaExtra = (url) => {
      if (url.includes('/freeBusy')) return json({ calendars: { 'ana.souza@citi.org.br': { busy: [] } } });
      throw Object.assign(new Error('abort'), { name: 'AbortError' });
    };
    const pedido = `marque a retro dia ${FUTURO} às 14h com a Ana Souza`;
    const args = { titulo: 'Retro', data: FUTURO, hora: '14:00', participantes: [{ nome: 'Ana Souza' }] };
    const a = await rodar(createEvent, args, ctx(pedido));
    expect(a.criado).toBe('desconhecido');
    const b = await rodar(createEvent, args, ctx(pedido));
    expect(b.criado).toBe('desconhecido');
    expect(noCalendario('POST').filter((c) => c.url.includes('/events?'))).toHaveLength(1);
  });
});
