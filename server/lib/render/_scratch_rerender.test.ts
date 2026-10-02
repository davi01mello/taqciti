import { readFileSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { renderPdf } from './pdf';
import { renderHtml } from './html';

const FONTE = process.env.RERENDER_JSON;

describe.skipIf(!FONTE)('re-render do documentData salvo', () => {
  it('regera PDF e HTML sem chamar a API', async () => {
    const salvo = JSON.parse(readFileSync(FONTE!, 'utf8'));
    const entrada = {
      documentType: 'ata' as const,
      data: salvo.documentData,
      gaps: salvo.gaps,
      title: salvo.title,
    };
    writeFileSync(`${FONTE!.replace(/\.json$/, '')}.pdf`, await renderPdf(entrada));
    writeFileSync(`${FONTE!.replace(/\.json$/, '')}.html`, renderHtml(entrada), 'utf8');
    console.log('regerado');
  });
});
