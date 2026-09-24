/**
 * Prova de fogo: pipeline INTEIRO (Pensante → Auditor → Escritor → render)
 * contra a API de verdade, com uma reunião hipotética desenhada pra pisar em
 * todas as armadilhas que o produto promete não cair.
 *
 * Fora do `npm test`: gasta token e depende de rede. Roda com
 *   $env:PROVA_DE_FOGO="C:\...\saida"; npx vitest run lib/_scratch_prova_de_fogo.test.ts
 *
 * A transcrição é SINTÉTICA — obrigatório, porque a chave configurada é de
 * free tier e manda o conteúdo pro treinamento do provedor.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateDocument } from './generateDocument';

/** Vitest não lê `.env.local` (isso é do Next). Carrega à mão. */
function loadEnvLocal(): void {
  const path = join(process.cwd(), '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (value!.trim() && !process.env[key!]) process.env[key!] = value!.trim();
  }
}
loadEnvLocal();

const DESTINO = process.env.PROVA_DE_FOGO;

/**
 * As armadilhas, e o que cada uma testa:
 *
 *  1. "acho que a gente devia adiar"  → PROPOSTA, não decisão. O Auditor tem
 *     que rejeitar. Mais adiante o adiamento é BATIDO de verdade — essa sim.
 *  2. o cancelamento do piloto é decidido e depois REVOGADO na mesma reunião.
 *     Só a revogação vale.
 *  3. Rafael fala o tempo todo e NINGUÉM diz o cargo dele → tem que virar
 *     lacuna, não um cargo inventado.
 *  4. "o cliente falou que são 40 mil usuários" é FALA DE TERCEIRO relatada,
 *     não fato apurado na reunião.
 *  5. "semana que vem" e "lá pro fim do mês" não são data → não pode virar
 *     uma data concreta em lugar nenhum.
 *  6. ruído, hesitação, gente se atropelando.
 *  7. acentuação pesada — "gestão", "integração", "manutenção", "adoção" —
 *     porque já houve modelo devolvendo "gesto" no lugar de "gestão".
 *  8. "<200ms", "Alpha & Beta" e aspas dentro de citação → escape de HTML.
 *  9. transcrição longa o bastante pra o documento passar de uma página, o
 *     que exercita marca de cabeçalho e rodapé na página 2.
 */
