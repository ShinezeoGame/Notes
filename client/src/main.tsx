import React from 'react';
import { createRoot } from 'react-dom/client';
import '@blocknote/mantine/style.css';
import './styles.css';
import App from './App';
import { startPwa } from './lib/pwa';

startPwa();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
