// @vitest-environment node
/**
 * TESTE AO VIVO — o juiz dos acompanhamentos (`acompanhamento-v1`) contra o
 * servidor e o provedor DE VERDADE, com uma reunião INVENTADA.
 *
 * Pulado por padrão. Roda com o servidor no ar (ver `estado.live.test.ts`):
 *
 *   $env:TAQ_LIVE_URL = 'http://localhost:3100'
 *   $env:TAQ_LIVE_KEY = '<o DOCCITI_SHARED_KEY do servidor>'
 *   npx vitest run src/features/acompanhamento/juiz.live.test.ts
 *
 * O que o código garante é conferido (teto, ids). O que a IA julga é impresso
 * para leitura, e só a falta de um julgamento válido falha o teste.
 */
import { describe, expect, it } from 'vitest';
import { criarAdaptadorHttp } from '@/features/taq/modelo';
import { julgarAcompanhamentos } from './juiz';

const URL_AO_VIVO = process.env.TAQ_LIVE_URL;
const CHAVE = process.env.TAQ_LIVE_KEY;
const rodar = URL_AO_VIVO && CHAVE ? describe : describe.skip;

const CANDIDATOS = [
  { id: 'c1', descricao: 'Levantar a duração da fila da triagem', responsavel: 'Marta', prazo: 'sexta-feira', trecho: 'A Marta levanta os dados até sexta-feira.' },
  { id: 'c2', descricao: 'Pensar em um aplicativo no futuro', trecho: 'Acho que um dia a gente podia ter um aplicativo.' },
  { id: 'c3', descricao: 'Enviar a proposta de piloto ao cliente', responsavel: 'Ana', prazo: 'terça', trecho: 'Eu mando a proposta do piloto para vocês na terça.' },
  { id: 'c4', descricao: 'Mapear a fila da triagem', trecho: 'Alguém precisa mapear a fila da triagem.' },
  { id: 'c5', descricao: 'Tomar um café depois', trecho: 'Depois a gente toma um café.' },
  { id: 'c6', descricao: 'Definir o orçamento do piloto com a diretoria', responsavel: 'Cliente', trecho: 'Eu levo o orçamento para a diretoria decidir.' },
];

rodar('juiz dos acompanhamentos contra o provedor real', () => {
  it('escolhe no máximo as vagas, só entre os candidatos, e diz o porquê', async () => {
    const adaptador = criarAdaptadorHttp({ baseUrl: URL_AO_VIVO!, chave: CHAVE!, sintetica: true });
    const r = await julgarAcompanhamentos({
      adaptador,
      reuniao: { id: 'demo', titulo: 'Demonstração — Descoberta: atendimento da Prefeitura' },
      candidatos: CANDIDATOS,
      existentes: [],
      vagas: 3,
    });
    if (r.tipo === 'erro') throw new Error(`${r.codigo}: ${r.mensagem}`);
    console.log(JSON.stringify(r.julgamento, null, 2));
    expect(r.julgamento.escolhidos.length).toBeLessThanOrEqual(3);
    expect(r.julgamento.escolhidos.length).toBeGreaterThan(0);
    const ids = new Set(CANDIDATOS.map((c) => c.id));
    for (const e of r.julgamento.escolhidos) expect(ids.has(e.id)).toBe(true);
  }, 120_000);
});
