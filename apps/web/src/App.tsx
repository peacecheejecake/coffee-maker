import { JoinScreen } from '@coffee/ui';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Home, TvHome } from './Home';

// The sandbox (and leva) never ship in production builds.
const Sandbox = import.meta.env.DEV ? lazy(() => import('./sandbox/Sandbox').then((m) => ({ default: m.Sandbox }))) : null;

const joinCode = (path: string) => /^\/join\/([A-Za-z0-9]+)\/?$/.exec(path)?.[1] ?? null;

export function App() {
  const [path, setPath] = useState(location.pathname);
  // Deep links in the native shell navigate via history + popstate.
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  const goHome = useCallback(() => {
    history.replaceState(null, '', '/');
    setPath('/');
  }, []);

  if (Sandbox && path.startsWith('/sandbox')) {
    return (
      <Suspense fallback={null}>
        <Sandbox />
      </Suspense>
    );
  }
  const code = joinCode(path);
  if (code) return <JoinScreen code={code} onDone={goHome} />;
  if (path.startsWith('/tv')) return <TvHome />;
  return <Home autoDemo={path.startsWith('/demo')} />;
}
