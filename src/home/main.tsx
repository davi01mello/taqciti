/**
 * Ponto de entrada da HOME. Mesmo formato de `src/document/main.tsx`: a
 * plataforma de extensão entra por provider, e nenhuma tela toca `chrome.*`
 * direto.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/shared/config/global.css';
import './home.css';
import { PlatformProvider } from '@/shared/platform/context';
import { extensionPlatform } from '@/shared/platform/extension';
import { HomePage } from './HomePage';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <PlatformProvider platform={extensionPlatform}>
      <HomePage />
    </PlatformProvider>
  </React.StrictMode>,
);
