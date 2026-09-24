import type { ReactNode } from 'react';

export const metadata = {
  title: 'TaqCiti — Servidor de geração de documento',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
