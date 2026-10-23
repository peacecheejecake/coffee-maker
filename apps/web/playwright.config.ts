import { defineConfig } from '@playwright/test';

const PORT = 5181;

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
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: 'chrome',
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
  },
});
