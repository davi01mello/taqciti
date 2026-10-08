/**
 * As ferramentas que alcançam a ORGANIZAÇÃO: diretório de pessoas, e-mail e agenda.
 *
 * Todas falam com o Google pela conta do CITi que a pessoa conectou
 * (`features/integracoes`). Nenhuma é oferecida ao modelo enquanto a capacidade
 * correspondente não está `available` (ver `CAPACIDADE_DA_FERRAMENTA` e o
 * orquestrador) — e cada uma confere isso de novo ao executar.
 *
 * ── As travas, todas em código ─────────────────────────────────────────────
 *
 *   1. O MODELO SÓ PREPARA. Chamada do modelo a send_email, create_event,
 *      reschedule_event ou cancel_event NUNCA executa: guarda o rascunho, mostra
 *      o cartão e espera. Não há "envio direto", nem decisão por frase.
 *   2. QUEM CONFIRMA É UM BOTÃO. A execução só acontece quando a tarefa traz
 *      `confirmacao` com a chave do rascunho — o que só o orquestrador
 *      (`confirmarAcao`) preenche, a partir de um clique da pessoa, sem chamar o
 *      modelo. O que se confirma é o rascunho guardado, byte a byte. Uma
 *      transcrição (ou uma mensagem) que diga "envie" não tem como produzir isso.
 *   3. PESSOAS. Destinatário e convidado são resolvidos no diretório real do
 *      domínio, em código. Endereço que o modelo escreveu sozinho não vale.
 *      Nome parecido com mais de uma pessoa volta como pergunta.
 *   4. IDEMPOTÊNCIA. A chave sai do conteúdo; o registro de ações impede a
 *      segunda saída. Tempo esgotado = "desconhecido", nunca "reenvie".
 *   5. DESFECHO. "Aceito pelo Google" não é "entregue"; o Taq diz o que sabe.
 */
import { z } from 'zod/v4';
import { recordToText } from '@/features/history/export';
import {
  buscarNoDiretorio,
  ehDaOrganizacao,
  type PessoaDoDiretorio,
} from '@/features/integracoes/diretorio';
import { ErroDeIntegracao } from '@/features/integracoes/erros';
import { CAPACIDADES_EXTERNAS, type CapacidadeExterna } from '@/features/integracoes/escopos';
import { estadoDasCapacidades, lerConexao } from '@/features/integracoes/estado';
import {
  enderecoValido,
  enviarPeloGmail,
  LIMITE_DE_ANEXOS_BYTES,
  MAX_DESTINATARIOS,
  type AnexoDeEmail,
} from '@/features/integracoes/gmail';
import {
  cancelarEvento,
  consultarOcupacao,
  criarEventoNaAgenda,
  janelasLivres,
  listarEventosProprios,
  obterEvento,
  remarcarEvento,
  type EventoDaAgenda,
} from '@/features/integracoes/calendario';
import {
  concluirAcao,
  guardarRascunho,
  obterAcao,
  reservarExecucao,
  type RegistroDeAcao,
  type TipoDeAcao,
} from '@/features/integracoes/registroDeAcoes';
import { fusoValido, localParaInstante, rotuloDoHorario } from './agenda';
import { versaoDaReuniao } from './armazenamento';
import { normalizar } from './busca';
import { revisarDocumento } from './revisao';
import { documentoNoEscopo, hash, instante, reuniaoNoEscopo } from './ferramentas';
import { podeLerReuniao } from './politica';
import { acharSensiveis, avisosDeExposicao } from './privacidade';
import { ErroDeFerramenta, type ContextoDeFerramenta, type DefinicaoDeFerramenta } from './tipos';

/** A capacidade externa de que cada ferramenta desta família depende. */
export const CAPACIDADE_DA_FERRAMENTA: Readonly<Record<string, CapacidadeExterna>> = {
  search_directory: 'diretorio',
  send_email: 'email',
  list_availability: 'agenda_consulta',
  create_event: 'agenda_eventos',
  reschedule_event: 'agenda_eventos',
  cancel_event: 'agenda_eventos',
};

// ------------------------------------------------------------------ comuns

const fusoDeQuemUsa = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Recife';

/** Chave de idempotência: o conteúdo decide, nunca o modelo. */
function chaveDe(prefixo: string, ...partes: string[]): string {
  const base = partes.join('\u0001');
  return `${prefixo}:${hash(base)}${hash([...base].reverse().join(''))}`;
}

async function exigirCapacidade(...caps: CapacidadeExterna[]): Promise<void> {
  const estados = await estadoDasCapacidades();
  for (const c of caps) {
    const s = estados[c];
    if (s.estado !== 'available')
      throw new ErroDeFerramenta(
        'integracao_indisponivel',
        `Isto depende de uma integração que não está pronta: ${s.dependencia ?? 'indisponível'} ` +
          'Diga isso à pessoa; o rascunho continua disponível para copiar.',
        { estado: s.estado },
      );
  }
}

function comoErroDeFerramenta(e: unknown): ErroDeFerramenta {
  if (e instanceof ErroDeFerramenta) return e;
  if (e instanceof ErroDeIntegracao)
    return new ErroDeFerramenta(`google_${e.codigo}`, e.message, { incerto: e.desfechoIncerto });
  return new ErroDeFerramenta('falha_interna', (e as Error)?.message ?? 'erro');
}

const alvoSchema = z.object({
  nome: z.string().trim().min(1).max(80).optional().describe('O nome como a pessoa disse. O endereço é achado no diretório.'),
  email: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe('Só se a PESSOA escreveu o endereço, ou se ele veio de search_directory.'),
});
type Alvo = z.infer<typeof alvoSchema>;

/** O endereço aparece, letra por letra, no pedido da PESSOA? */
export function enderecoNoPedido(email: string, pedido: string): boolean {
  return normalizar(pedido).includes(email.trim().toLowerCase());
}

interface PessoaResolvida {
  nome: string;
  email: string;
  daOrganizacao: boolean;
}

type ResolucaoDePessoa =
  | { situacao: 'resolvida'; pessoa: PessoaResolvida }
  | { situacao: 'ambigua'; consulta: string; candidatos: PessoaDoDiretorio[] }
  | { situacao: 'nao_encontrada'; consulta: string }
  | { situacao: 'invalida'; consulta: string; motivo: string };

/**
 * Nome ou endereço → uma pessoa REAL do diretório, ou a dúvida. O endereço que
 * o modelo trouxer só vale se o diretório o confirma, ou se a pessoa o escreveu.
 */
