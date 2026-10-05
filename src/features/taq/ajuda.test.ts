/**
 * A referência de ajuda contra o aplicativo de verdade.
 *
 * O que estes testes seguram: a referência não pode citar botão que não existe,
 * ferramenta que não está registrada, nem apresentar como planejado um
 * especialista que já foi ativado (ou vice-versa). Quando o app muda, é aqui
 * que quebra — e a mensagem diz qual entrada atualizar.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ASSUNTOS,
  FORA_DO_APP,
  FUNCIONALIDADES,
  capacidadesDoApp,
  guiaDeUso,
} from './ajuda';
import { FERRAMENTAS_BASE } from './ferramentas';
import { FERRAMENTAS_DE_APP } from './ferramentasDeApp';
import { FERRAMENTAS_DE_INTEGRACAO } from './ferramentasDeIntegracao';
import { FERRAMENTAS_DE_TRABALHO } from './ferramentasDeTrabalho';
import { criarRegistroPadrao } from './orquestrador';

const REGISTRADAS = new Set(
  [...FERRAMENTAS_BASE, ...FERRAMENTAS_DE_APP, ...FERRAMENTAS_DE_TRABALHO, ...FERRAMENTAS_DE_INTEGRACAO].map(
    (f) => f.nome,
  ),
);
/** Ferramentas que não são operação de funcionalidade: leitura de conteúdo e a própria ajuda. */
const SEM_FUNCIONALIDADE = new Set([
  'read_meeting',
  'read_document',
  'read_conversation',
  'list_document_types',
  'ask_user',
  'delegate_task',
  'get_app_capabilities',
  'get_usage_guide',
  // Leituras e passos intermediários dos especialistas de trabalho: a operação
  // de tela correspondente é a do registro/atualização.
  'read_analysis',
  'list_commitments',
  'list_decisions',
  'list_findings',
  'suggest_commitments',
  'link_dependency',
]);

const titulosDe = (r: ReturnType<typeof guiaDeUso>) => r.guias.map((g) => g.titulo);
const idDoTitulo = (titulo: string) => FUNCIONALIDADES.find((f) => f.titulo === titulo)!.id;
const idsDe = (r: ReturnType<typeof guiaDeUso>) => titulosDe(r).map(idDoTitulo);

