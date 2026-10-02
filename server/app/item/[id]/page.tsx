/**
 * A página para onde uma citação do ChatGPT aponta.
 *
 * ── Por que ela existe ───────────────────────────────────────────────────
 *
 * O ChatGPT exige um `url` em cada resultado de `search` e em cada `fetch`,
 * e o usa para CITAR a fonte na resposta. Um item do acervo não é uma página
 * pública, então a saída fácil seria mandar qualquer URL — e a consequência
 * seria uma citação clicável levando a um 404. Esta página é a alternativa
 * honesta: existe, diz o que aquilo é, e não mostra nada.
 *
 * ── Por que ela não mostra o conteúdo, e nem poderia ─────────────────────
 *
 * Não há autenticação aqui. Uma citação é um link que sai da conversa e pode
 * ir parar em qualquer lugar — num print, num relatório, num canal. Se esta
 * página lesse o acervo, o `id` viraria uma credencial acidental, e o acervo
 * inteiro ficaria a um `id` adivinhado de distância.
 *
 * Então ela não consulta o banco. O `id` aparece na tela só para a pessoa
 * saber de qual item a citação falava, e ele não é segredo — é `reuniao:` e
 * um identificador local, sem conteúdo dentro.
 */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Item do acervo — TaqCiti',
  // Uma citação pode ser colada em qualquer lugar. Não há motivo para esta
  // página entrar em índice de busca.
  robots: { index: false, follow: false },
};

export default async function ItemDoAcervo({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const legivel = decodeURIComponent(id);
  const [tipo] = legivel.split(':');

  const nomeDoTipo =
    { reuniao: 'uma reunião', documento: 'um documento', conversa: 'uma conversa', nota: 'uma nota' }[
      tipo ?? ''
    ] ?? 'um item';

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '32px',
        background: 'rgb(24 25 27)',
        color: 'rgb(226 228 231)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 520, lineHeight: 1.75 }}>
        <h1 style={{ fontSize: 22, fontWeight: 550, margin: '0 0 16px' }}>
          Item do acervo do TaqCiti
        </h1>
        <p style={{ color: 'rgb(174 177 181)', fontSize: 14, margin: '0 0 14px' }}>
          Esta citação aponta para {nomeDoTipo} guardada no acervo privado de alguém do
          CITi. O conteúdo não é público e não pode ser aberto por aqui — ele vive na
          extensão do TaqCiti, no navegador de quem o capturou.
        </p>
        <p style={{ color: 'rgb(174 177 181)', fontSize: 14, margin: '0 0 22px' }}>
          Se o acervo é seu, abra a extensão para ver o item inteiro.
        </p>
        <code
          style={{
            display: 'inline-block',
            fontSize: 12.5,
            color: 'rgb(150 153 157)',
            background: 'rgb(255 255 255 / 0.05)',
            border: '1px solid rgb(255 255 255 / 0.08)',
            borderRadius: 8,
            padding: '7px 11px',
          }}
        >
          {legivel}
        </code>
      </div>
    </main>
  );
}
