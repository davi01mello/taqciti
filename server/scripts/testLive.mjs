/**
 * Roda a suíte COM os testes de rede ligados.
 *
 * Existe porque definir variável de ambiente dentro de um script do
 * package.json não é portátil entre shells, e instalar `cross-env` só para
 * isso seria uma dependência a mais no servidor. Dez linhas resolvem.
 */
import { spawn } from 'node:child_process';

// Comando como string única, e não `spawn(cmd, args, {shell:true})`: com
// `shell: true` o Node deprecou a forma com array, porque os argumentos são
// concatenados sem escapar.
const child = spawn(['npx', 'vitest', 'run', ...process.argv.slice(2)].join(' '), {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DOCCITI_LIVE_TESTS: '1' },
});

child.on('exit', (code) => process.exit(code ?? 1));
