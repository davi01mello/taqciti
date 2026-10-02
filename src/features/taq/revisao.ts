/**
 * A REVISÃO de um documento — o que dá para conferir sem opinião.
 *
 * Duas partes, as duas determinísticas:
 *
 *   QUALIDADE (`quality_review`): a estrutura do tipo do catálogo — seção
 *     obrigatória ausente ou vazia, "A confirmar" que sobrou, parágrafo
 *     repetido, nota [n] sem fonte e fonte que ninguém cita.
 *   FONTES (`evidence_verifier`): cada linha de "Fontes" ainda aponta para uma
 *     reunião que existe e ainda contém o trecho? Se a reunião sumiu, a fonte
 *     está indisponível; se o trecho não está mais lá, a fonte mudou.
 *
 * O que NÃO sai daqui: "a frase interpreta bem o trecho". Isso é julgamento, e
 * a interface não vende a conferência como garantia — ela diz "trecho
 * conferido na fonte", não "verdadeiro".
 */
import type { DocumentoGuardado } from '@/features/documents/store';
import { CATALOGO_DE_DOCUMENTOS, type TipoDeDocumento } from '@/features/documents/catalogo';
import type { MeetingRecord } from '@/shared/types/domain';
import { normalizar } from './busca';

export interface ProblemaDaRevisao {
  gravidade: 'alta' | 'media' | 'baixa';
  tipo:
    | 'secao_ausente'
    | 'secao_vazia'
    | 'a_confirmar'
    | 'repeticao'
    | 'nota_sem_fonte'
    | 'fonte_sem_nota'
    | 'fonte_alterada'
    | 'fonte_indisponivel';
  texto: string;
}

export interface FonteRevisada {
  numero: number;
  situacao: 'conferida' | 'alterada' | 'indisponivel' | 'nao_conferivel';
  texto: string;
}

export interface RevisaoDoDocumento {
  tipo?: TipoDeDocumento;
  problemas: ProblemaDaRevisao[];
  fontes: FonteRevisada[];
}

interface Secao {
  titulo: string;
  corpo: string;
}