async function resolverPessoa(alvo: Alvo, pedido: string): Promise<ResolucaoDePessoa> {
  const consulta = alvo.email ?? alvo.nome ?? '';
  if (!consulta) return { situacao: 'invalida', consulta: '', motivo: 'sem nome nem endereço' };

  if (alvo.email) {
    const email = alvo.email.toLowerCase();
    if (!enderecoValido(email)) return { situacao: 'invalida', consulta: email, motivo: 'endereço mal formado' };
    if (await ehDaOrganizacao(email)) {
      const achados = await buscarNoDiretorio(email, 5);
      const p = achados.find((x) => x.email === email);
      if (!p) return { situacao: 'nao_encontrada', consulta: email };
      return { situacao: 'resolvida', pessoa: { ...p, daOrganizacao: true } };
    }
    // De fora: só o endereço que a pessoa escreveu. Nunca um que o modelo trouxe.
    if (!enderecoNoPedido(email, pedido))
      return { situacao: 'invalida', consulta: email, motivo: 'endereço de fora da organização que você não escreveu' };
    return {
      situacao: 'resolvida',
      pessoa: { nome: email, email, daOrganizacao: false },
    };
  }

  const nome = alvo.nome!;
  const achados = await buscarNoDiretorio(nome, 8);
  const exatos = achados.filter((p) => normalizar(p.nome) === normalizar(nome));
  const escolhido = exatos.length === 1 ? exatos[0] : achados.length === 1 ? achados[0] : undefined;
  if (escolhido) return { situacao: 'resolvida', pessoa: { ...escolhido, daOrganizacao: true } };
  if (achados.length > 1) return { situacao: 'ambigua', consulta: nome, candidatos: achados.slice(0, 5) };
  return { situacao: 'nao_encontrada', consulta: nome };
}

interface PessoasResolvidas {
  pessoas: PessoaResolvida[];
  pendencias: Array<Record<string, unknown>>;
}

async function resolverTodas(alvos: readonly Alvo[], pedido: string): Promise<PessoasResolvidas> {
  const pessoas: PessoaResolvida[] = [];
  const pendencias: Array<Record<string, unknown>> = [];
  const vistos = new Set<string>();
  for (const a of alvos) {
    const r = await resolverPessoa(a, pedido);
    if (r.situacao === 'resolvida') {
      if (!vistos.has(r.pessoa.email)) {
        vistos.add(r.pessoa.email);
        pessoas.push(r.pessoa);
      }
    } else if (r.situacao === 'ambigua') {
      pendencias.push({
        problema: 'ambiguo',
        consulta: r.consulta,
        candidatos: r.candidatos.map((c) => `${c.nome} <${c.email}>`),
      });
    } else if (r.situacao === 'nao_encontrada') {
      pendencias.push({ problema: 'nao_encontrado', consulta: r.consulta });
    } else {
      pendencias.push({ problema: 'invalido', consulta: r.consulta, motivo: r.motivo });
    }
  }
  return { pessoas, pendencias };
}

const RESERVADO_AO_BOTAO = 'RESERVADO ao botão de confirmação da tela. Não use: chamada do modelo com isto é recusada.';

const AVISO_DE_PENDENCIA =
  'Não há como prosseguir ainda. Pergunte à pessoa, mostrando nome e e-mail dos candidatos quando houver, e não escolha por palpite.';

function registrarResultado(
  ctx: ContextoDeFerramenta,
  c: {
    operacao: 'email' | 'evento_criar' | 'evento_remarcar' | 'evento_cancelar';
    estado: 'aguardando_confirmacao' | 'aceito' | 'falhou' | 'desconhecido';
    titulo: string;
    linhas: string[];
    alertas?: string[];
    link?: string;
    /** O rascunho que o botão do cartão confirma (prévia, falha ou resultado desconhecido). */
    chaveDoRascunho?: string;
  },
): void {
  ctx.registrarCartao({
    tipo: 'acao_externa',
    operacao: c.operacao,
    estado: c.estado,
    titulo: c.titulo.slice(0, 120),
    linhas: c.linhas.slice(0, 12).map((l) => l.slice(0, 400)),
    alertas: c.alertas ?? [],
    ...(c.link ? { link: c.link } : {}),
    ...(c.chaveDoRascunho ? { chaveDoRascunho: c.chaveDoRascunho } : {}),
  });
}

/** A pessoa pediu, no botão, para repetir uma ação cujo resultado ficou desconhecido? */
const repeticaoConfirmada = (ctx: ContextoDeFerramenta): boolean => ctx.tarefa.confirmacao?.repetir === true;

/**
 * O gesto que confirma um rascunho guardado: um CLIQUE da pessoa, que o
 * orquestrador põe em `tarefa.confirmacao`. Texto — do modelo, da transcrição,
 * da própria mensagem da pessoa — nunca confirma nada.
 */
async function rascunhoConfirmado(
  ctx: ContextoDeFerramenta,
  chave: string,
  tipo: TipoDeAcao,
): Promise<RegistroDeAcao> {
  if (ctx.tarefa.confirmacao?.chave !== chave)
    throw new ErroDeFerramenta(
      'sem_confirmacao',
      'Quem confirma é a pessoa, pelo botão do cartão. Mostre a prévia e espere; nada foi enviado.',
    );
  const r = await obterAcao(chave);
  if (!r || r.tipo !== tipo || r.conversaId !== ctx.tarefa.conversaId)
    throw new ErroDeFerramenta(
      'rascunho_desconhecido',
      'Não há rascunho com essa chave nesta conversa. Prepare de novo.',
    );
  if (r.estado === 'aceito')
    throw new ErroDeFerramenta('ja_feito', 'Isto já foi feito e aceito pelo Google. Não será repetido.');
  if (r.estado !== 'rascunho' && r.estado !== 'desconhecido' && r.estado !== 'falhou')
    throw new ErroDeFerramenta('estado_invalido', `O rascunho está "${r.estado}" e não pode ser confirmado agora.`);
  return r;
}

/**
 * Chamada do MODELO com a mesma ação já registrada: não há prévia nova para
 * mostrar quando o Google já aceitou, ou quando o resultado não se sabe.
 * `null` = ainda é rascunho (ou nada): prepara a prévia normalmente.
 */
function jaRegistrada(anterior: RegistroDeAcao | null): Record<string, unknown> | null {
  if (!anterior) return null;
  if (anterior.estado === 'aceito')
    return { feito: 'ja_aceito', aviso: 'Isto já foi feito e aceito pelo Google antes. Não será repetido. Diga isso.' };
  if (anterior.estado === 'enviando')
    return { feito: 'em_andamento', aviso: 'Isto já está em curso. Não repita; diga que está em andamento.' };
  return null;
}

// ---------------------------------------------------------- search_directory

const buscaSchema = z.object({
  consulta: z.string().trim().min(2).max(80).describe('Nome (ou parte do nome, ou do e-mail) de um colega.'),
});

export const searchDirectory: DefinicaoDeFerramenta<z.infer<typeof buscaSchema>> = {
  nome: 'search_directory',
  descricao:
    'Procura colegas da MESMA organização (CITi) no diretório do Google Workspace e devolve nome e e-mail ' +
    'reais. É a única fonte de endereços: nunca invente um. Mais de um resultado = pergunte qual.',
  schemaDeEntrada: buscaSchema,
  efeito: 'leitura',
  requisitos: [],
  politica: { repeticao: 'leitura', maxPorExecucao: 6 },
  etapa: 'Procurando no diretório da organização',
  async executar(args) {
    await exigirCapacidade('diretorio');
    try {
      const pessoas = await buscarNoDiretorio(args.consulta, 8);
      return {
        pessoas: pessoas.map((p) => ({ nome: p.nome, email: p.email })),
        total: pessoas.length,
        aviso: !pessoas.length
          ? 'Ninguém com esse nome no diretório. Diga isso; não suponha um endereço.'
          : pessoas.length > 1
            ? 'Mais de uma pessoa serve: pergunte qual, mostrando nome e e-mail. Não escolha por palpite.'
            : 'Uma pessoa. Confirme o nome na resposta.',
      };
    } catch (e) {
      throw comoErroDeFerramenta(e);
    }
  },
  resumir: (s) => `${s.total as number} pessoa(s) no diretório`,
};

