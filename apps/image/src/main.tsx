import React from 'react';
import ReactDOM from 'react-dom/client';
import { initLanguage } from '@openreel/i18n';
import { loadDictionary } from '@openreel/i18n/translate';
import App from './App';
import './index.css';

initLanguage();
void loadDictionary();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
