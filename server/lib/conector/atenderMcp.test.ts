/**
 * A CASCA HTTP do conector — a parte que não tinha teste, e onde o bug estava.
 *
 * ── O bug que este arquivo existe para nunca mais deixar passar ───────────
 *
 * O transporte responde, por padrão, com um stream SSE: `handleRequest`
 * devolve uma `Response` cujo corpo ainda vai ser preenchido. O `finally`
 * fechava transporte e servidor imediatamente, antes do primeiro byte — e o
 * cliente recebia **200 com corpo vazio**, ficando pendurado até estourar o
 * tempo.
 *
 * O sintoma enganava de três formas ao mesmo tempo:
 *
 *   - o status era 200, então monitor de uptime dizia "no ar";
 *   - o log do servidor registrava sucesso, porque do lado de cá correu bem;
 *   - `curl` e `fetch` "funcionavam", porque ler um corpo vazio não lança.
 *
 * Nada disso é exótico: é o resultado normal de testar um servidor HTTP com
 * ferramentas que só olham o status. O que revelou foi um cliente de MCP de
 * verdade, que ESPERA a resposta chegar.
 *
 * Por isso a asserção central aqui não é "respondeu 200". É **o corpo tem o
 * resultado dentro, e é JSON parseável**. Um teste que só checasse o status
 * passaria com o bug de volta.
 *
 * Vale ser exato sobre o que estas asserções pegam. Dentro do processo, o
 * stream SSE se enche rápido demais para a corrida acontecer — então o que
 * falha ao reintroduzir o bug não é "corpo vazio", é "corpo em SSE, não
 * JSON" (`Unexpected token 'e', "event: mes"...`). Ou seja: o teste tranca a
 * CONFIGURAÇÃO que causava a corrida, não o instante em que ela acontecia.
 * É a proteção possível aqui — reproduzir a corrida exigiria o tempo de rede
 * de um ambiente serverless — e ela basta, porque a corrida só volta se
 * alguém voltar ao modo SSE, e aí estes testes ficam vermelhos.
 *
 * ── Por que testar `atenderMcp` e não a rota ──────────────────────────────
 *
 * `vitest.config.mts` só inclui `lib/**`, e a rota é uma casca de três linhas
 * sobre esta função. O que tem substância — resolver o token, montar o
 * servidor, materializar a resposta, fechar sem cortar — está tudo aqui.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextRequest } from 'next/server';
import { atenderMcp } from './atenderMcp';
import type { Consultador } from './banco';
import { gravarReuniao } from './escrita';
import { garantirPessoa } from './pessoa';
import { criarTokenDoConector, revogarToken } from '@/lib/identidade/tokenDoConector';
import type { ReuniaoDoAcervo } from './tipos';

const ENDERECO = 'https://exemplo.test/api/mcp';

const REUNIAO: ReuniaoDoAcervo = {
  id: 'r1',
  titulo: 'Planejamento do trimestre',
  inicioMs: Date.UTC(2026, 8, 1, 14),
  duracaoSegundos: 1800,
  participantes: ['Ana', 'Bruno'],
  falas: [
    { falante: 'Ana', texto: 'O prazo do relatório é dia doze.', offsetMs: 0 },
    { falante: 'Bruno', texto: 'Eu cuido do relatório então.', offsetMs: 4000 },
  ],
};

/** Uma requisição como um cliente de MCP a monta. */
function requisicao(corpo: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request(ENDERECO, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(corpo),
  }) as unknown as NextRequest;
}

const INICIALIZAR = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'teste', version: '1' },
  },
};

