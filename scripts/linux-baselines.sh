#!/usr/bin/env bash
# Records the @visual screenshot baselines for Linux inside the same Playwright image CI uses, so the
# CI "visual" job compares like with like. Needs Docker. Usage: scripts/linux-baselines.sh [--check]
set -euo pipefail
IMAGE=mcr.microsoft.com/playwright:v1.56.1-noble
MODE=${1:---update}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
FLAG=$([ "$MODE" = "--check" ] && echo "" || echo "--update-snapshots=all")

docker run --rm \
  -v "$ROOT":/src:ro \
  -v "$ROOT/apps/web/e2e/__screenshots__":/out \
  -w /work "$IMAGE" bash -lc "
    set -e
    tar -C /src --exclude=node_modules --exclude=.git --exclude=dist --exclude=test-results \
      --exclude=apps/mobile/ios --exclude=apps/mobile/android -cf - . | tar -xf -
    npm install -g pnpm@12.11.2 >/dev/null 2>&1
    pnpm install --frozen-lockfile >/dev/null
    cd apps/web
    npx playwright test --project=local --grep @visual --retries=0 $FLAG
    cp -r e2e/__screenshots__/. /out/
  "
