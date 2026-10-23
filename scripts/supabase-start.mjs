#!/usr/bin/env node
// Starts the local Supabase stack. With supabase/functions/.env.local present (scripts/push-e2e-setup.sh),
// its values become the edge runtime's secrets (config.toml [edge_runtime.secrets]) and the edge runtime
// runs the notify function; without it, the edge runtime is left out like in CI.
// Usage: node scripts/supabase-start.mjs   (stop first with `pnpm supabase stop` to pick up changes)
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ENV_FILE = 'supabase/functions/.env.local';
const skip = ['studio', 'imgproxy', 'logflare', 'vector', 'supavisor', 'mailpit', 'postgres-meta'];
if (existsSync(ENV_FILE)) {
  // Keeps escaped "\n" in PEM values as is; the function unescapes them (a shell `source` would not).
  process.loadEnvFile(ENV_FILE);
  console.log(`edge runtime secrets from ${ENV_FILE}`);
} else {
  skip.push('edge-runtime');
}
const result = spawnSync('pnpm', ['exec', 'supabase', 'start', '-x', skip.join(',')], { stdio: 'inherit' });
process.exit(result.status ?? 1);