function secoesDe(conteudo: string): Secao[] {
  const partes = conteudo.split(/^##\s+/m).slice(1);
  return partes.map((p) => {
    const quebra = p.indexOf('\n');
    return {
      titulo: (quebra === -1 ? p : p.slice(0, quebra)).trim(),
      corpo: quebra === -1 ? '' : p.slice(quebra + 1).trim(),
    };
  });
}

/** O tipo do catálogo, pelo nome guardado no documento (`tipo` é o nome). */
export function tipoDoDocumento(doc: Pick<DocumentoGuardado, 'tipo'>): TipoDeDocumento | undefined {
  if (!doc.tipo) return undefined;
  const t = normalizar(doc.tipo);
  return CATALOGO_DE_DOCUMENTOS.find((c) => normalizar(c.nome) === t || c.id === t);
}

const LINHA_DE_FONTE = /^(\d+)\.\s+(.+?)(?:\s+·\s+\d+:\d{2}(?::\d{2})?)?\s+—\s+“(.+)”\s*$/;

export function revisarDocumento(
  doc: DocumentoGuardado,
  reunioes: readonly MeetingRecord[],
): RevisaoDoDocumento {
  const problemas: ProblemaDaRevisao[] = [];
  const tipo = tipoDoDocumento(doc);
  const secoes = secoesDe(doc.content);
  const porTitulo = new Map(secoes.map((s) => [normalizar(s.titulo), s]));

  if (tipo) {
    for (const s of tipo.estrutura) {
      const achada = porTitulo.get(normalizar(s.titulo));
      if (!achada) {
        if (s.obrigatoria)
          problemas.push({
            gravidade: 'alta',
            tipo: 'secao_ausente',
            texto: `Falta a seção obrigatória “${s.titulo}” do modelo ${tipo.nome}.`,
          });
      } else if (!achada.corpo) {
        problemas.push({
          gravidade: s.obrigatoria ? 'alta' : 'baixa',
          tipo: 'secao_vazia',
          texto: `A seção “${s.titulo}” está vazia.`,
        });
      }
    }
  }

  const corpoSemFontes = secoes
    .filter((s) => !['fontes', 'pendencias'].includes(normalizar(s.titulo)))
    .map((s) => `## ${s.titulo}\n${s.corpo}`)
    .join('\n');
  const aConfirmar = corpoSemFontes.match(/a confirmar/gi)?.length ?? 0;
  if (aConfirmar)
    problemas.push({
      gravidade: 'media',
      tipo: 'a_confirmar',
      texto: `${aConfirmar} ponto(s) ainda “A confirmar”.`,
    });

  const vistos = new Map<string, number>();
  for (const paragrafo of corpoSemFontes.split(/\n{2,}/)) {
    const chave = normalizar(paragrafo).replace(/\[\d+(?:, \d+)*\]/g, '').trim();
    if (chave.length < 40) continue;
    vistos.set(chave, (vistos.get(chave) ?? 0) + 1);
  }
  const repetidos = [...vistos.values()].filter((n) => n > 1).length;
  if (repetidos)
    problemas.push({
      gravidade: 'baixa',
      tipo: 'repeticao',
      texto: `${repetidos} parágrafo(s) aparecem repetidos.`,
    });

  const citados = new Set<number>();
  for (const m of corpoSemFontes.matchAll(/\[(\d+(?:,\s*\d+)*)\]/g))
    for (const n of m[1]!.split(/,\s*/)) citados.add(Number(n));

  const secaoDeFontes = porTitulo.get('fontes');
  const fontes: FonteRevisada[] = [];
  const listados = new Set<number>();
  for (const linha of (secaoDeFontes?.corpo ?? '').split('\n')) {
    const m = LINHA_DE_FONTE.exec(linha.trim());
    if (!m) continue;
    const numero = Number(m[1]);
    listados.add(numero);
    const titulo = m[2]!.trim();
    const trecho = normalizar(m[3]!.replace(/…$/, ''));
    const candidatas = reunioes.filter((r) => normalizar(r.title) === normalizar(titulo));
    // A fonte do documento é a reunião de origem dele, quando há.
    const reuniao =
      candidatas.find((r) => r.id === doc.meetingId) ?? (candidatas.length === 1 ? candidatas[0] : undefined);
    let situacao: FonteRevisada['situacao'];
    if (!candidatas.length) situacao = 'indisponivel';
    else if (!reuniao) situacao = 'nao_conferivel';
    else situacao = reuniao.segments.some((s) => normalizar(s.text).includes(trecho)) ? 'conferida' : 'alterada';
    fontes.push({ numero, situacao, texto: `${titulo} — “${m[3]}”` });
    if (situacao === 'indisponivel')
      problemas.push({
        gravidade: 'media',
        tipo: 'fonte_indisponivel',
        texto: `A fonte [${numero}] (${titulo}) não está mais disponível.`,
      });
    if (situacao === 'alterada')
      problemas.push({
        gravidade: 'media',
        tipo: 'fonte_alterada',
        texto: `O trecho da fonte [${numero}] não foi encontrado na transcrição atual de “${titulo}”.`,
      });
  }
  for (const n of citados)
    if (!listados.has(n))
      problemas.push({ gravidade: 'alta', tipo: 'nota_sem_fonte', texto: `A nota [${n}] não tem fonte listada.` });
  for (const n of listados)
    if (!citados.has(n))
      problemas.push({ gravidade: 'baixa', tipo: 'fonte_sem_nota', texto: `A fonte ${n} não é citada no texto.` });

  const ordem = { alta: 0, media: 1, baixa: 2 } as const;
  problemas.sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade]);
  return { ...(tipo ? { tipo } : {}), problemas, fontes };
}
