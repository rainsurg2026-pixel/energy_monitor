import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import './index.css';

const DesktopApp = lazy(() => import('./App.tsx'));
const CleanWebApp = lazy(() => import('./web-clean-v1/CleanWebApp.tsx'));
const webRuntime = window.location.protocol === 'http:' || window.location.protocol === 'https:';
const path = window.location.pathname.replace(/\/+$/, '') || '/';
void path;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<main className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center">Loading…</main>}>
      {webRuntime ? <CleanWebApp /> : <DesktopApp />}
    </Suspense>
  </StrictMode>,
);
