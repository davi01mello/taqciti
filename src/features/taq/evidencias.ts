/**
 * O LIVRO de evidências de uma execução — e a conferência das citações.
 *
 * Cada trecho que uma ferramenta devolve ao modelo entra aqui com um id curto
 * (`r1`, `r2`…), e é por esse id que o modelo cita (`… sexta [r4].`). No fim, o
 * runtime confere cada citação da resposta:
 *
 *   1. o id existe neste livro — o modelo não inventou a referência;
 *   2. o registro de origem ainda existe e o local (segmento, intervalo) cabe
 *      nele;
 *   3. o trecho ainda está lá, literal (ignorando acento e caixa).
 *
 * O que ISTO NÃO GARANTE, e a interface não afirma: que a frase citada diga o
 * que o trecho diz. A conferência prova que a fonte existe, é recuperável e
 * contém o trecho — a interpretação continua sendo do modelo, e a pessoa pode
 * abrir a fonte para checar. Por isso a fonte é clicável.
 *
 * Citação que não passa não some calada: vira `[fonte não verificada]` no
 * texto e uma limitação no resultado.
 */
import type { ReferenciaDeEvidencia } from './contratos';
import type { ArmazenamentoDoTaq } from './armazenamento';
import { normalizar } from './busca';

type Nova = Omit<ReferenciaDeEvidencia, 'id' | 'sustenta'>;

export class LivroDeEvidencias {
  private readonly porId = new Map<string, ReferenciaDeEvidencia>();
  private readonly porChave = new Map<string, string>();
  private contador = 0;

  /** Registra (ou reencontra) um trecho e devolve o id que o modelo vai citar. */
  registrar(ref: Nova): string {
    const chave = [
      ref.tipo,
      ref.registroId,
      ref.local.segmento ?? '',
      ref.local.inicio ?? '',
      ref.local.fim ?? '',
    ].join('|');
    const existente = this.porChave.get(chave);
    if (existente) return existente;
    const id = `r${++this.contador}`;
    this.porId.set(id, { ...ref, id });
    this.porChave.set(chave, id);
    return id;
  }

  obter(id: string): ReferenciaDeEvidencia | undefined {
    return this.porId.get(id);
  }

  get tamanho(): number {
    return this.porId.size;
  }
}

const MARCADOR = /\[(r\d+(?:\s*[,;]\s*r\d+)*)\]/g;

/** Todos os ids citados num texto, na ordem, sem repetição. */
export function idsCitados(texto: string): string[] {
  const ids: string[] = [];
  for (const m of texto.matchAll(MARCADOR)) {
    for (const id of m[1]!.split(/\s*[,;]\s*/)) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Tira marcadores de citação de um texto — para o histórico de outra execução. */
export function semMarcadores(texto: string): string {
  return texto.replace(MARCADOR, '').replace(/[ \t]+([.,;:!?])/g, '$1');
}

/** A frase que termina no marcador: é o que a referência sustenta. */
function fraseAntes(texto: string, fim: number): string {
  const antes = texto.slice(0, fim);
  const corte = Math.max(
    antes.lastIndexOf('. '),
    antes.lastIndexOf('! '),
    antes.lastIndexOf('? '),
    antes.lastIndexOf('\n'),
  );
  return antes
    .slice(corte + 1)
    .replace(MARCADOR, '')
    .trim()
    .slice(-300);
}

async function confere(
  ref: ReferenciaDeEvidencia,
  armazenamento: ArmazenamentoDoTaq,
): Promise<boolean> {
  const trecho = normalizar(ref.trecho);
  if (ref.tipo === 'reuniao') {
    const r = await armazenamento.obterReuniao(ref.registroId);
    const i = ref.local.segmento;
    if (!r || i === undefined || i >= r.segments.length) return false;
    return !trecho || normalizar(r.segments[i]!.text).includes(trecho);
  }
  const d = await armazenamento.obterDocumento(ref.registroId);
  if (!d) return false;
  if (ref.local.fim !== undefined && ref.local.fim > d.content.length) return false;
  return !trecho || normalizar(d.content).includes(trecho);
}

export interface CitacoesConferidas {
  texto: string;
  evidencias: ReferenciaDeEvidencia[];
  naoVerificadas: string[];
}

export async function conferirCitacoes(
  texto: string,
  livro: LivroDeEvidencias,
  armazenamento: ArmazenamentoDoTaq,
): Promise<CitacoesConferidas> {
  const validas = new Map<string, ReferenciaDeEvidencia>();
  const invalidas = new Set<string>();

  for (const id of idsCitados(texto)) {
    const ref = livro.obter(id);
    if (ref && (await confere(ref, armazenamento))) validas.set(id, ref);
    else invalidas.add(id);
  }

  const evidencias: ReferenciaDeEvidencia[] = [];
  const reescrito = texto.replace(MARCADOR, (_todo, lista: string, pos: number) => {
    const ids = lista.split(/\s*[,;]\s*/);
    const bons = ids.filter((id) => validas.has(id));
    for (const id of bons) {
      if (!evidencias.some((e) => e.id === id)) {
        evidencias.push({ ...validas.get(id)!, sustenta: fraseAntes(texto, pos) });
      }
    }
    if (bons.length === ids.length) return `[${bons.join(', ')}]`;
    if (bons.length) return `[${bons.join(', ')}] [fonte não verificada]`;
    return '[fonte não verificada]';
  });

  return { texto: reescrito, evidencias, naoVerificadas: [...invalidas] };
}

function instanteLegivel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * As citações dentro de um DOCUMENTO salvo.
 *
 * `[r3]` só significa algo dentro da execução; no documento que a pessoa vai
 * revisar e compartilhar, é ruído. Aqui cada referência do livro vira uma nota
 * numerada (`[1]`) e a lista "Fontes" ao fim diz de onde veio — reunião,
 * instante, trecho. Referência que o livro não conhece sai do texto, e não vira
 * fonte: documento não carrega citação que ninguém conferiu.
 */
export function citacoesParaDocumento(
  conteudo: string,
  livro: LivroDeEvidencias,
): { texto: string; fontes: string[] } {
  const numeros = new Map<string, number>();
  const fontes: string[] = [];
  const texto = conteudo
    .replace(MARCADOR, (_todo, lista: string) => {
      const ns: number[] = [];
      for (const id of lista.split(/\s*[,;]\s*/)) {
        const ref = livro.obter(id);
        if (!ref) continue;
        let n = numeros.get(id);
        if (n === undefined) {
          n = numeros.size + 1;
          numeros.set(id, n);
          const onde =
            ref.local.offsetMs !== undefined
              ? ` · ${instanteLegivel(ref.local.offsetMs)}`
              : '';
          const trecho =
            ref.trecho.length > 200 ? `${ref.trecho.slice(0, 199)}…` : ref.trecho;
          fontes.push(`${n}. ${ref.titulo}${onde} — “${trecho}”`);
        }
        ns.push(n);
      }
      return ns.length ? `[${ns.join(', ')}]` : '';
    })
    .replace(/[ \t]+([.,;:!?])/g, '$1');
  return { texto, fontes };
}