// ---------------------------------------------------------------- send_email

const anexoSchema = z.object({
  tipo: z.enum(['documento', 'transcricao']),
  id: z.string().min(1).describe('O id do documento, ou da reunião cuja transcrição segue.'),
});
type AnexoPedido = z.infer<typeof anexoSchema>;

const envioSchema = z.object({
  destinatarios: z.array(alvoSchema).max(MAX_DESTINATARIOS).default([]),
  assunto: z.string().trim().min(1).max(160).optional(),
  corpo: z.string().trim().min(1).max(6_000).optional(),
  anexos: z.array(anexoSchema).max(3).default([]),
  chave_do_rascunho: z
    .string()
    .max(80)
    .optional()
    .describe(RESERVADO_AO_BOTAO),
});

interface AnexoGuardado {
  tipo: 'documento' | 'transcricao';
  id: string;
  versao: string;
  nome: string;
}

interface PayloadDeEmail {
  de: string;
  para: Array<{ nome: string; email: string }>;
  assunto: string;
  corpo: string;
  anexos: AnexoGuardado[];
  externo: boolean;
}

const seguro = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'arquivo';

interface AnexosMontados {
  anexos: AnexoDeEmail[];
  guardados: AnexoGuardado[];
  /** O texto de tudo que vai anexado, para a revisão de exposição. */
  texto: string;
  avisos: string[];
}

/** Lê as fontes NO ESCOPO, agora. É daqui que sai o anexo — nunca do que o modelo escreveu. */
async function montarAnexos(ctx: ContextoDeFerramenta, pedidos: readonly AnexoPedido[]): Promise<AnexosMontados> {
  const anexos: AnexoDeEmail[] = [];
  const guardados: AnexoGuardado[] = [];
  const avisos: string[] = [];
  let texto = '';
  let bytes = 0;
  let reunioesDoEscopo: Awaited<ReturnType<typeof ctx.armazenamento.listarReunioes>> | null = null;
  for (const p of pedidos) {
    if (p.tipo === 'documento') {
      const d = await documentoNoEscopo(ctx, p.id);
      if (!d.content.trim())
        throw new ErroDeFerramenta('anexo_vazio', `O documento “${d.title}” está vazio: não há o que enviar.`);
      // Pendência grave não trava o envio, mas a pessoa precisa saber antes.
      reunioesDoEscopo ??= (await ctx.armazenamento.listarReunioes()).filter((r) =>
        podeLerReuniao(ctx.tarefa.escopo, r.id),
      );
      const graves = revisarDocumento(d, reunioesDoEscopo).problemas.filter((x) => x.gravidade === 'alta');
      if (graves.length)
        avisos.push(
          `“${d.title}” ainda tem ${graves.length} pendência(s) grave(s): ${graves.map((x) => x.texto).join(' ')}`,
        );
      // O conteúdo EDITÁVEL (com a edição humana), nunca o HTML da geração.
      const ext = d.formato === 'texto' ? 'txt' : 'md';
      const nome = `${seguro(d.title)}.${ext}`;
      const conteudo = new TextEncoder().encode(d.content);
      anexos.push({ nome, tipo: ext === 'txt' ? 'text/plain' : 'text/markdown', conteudo });
      guardados.push({ tipo: 'documento', id: d.id, versao: String(d.updatedAt), nome });
      texto += `\n${d.content}`;
      bytes += conteudo.length;
    } else {
      const r = await reuniaoNoEscopo(ctx, p.id);
      if (!r.segments.length)
        throw new ErroDeFerramenta('anexo_vazio', `A reunião “${r.title}” não tem transcrição: não há o que enviar.`);
      const vivo = await ctx.armazenamento.lerEstadoAoVivo().catch(() => null);
      const emAndamento =
        r.status === 'recording' ||
        (vivo?.session?.meetingId === r.id && ['recording', 'paused', 'captionsRequired'].includes(vivo.phase));
      let corpo = recordToText(r);
      if (emAndamento) {
        corpo =
          `TRANSCRIÇÃO PARCIAL — a captura desta reunião ainda está em andamento (até ${instante(
            r.segments.at(-1)?.endOffsetMs ?? 0,
          )}). O que falta ainda não foi capturado.\n\n` + corpo;
        avisos.push(`A transcrição de "${r.title}" é PARCIAL: a captura ainda está em andamento.`);
      }
      const nome = `${seguro(r.title)}-transcricao.txt`;
      const conteudo = new TextEncoder().encode(corpo);
      anexos.push({ nome, tipo: 'text/plain', conteudo });
      guardados.push({ tipo: 'transcricao', id: r.id, versao: versaoDaReuniao(r), nome });
      texto += `\n${corpo}`;
      bytes += conteudo.length;
    }
  }
  if (bytes > LIMITE_DE_ANEXOS_BYTES)
    throw new ErroDeFerramenta(
      'anexo_grande_demais',
      `Os anexos passam de ${Math.round(LIMITE_DE_ANEXOS_BYTES / 1024 / 1024)} MB. Envie menos arquivos ou um trecho.`,
    );
  return { anexos, guardados, texto, avisos };
}

/** O anexo guardado na prévia ainda é exatamente a mesma versão? */
async function versoesConferem(ctx: ContextoDeFerramenta, guardados: readonly AnexoGuardado[]): Promise<string | null> {
  for (const a of guardados) {
    if (a.tipo === 'documento') {
      const d = await documentoNoEscopo(ctx, a.id);
      if (String(d.updatedAt) !== a.versao) return `O documento "${d.title}" mudou depois da prévia.`;
    } else {
      const r = await reuniaoNoEscopo(ctx, a.id);
      if (versaoDaReuniao(r) !== a.versao) return `A transcrição de "${r.title}" mudou depois da prévia.`;
    }
  }
  return null;
}

function linhasDoEmail(p: PayloadDeEmail, extra: readonly string[] = []): string[] {
  return [
    `Para: ${p.para.map((x) => `${x.nome} <${x.email}>`).join(', ')}`,
    `Assunto: ${p.assunto}`,
    ...(p.anexos.length ? [`Anexos: ${p.anexos.map((a) => a.nome).join(', ')}`] : []),
    `Mensagem: ${p.corpo.length > 280 ? `${p.corpo.slice(0, 280)}…` : p.corpo}`,
    ...extra,
  ];
}

