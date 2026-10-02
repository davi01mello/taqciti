/**
 * Provedor FALSO — o que roda quando nenhuma chamada pode sair da máquina.
 *
 * ── Por que ele é um provedor de verdade ─────────────────────────────────
 *
 * Porque a alternativa é pior. Um mock injetado só nos testes deixa o caminho
 * de produção — resolução de agente, montagem do prompt, validação de schema,
 * reparo, contabilidade de uso — sem cobertura nenhuma; o que os testes
 * exercitariam seria o dublê. Aqui o mock entra pela MESMA porta
 * (`resolveAgent` → `provider.complete`), atravessa o MESMO `runCompletion`, e
 * o que ele substitui é só o último centímetro: o POST.
 *
 * ── O que ele responde ───────────────────────────────────────────────────
 *
 * Três camadas, nesta ordem:
 *
 *  1. uma resposta REGISTRADA para o caso, quando o teste registrou uma
 *     (`registrarResposta`) — é como se escreve o caso interessante;
 *  2. com `jsonSchema`, um objeto DERIVADO DO SCHEMA, que valida por
 *     construção. É o que faz o pipeline inteiro rodar sem ninguém escrever
 *     fixture à mão para cada agente;
 *  3. sem schema, um texto determinístico que ecoa o pedido.
 *
 * Determinismo é requisito, não conveniência: a mesma requisição devolve
 * sempre a mesma resposta, e nada aqui sorteia número nem lê relógio. Um mock
 * que variasse produziria teste que passa em três de cada quatro execuções.
 *
 * ── O que ele NÃO finge ──────────────────────────────────────────────────
 *
 * Qualidade. As respostas têm a FORMA certa e conteúdo evidentemente
 * artificial — prefixadas por `[mock]` no texto livre. Um mock que devolvesse
 * prosa plausível faria uma demonstração parecer um produto funcionando, que é
 * exatamente o que o painel de simulação da extensão evita com a faixa âmbar.
 */
import {
  type Capability,
  type CompletionRequest,
  type CompletionResult,
  type JsonSchema,
  type Provider,
} from '../types';
import { runCompletion } from './shared';

export interface ChamadaDoMock {
  model: string;
  req: CompletionRequest;
}

/** Uma resposta combinada: devolvida quando o predicado casa com a chamada. */
export interface RespostaRegistrada {
  quando: (chamada: ChamadaDoMock) => boolean;
  texto: string;
}

const chamadas: ChamadaDoMock[] = [];
const registradas: RespostaRegistrada[] = [];

/** Tudo que passou pelo mock desde o último `limparMock()`. */
export function chamadasDoMock(): readonly ChamadaDoMock[] {
  return chamadas;
}

/**
 * Combina uma resposta. A ÚLTIMA registrada que casa vence, para um teste
 * poder sobrescrever o que o `beforeEach` registrou sem desfazê-lo.
 */
export function registrarResposta(
  quando: (chamada: ChamadaDoMock) => boolean,
  texto: string,
): void {
  registradas.push({ quando, texto });
}

/** Zera histórico e combinações. Todo teste que usa o mock chama isto. */
export function limparMock(): void {
  chamadas.length = 0;
  registradas.length = 0;
}

// ---------------------------------------------------------------------------
// Valor derivado do schema
// ---------------------------------------------------------------------------

/**
 * Um número estável a partir de um texto. É o que dá variedade às respostas
 * (nem todo campo vira "texto") sem introduzir sorteio: a mesma chave produz
 * sempre o mesmo valor, nesta execução e na próxima.
 */
function semente(chave: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < chave.length; i += 1) {
    h ^= chave.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return Math.abs(h);
}

/**
 * Constrói um valor que satisfaz o schema.
 *
 * Só o subconjunto que esta camada usa (ver `JsonSchema` em types.ts). O que
 * não for reconhecido vira `null`, e o `parseAndValidate` de `runCompletion`
 * reprova — que é o comportamento certo: um mock que devolvesse algo inválido
 * em silêncio esconderia um schema que o provedor real também não atenderia.
 */
export function valorParaSchema(schema: JsonSchema, chave = 'raiz'): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[semente(chave) % schema.enum.length];
  }

  switch (schema.type) {
    case 'object': {
      const objeto: Record<string, unknown> = {};
      const propriedades = schema.properties ?? {};
      /*
       * Só o que é `required`. Preencher também os opcionais faria o mock
       * devolver mais do que o contrato garante, e um consumidor que passasse
       * a depender disso quebraria contra o provedor real.
       */
      const obrigatorias = schema.required ?? Object.keys(propriedades);
      for (const nome of obrigatorias) {
        const sub = propriedades[nome];
        if (sub) objeto[nome] = valorParaSchema(sub, `${chave}.${nome}`);
      }
      return objeto;
    }
    case 'array': {
      if (!schema.items) return [];
      // Dois itens: um só esconderia erro de laço, e três não acrescentam nada.
      return [
        valorParaSchema(schema.items, `${chave}[0]`),
        valorParaSchema(schema.items, `${chave}[1]`),
      ];
    }
    case 'string':
      return `[mock] ${chave}`;
    case 'number':
      return (semente(chave) % 1000) / 10;
    case 'integer':
      return semente(chave) % 100;
    case 'boolean':
      return semente(chave) % 2 === 0;
    case 'null':
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// O provedor
// ---------------------------------------------------------------------------

/** Uso plausível, derivado do tamanho do texto. ~4 caracteres por token. */
function usoEstimado(entrada: string, saida: string) {
  return {
    inputTokens: Math.ceil(entrada.length / 4),
    outputTokens: Math.ceil(saida.length / 4),
  };
}

export const mockProvider: Provider = {
  id: 'mock',

  supports(capability: Capability): boolean {
    switch (capability) {
      case 'structuredOutput':
        // Verdadeiro no sentido do contrato: a resposta sai já na forma do
        // schema, sem instrução injetada no prompt. É o que mantém o caminho
        // de código igual ao dos provedores que têm a nativa.
        return true;
      case 'contextCache':
      case 'extendedThinking':
        return false;
    }
  },

  maxContextTokens(): number {
    // Grande o bastante para nunca ser o motivo de um teste janelar.
    return 1_000_000;
  },

  async complete(model: string, req: CompletionRequest): Promise<CompletionResult> {
    const chamada: ChamadaDoMock = { model, req };
    chamadas.push(chamada);

    return runCompletion('mock', model, req, { nativeStructuredOutput: true }, async (invocation) => {
      const combinada = [...registradas].reverse().find((r) => r.quando(chamada));
      const entrada = invocation.system + invocation.messages.map((m) => m.content).join('');

      if (combinada) {
        return { text: combinada.texto, usage: usoEstimado(entrada, combinada.texto) };
      }

      if (invocation.jsonSchema) {
        const texto = JSON.stringify(valorParaSchema(invocation.jsonSchema), null, 2);
        return { text: texto, usage: usoEstimado(entrada, texto) };
      }

      const ultima = invocation.messages[invocation.messages.length - 1]?.content ?? '';
      const texto = `[mock] resposta de ${model} para: ${ultima.slice(0, 120)}`;
      return { text: texto, usage: usoEstimado(entrada, texto) };
    });
  },
};
