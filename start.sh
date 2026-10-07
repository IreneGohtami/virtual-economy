#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

echo "SEA Commodity Tycoon - Local Startup"
echo "========================================"

# 1. PostgreSQL
echo "Starting PostgreSQL..."
brew services start postgresql@14 2>/dev/null || true
sleep 2
if ! pg_isready -q; then
  echo "ERROR: PostgreSQL failed to start."
  exit 1
fi
echo "OK: PostgreSQL running"

# 2. Redis
echo "Checking Redis..."
if ! redis-cli ping > /dev/null 2>&1; then
  brew services start redis 2>/dev/null || redis-server --daemonize yes
  sleep 1
fi
echo "OK: Redis running"

# 3. Database
createdb sea_commodity_tycoon 2>/dev/null || true
echo "OK: Database ready"

# 4. Install
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# 5. Build
echo "Building..."
rm -f apps/api/tsconfig.tsbuildinfo packages/*/tsconfig.tsbuildinfo
pnpm turbo run build --filter=@sea-commodity-tycoon/shared-types --filter=@sea-commodity-tycoon/game-rules --filter=@sea-commodity-tycoon/config --filter=@sea-commodity-tycoon/ui --force
(cd apps/api && npx tsc)
echo "OK: Build complete"

# 6. Start services
echo ""
echo "Starting services..."
echo "  API:     http://localhost:3000"
echo "  Swagger: http://localhost:3000/api/docs"
echo "  Web UI:  http://localhost:3001"
echo "  Worker:  Background job processor"
echo ""

# Start API (watch mode - auto-restarts on source changes)
(cd "$ROOT_DIR/apps/api" && pnpm run dev:watch) &
API_PID=$!
sleep 4

# Start Worker (background job processor)
(cd "$ROOT_DIR/apps/worker" && pnpm run dev) &
WORKER_PID=$!

# Start Web
(cd "$ROOT_DIR/apps/web" && rm -rf .next && npx next dev -p 3001) &
WEB_PID=$!

cleanup() {
  echo ""
  echo "Shutting down..."
  kill $API_PID $WEB_PID $WORKER_PID 2>/dev/null
  wait $API_PID $WEB_PID $WORKER_PID 2>/dev/null
  exit 0
}
trap cleanup INT TERM

echo ""
echo "Ready! Register via Swagger at http://localhost:3000/api/docs"
echo '  POST /api/auth/register'
echo '  Body: {"email":"you@test.com","password":"pass123","displayName":"Player1"}'
echo ""
echo "Press Ctrl+C to stop."
wait