const TRANSCRICAO = `
[00:00] Larissa Fontes (Gerente de Projetos): Bom dia, gente. Vamos começar. Hoje é 19 de agosto de 2026, reunião de acompanhamento do Projeto Meridiano com a Alpha & Beta Logística.
[00:12] Larissa Fontes: Rápido roteiro: status da integração, o problema de performance, e o que a gente faz com o piloto. Rafael, você começa?
[00:20] Rafael Duarte: Bom. Então… é… deixa eu ver. A integração com o ERP da Alpha & Beta está de pé desde quinta. O que travou foi a parte de autenticação, que eles mudaram sem avisar.
[00:38] Camila Vasques (Arquiteta de Soluções): Mudaram o fluxo de token. A documentação que eles mandaram estava desatualizada em quatro endpoints.
[00:47] Rafael Duarte: Quatro não, três. O quarto a gente descobriu que já estava assim antes.
[00:52] Camila Vasques: Três, então. Isso custou uns dois dias.
[01:03] Larissa Fontes: Dois dias de atraso na integração. Anota aí.
[01:08] Bruno Sales (Analista de Dados): Posso falar da carga? A gente rodou o teste de carga na terça. Com mil requisições por segundo o tempo de resposta ficou abaixo de <200ms, que é o acordado. Acima disso degrada.
[01:24] Camila Vasques: Degrada quanto?
[01:26] Bruno Sales: Sobe pra uns 900ms. Mas a gente não sabe ainda se é o banco ou se é a fila.
[01:33] Camila Vasques: Aham.
[01:35] Bruno Sales: Eu diria que é o banco, mas é palpite. Não medi.
[01:40] Larissa Fontes: Então fica registrado como não determinado. A gente não vai escrever palpite em ata.
[01:47] Rafael Duarte: Sobre o cronograma. Acho que a gente devia adiar a entrega. Do jeito que está não fecha.
[01:55] Larissa Fontes: Adiar pra quando?
[01:57] Rafael Duarte: Sei lá, semana que vem? Lá pro fim do mês, talvez.
[02:02] Camila Vasques: Se for pra adiar, tem que ser com data. Senão adia de novo.
[02:08] Larissa Fontes: Concordo. Deixa eu ver o calendário… Então tá. Fica assim: entrega remarcada para 04 de setembro de 2026. Batido o martelo.
[02:20] Rafael Duarte: Fechado.
[02:21] Camila Vasques: De acordo.
[02:24] Larissa Fontes: Próximo ponto. O piloto com a segunda cliente, a Nordeste Varejo.
[02:31] Bruno Sales: Aquilo não vai andar. A gestão deles trocou e o novo time não respondeu nenhum e-mail em três semanas.
[02:40] Larissa Fontes: Então a gente cancela o piloto da Nordeste Varejo. Decidido.
[02:45] Camila Vasques: Espera. Espera. Antes de cancelar — eu falei com a Priscila de lá ontem à noite.
[02:52] Larissa Fontes: E?
[02:54] Camila Vasques: Ela pediu duas semanas. Disse que a diretoria nova quer o projeto, só está travada em contrato.
[03:03] Larissa Fontes: Hm. Então esquece o que eu falei, não vamos cancelar. A gente segura o piloto da Nordeste Varejo por duas semanas e reavalia. Isso substitui o cancelamento.
[03:14] Bruno Sales: Ok.
[03:15] Rafael Duarte: Ok, mas alguém precisa cobrar o contrato.
[03:19] Larissa Fontes: A Camila cobra. Camila, você fica de ponte com a Priscila.
[03:24] Camila Vasques: Fico.
[03:27] Larissa Fontes: Última coisa. Adoção.
[03:31] Rafael Duarte: O cliente falou que são 40 mil usuários ativos na base deles. A Alpha & Beta que disse, na reunião de kickoff.
[03:41] Larissa Fontes: A gente nunca conferiu esse número, né?
[03:44] Rafael Duarte: Nunca. É o que eles falaram.
[03:47] Larissa Fontes: Então não é nosso número. Se entrar em algum lugar, entra como "segundo a Alpha & Beta".
[03:55] Camila Vasques: Sobre manutenção — a gente combinou janela de manutenção na madrugada de domingo?
[04:03] Larissa Fontes: Combinamos na reunião passada, isso não mudou.
[04:08] Camila Vasques: Só confirmando.
[04:11] Bruno Sales: Ah, uma coisa. O relatório de performance eu mando hoje ainda.
[04:17] Larissa Fontes: Manda. E a Camila manda a lista dos três endpoints que mudaram, pra gente ter registro.
[04:24] Camila Vasques: Mando.
[04:27] Larissa Fontes: Resumindo: entrega em 04 de setembro, piloto da Nordeste segurado por duas semanas, e a gente investiga a degradação acima de mil requisições por segundo antes da entrega. Todo mundo de acordo?
[04:41] Rafael Duarte: De acordo.
[04:42] Camila Vasques: De acordo.
[04:43] Bruno Sales: De acordo.
[04:45] Larissa Fontes: Fechado. Obrigada, gente.
`.trim();

describe.skipIf(!DESTINO)('prova de fogo — pipeline completo', () => {
  it(
    'gera a Ata do Projeto Meridiano e grava PDF, HTML e o JSON canônico',
    { timeout: 20 * 60 * 1000 },
    async () => {
      const resultado = await generateDocument({
        transcript: TRANSCRICAO,
        title: 'Projeto Meridiano',
        documentType: 'ata',
      });

      writeFileSync(`${DESTINO}.html`, resultado.html, 'utf8');
      writeFileSync(`${DESTINO}.md`, resultado.content, 'utf8');
      writeFileSync(
        `${DESTINO}.json`,
        JSON.stringify(
          {
            title: resultado.title,
            documentData: resultado.documentData,
            gaps: resultado.gaps,
            questions: resultado.questions,
          },
          null,
          2,
        ),
        'utf8',
      );
      expect(resultado.pdf).toBeTruthy();
      writeFileSync(`${DESTINO}.pdf`, Buffer.from(resultado.pdf!, 'base64'));

      console.log('\n===== DOCUMENT DATA =====');
      console.log(JSON.stringify(resultado.documentData, null, 2));
      console.log('\n===== LACUNAS =====');
      console.log(JSON.stringify(resultado.gaps, null, 2));
      console.log('\n===== ARQUIVOS =====', `${DESTINO}.pdf`);
    },
  );
});
