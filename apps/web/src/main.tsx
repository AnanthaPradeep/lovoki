import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter, createHashRouter } from 'react-router-dom';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/figtree';
import { toCssVariables } from '@lovoki/tokens';
import './styles.css';
import { appConfig } from './config';
import { AppSkeleton, ToastProvider } from './ui';
import { ConfigError } from './screens/ConfigError';

// Tokens are emitted from the shared package, so every surface reads the same values.
const style = document.createElement('style');
style.id = 'lovoki-tokens';
style.textContent = toCssVariables();
document.head.prepend(style);

// Dev-only: `vite --mode uitest` swaps Supabase for in-memory fakes so the real-mode UI can be driven in a browser.
// Under any other mode this constant is null and the whole branch (and the fakes harness) is removed from the bundle.
// Each data mode is its own lazily loaded root: real mode never loads the demo store or sample people,
// and demo mode never loads the Supabase client.
const DemoApp = lazy(() => import('./App').then((m) => ({ default: m.DemoApp })));
const RealApp = lazy(() => import('./RealApp').then((m) => ({ default: m.RealApp })));

const UiTest = import.meta.env.MODE === 'uitest' ? lazy(() => import('./uitest').then((m) => ({ default: m.UiTestApp }))) : null;

function Root() {
  if (UiTest) return <ToastProvider><Suspense fallback={<AppSkeleton />}><UiTest /></Suspense></ToastProvider>;
  if (appConfig.mode === 'error') return <ConfigError problems={appConfig.problems} />;
  return <ToastProvider><Suspense fallback={<AppSkeleton />}>{appConfig.mode === 'supabase' ? <RealApp cfg={appConfig} /> : <DemoApp />}</Suspense></ToastProvider>;
}

// A data router is required for the unsaved-changes blocker. The single-file preview uses hash URLs because it has no server.
const make = import.meta.env.MODE === 'single' ? createHashRouter : createBrowserRouter;
const router = make([{ path: '*', element: <Root /> }]);

createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
