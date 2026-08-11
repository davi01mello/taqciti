import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/shared/config/global.css';
import { PlatformProvider } from '@/shared/platform/context';
import { extensionPlatform } from '@/shared/platform/extension';
import { DocumentPage } from './DocumentPage';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <PlatformProvider platform={extensionPlatform}>
      <DocumentPage />
    </PlatformProvider>
  </React.StrictMode>,
);
