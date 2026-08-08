import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/shared/config/global.css';
import { DocumentPage } from './DocumentPage';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <DocumentPage />
  </React.StrictMode>,
);
