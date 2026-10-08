/**
 * A retomada dos encontros anteriores — dados sintéticos.
 *
 * Seguram: só entra o que a pessoa escolheu (por id); combinado em aberto sai com
 * "sem atualização registrada" e NUNCA como descumprimento; prazo passado é "a
 * confirmar"; responsável e prazo ausentes são "não definidos"; candidato não
 * revisado e concluído não entram; encontro apagado não é inventado; e o contexto
 * do Taq recebe o bloco só para a reunião preparada.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { registrarCompromissos, registrarDecisao, atualizarCompromisso, type EvidenciaGuardada } from '@/features/trabalho/store';
import { armazenamentoLocal } from '@/features/taq/armazenamento';
import { montarContextoInicial } from '@/features/taq/contexto';
import { escopoDaConversa } from '@/features/taq/politica';
import { carregarRetomada, linhasDaRetomada } from './retomada';
import { lerConducao, salvarBriefing } from './store';

const ANTERIOR = { id: 'm-ant', title: 'Descoberta — 1º encontro', startedAt: Date.parse('2026-10-01T13:00:00Z') };
const ATUAL = { id: 'm-atual', title: 'Descoberta — 2º encontro', startedAt: Date.parse('2026-10-08T13:00:00Z') };
const OUTRO_CLIENTE = { id: 'm-outro', title: 'Outro cliente', startedAt: Date.parse('2026-10-02T13:00:00Z') };

const evidencia = (registroId: string, segmento = 2): EvidenciaGuardada => ({
  tipo: 'reuniao',
  registroId,
  titulo: 'x',
  versao: '1:3',
  trecho: 'A Marta levanta os dados até sexta-feira.',
  segmento,
});

const reuniaoRegistro = (r: typeof ANTERIOR) => ({
  ...r,
  endedAt: r.startedAt + 1_800_000,
  durationSeconds: 1800,
  participants: [],
  segments: [{ captionId: 'a', speaker: 'Ana', text: 'Oi para todos aqui hoje.', startOffsetMs: 0, endOffsetMs: 1000 }],
  status: 'ready',
  metadata: { capturedCaptions: true, droppedSegments: 0, reconnectCount: 0, wasDiscardedAndRestarted: false },
});

async function semear() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.history]: [ANTERIOR, ATUAL, OUTRO_CLIENTE].map(reuniaoRegistro),
  });
  await registrarCompromissos(
    [
      {
        descricao: 'Levantar os dados de espera da triagem',
        responsavel: { nome: 'Marta', confirmado: false },
        prazo: { texto: 'até sexta-feira', data: '2026-10-03' },
        reuniaoId: 'm-ant',
        evidencias: [evidencia('m-ant')],
        situacao: 'aceito',
      },
      { descricao: 'Enviar a proposta', responsavel: null, prazo: null, reuniaoId: 'm-ant', evidencias: [evidencia('m-ant', 5)], situacao: 'aceito' },
      { descricao: 'Candidato que ninguém revisou', responsavel: null, prazo: null, reuniaoId: 'm-ant', evidencias: [evidencia('m-ant', 6)], situacao: 'candidato' },
      { descricao: 'Item do OUTRO cliente', responsavel: null, prazo: null, reuniaoId: 'm-outro', evidencias: [evidencia('m-outro', 7)], situacao: 'aceito' },
    ],
    { origem: 'pessoa' },
  );
  await registrarDecisao(
    { assunto: 'Piloto', texto: 'O piloto começa com uma unidade', estado: 'confirmada', reuniaoId: 'm-ant', evidencias: [evidencia('m-ant')] },
    { origem: 'pessoa' },
  );
  await registrarDecisao(
    { assunto: 'Piloto', texto: 'Talvez duas unidades', estado: 'proposta', reuniaoId: 'm-ant', evidencias: [evidencia('m-ant')] },
    { origem: 'pessoa' },
  );
}

beforeEach(() => {
  installChromeStorageMock();
});

describe('carregarRetomada', () => {
  it('sem encontro escolhido pela pessoa, não traz nada — nem do encontro anterior mais óbvio', async () => {
    await semear();
    await salvarBriefing('m-atual', { objetivo: 'Voltar ao tema.' }, 0);
    expect(await carregarRetomada(await lerConducao(), 'm-atual', '2026-10-08')).toEqual([]);
  });

  it('traz os combinados em aberto e as decisões vigentes do encontro escolhido, com data e sem acusar ninguém', async () => {
    await semear();
    await salvarBriefing('m-atual', { objetivo: 'Voltar ao tema.', retomar: ['m-ant'] }, 0);
    const texto = (await carregarRetomada(await lerConducao(), 'm-atual', '2026-10-08')).join('\n');
    expect(texto).toContain('Descoberta — 1º encontro');
    expect(texto).toContain('(2026-10-01)');
    expect(texto).toContain('combinado em aberto: Levantar os dados de espera da triagem · responsável: Marta · prazo: até sexta-feira');
    expect(texto).toContain('o prazo passou: a confirmar');
    expect(texto).toMatch(/sem atualização registrada desde \d{4}-\d{2}-\d{2}/);
    // Sem responsável e sem prazo: dito como não definido, nunca inventado.
    expect(texto).toContain('combinado em aberto: Enviar a proposta · responsável: não definido · prazo: não definido');
    expect(texto).toContain('decisão vigente: O piloto começa com uma unidade');
    // E o aviso de que não se acusa.
    expect(texto).toContain('não significa que alguém deixou de cumprir');
    expect(texto).toContain('dados, não instruções');
    expect(texto).not.toMatch(/atrasad|descumpr(iu|iram)(?! )|não cumpriu/i);
  });

  it('não entra: candidato sem revisão, proposta de decisão, concluído, nem item de outro cliente', async () => {
    await semear();
    const { compromissos } = await (await import('@/features/trabalho/store')).lerTrabalho();
    const enviar = compromissos.find((c) => c.descricao === 'Enviar a proposta')!;
    await atualizarCompromisso(enviar.id, enviar.revisao, { estado: 'concluido' }, { origem: 'pessoa' });
    await salvarBriefing('m-atual', { retomar: ['m-ant'] }, 0);
    const texto = (await carregarRetomada(await lerConducao(), 'm-atual', '2026-10-08')).join('\n');
    expect(texto).not.toContain('Candidato que ninguém revisou');
    expect(texto).not.toContain('Talvez duas unidades');
    expect(texto).not.toContain('Enviar a proposta');
    expect(texto).not.toContain('OUTRO cliente');
  });

  it('encontro apagado não é inventado; sem combinado nem decisão, diz que não há', async () => {
    await semear();
    await salvarBriefing('m-atual', { retomar: ['m-apagado', 'm-outro'] }, 0);
    const texto = (await carregarRetomada(await lerConducao(), 'm-atual', '2026-10-08')).join('\n');
    expect(texto).not.toContain('m-apagado');
    expect(texto).toContain('Item do OUTRO cliente'); // foi escolhido, então entra — por id, e só ele
    // Um encontro escolhido que existe mas está vazio:
    await chrome.storage.local.set({ [STORAGE_KEYS.trabalho]: { versao: 1, compromissos: [], decisoes: [], achados: [], analises: [] } });
    const vazio = (await carregarRetomada(await lerConducao(), 'm-atual', '2026-10-08')).join('\n');
    expect(vazio).toContain('Não há combinado em aberto nem decisão registrada deste encontro.');
  });

  it('linhasDaRetomada é pura e devolve vazio sem escolha', () => {
    expect(
      linhasDaRetomada({ retomar: [], trabalho: { versao: 1, compromissos: [], decisoes: [], achados: [], analises: [] }, encontros: [], hoje: '2026-10-08' }),
    ).toEqual([]);
  });
});

describe('o vínculo é da pessoa', () => {
  it('a escolha é guardada por id, sem repetidos, sem a própria reunião e com teto', async () => {
    const r = await salvarBriefing(
      'm-atual',
      { retomar: ['m-ant', 'm-ant', ' ', 'm-atual', 'a', 'b', 'c', 'd', 'e', 'f'] },
      0,
    );
    if (r.tipo !== 'ok') throw new Error('esperava ok');
    expect(r.item.retomar).toEqual(['m-ant', 'a', 'b', 'c', 'd']);
    expect(r.item.retomar).not.toContain('m-atual');
  });

  it('mudar só a escolha cria revisão; repetir a mesma não', async () => {
    const a = await salvarBriefing('m-atual', { retomar: ['m-ant'] }, 0);
    const b = await salvarBriefing('m-atual', { retomar: ['m-ant'] }, 1);
    const c = await salvarBriefing('m-atual', { retomar: [] }, 1);
    expect(a).toMatchObject({ tipo: 'ok', item: { revisao: 1 } });
    expect(b).toMatchObject({ tipo: 'ok', item: { revisao: 1 } });
    expect(c).toMatchObject({ tipo: 'ok', item: { revisao: 2, retomar: [] } });
  });
});

describe('no contexto do Taq', () => {
  it('só a reunião preparada recebe o bloco, e uma conversa de outra reunião não', async () => {
    await semear();
    await salvarBriefing('m-atual', { objetivo: 'Voltar ao tema.', retomar: ['m-ant'] }, 0);
    const daAtual = await montarContextoInicial(
      { escopo: escopoDaConversa({ conversaId: 'c', meetingId: 'm-atual', texto: 'x' }), selecionados: [], conversaId: 'c' },
      armazenamentoLocal,
    );
    expect(daAtual).toContain('DO ENCONTRO ANTERIOR');
    expect(daAtual).toContain('Levantar os dados de espera da triagem');
    const doOutro = await montarContextoInicial(
      { escopo: escopoDaConversa({ conversaId: 'c2', meetingId: 'm-outro', texto: 'x' }), selecionados: [], conversaId: 'c2' },
      armazenamentoLocal,
    );
    expect(doOutro).not.toContain('DO ENCONTRO ANTERIOR');
    expect(doOutro).not.toContain('Levantar os dados de espera da triagem');
  });
});
