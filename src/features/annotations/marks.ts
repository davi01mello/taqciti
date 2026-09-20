/**
 * As MARCAÇÕES de trechos: um ícone que a pessoa associa a uma fala.
 *
 * ── Por que a chave é o `captionId` ───────────────────────────────────────
 *
 * Uma legenda do Meet não nasce pronta: a mesma fala chega várias vezes, cada
 * uma mais completa que a anterior, e o agregador reescreve o texto do segmento
 * no lugar. O que NÃO muda é o `captionId` — ele é estável por linha de legenda
 * (ver `CaptionChunk` em types/domain.ts) e é por isso que a marcação sobrevive
 * às atualizações: ela está presa ao trecho, não ao texto que ele tinha no
 * instante do clique. Marcar pelo índice do segmento, ou por um trecho do
 * texto, quebraria na primeira correção da legenda.
 *
 * ── Por que fora da transcrição ───────────────────────────────────────────
 *
 * A marcação é metadado: as palavras capturadas continuam exatamente as que
 * foram ditas, e o `.txt` exportado sai sem ícone nenhum. Guardá-la dentro do
 * segmento significaria reescrever a transcrição para registrar uma opinião
 * sobre ela — e a exportação teria que lembrar de removê-la.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { mapaGuardado } from './store';

/** O conjunto é pequeno de propósito: quatro intenções que se distinguem num
 *  ícone de 14px. Uma paleta maior vira adivinhação na hora de marcar. */
export type TipoDeMarca = 'destaque' | 'duvida' | 'decisao' | 'acao';

export const TIPOS_DE_MARCA: ReadonlyArray<{
  id: TipoDeMarca;
  rotulo: string;
  simbolo: string;
}> = [
  { id: 'destaque', rotulo: 'Destaque', simbolo: '★' },
  { id: 'duvida', rotulo: 'Dúvida', simbolo: '?' },
  { id: 'decisao', rotulo: 'Decisão', simbolo: '✓' },
  { id: 'acao', rotulo: 'Ação', simbolo: '→' },
];

const VALIDOS = new Set<string>(TIPOS_DE_MARCA.map((m) => m.id));

/** As marcações de UMA reunião: `captionId` → tipo. */
export type MarcasDaReuniao = Record<string, TipoDeMarca>;

function ehMapaDeMarcas(v: unknown): v is MarcasDaReuniao {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every(
    (t) => typeof t === 'string' && VALIDOS.has(t),
  );
}

const mapa = mapaGuardado<MarcasDaReuniao>(STORAGE_KEYS.marks, ehMapaDeMarcas);

export const observarMarcas = mapa.observar;

export async function lerMarcas(meetingId: string): Promise<MarcasDaReuniao> {
  return (await mapa.lerDe(meetingId)) ?? {};
}

/**
 * Põe, troca ou remove a marca de um trecho. `null` remove — é o mesmo caminho
 * de "desmarcar" e de "clicar de novo no ícone que já estava lá".
 */
export async function marcarTrecho(
  meetingId: string,
  captionId: string,
  tipo: TipoDeMarca | null,
): Promise<void> {
  await mapa.atualizar(meetingId, (atual) => {
    const base = atual ?? {};
    if (tipo === null) {
      if (!(captionId in base)) return Object.keys(base).length ? base : null;
      const resto = { ...base };
      delete resto[captionId];
      // Reunião sem marca nenhuma sai do mapa: não deixa casca no storage.
      return Object.keys(resto).length ? resto : null;
    }
    return { ...base, [captionId]: tipo };
  });
}
