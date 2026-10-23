#!/usr/bin/env node
/**
 * Builds the web app and deploys it to Vercel as a prebuilt static site (Build Output API v3), so Vercel never
 * has to install this pnpm workspace itself. Production env comes from apps/web/.env.production.local, which
 * Vite loads for `vite build`.
 *
 *   node scripts/deploy-web.mjs           # preview deployment
 *   node scripts/deploy-web.mjs --prod    # production
 *
 * The first run asks which Vercel project to link (stored in .vercel/, gitignored).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const VERCEL = 'vercel@65.2.0';
const prod = process.argv.includes('--prod');
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

run('pnpm', ['--filter', '@coffee/web', 'build']);

const out = '.vercel/output';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('apps/web/dist', `${out}/static`, { recursive: true });
writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        // The service worker must be revalidated on every load or updates never reach installed clients.
        { src: '/sw\\.js', headers: { 'cache-control': 'no-cache' }, continue: true },
        { src: '/assets/(.*)', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        { src: '/\\.well-known/apple-app-site-association', headers: { 'content-type': 'application/json' }, continue: true },
        { handle: 'filesystem' },
        // Client-side routes such as /join/<code>.
        { src: '/(.*)', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);

run('npx', ['--yes', VERCEL, 'deploy', '--prebuilt', ...(prod ? ['--prod'] : []), '--yes']);
