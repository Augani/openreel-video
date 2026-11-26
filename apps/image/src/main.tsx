import React from 'react';
import ReactDOM from 'react-dom/client';
import { initLanguage } from '@openreel/i18n';
import App from './App';
import './index.css';

initLanguage();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
