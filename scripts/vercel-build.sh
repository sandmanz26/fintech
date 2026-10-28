#!/bin/sh
# Vercel build (see vercel.json). Default: demo mode, so build the embedded mock database
# snapshot (about 100 s) that ships with the app; no settings or database needed.
# With SENTINEL_MODE=database (and DATABASE_URL, AUTH_SECRET): migrate that database instead.
set -e
npx prisma generate
if [ "$SENTINEL_MODE" = "database" ]; then
  npx prisma migrate deploy
else
  node scripts/build-mock-db.mjs
fi
node scripts/gen-api-registry.mjs --check
npx next build
