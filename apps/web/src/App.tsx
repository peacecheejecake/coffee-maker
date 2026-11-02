import { JoinScreen, useUi } from '@coffee/ui';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Home, TvHome } from './Home';
import { onNativeNotice } from './native';

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
  // Native sign-in failures (reported by the deep-link handler, outside React).
  const { toast } = useUi();
  useEffect(() => onNativeNotice((message) => toast(message, 'error')), [toast]);
  // Web: a failed Google sign-in comes back with the reason in the query; say so instead of quietly staying out.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const failure = params.get('error_description') ?? params.get('error');
    if (!failure) return;
    toast(failure, 'error');
    history.replaceState(null, '', location.pathname);
  }, [toast]);
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