async function executarEnvio(
  ctx: ContextoDeFerramenta,
  chave: string,
  payload: PayloadDeEmail,
): Promise<Record<string, unknown>> {
  const alertas: readonly string[] = [];
  const permitirDesconhecido = repeticaoConfirmada(ctx);
  const montados = await montarAnexos(
    ctx,
    payload.anexos.map((a) => ({ tipo: a.tipo, id: a.id })),
  );
  const reserva = await reservarExecucao({
    chave,
    tipo: 'email',
    execucaoId: ctx.tarefa.execucaoId,
    conversaId: ctx.tarefa.conversaId,
    payload: payload as unknown as Record<string, unknown>,
    permitirDesconhecido,
  });
  const titulo = payload.assunto;
  if (reserva.tipo === 'ja_feito')
    return {
      enviado: 'ja_aceito',
      aviso: 'Este e-mail já foi aceito pelo Google antes. Não foi repetido. Diga isso.',
    };
  if (reserva.tipo === 'em_andamento')
    return { enviado: 'em_andamento', aviso: 'Este envio já está em curso. Não repita; diga que está em andamento.' };
  if (reserva.tipo === 'desconhecido') {
    registrarResultado(ctx, {
      operacao: 'email',
      estado: 'desconhecido',
      titulo,
      linhas: linhasDoEmail(payload),
      alertas: [...alertas, reserva.registro.erro?.mensagem ?? 'Não se sabe se saiu.'],
      chaveDoRascunho: chave,
    });
    return {
      enviado: 'desconhecido',
      aviso:
        'A tentativa anterior ficou com resultado DESCONHECIDO: pode ter saído. Não foi reenviado. A pessoa confere a ' +
        'pasta Enviados e, se não estiver lá, reenvia pelo botão do cartão.',
    };
  }

  try {
    const aceito = await enviarPeloGmail({
      de: payload.de,
      para: payload.para.map((p) => p.email),
      assunto: payload.assunto,
      corpo: payload.corpo,
      anexos: montados.anexos,
    });
    await concluirAcao(chave, { estado: 'aceito', resultado: { idDaMensagem: aceito.idDaMensagem } });
    registrarResultado(ctx, {
      operacao: 'email',
      estado: 'aceito',
      titulo,
      linhas: linhasDoEmail(payload),
      alertas: [...alertas, ...montados.avisos],
    });
    return {
      enviado: 'aceito_pelo_google',
      entrega_confirmada: false,
      destinatarios: payload.para.map((p) => p.nome),
      anexos: payload.anexos.map((a) => a.nome),
      aviso:
        'O Google ACEITOU o envio. Isso não confirma que chegou nem que foi lido; não diga "entregue". ' +
        'Diga o que foi enviado e a quem.',
    };
  } catch (e) {
    const err = e instanceof ErroDeIntegracao ? e : new ErroDeIntegracao('sem_rede', 'Falha ao enviar.');
    if (err.desfechoIncerto) {
      await concluirAcao(chave, { estado: 'desconhecido', erro: { codigo: err.codigo, mensagem: err.message } });
      registrarResultado(ctx, {
        operacao: 'email',
        estado: 'desconhecido',
        titulo,
        linhas: linhasDoEmail(payload),
        alertas: [err.message],
        chaveDoRascunho: chave,
      });
      return {
        enviado: 'desconhecido',
        motivo: err.message,
        aviso:
          'Não se sabe se o e-mail saiu. Não será reenviado sozinho: a pessoa confere a pasta Enviados e, se não ' +
          'estiver lá, reenvia pelo botão do cartão. O rascunho está guardado.',
      };
    }
    await concluirAcao(chave, { estado: 'falhou', erro: { codigo: err.codigo, mensagem: err.message } });
    registrarResultado(ctx, {
      operacao: 'email',
      estado: 'falhou',
      titulo,
      linhas: linhasDoEmail(payload),
      alertas: [err.message],
      chaveDoRascunho: chave,
    });
    return {
      enviado: false,
      motivo: err.message,
      aviso: 'O Google recusou; nada foi enviado. O rascunho foi preservado e pode ser copiado. Diga o motivo.',
    };
  }
}

export const sendEmail: DefinicaoDeFerramenta<z.infer<typeof envioSchema>> = {
  nome: 'send_email',
  descricao:
    'PREPARA um e-mail, pela conta do CITi da pessoa, para colegas da organização, com documentos ou a ' +
    'transcrição como anexo. Nomes são resolvidos no diretório em código. Esta ferramenta NUNCA envia: ela ' +
    'guarda o rascunho e mostra uma PRÉVIA com o botão Enviar; quem confirma é a pessoa, clicando. Depois de ' +
    'chamá-la, diga o que foi preparado (para quem, assunto, anexos) e que ela confirma pelo botão do cartão.',
  schemaDeEntrada: envioSchema,
  // Só prepara (grava um rascunho local): enviar é do botão, que o código verifica.
  efeito: 'leitura',
  requisitos: ['documentos', 'reunioes'],
  politica: { repeticao: 'idempotente', maxPorExecucao: 3 },
  etapa: 'Preparando o e-mail',
  async executar(args, ctx) {
    await exigirCapacidade('email', 'diretorio');
    const conexao = await lerConexao();
    if (!conexao) throw new ErroDeFerramenta('integracao_indisponivel', 'A conta do CITi não está conectada.');
    const pedido = ctx.tarefa.pedidoOriginal;

    try {
      // ---- confirmação de um rascunho guardado: só com o clique (`tarefa.confirmacao`)
      if (args.chave_do_rascunho) {
        const r = await rascunhoConfirmado(ctx, args.chave_do_rascunho, 'email');
        const payload = r.payload as unknown as PayloadDeEmail;
        const mudou = await versoesConferem(ctx, payload.anexos);
        if (mudou)
          throw new ErroDeFerramenta('anexo_mudou', `${mudou} Prepare a prévia de novo antes de enviar.`);
        return await executarEnvio(ctx, r.chave, payload);
      }

      // ---- prévia: resolve, monta, guarda
      if (!args.destinatarios.length) throw new ErroDeFerramenta('sem_destinatario', 'Diga para quem enviar.');
      if (!args.assunto || !args.corpo)
        throw new ErroDeFerramenta('sem_conteudo', 'Faltam o assunto e a mensagem.');

      const { pessoas, pendencias } = await resolverTodas(args.destinatarios, pedido);
      if (pendencias.length)
        return { enviado: false, pendencias, aviso: AVISO_DE_PENDENCIA };

      const montados = await montarAnexos(ctx, args.anexos);
      const alertas = [
        ...avisosDeExposicao(acharSensiveis(`${args.assunto}\n${args.corpo}\n${montados.texto}`)),
        ...montados.avisos,
      ];
      if (/\[(?:r\d+|\d+)\]/.test(args.corpo))
        alertas.push('O texto tem marcas de citação internas; tire-as antes de enviar.');

      const payload: PayloadDeEmail = {
        de: conexao.email,
        para: pessoas.map((p) => ({ nome: p.nome, email: p.email })),
        assunto: args.assunto,
        corpo: args.corpo,
        anexos: montados.guardados,
        externo: pessoas.some((p) => !p.daOrganizacao),
      };
      const chave = chaveDe(
        'email',
        ctx.tarefa.conversaId,
        payload.para.map((p) => p.email).sort().join(','),
        payload.assunto,
        payload.corpo,
        payload.anexos.map((a) => `${a.id}@${a.versao}`).join(','),
      );

      const feito = jaRegistrada(await obterAcao(chave));
      if (feito) return feito;

      await guardarRascunho({
        chave,
        tipo: 'email',
        execucaoId: ctx.tarefa.execucaoId,
        conversaId: ctx.tarefa.conversaId,
        payload: payload as unknown as Record<string, unknown>,
      });
      ctx.registrarCartao({
        tipo: 'rascunho_de_mensagem',
        canal: 'email',
        publico: payload.externo ? 'externo' : 'interno',
        destinatarios: pessoas.map((p) => ({
          nome: p.nome,
          endereco: p.email,
          situacao: p.daOrganizacao ? ('verificado' as const) : ('informado' as const),
        })),
        assunto: payload.assunto,
        corpo: payload.corpo,
        alertas,
        chaveDoRascunho: chave,
      });
      // O botão está no cartão do rascunho; este só repete o estado, sem botão duplicado.
      registrarResultado(ctx, {
        operacao: 'email',
        estado: 'aguardando_confirmacao',
        titulo: payload.assunto,
        linhas: linhasDoEmail(payload),
        alertas,
      });
      return {
        enviado: false,
        aguardando_confirmacao: true,
        alertas,
        aviso:
          'NADA foi enviado. Mostre o que vai sair (para quem, assunto, anexos) e diga que a pessoa envia clicando em ' +
          '"Enviar" no cartão. Não há outra forma de enviar: nenhuma frase dela confirma, e você não consegue confirmar.',
      };
    } catch (e) {
      throw comoErroDeFerramenta(e);
    }
  },
  resumir: (s) =>
    s.aguardando_confirmacao
      ? 'e-mail em prévia, nada enviado'
      : s.enviado === 'aceito_pelo_google'
        ? 'e-mail aceito pelo Google'
        : `e-mail: ${String(s.enviado)}`,
};

