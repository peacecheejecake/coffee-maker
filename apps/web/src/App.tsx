import { lazy, Suspense } from 'react';
import { Home } from './Home';

// The sandbox (and leva) never ship in production builds.
const Sandbox = import.meta.env.DEV ? lazy(() => import('./sandbox/Sandbox').then((m) => ({ default: m.Sandbox }))) : null;

export function App() {
  if (Sandbox && location.pathname.startsWith('/sandbox')) {
    return (
      <Suspense fallback={null}>
        <Sandbox />
      </Suspense>
    );
  }
  return <Home />;
}
