/**
 * O token OAuth — pedido ao Chrome, usado em memória e descartado.
 *
 * `chrome.identity.getAuthToken` devolve um token da conta que a pessoa já usa
 * no Chrome (a conta Google do CITi) e guarda o cache dele no perfil. Nada aqui
 * escreve o token em storage, em log ou numa mensagem de erro: ele existe só
 * entre `pedirToken` e o `fetch` que o usa. O servidor nunca o vê.
 */
import { oauthConfigurado } from '@/document/googleDocs';
import { ErroDeIntegracao } from './erros';

export interface OpcoesDoToken {
  /** Abre a tela de consentimento do Google se preciso. Sem isto, só o que já foi concedido. */
  interativo: boolean;
}

export function pedirToken(escopos: readonly string[], opcoes: OpcoesDoToken): Promise<string> {
  if (!oauthConfigurado()) {
    return Promise.reject(
      new ErroDeIntegracao(
        'nao_configurado',
        'O cliente OAuth do Google ainda não foi registrado para esta extensão (docs/integracoes-google-workspace.md).',
      ),
    );
  }
  return new Promise((resolve, reject) => {
    try {
      chrome.identity.getAuthToken({ interactive: opcoes.interativo, scopes: [...escopos] }, (resposta) => {
        const falha = chrome.runtime.lastError;
        // O texto do Chrome pode ser cru ("OAuth2 not granted or revoked"): só o
        // classificamos; a mensagem que sobe é nossa.
        const token =
          typeof resposta === 'string' ? resposta : (resposta as { token?: string } | undefined)?.token;
        if (falha || !token) {
          const texto = falha?.message ?? '';
          reject(
            /client\s?id|invalid_client/i.test(texto)
              ? new ErroDeIntegracao(
                  'nao_configurado',
                  'O cliente OAuth do Google não bate com esta extensão (docs/integracoes-google-workspace.md).',
                )
              : new ErroDeIntegracao(
                  'sem_autorizacao',
                  'A conta do Google do CITi não está conectada, ou não concedeu estas permissões. Conecte em Conexões.',
                ),
          );
          return;
        }
        resolve(token);
      });
    } catch {
      reject(new ErroDeIntegracao('sem_autorizacao', 'O Chrome não conseguiu obter a autorização do Google.'));
    }
  });
}

/**
 * O Chrome devolve do cache mesmo um token revogado ou vencido; sem descartá-lo
 * um 401 viraria permanente.
 */
export function descartarToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.identity.removeCachedAuthToken({ token }, () => resolve());
    } catch {
      resolve();
    }
  });
}