describe('atenderMcp', () => {
  let pglite: PGlite;
  let pool: Consultador;
  let token: string;
  let pessoaId: string;

  beforeAll(async () => {
    pglite = new PGlite();
    pool = pglite as unknown as Consultador;
    await pglite.exec(readFileSync(join(process.cwd(), 'lib', 'conector', 'esquema.sql'), 'utf8'));

    pessoaId = await garantirPessoa(
      { googleSub: `casca-${Date.now()}`, email: 'ana@citi.org.br' },
      pool,
    );
    await gravarReuniao(pessoaId, REUNIAO, pool);
    ({ token } = await criarTokenDoConector(pessoaId, 'teste', pool));
  });

  afterAll(async () => {
    await pglite.close();
  });

  describe('a resposta chega inteira', () => {
    it('initialize devolve um corpo com resultado, não um 200 vazio', async () => {
      // ESTA é a asserção que o bug derrubava. Ver o cabeçalho do arquivo.
      const r = await atenderMcp(requisicao(INICIALIZAR), { token, origem: 'caminho' }, pool);
      expect(r.status).toBe(200);

      const texto = await r.text();
      expect(texto.length).toBeGreaterThan(0);
      expect(texto).toContain('serverInfo');
      expect(texto).toContain('taqciti');
    });

    it('o corpo é JSON de verdade, parseável — não um stream pela metade', async () => {
      const r = await atenderMcp(requisicao(INICIALIZAR), { token, origem: 'caminho' }, pool);
      const corpo = JSON.parse(await r.text()) as { result?: { serverInfo?: unknown } };
      expect(corpo.result?.serverInfo).toBeDefined();
    });

    it('tools/list traz as ferramentas, e o acervo responde de verdade', async () => {
      // Duas requisições porque o modo sem sessão trata cada uma isolada:
      // é exatamente assim que um cliente fala com este servidor.
      await atenderMcp(requisicao(INICIALIZAR), { token, origem: 'caminho' }, pool);
      const r = await atenderMcp(
        requisicao({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
        { token, origem: 'caminho' },
        pool,
      );
      const corpo = JSON.parse(await r.text()) as {
        result?: { tools?: { name: string }[] };
      };
      const nomes = (corpo.result?.tools ?? []).map((t) => t.name);
      expect(nomes).toContain('buscar');
      expect(nomes).toContain('ler');
    });

    it('uma busca atravessa a casca inteira e acha o que está no acervo', async () => {
      const r = await atenderMcp(
        requisicao({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'buscar', arguments: { consulta: 'relatório' } },
        }),
        { token, origem: 'caminho' },
        pool,
      );
      const texto = await r.text();
      expect(texto).toContain('Planejamento do trimestre');
    });
  });

  describe('tolerância a cliente desleixado', () => {
    it('POST sem o Accept de SSE funciona, em vez de 406', async () => {
      // O transporte exigiria `application/json, text/event-stream`. Uma
      // sonda de verificação não manda isso, e um 406 aqui vira "não foi
      // possível verificar o servidor" na tela de quem está conectando.
      const r = await atenderMcp(
        requisicao(INICIALIZAR, { accept: 'application/json' }),
        { token, origem: 'caminho' },
        pool,
      );
      expect(r.status).toBe(200);
      expect(await r.text()).toContain('serverInfo');
    });

    it('GET simples responde 200 dizendo o que é este endereço', async () => {
      const r = await atenderMcp(
        new Request(ENDERECO, { method: 'GET' }) as unknown as NextRequest,
        { token, origem: 'caminho' },
        pool,
      );
      expect(r.status).toBe(200);
      expect(await r.text()).toContain('conector MCP');
    });

    it('GET pedindo SSE recebe 405 — sem sessão, não há canal a abrir', async () => {
      // 405 e não um stream vazio: um stream que nunca fala prenderia a
      // função serverless até o tempo limite, cobrando por silêncio.
      const r = await atenderMcp(
        new Request(ENDERECO, {
          method: 'GET',
          headers: { accept: 'text/event-stream' },
        }) as unknown as NextRequest,
        { token, origem: 'caminho' },
        pool,
      );
      expect(r.status).toBe(405);
    });
  });

  describe('credencial', () => {
    it('sem token, a recusa vai no CORPO — nada de 401 nem `WWW-Authenticate`', async () => {
      // Um 401 daqui manda o cliente procurar servidor de autorização e tentar
      // registro dinâmico de cliente, que neste servidor não existe: a pessoa
      // lê "não foi possível registrar no serviço de login de TaqCiti" em vez
      // de saber que o token está errado. Ver o bloco em `atenderMcp.ts`.
      const r = await atenderMcp(requisicao(INICIALIZAR), { token: null, origem: 'ausente' }, pool);
      expect(r.status).toBe(200);
      expect(r.headers.get('www-authenticate')).toBeNull();

      const corpo = JSON.parse(await r.text()) as {
        result?: unknown;
        error?: { code?: number; message?: string };
        id?: unknown;
      };
      expect(corpo.result).toBeUndefined();
      expect(corpo.error?.message).toContain('Conexões');
      // O `id` casa a resposta com a requisição. Sem ele o cliente não
      // reconhece esta resposta e espera até estourar o tempo — um travamento
      // silencioso no lugar de uma frase que resolve.
      expect(corpo.id).toBe(INICIALIZAR.id);
    });

    it('token revogado deixa de valer na hora, e diz isso em texto', async () => {
      const { token: descartavel, id } = await criarTokenDoConector(pessoaId, 'curto', pool);
      const antes = await atenderMcp(
        requisicao(INICIALIZAR),
        { token: descartavel, origem: 'caminho' },
        pool,
      );
      const aceito = JSON.parse(await antes.text()) as { result?: { serverInfo?: unknown } };
      expect(aceito.result?.serverInfo).toBeDefined();

      await revogarToken(pessoaId, id, pool);

      const depois = await atenderMcp(
        requisicao(INICIALIZAR),
        { token: descartavel, origem: 'caminho' },
        pool,
      );
      // 200 é o status; o que separa aceito de recusado é o corpo. Uma
      // asserção só de status aqui passaria com o servidor entregando o
      // acervo para um token revogado.
      expect(depois.status).toBe(200);
      const corpo = JSON.parse(await depois.text()) as {
        result?: unknown;
        error?: { message?: string };
      };
      expect(corpo.result).toBeUndefined();
      expect(corpo.error?.message).toContain('revogado');
    });

    it('o acervo devolvido é o da pessoa do token, não o de outra', async () => {
      // Sem isto, um `pessoa_id` esquecido num WHERE entregaria a reunião de
      // alguém para o conector de outro — incidente, não bug.
      const outra = await garantirPessoa(
        { googleSub: `outra-${Date.now()}`, email: 'bia@citi.org.br' },
        pool,
      );
      const { token: tokenDaOutra } = await criarTokenDoConector(outra, 'outra', pool);

      const r = await atenderMcp(
        requisicao({
          jsonrpc: '2.0',
          id: 9,
          method: 'tools/call',
          params: { name: 'buscar', arguments: { consulta: 'relatório' } },
        }),
        { token: tokenDaOutra, origem: 'caminho' },
        pool,
      );
      expect(await r.text()).not.toContain('Planejamento do trimestre');
    });
  });
});