// ------------------------------------------------------------------- agenda

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('AAAA-MM-DD, no fuso de quem usa.');
const horaLocal = z.string().regex(/^\d{2}:\d{2}$/).describe('HH:MM, hora LOCAL de quem usa.');

function instantes(data: string, hora: string, duracaoMin: number, fuso: string): { inicio: number; fim: number } {
  if (!fusoValido(fuso)) throw new ErroDeFerramenta('fuso_invalido', `Fuso desconhecido: ${fuso}.`);
  let inicio: number;
  try {
    inicio = localParaInstante(data, hora, fuso);
  } catch (e) {
    throw new ErroDeFerramenta('horario_invalido', `${data} ${hora}: ${(e as Error).message}`);
  }
  return { inicio, fim: inicio + duracaoMin * 60_000 };
}

const iso = (ms: number) => new Date(ms).toISOString();

// ---- list_availability

const disponibilidadeSchema = z.object({
  participantes: z.array(alvoSchema).max(10).default([]),
  data_inicio: dataIso,
  data_fim: dataIso.optional().describe('Último dia (inclusive). Padrão: o mesmo dia. No máximo 7 dias.'),
  duracao_min: z.number().int().min(15).max(480).default(30),
  incluir_meus_eventos: z
    .boolean()
    .default(false)
    .describe('Lista os eventos da própria agenda, com o id (necessário para remarcar ou cancelar).'),
});

export const listAvailability: DefinicaoDeFerramenta<z.infer<typeof disponibilidadeSchema>> = {
  nome: 'list_availability',
  descricao:
    'Consulta ocupado/livre dos colegas na agenda do Google e sugere horários livres para TODOS os que ' +
    'têm agenda visível. Quem a conta não enxerga fica "sem acesso": a disponibilidade dessa pessoa é ' +
    'DESCONHECIDA — nunca diga que está livre. Pode listar os eventos da própria agenda (com id).',
  schemaDeEntrada: disponibilidadeSchema,
  efeito: 'leitura',
  requisitos: [],
  politica: { repeticao: 'leitura', maxPorExecucao: 4 },
  etapa: 'Consultando as agendas',
  async executar(args, ctx) {
    await exigirCapacidade('agenda_consulta', 'diretorio');
    const fuso = fusoDeQuemUsa();
    const fimDia = args.data_fim ?? args.data_inicio;
    const { inicio } = instantes(args.data_inicio, '00:00', args.duracao_min, fuso);
    const { inicio: fimMs } = instantes(fimDia, '23:59', args.duracao_min, fuso);
    if (fimMs - inicio > 7 * 86_400_000) throw new ErroDeFerramenta('janela_grande_demais', 'A janela passa de 7 dias.');
    if (fimMs < inicio) throw new ErroDeFerramenta('janela_invalida', 'A data final é anterior à inicial.');

    try {
      const conexao = await lerConexao();
      const { pessoas, pendencias } = await resolverTodas(args.participantes, ctx.tarefa.pedidoOriginal);
      if (pendencias.length) return { pendencias, aviso: AVISO_DE_PENDENCIA };

      const emails = [...new Set([conexao?.email ?? '', ...pessoas.map((p) => p.email)].filter(Boolean))];
      const ocupacao = await consultarOcupacao({ emails, inicio: iso(inicio), fim: iso(fimMs), fuso });
      const livres = janelasLivres({ ocupacao, inicio: Math.max(inicio, Date.now()), fim: fimMs, duracaoMin: args.duracao_min, fuso });
      const semAcesso = emails.filter((e) => !ocupacao[e]?.acesso);
      const nomeDe = (e: string) => pessoas.find((p) => p.email === e)?.nome ?? (e === conexao?.email ? 'você' : e);
      const meus = args.incluir_meus_eventos
        ? await listarEventosProprios({ inicio: iso(inicio), fim: iso(fimMs) })
        : [];
      return {
        fuso,
        por_pessoa: emails.map((e) => ({
          pessoa: nomeDe(e),
          agenda_visivel: !!ocupacao[e]?.acesso,
          ocupado: (ocupacao[e]?.ocupado ?? []).map(
            (o) => `${rotuloDoHorario(Date.parse(o.inicio), fuso)}–${rotuloDoHorario(Date.parse(o.fim), fuso)}`,
          ),
        })),
        sem_acesso: semAcesso.map(nomeDe),
        livres_para_quem_tem_agenda_visivel: livres.map((l) => ({
          inicio: l.inicio,
          fim: l.fim,
          rotulo: rotuloDoHorario(Date.parse(l.inicio), fuso),
        })),
        meus_eventos: meus.map((m: EventoDaAgenda) => ({
          id: m.id,
          titulo: m.titulo,
          quando: m.inicio ? rotuloDoHorario(Date.parse(m.inicio), fuso) : '',
          convidados: m.participantes.length,
          organizo: m.proprio,
        })),
        aviso: semAcesso.length
          ? `Sem acesso à agenda de: ${semAcesso.map(nomeDe).join(', ')}. A disponibilidade deles é DESCONHECIDA — ` +
            'não diga que estão livres. Os horários sugeridos só consideram quem tem agenda visível.'
          : 'Ocupado/livre do calendário principal; não prova que a pessoa está disponível. Horário comercial (9h–18h).',
      };
    } catch (e) {
      throw comoErroDeFerramenta(e);
    }
  },
  resumir: (s) => `${(s.por_pessoa as unknown[] | undefined)?.length ?? 0} agenda(s) consultada(s)`,
};

// ---- create_event

const criarEventoSchema = z.object({
  titulo: z.string().trim().min(2).max(160).optional(),
  data: dataIso.optional(),
  hora: horaLocal.optional(),
  duracao_min: z.number().int().min(5).max(480).default(30),
  participantes: z.array(alvoSchema).max(20).default([]),
  descricao: z.string().trim().max(1_000).optional(),
  chave_do_rascunho: z.string().max(80).optional().describe(RESERVADO_AO_BOTAO),
});

