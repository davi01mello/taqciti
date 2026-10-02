/**
 * A TRANCA: nenhum teste desta suíte chama provedor de verdade.
 *
 * ── Por que uma tranca, e não só disciplina ──────────────────────────────
 *
 * Porque o modo de falhar é caro e silencioso. Um teste que resolve o agente
 * pela configuração padrão e cai num provedor com chave presente no ambiente
 * gasta crédito, demora, e falha por rede — e nada disso se parece com "o teste
 * está errado". Quem roda a suíte pode ter `GOOGLE_API_KEY` exportada na
 * sessão por causa de outra coisa; a suíte não pode depender disso.
 *
 * `MOCK_LLM=true` é a precedência mais alta da camada (ver
 * `buildAgentConfig` em lib/ai/config.ts): com ela, TODO agente resolve para o
 * provedor `mock`, independentemente de chave, de `LLM_PROVIDER` e dos
 * overrides por agente.
 *
 * Isto roda ANTES de qualquer arquivo de teste importar qualquer módulo, que é
 * o que importa: `AGENT_CONFIG` é resolvida na importação, e definir a variável
 * dentro de um `beforeEach` chegaria tarde.
 *
 * ── O que ela não cobre ──────────────────────────────────────────────────
 *
 * Um teste que instancie um adaptador à mão e lhe dê um transporte de rede de
 * verdade. É por isso que `providers/openai.ts` recebe o `fetch` por parâmetro
 * e o teste dele prova, explicitamente, que o `fetch` global não é chamado.
 *
 * As chamadas reais vivem em `npm run test:live`, que é outro caminho.
 */
process.env.MOCK_LLM = 'true';
