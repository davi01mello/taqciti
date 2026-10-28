/**
 * Os tipos do catálogo (ata, x1, resumo, daily, planning, review) no padrão
 * visual da Apostila.
 *
 * Eles saíam de `render/pdf.ts`, que desenha a moldura da Ata (`example.pdf`).
 * Agora o `DocumentData` vira uma `ContentTree` e passa pelo MESMO compilador
 * dos documentos personalizados, na variante `editorial` — um padrão visual só,
 * e uma medida só para manter.
 *
 * O que NÃO entra no documento, de propósito:
 *  - campo ausente. Cargo que a reunião não disse, quem assina, nome do projeto:
 *    a linha não existe. Nada de `[A preencher: …]` num documento de cliente.
 *    Só uma lacuna marcada como `extrema` (ver `soDuvidasExtremas`) aparece.
 *  - a pessoa que o Meet chama de "Você": não é um nome.
 *
 * E o que não pode sair vazio não sai: documento sem nenhum conteúdo é erro
 * (`DocumentoSemConteudoError`), não um PDF com capa e mais nada — foi o que o
 * X1 entregava para uma reunião que não era uma entrevista.
 */
import type { DocumentType } from '../documentTypes';
import { TEMPLATES } from '../templates';
import {
  juntarFrases,
  linhaDoParticipante,
  rotuloDoPeriodo,
  soDuvidasExtremas,
  type DocumentData,
  type Gap,
} from '../documentData';
import { ehRotuloDeSelf } from '../rotuloDeSelf';
import { compilarPdf } from './compilador';
import type { Bloco, ContentTree } from './contentTree';
import { VARIANTE_DOS_PERSONALIZADOS } from './perfil';

export class DocumentoSemConteudoError extends Error {
  constructor(readonly documentType: DocumentType) {
    super(
      documentType === 'x1'
        ? 'A transcrição não tem perguntas e respostas de uma conversa individual (X1). ' +
            'Este tipo serve para entrevistas 1:1; para uma reunião de equipe, use Ata ou Resumo.'
        : 'A reunião não tem conteúdo suficiente para este documento.',
    );
    this.name = 'DocumentoSemConteudoError';
  }
}

export interface EntradaDoCatalogo {
  documentType: DocumentType;
  data: DocumentData;
  /** O título da reunião, quando a extensão o manda. Vira o subtítulo da capa. */
  tituloDaReuniao?: string;
  /** Lacunas que sobraram — só as extremas chegam até aqui. */
  gaps?: Gap[];
}

type SemId<T> = T extends unknown ? Omit<T, 'blockId'> : never;

/** O modelo costuma numerar os títulos ("1. Instalação"); a numeração é nossa, e não pode dobrar. */
const semNumeracao = (titulo: string): string => titulo.replace(/^\s*\d+\s*[.)\-–—:]\s*/, '').trim();

const linhas = (texto: string): string[] =>
  texto
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

