/**
 * Ata e Resumo contra o modelo de VERDADE — só roda com `ATA_LIVE=1`.
 *
 * Gasta chamadas ao provedor configurado (duas por documento: Leitor e
 * Auditor), então fica fora da suíte normal. A reunião é a SINTÉTICA de
 * `docs/fixtures/reuniao-longa-ruidosa.txt`, que tem gabarito: com chave de
 * free tier o conteúdo vai para treinamento do provedor, e nenhuma gravação
 * real pode passar por aqui.
 *
 *   ATA_LIVE=1 DOCUMENTOS_AMOSTRAS=<pasta> npx vitest run lib/documentos/ataResumo.live.test.ts
 *
 * Existe desde 28/10/2026, quando a Ata ganhou resumo executivo, atuação,
 * encaminhamentos e "em aberto", e o Resumo ganhou executivo e pontos de
 * atenção. O que se confere é o contrato do gabarito, não o estilo: decisão
 * revertida não volta, proposta não aceita não vira decisão nem ação, quem não
 * estava na reunião não é participante, cargo nunca dito não aparece, e o
 * "sobe o monitoramento até quarta" / "Pode deixar" vira encaminhamento do
 * Bruno. Com `DOCUMENTOS_AMOSTRAS`, grava o PDF e o `documentData` de cada um
 * — o JSON permite re-renderizar sem gastar cota (regra 9 do CLAUDE.md).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DocumentData } from '../documentData';

const AO_VIVO = process.env.ATA_LIVE === '1';

// A tranca da suíte (`vitest.setup.ts`) força o mock em todo teste. Este arquivo é a
// exceção DECLARADA, como `gerar.live.test.ts`: só com `ATA_LIVE=1` ela é suspensa,
// antes de qualquer import de `../ai` (por isso os imports abaixo são dinâmicos).
if (AO_VIVO) delete process.env.MOCK_LLM;

if (AO_VIVO && existsSync('.env.local')) {
  for (const linha of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(linha.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
  }
}

const REUNIAO = AO_VIVO ? readFileSync('docs/fixtures/reuniao-longa-ruidosa.txt', 'utf8') : '';

async function gerar(documentType: 'ata' | 'resumo') {
  const { generateStep } = await import('../generateStep');
  const { renderPdfDoCatalogo } = await import('./doCatalogo');
  const t0 = Date.now();
  const passo = await generateStep({
    transcript: REUNIAO,
    documentType,
    completed: [],
    answers: [],
    documentData: { metadata: { date: '16/08/2026' } },
  });
  const data = passo.documentData;
  const pdf = await renderPdfDoCatalogo({ documentType, data, tituloDaReuniao: 'Planejamento — Projeto Atlas (sintética)' });

  const pasta = process.env.DOCUMENTOS_AMOSTRAS;
  if (pasta) {
    mkdirSync(pasta, { recursive: true });
    writeFileSync(join(pasta, `ao-vivo-${documentType}.pdf`), pdf);
    writeFileSync(join(pasta, `ao-vivo-${documentType}.documentData.json`), JSON.stringify(data, null, 2));
    // O que caiu, e por quê: sem isto, um trecho que o Auditor derrubou some
    // do documento sem deixar rastro de que existiu.
    writeFileSync(join(pasta, `ao-vivo-${documentType}.descartes.json`), JSON.stringify(passo.report?.discarded ?? [], null, 2));
  }
  console.log(
    `\n[${documentType}] ${Date.now() - t0} ms; chamadas: ${passo.report?.calls}; descartes:`,
    JSON.stringify(passo.report?.discarded.map((d) => `${d.path}: ${d.reason}`), null, 2),
  );
  return { data, pdf };
}

/** O texto que o modelo ESCREVEU — sem as citações, que copiam a transcrição (e ela diz "oitenta mil" antes de corrigir). */
const textoTodo = (data: DocumentData) =>
  JSON.stringify(data, (chave, valor) => (chave === 'quotes' || chave === 'agreement' ? undefined : valor));

describe.skipIf(!AO_VIVO)('Ata e Resumo ao vivo (reunião sintética com gabarito)', { timeout: 300_000 }, () => {
  it('Ata: resumo executivo, encaminhamentos com dono dito e nada que o gabarito proíbe', async () => {
    const { data, pdf } = await gerar('ata');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

    // O resumo executivo existe e cada frase sobreviveu sozinha.
    expect(data.executiveSummary?.length ?? 0).toBeGreaterThan(0);

    // Armadilhas 1 e 3: decisão revertida e proposta não aceita.
    const decisoes = (data.decisions ?? []).map((d) => d.text).join(' | ');
    expect(decisoes).not.toMatch(/kubernetes|cubernetes/i);
    expect(decisoes).not.toMatch(/^(?!.*n[ãa]o).*contratar (dois )?estagi/im);

    // Nem como ação: o que não foi aceito não vira encaminhamento.
    const acoes = data.actionItems ?? [];
    expect(acoes.map((a) => a.acao).join(' | ')).not.toMatch(/kubernetes|abrir a vaga/i);

    // Armadilha 2: ordem aceita com prazo. Se o dono ou o prazo saírem, é a
    // guarda conferindo — mas a ação do monitoramento tem de estar lá.
    const monitoramento = acoes.find((a) => /monitoramento/i.test(a.acao));
    expect(monitoramento, 'a ação do monitoramento').toBeDefined();
    if (monitoramento?.responsavel) expect(monitoramento.responsavel).toMatch(/Bruno/);
    if (monitoramento?.prazo) expect(monitoramento.prazo).toMatch(/quarta/i);

    // Marcelo é do cliente e não participou; só o Rafael teve cargo dito.
    const nomes = (data.participants ?? []).map((p) => p.name);
    expect(nomes.join(' ')).not.toMatch(/Marcelo/);
    for (const p of data.participants ?? []) {
      if (!/Rafael/.test(p.name)) expect(p.role, `cargo de ${p.name}`).toBeUndefined();
    }

    // O gabarito lista quatro pendências ao fim (homologação, carga, LGPD,
    // impacto do adiamento). Nenhuma sobreviver é o Auditor derrubando pendência
    // como se fosse fato — o defeito da primeira rodada ao vivo.
    expect(data.openPoints?.length ?? 0, 'em aberto').toBeGreaterThan(1);

    // Armadilha 5: o orçamento é 180 mil.
    expect(textoTodo(data)).not.toMatch(/(?<!cento e )oitenta mil|\b80 mil/i);
  });

  it('Resumo: executivo, trechos e pontos de atenção, sem número não acordado', async () => {
    const { data, pdf } = await gerar('resumo');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(data.executiveSummary?.length ?? 0).toBeGreaterThan(0);
    expect(data.periods?.length ?? 0).toBeGreaterThan(1);
    // Armadilha 4: a divergência de carga não pode virar número acordado.
    expect(textoTodo(data)).not.toMatch(/suporta (500|200)/i);
  });
});
