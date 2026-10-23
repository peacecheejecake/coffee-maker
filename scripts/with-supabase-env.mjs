#!/usr/bin/env node
// Runs a command with SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY taken from the
// running local Supabase (`pnpm supabase start`). Usage: node scripts/with-supabase-env.mjs <cmd...>
import { execSync, spawnSync } from 'node:child_process';

let status;
try {
  status = execSync('pnpm exec supabase status -o env', { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
} catch {
  console.error('Local Supabase is not running. Start it with: pnpm supabase start');
  process.exit(1);
}
const get = (k) => new RegExp(`^${k}="?([^"\\n]+)"?$`, 'm').exec(status)?.[1] ?? '';
const env = {
  ...process.env,
  SUPABASE_URL: get('API_URL'),
  SUPABASE_ANON_KEY: get('ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: get('SERVICE_ROLE_KEY'),
};
const [cmd, ...args] = process.argv.slice(2);
const result = spawnSync(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
