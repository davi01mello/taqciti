/**
 * Quando uma ação externa pode sair SEM prévia — decidido em código, sobre o
 * pedido da PESSOA.
 *
 * Duas portas, e nenhuma depende de o modelo ter sido cuidadoso:
 *
 *   direta     — o pedido já nomeou os destinatários e o conteúdo (ou o
 *                horário e o título): repetir "posso enviar?" seria pergunta
 *                sem motivo. É o caso de "envie a ata da sprint para a Ana".
 *   com prévia — falta uma escolha, ou o texto foi composto pelo modelo, ou há
 *                alerta, ou o alvo é de fora: o Taq mostra o que vai sair e só
 *                executa quando a pessoa confirmar numa mensagem seguinte.
 *
 * Tudo aqui é função pura (sem storage, sem rede) para ser testada a fundo.
 */
import { normalizar, termosDe } from './busca';

const palavras = (texto: string) => normalizar(texto).split(/[^a-z0-9]+/).filter((p) => p.length >= 3);

/** Todas as partes do nome (≥ 3 letras) aparecem, como palavras, no pedido? */
export function nomeNoPedido(nome: string, pedido: string): boolean {
  const partes = palavras(nome);
  if (!partes.length) return false;
  const alvo = ` ${palavras(pedido).join(' ')} `;
  return partes.every((p) => alvo.includes(` ${p} `));
}

/** O endereço aparece, letra por letra, no pedido? */
export function enderecoNoPedido(email: string, pedido: string): boolean {
  return normalizar(pedido).includes(email.trim().toLowerCase());
}

/** O corpo é uma frase que a PESSOA escreveu entre aspas no pedido? */
export function corpoNoPedido(corpo: string, pedido: string): boolean {
  const c = normalizar(corpo).replace(/[^a-z0-9 ]/g, '').trim();
  if (c.length < 8) return false;
  return normalizar(pedido).replace(/[^a-z0-9 ]/g, '').includes(c);
}

/** O pedido traz um horário explícito ("às 14h", "14:30", "dia 08/10")? */
export function horarioNoPedido(pedido: string): boolean {
  const t = normalizar(pedido);
  return /\b\d{1,2}\s?(?:h|hs|horas?)(?:\s?\d{2})?\b/.test(t) || /\b\d{1,2}:\d{2}\b/.test(t);
}

/** Pelo menos dois termos do título do evento aparecem no pedido? */
export function tituloNoPedido(titulo: string, pedido: string): boolean {
  const alvo = ` ${termosDe(pedido).join(' ')} `;
  const termos = termosDe(titulo);
  const achados = termos.filter((t) => alvo.includes(` ${t} `)).length;
  return termos.length === 1 ? achados === 1 : achados >= 2;
}

export interface PessoaDaDecisao {
  /** O nome (ou endereço) dela está no pedido da pessoa. */
  citadaNoPedido: boolean;
  daOrganizacao: boolean;
}

export interface DecisaoDeEnvio {
  direto: boolean;
  /** Por que passou pela prévia — vira o aviso ao modelo e linha no cartão. */
  motivos: string[];
}

export function decidirEnvio(e: {
  pedido: string;
  destinatarios: readonly PessoaDaDecisao[];
  temAnexo: boolean;
  corpo: string;
  alertas: number;
}): DecisaoDeEnvio {
  const motivos: string[] = [];
  if (!e.destinatarios.length) motivos.push('não há destinatário');
  if (e.destinatarios.some((d) => !d.citadaNoPedido))
    motivos.push('algum destinatário não foi dito por você neste pedido');
  if (e.destinatarios.some((d) => !d.daOrganizacao)) motivos.push('há destinatário de fora da organização');
  if (e.alertas > 0) motivos.push('o conteúdo tem dado sensível ou aviso de exposição');
  const conteudoDito = (e.temAnexo && e.corpo.trim().length <= 600) || corpoNoPedido(e.corpo, e.pedido);
  if (!conteudoDito)
    motivos.push('o texto da mensagem foi composto pelo Taq, e você ainda não o viu');
  return { direto: motivos.length === 0, motivos };
}

export function decidirEvento(e: {
  pedido: string;
  participantes: readonly PessoaDaDecisao[];
}): DecisaoDeEnvio {
  const motivos: string[] = [];
  if (!horarioNoPedido(e.pedido)) motivos.push('o horário não foi dito por você neste pedido');
  if (e.participantes.some((p) => !p.citadaNoPedido))
    motivos.push('algum convidado não foi dito por você neste pedido');
  if (e.participantes.some((p) => !p.daOrganizacao)) motivos.push('há convidado de fora da organização');
  return { direto: motivos.length === 0, motivos };
}

export function decidirAlteracaoDeEvento(e: {
  pedido: string;
  titulo: string;
  exigeHorario: boolean;
  /** Há convidados além de quem organiza: mexer no evento avisa gente. */
  temConvidados: boolean;
}): DecisaoDeEnvio {
  const motivos: string[] = [];
  if (!tituloNoPedido(e.titulo, e.pedido)) motivos.push('o evento não foi nomeado por você neste pedido');
  if (e.exigeHorario && !horarioNoPedido(e.pedido)) motivos.push('o novo horário não foi dito por você neste pedido');
  if (e.temConvidados && !/\b(cancel|remarc|remarq|reagend)/.test(normalizar(e.pedido)))
    motivos.push('o pedido não diz claramente o que fazer com o evento');
  return { direto: motivos.length === 0, motivos };
}
