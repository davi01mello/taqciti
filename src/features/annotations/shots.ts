/**
 * Os PRINTS da aba da reunião.
 *
 * ── Por que JPEG, e por que um teto ──────────────────────────────────────
 *
 * Um print de 1440×900 em PNG passa de 1 MB, e vira ~1,4 MB depois de virar
 * data URL (base64 cresce um terço). O `storage.local` da extensão tem cota, e
 * estourá-la não falha só o print: falha a PRÓXIMA gravação de qualquer coisa,
 * inclusive a da transcrição em andamento. Então JPEG com qualidade alta (a
 * captura é de tela, não de fotografia) e um teto por reunião, com o mais
 * antigo saindo primeiro. Preferir perder o print mais velho a perder a
 * reunião.
 *
 * ── Por que o print não vai para a IA ─────────────────────────────────────
 *
 * Ele fica aqui, vinculado à reunião, e só entra num pedido à IA se a pessoa o
 * acrescentar ao contexto. Mandar imagem junto por padrão seria enviar a tela
 * de alguém para um terceiro sem que ninguém tenha pedido.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { onLocalChange, readLocal, writeLocal } from '@/shared/services/storage';

export interface Print {
  id: string;
  meetingId: string;
  /** `data:image/jpeg;base64,…` — o que `captureVisibleTab` devolve. */
  dataUrl: string;
  at: number;
  largura: number;
  altura: number;
}

/** Prints guardados por reunião. Além disto, o mais antigo sai. */
export const MAX_POR_REUNIAO = 12;
/** Teto duro do conjunto, para o storage não virar álbum. */
export const MAX_TOTAL = 40;

function ehPrint(v: unknown): v is Print {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<Print>;
  return (
    typeof p.id === 'string' &&
    typeof p.meetingId === 'string' &&
    typeof p.dataUrl === 'string' &&
    p.dataUrl.startsWith('data:image/')
  );
}

async function ler(): Promise<Print[]> {
  const bruto = await readLocal<unknown>(STORAGE_KEYS.shots);
  return Array.isArray(bruto) ? bruto.filter(ehPrint) : [];
}

/** Mais recentes primeiro, como em todo o resto do produto. */
export async function lerPrints(meetingId?: string): Promise<Print[]> {
  const todos = await ler();
  const filtrados = meetingId ? todos.filter((p) => p.meetingId === meetingId) : todos;
  return filtrados.sort((a, b) => b.at - a.at);
}

export function observarPrints(cb: (prints: Print[]) => void): () => void {
  let vivo = true;
  void lerPrints().then((p) => {
    if (vivo) cb(p);
  });
  const parar = onLocalChange<unknown>(STORAGE_KEYS.shots, (valor) => {
    if (!vivo) return;
    const lista = Array.isArray(valor) ? valor.filter(ehPrint) : [];
    cb(lista.sort((a, b) => b.at - a.at));
  });
  return () => {
    vivo = false;
    parar();
  };
}

function novoId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Guarda um print. Devolve o registro gravado.
 *
 * Lança se o storage recusar — quem chama precisa saber, porque a interface
 * mostra uma prévia e não pode dizer "salvo" sobre algo que não foi.
 */
export async function guardarPrint(
  meetingId: string,
  dataUrl: string,
  largura: number,
  altura: number,
): Promise<Print> {
  const todos = await ler();
  const print: Print = { id: novoId(), meetingId, dataUrl, at: Date.now(), largura, altura };

  // Poda antes de gravar: primeiro o excedente DESTA reunião, depois o teto
  // geral. A ordem importa — um álbum de outra reunião não pode consumir a cota
  // do print que acabou de ser tirado.
  const daReuniao = todos
    .filter((p) => p.meetingId === meetingId)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_POR_REUNIAO - 1)
    .map((p) => p.id);
  const mantidos = todos.filter(
    (p) => p.meetingId !== meetingId || daReuniao.includes(p.id),
  );
  const proximos = [print, ...mantidos]
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_TOTAL);

  await writeLocal(STORAGE_KEYS.shots, proximos);
  return print;
}

export async function apagarPrint(id: string): Promise<void> {
  const todos = await ler();
  const proximos = todos.filter((p) => p.id !== id);
  if (proximos.length !== todos.length) {
    await writeLocal(STORAGE_KEYS.shots, proximos);
  }
}