interface PayloadDeEvento {
  titulo: string;
  inicio: string;
  fim: string;
  fuso: string;
  participantes: Array<{ nome: string; email: string }>;
  descricao?: string;
}

const linhasDoEvento = (p: PayloadDeEvento, extra: readonly string[] = []): string[] => [
  `Quando: ${rotuloDoHorario(Date.parse(p.inicio), p.fuso)} (${p.fuso})`,
  `Duração: ${Math.round((Date.parse(p.fim) - Date.parse(p.inicio)) / 60_000)} min`,
  p.participantes.length
    ? `Convidados: ${p.participantes.map((x) => `${x.nome} <${x.email}>`).join(', ')}`
    : 'Sem convidados (só na sua agenda)',
  ...extra,
];

async function executarCriacao(
  ctx: ContextoDeFerramenta,
  chave: string,
  p: PayloadDeEvento,
  alertas: readonly string[],
): Promise<Record<string, unknown>> {
  const reserva = await reservarExecucao({
    chave,
    tipo: 'evento_criar',
    execucaoId: ctx.tarefa.execucaoId,
    conversaId: ctx.tarefa.conversaId,
    payload: p as unknown as Record<string, unknown>,
    permitirDesconhecido: repeticaoConfirmada(ctx),
  });
  if (reserva.tipo === 'ja_feito')
    return { criado: 'ja_criado', aviso: 'Este evento já foi criado. Não foi repetido.' };
  if (reserva.tipo === 'em_andamento') return { criado: 'em_andamento', aviso: 'A criação já está em curso. Não repita.' };
  if (reserva.tipo === 'desconhecido') {
    registrarResultado(ctx, {
      operacao: 'evento_criar',
      estado: 'desconhecido',
      titulo: p.titulo,
      linhas: linhasDoEvento(p),
      alertas: [reserva.registro.erro?.mensagem ?? 'Não se sabe se o evento foi criado.'],
      chaveDoRascunho: chave,
    });
    return {
      criado: 'desconhecido',
      aviso:
        'A tentativa anterior ficou DESCONHECIDA: o evento pode existir. Não foi repetido; a pessoa confere a agenda e, ' +
        'se não estiver lá, tenta de novo pelo botão do cartão.',
    };
  }
  try {
    const r = await criarEventoNaAgenda({
      chave,
      titulo: p.titulo,
      inicio: p.inicio,
      fim: p.fim,
      fuso: p.fuso,
      participantes: p.participantes.map((x) => x.email),
      ...(p.descricao ? { descricao: p.descricao } : {}),
    });
    await concluirAcao(chave, { estado: 'aceito', resultado: { eventoId: r.evento.id, link: r.evento.link ?? '' } });
    registrarResultado(ctx, {
      operacao: 'evento_criar',
      estado: 'aceito',
      titulo: p.titulo,
      linhas: linhasDoEvento(p),
      alertas: [...alertas],
      ...(r.evento.link ? { link: r.evento.link } : {}),
    });
    return {
      criado: r.jaExistia ? 'ja_existia' : 'criado',
      evento_id: r.evento.id,
      convites_enviados_pelo_google: p.participantes.length > 0,
      aviso:
        'O Google criou o evento' +
        (p.participantes.length ? ' e enviou os convites' : '') +
        '. Diga o dia e a hora no fuso informado. Não diga que alguém aceitou.',
    };
  } catch (e) {
    const err = e instanceof ErroDeIntegracao ? e : new ErroDeIntegracao('sem_rede', 'Falha ao criar.');
    const incerto = err.desfechoIncerto;
    await concluirAcao(chave, {
      estado: incerto ? 'desconhecido' : 'falhou',
      erro: { codigo: err.codigo, mensagem: err.message },
    });
    registrarResultado(ctx, {
      operacao: 'evento_criar',
      estado: incerto ? 'desconhecido' : 'falhou',
      titulo: p.titulo,
      linhas: linhasDoEvento(p),
      alertas: [err.message],
      chaveDoRascunho: chave,
    });
    return {
      criado: incerto ? 'desconhecido' : false,
      motivo: err.message,
      aviso: incerto
        ? 'Não se sabe se o evento foi criado. Não será repetido sozinho: a pessoa confere a agenda.'
        : 'O Google recusou; nada foi criado. Diga o motivo.',
    };
  }
}

/** Alertas de conflito, se a agenda dos convidados está visível. Falha vira aviso, nunca "livre". */
async function conflitos(p: PayloadDeEvento): Promise<string[]> {
  if (!p.participantes.length) return [];
  try {
    const oc = await consultarOcupacao({
      emails: p.participantes.map((x) => x.email),
      inicio: p.inicio,
      fim: p.fim,
      fuso: p.fuso,
    });
    return p.participantes.flatMap((x) => {
      const o = oc[x.email];
      if (!o?.acesso) return [`Não vejo a agenda de ${x.nome}: a disponibilidade dessa pessoa é desconhecida.`];
      return o.ocupado.length ? [`${x.nome} aparece como ocupado(a) nesse horário.`] : [];
    });
  } catch {
    return ['Não consegui consultar as agendas: a disponibilidade dos convidados é desconhecida.'];
  }
}

export const createEvent: DefinicaoDeFerramenta<z.infer<typeof criarEventoSchema>> = {
  nome: 'create_event',
  descricao:
    'PREPARA um evento na agenda do Google da pessoa, com convidados da organização. Fuso: o de quem usa. ' +
    'Esta ferramenta NUNCA cria: ela guarda a PRÉVIA com o botão Marcar; quem confirma é a pessoa, clicando ' +
    '(só então o Google cria o evento e envia os convites). Uma fala na reunião sobre marcar outro encontro ' +
    'não confirma nada.',
  schemaDeEntrada: criarEventoSchema,
  // Só prepara (grava um rascunho local): criar é do botão, que o código verifica.
  efeito: 'leitura',
  requisitos: [],
  politica: { repeticao: 'idempotente', maxPorExecucao: 3 },
  etapa: 'Preparando o evento',
  async executar(args, ctx) {
    await exigirCapacidade('agenda_eventos', 'diretorio');
    const pedido = ctx.tarefa.pedidoOriginal;
    try {
      if (args.chave_do_rascunho) {
        const r = await rascunhoConfirmado(ctx, args.chave_do_rascunho, 'evento_criar');
        return await executarCriacao(ctx, r.chave, r.payload as unknown as PayloadDeEvento, []);
      }
      if (!args.titulo || !args.data || !args.hora)
        throw new ErroDeFerramenta('faltam_dados', 'Faltam título, data e hora do evento.');
      const fuso = fusoDeQuemUsa();
      const { inicio, fim } = instantes(args.data, args.hora, args.duracao_min, fuso);
      if (inicio <= Date.now()) throw new ErroDeFerramenta('horario_passado', 'Esse horário já passou.');

      const { pessoas, pendencias } = await resolverTodas(args.participantes, pedido);
      if (pendencias.length) return { criado: false, pendencias, aviso: AVISO_DE_PENDENCIA };

      const payload: PayloadDeEvento = {
        titulo: args.titulo,
        inicio: iso(inicio),
        fim: iso(fim),
        fuso,
        participantes: pessoas.map((p) => ({ nome: p.nome, email: p.email })),
        ...(args.descricao ? { descricao: args.descricao } : {}),
      };
      const chave = chaveDe(
        'evento',
        ctx.tarefa.conversaId,
        payload.titulo,
        payload.inicio,
        payload.fim,
        payload.participantes.map((p) => p.email).sort().join(','),
      );
      const alertas = await conflitos(payload);
      const feito = jaRegistrada(await obterAcao(chave));
      if (feito) return feito;

      await guardarRascunho({
        chave,
        tipo: 'evento_criar',
        execucaoId: ctx.tarefa.execucaoId,
        conversaId: ctx.tarefa.conversaId,
        payload: payload as unknown as Record<string, unknown>,
      });
      registrarResultado(ctx, {
        operacao: 'evento_criar',
        estado: 'aguardando_confirmacao',
        titulo: payload.titulo,
        linhas: linhasDoEvento(payload),
        alertas,
        chaveDoRascunho: chave,
      });
      return {
        criado: false,
        aguardando_confirmacao: true,
        alertas,
        aviso:
          'NADA foi criado nem enviado. Mostre quando, a duração, o fuso e os convidados, e diga que a pessoa marca ' +
          'clicando em "Marcar" no cartão. Nenhuma frase dela confirma, e você não consegue confirmar.',
      };
    } catch (e) {
      throw comoErroDeFerramenta(e);
    }
  },
  resumir: (s) => (s.aguardando_confirmacao ? 'evento em prévia, nada criado' : `evento: ${String(s.criado)}`),
};

