/** Texto editável do HTML já renderizado, inclusive respostas aplicadas. */
export function textoDoHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,head').forEach((el) => el.remove());
  doc.querySelectorAll('br').forEach((el) => el.replaceWith('\n'));
  doc.querySelectorAll('td,th').forEach((el) => el.append('\t'));
  doc
    .querySelectorAll('p,div,section,article,h1,h2,h3,h4,li,tr')
    .forEach((el) => el.append('\n'));
  return (doc.body.textContent ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
