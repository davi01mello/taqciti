/**
 * Adaptador de TURNO com ferramentas para o Gemini (`@google/genai` 2.16).
 *
 * Um turno é uma chamada `models.generateContent`. As ferramentas vão como
 * `functionDeclarations` com `parametersJsonSchema` — JSON Schema de verdade,
 * aceito pela família 3.x e pela 2.5 nesta versão do SDK —, em modo `AUTO`: o
 * modelo decide se responde ou se pede ferramenta.
 *
 * ── A assinatura do raciocínio ──────────────────────────────────────────────
 *
 * Nos modelos com raciocínio, a parte `functionCall` vem acompanhada de um
 * `thoughtSignature` opaco, e o turno seguinte PRECISA devolvê-lo intacto, senão
 * o provedor recusa ou perde o fio. Por isso a resposta leva `continuacao`: as
 * partes do modelo, serializadas, que a extensão devolve sem ler. O raciocínio
 * em si não vem em texto (não pedimos `includeThoughts`), e a assinatura é
 * cifrada — nada disso é registrado em lugar nenhum.
 *
 * ── Ids das chamadas ────────────────────────────────────────────────────────
 *
 * O Gemini nem sempre numera `functionCall.id`. Quando falta, o adaptador cria
 * um (`g:<n>`) para a extensão casar resultado com chamada, e o omite na volta —
 * mandar ao provedor um id que ele não emitiu seria inventar protocolo.
 */
import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  ThinkingLevel,
  type Content,
  type GenerateContentConfig,
  type Part,
} from '@google/genai';
import { asOverloaded, asRateLimit } from '@/lib/ai/providers/google';
import { ProviderError } from '@/lib/ai/types';
import type {
  ChamadaDeFerramenta,
  DeclaracaoDeFerramenta,
  MensagemDoTurno,
  RespostaDoTurno,
} from './contrato';

export interface PedidoAoAdaptador {
  sistema: string;
  contexto: string;
  mensagens: MensagemDoTurno[];
  ferramentas: DeclaracaoDeFerramenta[];
  maxTokensDeSaida: number;
}

export type SaidaDoAdaptador = Omit<RespostaDoTurno, 'instrucoesVersao' | 'latenciaMs'>;

export interface AdaptadorDeTurno {
  provedor: string;
  executar(modelo: string, pedido: PedidoAoAdaptador, sinal?: AbortSignal): Promise<SaidaDoAdaptador>;
}

/** O pedaço do cliente que o adaptador usa — injetável nos testes. */
export interface ClienteGemini {
  models: {
    generateContent(params: {
      model: string;
      contents: Content[];
      config: GenerateContentConfig;
    }): Promise<{
      candidates?: Array<{ content?: { parts?: Part[] }; finishReason?: string }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
        cachedContentTokenCount?: number;
      };
    }>;
  };
}

const ID_GERADO = 'g:';

/** Partes que podem voltar numa `continuacao` — o resto é recusado. */
const CHAVES_DE_PARTE = new Set(['text', 'functionCall', 'thoughtSignature', 'thought']);

function partesDaContinuacao(bruto: string): Part[] {
  let partes: unknown;
  try {
    partes = JSON.parse(bruto);
  } catch {
    throw new ErroDeConversao('continuacao não é JSON.');
  }
  if (!Array.isArray(partes)) throw new ErroDeConversao('continuacao precisa ser uma lista.');
  for (const parte of partes) {
    if (!parte || typeof parte !== 'object') throw new ErroDeConversao('parte inválida.');
    for (const chave of Object.keys(parte)) {
      if (!CHAVES_DE_PARTE.has(chave)) {
        throw new ErroDeConversao(`continuacao traz um campo não aceito: ${chave}.`);
      }
    }
  }
  return partes as Part[];
}

export class ErroDeConversao extends Error {}

/** O provedor passou do `timeout` da chamada. Não é repetido: repetir dobraria a espera. */
export class ErroDeLentidao extends Error {
  constructor(modelo: string) {
    super(`O provedor (${modelo}) não respondeu a tempo.`);
    this.name = 'ErroDeLentidao';
  }
}

/** Converte o histórico neutro no formato do Gemini. Exportado para teste. */
export function paraConteudos(contexto: string, mensagens: MensagemDoTurno[]): Content[] {
  const conteudos: Content[] = [];
  let contextoPendente = contexto.trim();

  for (const m of mensagens) {
    if (m.papel === 'pessoa') {
      const partes: Part[] = [];
      // O contexto entra na PRIMEIRA mensagem da pessoa, como parte própria e
      // rotulada como dado. No sistema ele se misturaria às instruções.
      if (contextoPendente) {
        partes.push({ text: contextoPendente });
        contextoPendente = '';
      }
      partes.push({ text: m.texto });
      conteudos.push({ role: 'user', parts: partes });
    } else if (m.papel === 'modelo') {
      const partes: Part[] = m.continuacao
        ? partesDaContinuacao(m.continuacao)
        : [
            ...(m.texto ? [{ text: m.texto }] : []),
            ...m.chamadas.map<Part>((c) => ({
              functionCall: {
                name: c.nome,
                args: c.argumentos,
                ...(c.id.startsWith(ID_GERADO) ? {} : { id: c.id }),
              },
            })),
          ];
      if (partes.length) conteudos.push({ role: 'model', parts: partes });
    } else {
      conteudos.push({
        role: 'user',
        parts: m.resultados.map<Part>((r) => ({
          functionResponse: {
            name: r.nome,
            response: r.conteudo,
            ...(r.chamadaId.startsWith(ID_GERADO) ? {} : { id: r.chamadaId }),
          },
        })),
      });
    }
  }
  return conteudos;
}