// ---- reschedule_event e cancel_event

/** Só mexe em evento que a conta organiza e que ainda existe. */
async function eventoAlteravel(id: string): Promise<EventoDaAgenda> {
  const e = await obterEvento(id);
  if (!e) throw new ErroDeFerramenta('evento_nao_encontrado', 'Não há evento com esse id na sua agenda.');
  if (e.cancelado) throw new ErroDeFerramenta('evento_cancelado', 'Esse evento já está cancelado.');
  if (!e.proprio)
    throw new ErroDeFerramenta(
      'evento_de_outra_pessoa',
      'Só dá para remarcar ou cancelar evento que você organiza. Este é de outra pessoa.',
    );
  return e;
}

const remarcarSchema = z.object({
  evento_id: z.string().min(5).max(200).optional().describe('O id vindo de list_availability (meus_eventos) ou de create_event.'),
  data: dataIso.optional(),
  hora: horaLocal.optional(),
  duracao_min: z.number().int().min(5).max(480).optional().describe('Padrão: a duração atual do evento.'),
  chave_do_rascunho: z.string().max(80).optional().describe(RESERVADO_AO_BOTAO),
});

interface PayloadDeAlteracao {
  eventoId: string;
  titulo: string;
  convidados: number;
  inicio?: string;
  fim?: string;
  fuso?: string;
}

async function aplicarAlteracao(
  ctx: ContextoDeFerramenta,
  chave: string,
  tipo: 'evento_remarcar' | 'evento_cancelar',
  p: PayloadDeAlteracao,
): Promise<Record<string, unknown>> {
  const reserva = await reservarExecucao({
    chave,
    tipo,
    execucaoId: ctx.tarefa.execucaoId,
    conversaId: ctx.tarefa.conversaId,
    payload: p as unknown as Record<string, unknown>,
    permitirDesconhecido: repeticaoConfirmada(ctx),
  });
  if (reserva.tipo === 'ja_feito') return { feito: 'ja_feito', aviso: 'Isto já foi feito. Não foi repetido.' };
  if (reserva.tipo === 'em_andamento') return { feito: 'em_andamento', aviso: 'Já está em curso. Não repita.' };
  const operacao = tipo;
  const linhas =
    tipo === 'evento_remarcar' && p.inicio && p.fuso
      ? [`Novo horário: ${rotuloDoHorario(Date.parse(p.inicio), p.fuso)} (${p.fuso})`, `Convidados avisados pelo Google: ${p.convidados}`]
      : [`Evento: ${p.titulo}`, `Convidados avisados pelo Google: ${p.convidados}`];
  if (reserva.tipo === 'desconhecido') {
    registrarResultado(ctx, {
      operacao,
      estado: 'desconhecido',
      titulo: p.titulo,
      linhas,
      alertas: [reserva.registro.erro?.mensagem ?? 'Não se sabe se foi feito.'],
      chaveDoRascunho: chave,
    });
    return {
      feito: 'desconhecido',
      aviso: 'A tentativa anterior ficou DESCONHECIDA. Não foi repetido; a pessoa confere a agenda e decide pelo botão.',
    };
  }
  try {
    if (tipo === 'evento_remarcar') {
      const r = await remarcarEvento(p.eventoId, { inicio: p.inicio!, fim: p.fim!, fuso: p.fuso! });
      await concluirAcao(chave, { estado: 'aceito', resultado: { eventoId: r.id } });
      registrarResultado(ctx, { operacao, estado: 'aceito', titulo: p.titulo, linhas, ...(r.link ? { link: r.link } : {}) });
      return { feito: 'remarcado', aviso: 'O Google remarcou e avisou os convidados. Diga o novo horário no fuso informado.' };
    }
    const r = await cancelarEvento(p.eventoId);
    await concluirAcao(chave, { estado: 'aceito', resultado: { jaCancelado: r.jaCancelado } });
    registrarResultado(ctx, { operacao, estado: 'aceito', titulo: p.titulo, linhas });
    return {
      feito: r.jaCancelado ? 'ja_estava_cancelado' : 'cancelado',
      aviso: 'O Google cancelou o evento e avisou os convidados. Não diga que alguém leu o aviso.',
    };
  } catch (e) {
    const err = e instanceof ErroDeIntegracao ? e : new ErroDeIntegracao('sem_rede', 'Falha na agenda.');
    const incerto = err.desfechoIncerto;
    await concluirAcao(chave, {
      estado: incerto ? 'desconhecido' : 'falhou',
      erro: { codigo: err.codigo, mensagem: err.message },
    });
    registrarResultado(ctx, {
      operacao,
      estado: incerto ? 'desconhecido' : 'falhou',
      titulo: p.titulo,
      linhas,
      alertas: [err.message],
      chaveDoRascunho: chave,
    });
    return {
      feito: incerto ? 'desconhecido' : false,
      motivo: err.message,
      aviso: incerto ? 'Não se sabe se foi feito. Não será repetido sozinho: a pessoa confere a agenda.' : 'O Google recusou; nada mudou.',
    };
  }
}

function previaDeAlteracao(
  ctx: ContextoDeFerramenta,
  chave: string,
  tipo: 'evento_remarcar' | 'evento_cancelar',
  p: PayloadDeAlteracao,
): Promise<RegistroDeAcao> {
  const linhas =
    tipo === 'evento_remarcar' && p.inicio && p.fuso
      ? [`Evento: ${p.titulo}`, `Novo horário: ${rotuloDoHorario(Date.parse(p.inicio), p.fuso)} (${p.fuso})`, `Convidados que o Google vai avisar: ${p.convidados}`]
      : [`Evento: ${p.titulo}`, `Convidados que o Google vai avisar: ${p.convidados}`];
  registrarResultado(ctx, {
    operacao: tipo,
    estado: 'aguardando_confirmacao',
    titulo: p.titulo,
    linhas,
    alertas:
      tipo === 'evento_cancelar' ? ['Cancelar avisa os convidados e não tem volta pelo Taq.'] : [],
    chaveDoRascunho: chave,
  });
  return guardarRascunho({
    chave,
    tipo,
    execucaoId: ctx.tarefa.execucaoId,
    conversaId: ctx.tarefa.conversaId,
    payload: p as unknown as Record<string, unknown>,
  });
}

