/**
 * A POPULAÇÃO DE DEMONSTRAÇÃO — registros fictícios para avaliar a interface
 * cheia.
 *
 * ── Onde isto existe, e onde NÃO existe ──────────────────────────────────
 *
 * Só em build de desenvolvimento. Quem importa este módulo é
 * `PainelDeSimulacao`, carregado por um `import()` dentro de um ramo
 * `import.meta.env.DEV` — numa build de produção o ramo é `false` em tempo de
 * compilação e o chunk inteiro deixa de ser gerado. Não é um recurso escondido
 * atrás de uma flag: é código que não chega ao usuário final.
 *
 * ── As regras que estes registros respeitam ──────────────────────────────
 *
 *  • MESMO formato e MESMOS componentes dos registros reais. Nada aqui é um
 *    tipo paralelo: é `MeetingRecord`, `Nota`, `Print`, `Conversation`, nas
 *    chaves de storage de sempre. Uma tela que funcione com isto funciona com o
 *    dado verdadeiro — que é o motivo de a demonstração existir.
 *  • Identificados como demonstração no TÍTULO e, nas respostas do agente, no
 *    próprio registro (`demo: true`). Um dado fictício que perdesse a marca ao
 *    ser relido viraria, para todos os efeitos, dado real.
 *  • Identificadores próprios, todos com o prefixo `demo-`, e referências
 *    consistentes entre si: a nota, as marcações, o print e as conversas
 *    apontam para a MESMA reunião fictícia.
 *  • Idempotente: semear duas vezes produz exatamente o mesmo conjunto. Os ids
 *    são fixos e os instantes derivam da meia-noite local, não de `Date.now()`.
 *  • Removível sem tocar no que é real: `remover` filtra pelo prefixo e não
 *    conhece nenhum outro critério.
 *
 * ── O que isto NÃO faz ───────────────────────────────────────────────────
 *
 * Não chama API nenhuma, não envia mensagem para lugar nenhum e não liga a
 * captura. É escrita em `chrome.storage.local`, e só.
 */
import type { MeetingRecord, LiveSegment } from '@/shared/types/domain';
import type { Nota } from '@/features/annotations/notes';
import type { MarcasDaReuniao, TipoDeMarca } from '@/features/annotations/marks';
import type { Print } from '@/features/annotations/shots';
import type { Conversation } from '@/home/conversations';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { readLocal, writeLocal } from '@/shared/services/storage';

/** Todo id semeado começa com isto. É o único critério de remoção. */
export const PREFIXO_DEMO = 'demo-';

export const REUNIAO_DEMO_ID = 'demo-reuniao-kickoff';

/** Um rótulo só, usado no começo de todo título semeado. */
const SELO = 'Demonstração · ';

/**
 * Os instantes vêm da meia-noite LOCAL de hoje, e não de `Date.now()`.
 *
 * É o que torna a semeadura idempotente de verdade: rodar de novo no mesmo dia
 * reescreve exatamente os mesmos valores, em vez de mover a reunião alguns
 * segundos para frente a cada clique. E, como o dia é o de hoje, a reunião
 * fictícia aparece perto do topo do histórico, que é onde ela serve para
 * alguma coisa.
 */
