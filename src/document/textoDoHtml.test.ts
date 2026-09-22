import { expect, it } from 'vitest';
import { textoDoHtml } from './textoDoHtml';

it('preserva respostas renderizadas e separação de parágrafos no editor de texto', () => {
  expect(
    textoDoHtml(
      '<html><head><style>p{color:red}</style></head><body><h1>Ata</h1><p>Responsável: Ana</p><p>Prazo: sexta</p></body></html>',
    ),
  ).toBe('Ata\nResponsável: Ana\nPrazo: sexta');
});
