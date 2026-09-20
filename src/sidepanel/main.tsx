/**
 * Ponto de entrada da sidebar. Mesmo formato das outras superfícies: a
 * plataforma de extensão entra por provider, e nenhuma tela toca `chrome.*`
 * direto.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/shared/config/global.css';
import './sidepanel.css';
import { PlatformProvider } from '@/shared/platform/context';
import { extensionPlatform } from '@/shared/platform/extension';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <PlatformProvider platform={extensionPlatform}>
      <App />
    </PlatformProvider>
  </React.StrictMode>,
);
