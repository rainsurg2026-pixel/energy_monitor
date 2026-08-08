import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import './index.css';

const DesktopApp = lazy(() => import('./App.tsx'));
const WebV3SettingsApp = lazy(() => import('./web/WebV3SettingsApp.tsx'));
const WebV3App = lazy(() => import('./web/WebV3App.tsx'));
const webRuntime = window.location.protocol === 'http:' || window.location.protocol === 'https:';
const path = window.location.pathname.replace(/\/+$/, '') || '/';
const isWebV3SettingsRoute = webRuntime && (path === '/settings' || path.startsWith('/settings/'));
const isWebV3ReadRoute = webRuntime && new Set(['/','/login','/dashboard','/energy','/cost','/electrical','/site-comparison','/racks','/rack-units']).has(path);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<main className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center">Loading…</main>}>
      {isWebV3SettingsRoute ? <WebV3SettingsApp /> : isWebV3ReadRoute ? <WebV3App /> : <DesktopApp />}
    </Suspense>
  </StrictMode>,
);
