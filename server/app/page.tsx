export default function HomePage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>TaqCITi — servidor de geração de documento</h1>
      <p>
        Este servidor não tem interface própria. A única rota é{' '}
        <code>POST /api/generate</code> — ver <code>README.md</code>.
      </p>
    </main>
  );
}
