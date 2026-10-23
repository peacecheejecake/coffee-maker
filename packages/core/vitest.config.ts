import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      include: ['src/**'],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
});