function meiaNoite(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const INICIO_OFFSET = 9 * 60 * 60 * 1000 + 12 * 60 * 1000; // 09:12
const DURACAO_MS = 34 * 60 * 1000 + 20 * 1000;

/**
 * O diálogo. Quatro falantes, falas de comprimentos bem diferentes, e volume
 * suficiente para a rolagem ter o que fazer numa coluna estreita.
 */
export const DIALOGO: ReadonlyArray<[string, string]> = [
  ['Ana Duarte', 'Bom dia, gente. Vou compartilhar a tela em um minuto.'],
  ['Bruno Lima', 'Bom dia.'],
  ['Carla Nunes', 'Oi, pessoal. Consigo ouvir bem.'],
  ['Ana Duarte', 'Então, o objetivo de hoje é fechar o escopo da primeira entrega e sair daqui com dono para cada frente.'],
  ['Diego Alves', 'Cheguei. Desculpa o atraso, o calendário marcou meia hora depois.'],
  ['Ana Duarte', 'Sem problema, a gente está começando agora.'],
  ['Ana Duarte', 'Primeira coisa: o que exatamente entra na primeira entrega?'],
  ['Bruno Lima', 'Da minha parte, o cadastro e a autenticação. O resto eu consideraria fase dois.'],
  ['Carla Nunes', 'Eu discordo um pouco. Sem a tela de acompanhamento, a pessoa entra, cadastra e não tem o que fazer.'],
  ['Bruno Lima', 'Faz sentido. Uma versão mínima do acompanhamento, então.'],
  ['Ana Duarte', 'Mínima quanto?'],
  ['Carla Nunes', 'Lista e detalhe. Sem filtro, sem exportação, sem gráfico.'],
  ['Diego Alves', 'Isso eu consigo em duas semanas se o desenho vier junto.'],
  ['Ana Duarte', 'O desenho vem. Carla, você consegue fechar até sexta?'],
  ['Carla Nunes', 'Consigo, mas preciso das regras de permissão antes. Quem vê o quê ainda está em aberto.'],
  ['Bruno Lima', 'As permissões eu fecho amanhã. É basicamente três papéis.'],
  ['Ana Duarte', 'Combinado. Bruno fecha permissões amanhã, Carla fecha o desenho sexta.'],
  ['Diego Alves', 'Uma dúvida: a gente vai suportar login social nessa primeira?'],
  ['Bruno Lima', 'Eu deixaria de fora. Dobra o trabalho de teste e não é o que trava ninguém.'],
  ['Carla Nunes', 'Concordo.'],
  ['Ana Duarte', 'Então fica de fora. Decidido.'],
  ['Ana Duarte', 'Segundo ponto: prazo. Vocês estão confortáveis com o dia 30?'],
  ['Diego Alves', 'Confortável não, mas factível. Se aparecer qualquer coisa fora do previsto, escorrega.'],
  ['Bruno Lima', 'Eu diria a mesma coisa. Dá, mas sem folga nenhuma.'],
  ['Carla Nunes', 'Eu tenho uma semana de férias no meio, lembra disso.'],
  ['Ana Duarte', 'Verdade, tinha esquecido. Isso muda a conta.'],
  ['Diego Alves', 'Muda bastante. Sem ela, o desenho das telas novas para.'],
  ['Ana Duarte', 'Vamos assumir dia 6 do mês seguinte, então, e falar isso hoje mesmo com o cliente.'],
  ['Bruno Lima', 'Melhor avisar agora do que na véspera.'],
  ['Ana Duarte', 'Eu mando o recado ainda hoje.'],
  ['Carla Nunes', 'Sobre os testes: quem escreve?'],
  ['Diego Alves', 'Eu escrevo os do fluxo principal. Os de borda eu não vou dar conta sozinho.'],
  ['Bruno Lima', 'Eu pego os de autenticação, que são os mais chatos.'],
  ['Ana Duarte', 'Ótimo. E o ambiente de homologação, está de pé?'],
  ['Diego Alves', 'Está, mas com o banco da semana passada. Preciso de uma carga nova.'],
  ['Bruno Lima', 'Eu gero a carga na quinta.'],
  ['Ana Duarte', 'Anotado.'],
  ['Carla Nunes', 'Uma coisa que ficou solta na reunião passada: o que a gente faz com os dados antigos?'],
  ['Ana Duarte', 'Boa pergunta. Ninguém respondeu isso ainda.'],
  ['Bruno Lima', 'A migração é o maior risco do projeto, na minha opinião. E é a parte que ninguém está olhando.'],
  ['Diego Alves', 'Concordo. É onde eu apostaria que vai dar problema.'],
  ['Ana Duarte', 'Então vira item próprio. Bruno, você levanta o tamanho disso até a próxima?'],
  ['Bruno Lima', 'Levanto. Mas já adianto que pode ser grande.'],
  ['Ana Duarte', 'Melhor saber agora.'],
  ['Carla Nunes', 'Mais alguma coisa?'],
  ['Ana Duarte', 'Da minha parte não. Obrigada, gente.'],
  ['Diego Alves', 'Valeu.'],
  ['Bruno Lima', 'Até.'],
];

/** As marcações: quatro trechos, um de cada tipo, para ver os quatro ícones. */
const MARCACOES: ReadonlyArray<[numero: number, tipo: TipoDeMarca]> = [
  [20, 'decisao'], // "Então fica de fora. Decidido."
  [27, 'decisao'], // a data nova
  [37, 'duvida'], // "o que a gente faz com os dados antigos?"
  [39, 'destaque'], // "a migração é o maior risco"
  [41, 'acao'], // "você levanta o tamanho disso até a próxima?"
];

function idDoTrecho(i: number): string {
  return `${PREFIXO_DEMO}cap-${String(i).padStart(3, '0')}`;
}

/** Offsets em cascata: cada fala dura conforme o tamanho, com um respiro entre elas. */
function segmentos(): LiveSegment[] {
  let offset = 4000;
  return DIALOGO.map(([speaker, text], i) => {
    const duracao = 2200 + text.length * 55;
    const segmento: LiveSegment = {
      captionId: idDoTrecho(i),
      speaker,
      text,
      startOffsetMs: offset,
      endOffsetMs: offset + duracao,
    };
    offset += duracao + 900;
    return segmento;
  });
}

/**
 * O print fictício.
 *
 * SVG em data URL, montado aqui: um PNG de verdade no repositório seria um
 * binário de centenas de KB para dizer "isto é uma demonstração", e ele teria
 * de entrar na build de produção junto com o resto de `public/`. O formato
 * continua sendo o real — `Print.dataUrl` é um `data:image/…`, e a tela o
 * desenha com a mesma `<img>` que desenha uma captura verdadeira.
 */
function imagemDeDemonstracao(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
<rect width="640" height="400" fill="#16181b"/>
<rect x="24" y="24" width="592" height="300" rx="12" fill="#1f2226" stroke="#33383d"/>
<circle cx="160" cy="150" r="46" fill="#2b3036"/>
<circle cx="330" cy="150" r="46" fill="#2b3036"/>
<circle cx="500" cy="150" r="46" fill="#2b3036"/>
<rect x="120" y="212" width="80" height="10" rx="5" fill="#33383d"/>
<rect x="290" y="212" width="80" height="10" rx="5" fill="#33383d"/>
<rect x="460" y="212" width="80" height="10" rx="5" fill="#33383d"/>
<rect x="24" y="344" width="592" height="32" rx="8" fill="#1b1e21"/>
<text x="320" y="366" fill="#8d9196" font-family="Inter, system-ui, sans-serif" font-size="15" text-anchor="middle">Print fictício — Demonstração</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const RESPOSTA_LONGA = `Pelo que ficou registrado, a reunião fechou quatro coisas e deixou uma em aberto.

Decidido:
• A primeira entrega leva cadastro, autenticação e uma versão mínima do acompanhamento — lista e detalhe, sem filtro, exportação ou gráfico.
• Login social fica fora desta entrega.
• A data passa do dia 30 para o dia 6 do mês seguinte, por causa da semana de férias no meio do caminho.
• Os testes ficam divididos: fluxo principal com o Diego, autenticação com o Bruno.

Com dono e prazo:
• Bruno fecha as regras de permissão amanhã, e gera a carga nova de homologação na quinta.
• Carla fecha o desenho das telas até sexta, depois das permissões.
• Ana avisa o cliente sobre a data nova ainda hoje.

Em aberto, e é o ponto que mais apareceu:
• A migração dos dados antigos. Dois dos quatro participantes a chamaram de maior risco do projeto, e ninguém está olhando para ela hoje. Ficou com o Bruno levantar o tamanho até a próxima reunião.`;

const RESPOSTA_CURTA = `Três pessoas falaram sobre prazo, e nenhuma delas disse que estava confortável. O Diego usou a palavra "factível", o Bruno disse "sem folga nenhuma", e foi a lembrança das férias da Carla que fez a data mudar.`;

function conversas(inicio: number): Conversation[] {
  const t = (min: number) => inicio + min * 60 * 1000;
  return [
    {
      id: `${PREFIXO_DEMO}conversa-resumo`,
      title: `${SELO}O que ficou decidido no kickoff`,
      createdAt: t(36),
      updatedAt: t(38),
      meetingId: REUNIAO_DEMO_ID,
      messages: [
        {
          id: `${PREFIXO_DEMO}msg-1`,
          role: 'user',
          text: 'O que ficou decidido?',
          at: t(36),
          contexto: {
            meetingId: REUNIAO_DEMO_ID,
            meetingTitle: `${SELO}Kickoff do projeto`,
            comTranscricao: true,
          },
        },
        {
          id: `${PREFIXO_DEMO}msg-2`,
          role: 'assistant',
          text: RESPOSTA_LONGA,
          at: t(38),
          demo: true,
        },
      ],
    },
    {
      id: `${PREFIXO_DEMO}conversa-prazo`,
      title: `${SELO}Alguém ficou confortável com o prazo?`,
      createdAt: t(40),
      updatedAt: t(41),
      meetingId: REUNIAO_DEMO_ID,
      messages: [
        {
          id: `${PREFIXO_DEMO}msg-3`,
          role: 'user',
          text: 'Alguém ficou realmente confortável com o prazo?',
          at: t(40),
          contexto: {
            meetingId: REUNIAO_DEMO_ID,
            meetingTitle: `${SELO}Kickoff do projeto`,
            excerpt: 'Confortável não, mas factível.',
            captionId: idDoTrecho(22),
          },
        },
        {
          id: `${PREFIXO_DEMO}msg-4`,
          role: 'assistant',
          text: RESPOSTA_CURTA,
          at: t(41),
          demo: true,
        },
      ],
    },
    /*
     * A terceira não tem resposta nenhuma — e é de propósito. É exatamente a
     * forma que uma conversa tem HOJE em produção: rascunhos guardados, sem
     * turno de assistente, porque não há rota de conversa no servidor. Vê-la ao
     * lado das outras duas é o que impede a demonstração de passar a impressão
     * de que a integração existe.
     */
    {
      id: `${PREFIXO_DEMO}conversa-rascunhos`,
      title: `${SELO}Rascunhos sem resposta (como é hoje)`,
      createdAt: t(44),
      updatedAt: t(46),
      messages: [
        {
          id: `${PREFIXO_DEMO}msg-5`,
          role: 'user',
          text: 'Lembrar de perguntar ao cliente se a data nova tem impacto contratual.',
          at: t(44),
        },
        {
          id: `${PREFIXO_DEMO}msg-6`,
          role: 'user',
          text: 'E levantar quanto custaria fazer a migração em duas etapas.',
          at: t(46),
        },
      ],
    },
  ];
}

function registro(inicio: number): MeetingRecord {
  const segs = segmentos();
  return {
    id: REUNIAO_DEMO_ID,
    title: `${SELO}Kickoff do projeto`,
    startedAt: inicio,
    endedAt: inicio + DURACAO_MS,
    durationSeconds: Math.round(DURACAO_MS / 1000),
    participants: [
      { name: 'Ana Duarte', isHost: true },
      { name: 'Bruno Lima', isHost: false },
      { name: 'Carla Nunes', isHost: false },
      { name: 'Diego Alves', isHost: false },
    ],
    presentNow: [],
    speakersObserved: [],
    segments: segs,
    status: 'ready',
    metadata: {
      capturedCaptions: true,
      droppedSegments: 0,
      reconnectCount: 1,
      captureDegradedCount: 0,
      lastChunkAt: inicio + DURACAO_MS,
      wasDiscardedAndRestarted: false,
    },
  };
}

// ---------- leitura e escrita das chaves reais ----------

async function lerLista<T>(chave: string): Promise<T[]> {
  const bruto = await readLocal<unknown>(chave);
  return Array.isArray(bruto) ? (bruto as T[]) : [];
}

async function lerMapa<T>(chave: string): Promise<Record<string, T>> {
  const bruto = await readLocal<unknown>(chave);
  return bruto && typeof bruto === 'object' && !Array.isArray(bruto)
    ? (bruto as Record<string, T>)
    : {};
}

function semDemo<T extends { id: string }>(lista: T[]): T[] {
  return lista.filter((item) => !item.id.startsWith(PREFIXO_DEMO));
}

function mapaSemDemo<T>(mapa: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(mapa).filter(([k]) => !k.startsWith(PREFIXO_DEMO)),
  );
}

/**
 * Semeia tudo. Rodar duas vezes deixa o storage no mesmo estado — a remoção
 * vem antes da inserção, então não há como duplicar.
 */
export async function semear(): Promise<void> {
  const inicio = meiaNoite() + INICIO_OFFSET;

  const historico = await lerLista<MeetingRecord>(STORAGE_KEYS.history);
  await writeLocal(
    STORAGE_KEYS.history,
    [registro(inicio), ...semDemo(historico)].sort((a, b) => b.startedAt - a.startedAt),
  );

  const notas = await lerMapa<Nota>(STORAGE_KEYS.notes);
  const nota: Nota = {
    meetingId: REUNIAO_DEMO_ID,
    texto:
      'Nota de demonstração.\n\n' +
      'Combinado: avisar o cliente da data nova hoje.\n' +
      'Perguntar quanto custa a migração em duas etapas.\n' +
      'A Carla sai de férias no meio — refazer a conta do prazo com isso.',
    updatedAt: inicio + DURACAO_MS,
  };
  await writeLocal(STORAGE_KEYS.notes, {
    ...mapaSemDemo(notas),
    [REUNIAO_DEMO_ID]: nota,
  });

  const marcas = await lerMapa<MarcasDaReuniao>(STORAGE_KEYS.marks);
  const doDemo: MarcasDaReuniao = {};
  for (const [numero, tipo] of MARCACOES) doDemo[idDoTrecho(numero)] = tipo;
  await writeLocal(STORAGE_KEYS.marks, {
    ...mapaSemDemo(marcas),
    [REUNIAO_DEMO_ID]: doDemo,
  });

  const prints = await lerLista<Print>(STORAGE_KEYS.shots);
  const print: Print = {
    id: `${PREFIXO_DEMO}print-tela`,
    meetingId: REUNIAO_DEMO_ID,
    dataUrl: imagemDeDemonstracao(),
    at: inicio + 12 * 60 * 1000,
    largura: 640,
    altura: 400,
  };
  await writeLocal(STORAGE_KEYS.shots, [print, ...semDemo(prints)]);

  const guardadas = await lerLista<Conversation>(STORAGE_KEYS.conversations);
  await writeLocal(STORAGE_KEYS.conversations, [
    ...conversas(inicio),
    ...semDemo(guardadas),
  ]);
}

/** Tira só o que foi semeado. Nada que não comece com `demo-` é tocado. */
export async function remover(): Promise<void> {
  await writeLocal(
    STORAGE_KEYS.history,
    semDemo(await lerLista<MeetingRecord>(STORAGE_KEYS.history)),
  );
  await writeLocal(
    STORAGE_KEYS.notes,
    mapaSemDemo(await lerMapa<Nota>(STORAGE_KEYS.notes)),
  );
  await writeLocal(
    STORAGE_KEYS.marks,
    mapaSemDemo(await lerMapa<MarcasDaReuniao>(STORAGE_KEYS.marks)),
  );
  await writeLocal(
    STORAGE_KEYS.shots,
    semDemo(await lerLista<Print>(STORAGE_KEYS.shots)),
  );
  await writeLocal(
    STORAGE_KEYS.conversations,
    semDemo(await lerLista<Conversation>(STORAGE_KEYS.conversations)),
  );
}

/** Já existe demonstração no storage? Decide o rótulo do botão. */
export async function existeDemo(): Promise<boolean> {
  const historico = await lerLista<MeetingRecord>(STORAGE_KEYS.history);
  return historico.some((r) => r.id.startsWith(PREFIXO_DEMO));
}
