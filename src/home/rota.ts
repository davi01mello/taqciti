/**
 * O que a URL da HOME pede.
 *
 * A HOME é um destino só e a troca de seção é estado local — trocar de aba
 * interna não deveria empilhar histórico do navegador. Mas o ENDEREÇO ainda
 * precisa poder apontar para um lugar: quem clica em "Abrir no TaqCiti" dentro
 * de uma reunião encerrada quer cair naquela reunião, não na conversa.
 *
 * Então a query string é lida UMA vez, na montagem, e vira o estado inicial.
 * Daí em diante quem manda é a navegação da tela, senão o botão "voltar" da
 * lista seria desfeito no render seguinte.
 *
 * Puro de propósito: recebe a search string, não toca em `window`. É o que
 * permite testar as combinações sem um navegador no meio.
 */
export type Secao = 'assistente' | 'reunioes' | 'documentos' | 'conexoes';

const SECOES: readonly Secao[] = ['assistente', 'reunioes', 'documentos', 'conexoes'];

export interface PedidoDaHome {
  secao: Secao;
  /** Reunião em que a seção "Reuniões" já nasce aberta. */
  recordId: string | null;
}

export function lerPedidoDaHome(search: string): PedidoDaHome {
  const params = new URLSearchParams(search);
  const recordId = params.get('record');
  const pedida = params.get('secao');
  const secao = SECOES.find((s) => s === pedida) ?? null;

  // Um registro implica a seção que o mostra, mesmo que a URL não a traga: sem
  // isto um link com `?record=…` cairia no Assistente e a reunião pedida
  // simplesmente não apareceria, sem erro nenhum.
  if (recordId) return { secao: 'reunioes', recordId };
  return { secao: secao ?? 'assistente', recordId: null };
}