export const rescheduleEvent: DefinicaoDeFerramenta<z.infer<typeof remarcarSchema>> = {
  nome: 'reschedule_event',
  descricao:
    'PREPARA a remarcação de um evento que a pessoa organiza, para um novo dia e hora (fuso de quem usa). ' +
    'Esta ferramenta NUNCA remarca: ela guarda a PRÉVIA com o botão Remarcar; quem confirma é a pessoa, ' +
    'clicando (só então o Google remarca e avisa os convidados).',
  schemaDeEntrada: remarcarSchema,
  // Só prepara (grava um rascunho local): remarcar é do botão, que o código verifica.
  efeito: 'leitura',
  requisitos: [],
  politica: { repeticao: 'idempotente', maxPorExecucao: 3 },
  etapa: 'Preparando a remarcação',
  async executar(args, ctx) {
    await exigirCapacidade('agenda_eventos');
    try {
      if (args.chave_do_rascunho) {
        const r = await rascunhoConfirmado(ctx, args.chave_do_rascunho, 'evento_remarcar');
        const p = r.payload as unknown as PayloadDeAlteracao;
        await eventoAlteravel(p.eventoId); // ainda existe e ainda é dela
        return await aplicarAlteracao(ctx, r.chave, 'evento_remarcar', p);
      }
      if (!args.evento_id || !args.data || !args.hora)
        throw new ErroDeFerramenta('faltam_dados', 'Faltam o evento (id), o dia e a hora novos.');
      const ev = await eventoAlteravel(args.evento_id);
      const fuso = fusoDeQuemUsa();
      const duracao = args.duracao_min ?? Math.max(5, Math.round((Date.parse(ev.fim) - Date.parse(ev.inicio)) / 60_000));
      const { inicio, fim } = instantes(args.data, args.hora, duracao, fuso);
      if (inicio <= Date.now()) throw new ErroDeFerramenta('horario_passado', 'Esse horário já passou.');
      const payload: PayloadDeAlteracao = {
        eventoId: ev.id,
        titulo: ev.titulo,
        convidados: ev.participantes.length,
        inicio: iso(inicio),
        fim: iso(fim),
        fuso,
      };
      const chave = chaveDe('remarcar', ctx.tarefa.conversaId, ev.id, iso(inicio), iso(fim));
      const feito = jaRegistrada(await obterAcao(chave));
      if (feito) return feito;
      await previaDeAlteracao(ctx, chave, 'evento_remarcar', payload);
      return {
        feito: false,
        aguardando_confirmacao: true,
        aviso:
          'NADA foi alterado. Diga qual evento, o novo horário e quantos convidados serão avisados, e diga que a pessoa ' +
          'remarca clicando em "Remarcar" no cartão. Nenhuma frase dela confirma, e você não consegue confirmar.',
      };
    } catch (e) {
      throw comoErroDeFerramenta(e);
    }
  },
  resumir: (s) => (s.aguardando_confirmacao ? 'remarcação em prévia' : `remarcar: ${String(s.feito)}`),
};

const cancelarSchema = z.object({
  evento_id: z.string().min(5).max(200).optional(),
  chave_do_rascunho: z.string().max(80).optional().describe(RESERVADO_AO_BOTAO),
});

export const cancelEvent: DefinicaoDeFerramenta<z.infer<typeof cancelarSchema>> = {
  nome: 'cancel_event',
  descricao:
    'PREPARA o cancelamento de um evento que a pessoa organiza. Esta ferramenta NUNCA cancela: ela guarda a ' +
    'PRÉVIA com o botão Cancelar o evento; quem confirma é a pessoa, clicando (só então o Google cancela e ' +
    'avisa os convidados, sem volta pelo Taq).',
  schemaDeEntrada: cancelarSchema,
  // Só prepara (grava um rascunho local): cancelar é do botão, que o código verifica.
  efeito: 'leitura',
  requisitos: [],
  politica: { repeticao: 'idempotente', maxPorExecucao: 2 },
  etapa: 'Preparando o cancelamento',
  async executar(args, ctx) {
    await exigirCapacidade('agenda_eventos');
    try {
      if (args.chave_do_rascunho) {
        const r = await rascunhoConfirmado(ctx, args.chave_do_rascunho, 'evento_cancelar');
        const p = r.payload as unknown as PayloadDeAlteracao;
        return await aplicarAlteracao(ctx, r.chave, 'evento_cancelar', p);
      }
      if (!args.evento_id) throw new ErroDeFerramenta('faltam_dados', 'Falta o evento (id).');
      const ev = await eventoAlteravel(args.evento_id);
      const payload: PayloadDeAlteracao = { eventoId: ev.id, titulo: ev.titulo, convidados: ev.participantes.length };
      const chave = chaveDe('cancelar', ctx.tarefa.conversaId, ev.id);
      const feito = jaRegistrada(await obterAcao(chave));
      if (feito) return feito;
      await previaDeAlteracao(ctx, chave, 'evento_cancelar', payload);
      return {
        feito: false,
        aguardando_confirmacao: true,
        aviso:
          'NADA foi cancelado. Diga qual evento e quantos convidados serão avisados, e diga que a pessoa cancela ' +
          'clicando em "Cancelar o evento" no cartão. Nenhuma frase dela confirma, e você não consegue confirmar.',
      };
    } catch (e) {
      throw comoErroDeFerramenta(e);
    }
  },
  resumir: (s) => (s.aguardando_confirmacao ? 'cancelamento em prévia' : `cancelar: ${String(s.feito)}`),
};

export const FERRAMENTAS_DE_INTEGRACAO: readonly DefinicaoDeFerramenta[] = [
  searchDirectory,
  sendEmail,
  listAvailability,
  createEvent,
  rescheduleEvent,
  cancelEvent,
] as unknown as readonly DefinicaoDeFerramenta[];

/** As ferramentas cuja capacidade está disponível AGORA — as únicas que o modelo pode receber. */
export async function ferramentasDeIntegracaoDisponiveis(): Promise<readonly DefinicaoDeFerramenta[]> {
  let estados: Awaited<ReturnType<typeof estadoDasCapacidades>>;
  try {
    estados = await estadoDasCapacidades();
  } catch {
    return [];
  }
  return FERRAMENTAS_DE_INTEGRACAO.filter((f) => {
    const cap = CAPACIDADE_DA_FERRAMENTA[f.nome];
    if (!cap || !(CAPACIDADES_EXTERNAS as readonly string[]).includes(cap)) return false;
    if (estados[cap].estado !== 'available') return false;
    // Enviar e agendar com colegas precisa também do diretório.
    return f.nome === 'create_event' || f.nome === 'send_email' || f.nome === 'list_availability'
      ? estados.diretorio.estado === 'available'
      : true;
  });
}