/** Monta os blocos de corpo (depois da capa) de cada tipo. */
function corpoDe(documentType: DocumentType, data: DocumentData): SemId<Bloco>[] {
  const template = TEMPLATES[documentType];
  const blocos: SemId<Bloco>[] = [];
  // Nível 2: o título de seção do corpo da Apostila. O nível 1 é o de abertura
  // de capítulo, com texto grande — pesado demais para uma ata de duas páginas,
  // e deixava "Conclusão" sozinha numa página.
  const titulo = (texto: string, nivel: 1 | 2 | 3 = 2) =>
    blocos.push({ tipo: 'titulo', nivel, texto, fontes: [], origem: 'agente' });
  const paragrafo = (texto: string) =>
    blocos.push({ tipo: 'paragrafo', texto, fontes: [], origem: 'agente' });
  const lista = (itens: string[], ordenada = false) => {
    const limpos = itens.map((i) => i.trim()).filter(Boolean);
    if (limpos.length > 0) blocos.push({ tipo: 'lista', ordenada, itens: limpos, fontes: [], origem: 'agente' });
  };
  const secao = (id: string): string => template.sections.find((s) => s.id === id)?.title ?? id;
  const pontos = (id: string, itens: { text: string }[] | undefined) => {
    if (!itens?.some((i) => i.text.trim())) return;
    titulo(secao(id));
    lista(itens.map((i) => i.text));
  };

  // --- Ata: as linhas rotuladas abrem a página, antes de qualquer título ----
  // Depois do título do resumo executivo elas liam como parte dele.
  if (data.generalTopic) {
    paragrafo(`**Tópico:** ${data.generalTopic.topic}`);
    paragrafo(`**Andamento:** ${data.generalTopic.progress}`);
  }

  // --- Resumo executivo (Ata e Resumo): o que quem tem dois minutos lê --------
  const executivo = juntarFrases((data.executiveSummary ?? []).map((a) => a.text));
  if (executivo) {
    titulo(secao('resumo_executivo'));
    paragrafo(executivo);
  }

  const participantes = (data.participants ?? []).filter((p) => !ehRotuloDeSelf(p.name));
  if (participantes.length > 0) {
    titulo(secao('participantes'));
    lista(participantes.map((p) => linhaDoParticipante({ ...p, name: `**${p.name}**` }, p.role)));
  }

  const topicos = data.topicsDiscussed ?? [];
  if (topicos.length > 0) {
    titulo(secao('topicos_discutidos'));
    topicos.forEach((t, i) => {
      paragrafo(`**${i + 1}. ${semNumeracao(t.title)}**`);
      linhas(t.summary).forEach(paragrafo);
    });
  }

  pontos('decisoes', data.decisions);

  // Encaminhamentos: tabela com quem assumiu; a coluna Prazo só existe se
  // algum prazo foi dito. Sem dono, a ação vai para a caixa própria — e não
  // para uma célula vazia, que leria como esquecimento.
  const encaminhamentos = data.actionItems ?? [];
  const comDono = encaminhamentos.filter((e) => e.responsavel);
  const semDono = encaminhamentos.filter((e) => !e.responsavel);
  if (encaminhamentos.length > 0) titulo(secao('encaminhamentos'));
  if (comDono.length > 0) {
    const comPrazo = comDono.some((e) => e.prazo);
    blocos.push({
      tipo: 'tabela',
      cabecalho: comPrazo ? ['Ação', 'Responsável', 'Prazo'] : ['Ação', 'Responsável'],
      linhas: comDono.map((e) => (comPrazo ? [e.acao, e.responsavel!, e.prazo ?? '—'] : [e.acao, e.responsavel!])),
      fontes: [],
      origem: 'agente',
    });
  }
  if (semDono.length > 0) {
    paragrafo('**Sem responsável definido**');
    lista(semDono.map((e) => (e.prazo ? `${e.acao} (prazo: ${e.prazo})` : e.acao)));
  }

  if (documentType !== 'resumo') pontos('em_aberto', data.openPoints);
  pontos('outcomes', data.outcomes);
  pontos('outputs', data.outputs);

  // Documentos salvos antes de 28/10/2026, quando o resumo executivo a substituiu.
  if (data.conclusion?.text.trim()) {
    titulo('Conclusão');
    linhas(data.conclusion.text).forEach(paragrafo);
  }

  // Sem nome de quem assina não há fecho.
  if (data.signature?.name) {
    paragrafo('Atenciosamente,');
    paragrafo(data.signature.role ? `**${data.signature.name}** – ${data.signature.role}` : `**${data.signature.name}**`);
  }

  // --- X1 --------------------------------------------------------------
  (data.qa ?? [])
    .filter((par) => par.pergunta || par.resposta)
    .forEach((par, i) => {
      if (par.pergunta) paragrafo(`**${i + 1}. ${par.pergunta}**`);
      if (par.resposta) linhas(par.resposta).forEach(paragrafo);
    });

  // --- Resumo ----------------------------------------------------------
  (data.periods ?? []).forEach((periodo, i) => {
    const intervalo = rotuloDoPeriodo(periodo);
    // O horário vai numa linha própria: dentro do título ele quebrava no meio
    // ("(08:28 –" / "11:17)").
    titulo(`${i + 1}. ${semNumeracao(periodo.title)}`);
    if (intervalo) paragrafo(`**${intervalo}**`);
    linhas(periodo.summary).forEach(paragrafo);
  });
  if (documentType === 'resumo') pontos('pontos_de_atencao', data.openPoints);

  // --- Daily, Planning, Review (seções genéricas) ------------------------
  for (const [id, itens] of Object.entries(data.generic ?? {})) {
    if (itens.length === 0) continue;
    const nome = secao(id);
    // Documento de uma seção só, com o mesmo nome do documento: o título
    // repetiria a capa.
    if (nome !== template.label && Object.keys(data.generic ?? {}).length > 1) titulo(nome);
    lista(itens.map((i) => i.text));
  }

  return blocos;
}

/** O `DocumentData` de um tipo do catálogo como árvore editorial. */
export function arvoreDoCatalogo(entrada: EntradaDoCatalogo): ContentTree {
  const { documentType, data } = entrada;
  const template = TEMPLATES[documentType];

  const corpo = corpoDe(documentType, data);
  const extremas = soDuvidasExtremas(entrada.gaps ?? []);
  if (corpo.length === 0 && extremas.length === 0) throw new DocumentoSemConteudoError(documentType);

  const subtitulo = data.metadata?.projectName ?? entrada.tituloDaReuniao ?? data.generalTopic?.topic;
  const capa: SemId<Bloco> = {
    tipo: 'capa',
    variante: VARIANTE_DOS_PERSONALIZADOS,
    titulo: template.documentTitle ?? template.label,
    ...(subtitulo ? { subtitulo } : {}),
    ...(data.metadata?.date ? { data: data.metadata.date } : {}),
    fontes: [],
    origem: 'agente',
  };

  return {
    revisao: 0,
    titulo: template.documentTitle ?? template.label,
    blocos: [capa, ...corpo].map((bloco, i) => ({ ...bloco, blockId: `b${i + 1}` }) as Bloco),
    // A pergunta extrema, se houver, viaja com o documento; o PDF não a imprime.
    lacunas: extremas.map((g) => ({ campo: g.field, pergunta: g.question })),
  };
}

/** O PDF de um tipo do catálogo, no padrão da Apostila. */
export async function renderPdfDoCatalogo(entrada: EntradaDoCatalogo): Promise<Buffer> {
  const compilado = await compilarPdf(arvoreDoCatalogo(entrada), { variante: VARIANTE_DOS_PERSONALIZADOS });
  return compilado.pdf;
}
