/**
 * A bandeira que separa a build de desenvolvimento da build publicada.
 *
 * ── Por que não `import.meta.env.DEV` ────────────────────────────────────
 *
 * Porque ele não responde o que parece responder. `vite build` roda com
 * `NODE_ENV=production` e `import.meta.env.DEV` sai `false` mesmo com
 * `--mode development` — medido aqui: as duas builds produziram chunks com o
 * MESMO hash, ou seja, o ramo de desenvolvimento não existia em nenhuma das
 * duas. Um andaime que some silenciosamente da build em que ele deveria estar
 * é pior do que não ter andaime: a pessoa carrega a extensão e conclui que a
 * funcionalidade não foi feita.
 *
 * `__TAQCITI_DEV__` é substituída por `true` ou `false` literal em tempo de
 * build (ver `define` em vite.config.ts), a partir do `--mode`. Como é
 * literal, o bundler elimina o ramo inteiro quando é `false`: o painel de
 * simulação e a população de demonstração não ficam escondidos atrás de uma
 * condição — deixam de ser emitidos.
 */
declare const __TAQCITI_DEV__: boolean;
