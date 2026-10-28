/**
 * O PADRÃO DO CITi — o assistente de reuniões que todo mundo recebe sem
 * configurar nada, e de onde o "Personalizado" parte.
 *
 * ── Por que mora no pacote ──────────────────────────────────────────────────
 *
 * É uma constante versionada da extensão, não uma resposta do servidor: o
 * Preparar funciona com o servidor fora, o teste fixa o texto exato, e uma
 * versão nova do padrão sai junto com a extensão que sabe lê-la. Mudou o
 * texto? Suba `versao`: quem personalizou vê de qual versão partiu
 * (`padraoVersao`), e a reunião em andamento continua com a cópia de quando
 * começou (`fixarPerfilDaReuniao`).
 *
 * ── Por que só estes contextos ──────────────────────────────────────────────
 *
 * O padrão é o comportamento que o assistente de reuniões já tinha, dito em
 * contextos. A ata NÃO entra: documentos são outro agente, com o próprio
 * "padrão CITi" (`server/lib/documentos/perfil.ts`). O "Manual do CITi" da
 * prévia também não: sem o texto real, entraria um resumo inventado — e este
 * repositório é público.
 *
 * ── Por que "só quando eu chamar" ───────────────────────────────────────────
 *
 * Antes do padrão, quem nunca configurou nada não recebia sugestão sozinha (o
 * apoio só age com um modo que a pessoa escolheu). O padrão não muda isso para
 * ninguém: sugerir sem ser chamado é escolha de quem personaliza.
 */
import type { ModoDeIntervencao } from './store';

export interface ContextoDoPadrao {
  id: string;
  nome: string;
  texto: string;
  vaga: number;
}

export const PADRAO_DO_CITI: {
  versao: number;
  modo: ModoDeIntervencao;
  contextos: readonly ContextoDoPadrao[];
} = {
  versao: 1,
  modo: 'sob_demanda',
  contextos: [
    {
      id: 'padrao-conducao',
      nome: 'Condução CITi',
      texto: 'Ajuda a sair de cada ponto com dono e prazo. Se ninguém assumiu, pergunta antes de seguir.',
      vaga: 0,
    },
    {
      id: 'padrao-uma-pergunta',
      nome: 'Uma pergunta por vez',
      texto: 'Quando chamado, uma lembrança relevante por vez, numa pergunta curta. Não interrompe quem está falando.',
      vaga: 1,
    },
  ],
};
