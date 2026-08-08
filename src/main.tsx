import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import WebV3SettingsApp from './web/WebV3SettingsApp.tsx';
import './index.css';

const isWebV3SettingsRoute = window.location.pathname === '/settings' || window.location.pathname.startsWith('/settings/');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isWebV3SettingsRoute ? <WebV3SettingsApp /> : <App />}
  </StrictMode>,
);
