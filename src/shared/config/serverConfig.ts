/**
 * Endereço do servidor de geração de documento (fase 2 do "Continuar
 * fluxo") — projeto independente em `server/` na raiz do repo, ver o
 * README de lá. Só existe valor de dev por enquanto: produção entra junto
 * com o deploy real do servidor, numa fase futura.
 */
export const SERVER_BASE_URL = 'http://localhost:3000';

/**
 * Segredo compartilhado enviado no header `x-docciti-key`. O servidor
 * recusa 401 sem ele, porque agora existe uma chave de API paga atrás de
 * /api/generate e a rota não pode atender qualquer um que descubra a URL.
 *
 * ISTO NÃO É SEGREDO DE VERDADE e o valor padrão abaixo é público: ele vive
 * dentro do bundle da extensão, que qualquer pessoa consegue abrir. Serve
 * pra barrar uso acidental e varredura, não pra tratar o chamador como
 * confiável — a mesma limitação está documentada em server/lib/apiGuard.ts.
 *
 * Para um servidor que não seja o seu localhost, defina
 * `VITE_DOCCITI_SHARED_KEY` na build da extensão e `DOCCITI_SHARED_KEY` no
 * servidor, com o mesmo valor.
 */
export const SERVER_SHARED_KEY =
  import.meta.env.VITE_DOCCITI_SHARED_KEY ?? 'taqciti-dev-local';

/** Nome do header. Espelha SHARED_KEY_HEADER em server/lib/apiGuard.ts. */
export const SERVER_SHARED_KEY_HEADER = 'x-docciti-key';
