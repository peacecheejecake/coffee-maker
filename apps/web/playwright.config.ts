import { execSync } from 'node:child_process';
import { defineConfig } from '@playwright/test';

const LOCAL_PORT = 5181;
const SYNC_PORT = 5182;
const PWA_PORT = 5183;

/** Local Supabase connection, if `pnpm supabase start` is running. Sync tests are skipped otherwise. */
function localSupabase(): { url: string; anonKey: string } | null {
  try {
    const out = execSync('pnpm exec supabase status -o env', { cwd: '../..', stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const get = (k: string) => new RegExp(`^${k}="?([^"\\n]+)"?$`, 'm').exec(out)?.[1];
    const url = get('API_URL');
    const anonKey = get('ANON_KEY');
    return url && anonKey ? { url, anonKey } : null;
  } catch {
    return null;
  }
}

const supabase = localSupabase();
const chrome = {
  channel: 'chrome',
  viewport: { width: 1280, height: 800 },
  launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
};

/**
 * Local visual checks against the installed Chrome (no browser download). WebGL runs on SwiftShader so
 * screenshots do not depend on the GPU; baselines are per-platform (Playwright suffixes them).
 */
export default defineConfig({
  testDir: 'e2e',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{platform}{ext}',
  timeout: 60_000,
  // The first run after a dependency change waits for Vite's pre-bundling.
  retries: 1,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  // Idle decoration (steam, wisps, sway) is irrelevant to most flows and heavy under software rendering;
  // tests that are about motion opt back in with test.use({ contextOptions: { reducedMotion: 'no-preference' } }).
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure', contextOptions: { reducedMotion: 'reduce' } },
  projects: [
    { name: 'local', testIgnore: ['sync/**', 'pwa/**'], use: { ...chrome, baseURL: `http://127.0.0.1:${LOCAL_PORT}` } },
    // Production build + preview: service worker, manifest, offline.
    { name: 'pwa', testMatch: 'pwa/**/*.spec.ts', use: { ...chrome, baseURL: `http://127.0.0.1:${PWA_PORT}` } },
    ...(supabase
      ? [
          {
            name: 'sync',
            testMatch: 'sync/**/*.spec.ts',
            // Each test drives up to three browsers; running them one at a time keeps SwiftShader responsive.
            fullyParallel: false,
            workers: 1,
            use: { ...chrome, baseURL: `http://127.0.0.1:${SYNC_PORT}` },
          },
        ]
      : []),
  ],
  webServer: [
    {
      command: `pnpm exec vite build && pnpm exec vite preview --port ${PWA_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${PWA_PORT}`,
      reuseExistingServer: true,
      timeout: 180_000,
      env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
    },
    {
      command: `pnpm exec vite --port ${LOCAL_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${LOCAL_PORT}`,
      reuseExistingServer: true,
      // Make sure an .env.local with Supabase settings cannot leak into the local-only project.
      env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
    },
    ...(supabase
      ? [
          {
            command: `pnpm exec vite --port ${SYNC_PORT} --strictPort --host 127.0.0.1`,
            url: `http://127.0.0.1:${SYNC_PORT}`,
            reuseExistingServer: true,
            env: { VITE_SUPABASE_URL: supabase.url, VITE_SUPABASE_ANON_KEY: supabase.anonKey },
          },
        ]
      : []),
  ],
});
