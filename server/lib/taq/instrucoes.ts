/**
 * As instruções do Taq e dos especialistas implementados, versionadas como os
 * demais prompts: arquivos `.md` em `lib/prompts/taq/`.
 *
 * Moram no SERVIDOR, e não na extensão, por um motivo de fronteira: a rota de
 * turno não é um proxy genérico de modelo. Quem descobrir a URL e o segredo
 * compartilhado (que viaja no bundle, ver `apiGuard.ts`) consegue mandar
 * mensagens, mas não troca as instruções de sistema — só escolhe entre as que
 * existem aqui.
 *
 * Versão nova é arquivo novo, nunca edição no lugar — cada execução registra
 * `instrucoesVersao`, e editar no lugar faria o registro mentir.
 *
 * O carregador é próprio (e não `lib/prompts/index.ts`) porque os nomes aqui
 * não são só `vN`: cada especialista tem a sua família (`documents-v1`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A versão padrão do orquestrador. */
export const VERSAO_DAS_INSTRUCOES = 'taq-v7';

const ARQUIVO_POR_VERSAO: Record<string, string> = {
  'taq-v1': 'v1.md',
  /** v2: o fluxo de documentos pelo catálogo e os pedidos fora dele. */
  'taq-v2': 'v2.md',
  /** v3: o orquestrador delega documentos e operações aos especialistas. */
  'taq-v3': 'v3.md',
  'documents-v1': 'documents-v1.md',
  'app-assistant-v1': 'app-assistant-v1.md',
  /** v4 e v2: mínimo de intervenção — o documento só pergunta o tipo, a operação não confirma. */
  'taq-v4': 'v4.md',
  'documents-v2': 'documents-v2.md',
  'app-assistant-v2': 'app-assistant-v2.md',
  /** v3: a ajuda sai da referência (`get_app_capabilities`, `get_usage_guide`), nunca da memória do modelo. */
  'app-assistant-v3': 'app-assistant-v3.md',
  /** v5: o Taq também não explica o aplicativo de memória; consulta a referência se a delegação falhar. */
  'taq-v5': 'v5.md',
  /** v6 e v4: memória e contexto da conversa; apagar conversas. */
  'taq-v6': 'v6.md',
  'app-assistant-v4': 'app-assistant-v4.md',
  /** v5: copiar a transcrição, baixar documento e fontes do contexto da conversa. */
  'app-assistant-v5': 'app-assistant-v5.md',
  /** v7: os especialistas de trabalho (análise, compromissos, continuidade, passagem, comunicação…). */
  'taq-v7': 'v7.md',
  /** v3: revisar com check_document; refazer cria documento novo, sem sobrescrever a edição humana. */
  'documents-v3': 'documents-v3.md',
  'analyst-v1': 'analyst-v1.md',
  'commitments-v1': 'commitments-v1.md',
  'continuity-v1': 'continuity-v1.md',
  'handoff-v1': 'handoff-v1.md',
  'communication-v1': 'communication-v1.md',
  'scheduling-v1': 'scheduling-v1.md',
  /** v2: com a conta do CITi conectada, envia e-mail e mexe na agenda (prévia, confirmação, desfecho incerto). */
  'communication-v2': 'communication-v2.md',
  'scheduling-v2': 'scheduling-v2.md',
  /** v3: o modelo só PREPARA a prévia; quem confirma é o botão do cartão (sem `chave_do_rascunho`, sem "envie"). */
  'communication-v3': 'communication-v3.md',
  'scheduling-v3': 'scheduling-v3.md',
  'memory-v1': 'memory-v1.md',
  'context-v1': 'context-v1.md',
  'copilot-v1': 'copilot-v1.md',
  /** v2: acompanha o que falta fechar pela preparação da reunião (a esclarecer, discutido, a confirmar, decidido, adiado) e ajuda a fechar. */
  'copilot-v2': 'copilot-v2.md',
  /** Acompanha a reunião em silêncio e propõe, no máximo, UMA sugestão privada de condução por chamada (`avaliar`). */
  'intervencao-v1': 'intervencao-v1.md',
  /** Organiza o texto livre da pessoa num perfil de condução editável (`propor_perfil`); nunca salva. */
  'conducao-v1': 'conducao-v1.md',
};

const cache = new Map<string, string>();

export function versaoSuportada(versao: string): boolean {
  return versao in ARQUIVO_POR_VERSAO;
}

export function instrucoesDoTaq(versao: string = VERSAO_DAS_INSTRUCOES): string {
  const arquivo = ARQUIVO_POR_VERSAO[versao];
  if (!arquivo) throw new Error(`Versão de instruções desconhecida: ${versao}.`);
  const guardado = cache.get(arquivo);
  if (guardado !== undefined) return guardado;
  const texto = readFileSync(join(process.cwd(), 'lib', 'prompts', 'taq', arquivo), 'utf8').trim();
  cache.set(arquivo, texto);
  return texto;
}
