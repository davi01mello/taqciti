/**
 * Sem test runner instalado em server/ ainda (nem vitest, nem jest) —
 * framework-agnóstico de propósito: roda direto com
 * `node lib/templates/templates.test.ts` hoje (Node 22+ stripa os tipos
 * nativamente), sai com código 1 se achar problema. Dá pra plugar num
 * `test()`/`it()` de verdade assim que um runner entrar em server/ —
 * `validateTemplates` já é uma função pura, importável como está.
 */
import { TEMPLATES } from './index';
import type { DocumentTemplate } from './types';

export function validateTemplates(templates: Record<string, DocumentTemplate>): string[] {
  const errors: string[] = [];
  for (const [documentType, template] of Object.entries(templates)) {
    const seenIds = new Set<string>();
    const seenOrders = new Set<number>();
    for (const section of template.sections) {
      if (seenIds.has(section.id)) {
        errors.push(`${documentType}: id de seção duplicado "${section.id}"`);
      }
      seenIds.add(section.id);

      if (seenOrders.has(section.order)) {
        errors.push(`${documentType}: order de seção repetido ${section.order}`);
      }
      seenOrders.add(section.order);
    }
  }
  return errors;
}

const errors = validateTemplates(TEMPLATES);
if (errors.length > 0) {
  console.error('FAIL — templates com id/order duplicado:');
  for (const error of errors) console.error(' -', error);
  process.exit(1);
}
console.log(
  `OK — ${Object.keys(TEMPLATES).length} templates válidos (ids e orders únicos por template).`,
);