describe('a referência contra o código', () => {
  it('ids únicos e assuntos conhecidos', () => {
    const ids = [...FUNCIONALIDADES.map((f) => f.id), ...FORA_DO_APP.map((f) => f.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FUNCIONALIDADES) expect(ASSUNTOS).toContain(f.assunto);
  });

  it('todo arquivo de implementação existe', () => {
    for (const f of FUNCIONALIDADES)
      for (const arquivo of f.implementacao)
        expect(existsSync(arquivo), `${f.id}: ${arquivo}`).toBe(true);
  });

  it('todo rótulo citado existe, literalmente, na implementação da funcionalidade', () => {
    const faltam = FUNCIONALIDADES.flatMap((f) => {
      const fonte = f.implementacao.map((a) => readFileSync(a, 'utf8')).join('\n');
      return f.rotulos.filter((r) => !fonte.includes(r)).map((r) => `${f.id}: “${r}”`);
    });
    expect(faltam).toEqual([]);
  });

  it('todo nome entre aspas nos passos está na lista de rótulos (e portanto conferido)', () => {
    const soltos = FUNCIONALIDADES.flatMap((f) =>
      (f.passos.join(' ').match(/“([^”]+)”/g) ?? [])
        .map((c) => c.slice(1, -1))
        // Composto na tela (“Baixar .md”): conferido só pelo script da interface.
        .filter((r) => !COMPOSTOS.has(r) && !f.rotulos.includes(r))
        .map((r) => `${f.id}: “${r}”`),
    );
    expect(soltos).toEqual([]);
  });

  it('toda ferramenta citada está registrada e é declarada por um agente disponível', () => {
    const agentes = criarRegistroPadrao();
    const declaradas = new Set(
      agentes
        .todos()
        .filter((a) => a.estado === 'available')
        .flatMap((a) => a.ferramentasPermitidas),
    );
    for (const f of FUNCIONALIDADES) {
      if (!f.ferramenta) continue;
      expect(REGISTRADAS, `${f.id}: ${f.ferramenta}`).toContain(f.ferramenta);
      expect(declaradas, `${f.id}: ${f.ferramenta} não é de nenhum agente`).toContain(f.ferramenta);
      expect(f.comoPedir, `${f.id}: falta comoPedir`).toBeTruthy();
    }
  });

  it('toda ferramenta de operação registrada tem a sua funcionalidade', () => {
    const cobertas = new Set(FUNCIONALIDADES.map((f) => f.ferramenta).filter(Boolean));
    for (const nome of REGISTRADAS) {
      if (SEM_FUNCIONALIDADE.has(nome)) continue;
      expect(cobertas, `ferramenta ${nome} sem entrada na referência`).toContain(nome);
    }
  });

  it('o que está como planejado continua planejado no catálogo', () => {
    const agentes = criarRegistroPadrao();
    for (const x of FORA_DO_APP) {
      if (x.situacao !== 'planejado') continue;
      expect(x.agentePlanejado, `${x.id}: planejado sem especialista`).toBeTruthy();
      expect(agentes.obter(x.agentePlanejado!)?.estado, x.id).toBe('planned');
    }
  });

  it('entrada marcada "interface" teve todos os rótulos vistos pela volta na tela', () => {
    const marcadas = FUNCIONALIDADES.filter((f) => f.verificacao === 'interface');
    if (!marcadas.length) return;
    const arquivo = 'docs/verification/ajuda/resultado.json';
    expect(existsSync(arquivo), 'rode scripts/verify-ajuda.cjs').toBe(true);
    const { vistos } = JSON.parse(readFileSync(arquivo, 'utf8')) as { vistos: string[] };
    const tela = new Set(vistos);
    for (const f of marcadas)
      for (const rotulo of f.rotulos) expect(tela.has(rotulo), `${f.id}: “${rotulo}”`).toBe(true);
  });
});

/** Rótulos montados na tela (não aparecem literais no código) — conferidos só no navegador. */
const COMPOSTOS = new Set(['Baixar .md', 'Baixar .txt', '×', 'Esc']);

describe('get_usage_guide', () => {
  it('funções existentes: encontra a certa, com os passos e os nomes da tela', () => {
    expect(idsDe(guiaDeUso('Como começo uma transcrição?', REGISTRADAS))).toContain(
      'registrar_reuniao',
    );
    expect(idsDe(guiaDeUso('Onde ficam minhas reuniões?', REGISTRADAS))).toContain(
      'ver_reunioes',
    );
    const ata = guiaDeUso('Como gero uma ata?', REGISTRADAS);
    expect(idsDe(ata)[0]).toBe('gerar_documento');
    expect(ata.guias[0]!.passos.join(' ')).toMatch(/“Criar documento”/);
    expect(idsDe(guiaDeUso('Como edito um documento?', REGISTRADAS))).toContain(
      'editar_documento',
    );
    expect(idsDe(guiaDeUso('Como apago uma conversa?', REGISTRADAS))).toEqual([
      'apagar_conversa',
    ]);
    expect(idsDe(guiaDeUso('Como envio ao Google Docs?', REGISTRADAS))[0]).toBe(
      'enviar_google_docs',
    );
  });

  it('assunto errado vindo do modelo não esconde a resposta certa (visto ao vivo)', () => {
    for (const assunto of ASSUNTOS)
      expect(idsDe(guiaDeUso('Como eu gero uma ata no TaqCiti?', REGISTRADAS, assunto))).toContain(
        'gerar_documento',
      );
  });

  it('o passo de baixar documento é o botão que aparece sempre, não o de falha', () => {
    const g = guiaDeUso('Como baixo um documento?', REGISTRADAS).guias.find(
      (x) => idDoTitulo(x.titulo) === 'baixar_documento',
    )!;
    expect(g.passos[0]).toMatch(/“Baixar \.md”/);
    expect(g.limitacoes.join(' ')).toMatch(/“Baixar rascunho” só aparece quando o salvamento falhou/);
  });

  it('funções inexistentes: dito como inexistente, sem guia inventado', () => {
    const zoom = guiaDeUso('Funciona no Zoom?', REGISTRADAS);
    expect(zoom.guias).toEqual([]);
    expect(zoom.fora_do_app[0]).toMatchObject({ situacao: 'indisponivel' });
    expect(zoom.fora_do_app[0]!.resposta).toMatch(/só no Google Meet/);

    const tema = guiaDeUso('Como mudo o tema para escuro?', REGISTRADAS);
    expect(tema.fora_do_app.map((x) => x.situacao)).toEqual(['indisponivel']);
    expect(tema.fora_do_app[0]!.resposta).toMatch(/não tem tela de configurações/);

    const jira = guiaDeUso('Como integro com o Jira?', REGISTRADAS);
    expect(jira).toMatchObject({ encontrou: false, guias: [], fora_do_app: [] });
    expect(jira.aviso).toMatch(/não está documentado/);
  });

  it('e-mail e agenda dependem da conta do CITi: com ela o Taq executa; sem ela, só rascunho e sugestão', () => {
    const email = guiaDeUso('Dá para mandar a ata por e-mail para o cliente?', REGISTRADAS);
    expect(idsDe(email)).toContain('enviar_email');
    // O guia traz o pré-requisito e a limitação: sem a conta, só rascunho.
    const guia = email.guias.find((g) => idDoTitulo(g.titulo) === 'enviar_email')!;
    expect(guia.pre_requisitos.join(' ')).toMatch(/conta do CITi conectada em “Conexões”/);
    expect(guia.limitacoes.join(' ')).toMatch(/Sem a conta conectada o Taq só prepara o rascunho/);
    // E o que continua inexistente segue dito como inexistente — sem prometer envio sem conta.
    const whats = guiaDeUso('Integra com WhatsApp ou Slack?', REGISTRADAS);
    expect(whats.fora_do_app[0]).toMatchObject({ situacao: 'indisponivel' });
    expect(whats.fora_do_app[0]!.resposta).toMatch(/Sem a conta conectada ele não envia/);
    expect(whats.fora_do_app[0]!.resposta).toMatch(/Conexões/);
    const rascunho = guiaDeUso('Prepare um rascunho de e-mail para a Ana', REGISTRADAS);
    expect(idsDe(rascunho)).toContain('rascunho_de_mensagem');
    const agenda = guiaDeUso('Consigo agendar a próxima reunião pelo TaqCiti?', REGISTRADAS);
    expect(idsDe(agenda)).toContain('sugerir_horario');
    expect(agenda.fora_do_app.map((x) => x.resposta).join(' ')).toMatch(/não consulta a agenda/);
  });

  it('sem a conta conectada, enviar e-mail NÃO conta como operação que o agente executa', () => {
    const semConta = new Set([...REGISTRADAS].filter((n) => !FERRAMENTAS_DE_INTEGRACAO.some((f) => f.nome === n)));
    const por = (s: ReadonlySet<string>, id: string) =>
      capacidadesDoApp(s).funcionalidades.find((f) => f.id === id)!;
    expect(por(semConta, 'enviar_email')).toMatchObject({ o_agente_executa: false });
    expect(por(semConta, 'criar_evento')).toMatchObject({ o_agente_executa: false });
    expect(por(REGISTRADAS, 'enviar_email')).toMatchObject({ o_agente_executa: true, ferramenta: 'send_email' });
    expect(por(REGISTRADAS, 'conectar_conta_citi')).toMatchObject({ o_agente_executa: false });
  });

  it('compromissos: guia com os nomes da tela, e o agente executa', () => {
    const g = guiaDeUso('Como acompanho os compromissos da reunião?', REGISTRADAS);
    expect(idsDe(g)).toEqual(expect.arrayContaining(['registrar_compromissos']));
    const reg = g.guias.find((x) => idDoTitulo(x.titulo) === 'registrar_compromissos')!;
    expect(reg).toMatchObject({ o_agente_executa: true, ferramenta: 'register_commitments' });
    expect(reg.passos.join(' ')).toMatch(/“Registrar selecionados”/);
  });

  it('manual sem ferramenta: o guia diz que o agente não executa', () => {
    const apagar = guiaDeUso('Apague o documento Ata comercial', REGISTRADAS);
    const g = apagar.guias.find((x) => idDoTitulo(x.titulo) === 'apagar_documento')!;
    expect(g).toMatchObject({ o_agente_executa: false });
    expect(g).not.toHaveProperty('ferramenta');
    expect(g.passos.join(' ')).toMatch(/“Apagar documento”/);
  });
});

describe('get_app_capabilities', () => {
  it('separa o que o agente executa do que é só manual, pelo registro de verdade', () => {
    const c = capacidadesDoApp(REGISTRADAS);
    const por = (id: string) => c.funcionalidades.find((f) => f.id === id)!;
    expect(por('apagar_reuniao')).toMatchObject({ o_agente_executa: true, ferramenta: 'delete_meeting' });
    expect(por('apagar_documento')).toMatchObject({ o_agente_executa: false });
    expect(por('baixar_documento')).toMatchObject({
      o_agente_executa: true,
      ferramenta: 'download_document',
    });
    expect(por('fontes_do_contexto')).toMatchObject({ o_agente_executa: true });
    expect(por('enviar_google_docs')).toMatchObject({ o_agente_executa: false });
    expect(por('acompanhar_compromissos')).toMatchObject({ o_agente_executa: true, ferramenta: 'update_commitment' });
    // Todos os especialistas do catálogo estão ativos: nada sobra como "planejado".
    expect(c.fora_do_app.some((x) => x.situacao === 'planejado')).toBe(false);
  });

  it('ferramenta fora do registro não conta como operação do agente', () => {
    const c = capacidadesDoApp(new Set(['search_records']));
    expect(c.funcionalidades.find((f) => f.id === 'apagar_reuniao')).toMatchObject({
      o_agente_executa: false,
    });
  });

  it('filtra por assunto', () => {
    const c = capacidadesDoApp(REGISTRADAS, 'exportacao');
    expect(c.funcionalidades.every((f) => f.assunto === 'exportacao')).toBe(true);
    expect(c.funcionalidades.length).toBeGreaterThan(0);
  });
});