function familia3(modelo: string): boolean {
  return !modelo.startsWith('gemini-2.');
}

export function criarAdaptadorGemini(cliente: () => ClienteGemini): AdaptadorDeTurno {
  return {
    provedor: 'google',

    async executar(modelo, pedido, sinal) {
      const config: GenerateContentConfig = {
        systemInstruction: pedido.sistema,
        maxOutputTokens: pedido.maxTokensDeSaida,
        // Raciocínio BAIXO: o orquestrador decide qual ferramenta chamar e
        // redige a resposta; o trabalho pesado é ler, e ler é das ferramentas.
        ...(familia3(modelo)
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : { thinkingConfig: { thinkingBudget: -1 } }),
        ...(pedido.ferramentas.length
          ? {
              tools: [
                {
                  functionDeclarations: pedido.ferramentas.map((f) => ({
                    name: f.nome,
                    description: f.descricao,
                    parametersJsonSchema: f.parametros,
                  })),
                },
              ],
              toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
            }
          : {}),
        ...(sinal ? { abortSignal: sinal } : {}),
      };

      let resposta;
      try {
        resposta = await cliente().models.generateContent({
          model: modelo,
          contents: paraConteudos(pedido.contexto, pedido.mensagens),
          config,
        });
      } catch (error) {
        if (error instanceof ProviderError || error instanceof ErroDeConversao) throw error;
        // Abortado sem o sinal de quem pediu = o `timeout` do cliente venceu.
        if (!sinal?.aborted && /aborted|timeout/i.test((error as Error)?.message ?? '')) {
          throw new ErroDeLentidao(modelo);
        }
        const cota = asRateLimit(modelo, error);
        if (cota) throw cota;
        const sobrecarga = asOverloaded(modelo, error);
        if (sobrecarga) throw sobrecarga;
        throw new ProviderError('google', modelo, (error as Error).message ?? 'falha', error);
      }

      const candidato = resposta.candidates?.[0];
      const partes = candidato?.content?.parts ?? [];
      const texto = partes
        .filter((p) => typeof p.text === 'string' && !p.thought)
        .map((p) => p.text)
        .join('');

      let gerados = 0;
      const chamadas: ChamadaDeFerramenta[] = partes
        .filter((p) => p.functionCall?.name)
        .map((p) => ({
          id: p.functionCall!.id || `${ID_GERADO}${++gerados}`,
          nome: p.functionCall!.name!,
          argumentos: (p.functionCall!.args ?? {}) as Record<string, unknown>,
        }));

      const motivo = candidato?.finishReason ?? 'desconhecido';
      if (!texto && chamadas.length === 0) {
        throw new ProviderError('google', modelo, `resposta vazia (finishReason: ${motivo}).`);
      }

      // Só o que precisa voltar: texto, chamadas e as assinaturas. Partes de
      // raciocínio sem assinatura não têm função no turno seguinte.
      const paraVoltar = partes
        .filter((p) => !(p.thought && !p.thoughtSignature))
        .map((p) => {
          const parte: Part = {};
          if (p.text !== undefined && !p.thought) parte.text = p.text;
          if (p.functionCall) parte.functionCall = p.functionCall;
          if (p.thoughtSignature) parte.thoughtSignature = p.thoughtSignature;
          return parte;
        })
        .filter((p) => Object.keys(p).length > 0);

      const uso = resposta.usageMetadata;
      return {
        tipo: chamadas.length ? 'ferramentas' : motivo === 'MAX_TOKENS' ? 'truncado' : 'final',
        texto,
        chamadas,
        ...(paraVoltar.length ? { continuacao: JSON.stringify(paraVoltar) } : {}),
        uso: {
          entrada: uso?.promptTokenCount ?? 0,
          // Raciocínio é cobrado como saída — ver `providers/google.ts`.
          saida: (uso?.candidatesTokenCount ?? 0) + (uso?.thoughtsTokenCount ?? 0),
          ...(uso?.cachedContentTokenCount ? { cache: uso.cachedContentTokenCount } : {}),
        },
        provedor: 'google',
        modelo,
      };
    },
  };
}

let clienteReal: GoogleGenAI | undefined;

/** O adaptador de produção. A chave é lida só aqui, no servidor. */
export const adaptadorGemini = criarAdaptadorGemini(() => {
  if (!clienteReal) {
    const chave = process.env.GOOGLE_API_KEY?.trim();
    if (!chave) throw new ProviderError('google', '(sem modelo)', 'GOOGLE_API_KEY não está definida.');
    // `attempts: 1`: o SDK repete sozinho até 5 vezes, com espera, por padrão.
    // Medido ao vivo: uma chamada ficou ~100 s presa nessas tentativas
    // invisíveis e a execução estourou o tempo. Quem repete é o runtime da
    // extensão — no máximo duas vezes, contado e dentro do prazo. E o
    // `timeout` corta a chamada antes do `maxDuration` da rota.
    clienteReal = new GoogleGenAI({
      apiKey: chave,
      httpOptions: { retryOptions: { attempts: 1 }, timeout: 50_000 },
    });
  }
  return clienteReal as unknown as ClienteGemini;
});
