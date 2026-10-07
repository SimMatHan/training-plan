import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppUpdateProvider } from './lib/appUpdate';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppUpdateProvider>
      <App />
    </AppUpdateProvider>
  </StrictMode>,
);
