#!/bin/sh
# Vercel build. With DATABASE_URL: migrate that database. Without it: demo mode, build the
# embedded mock database snapshot (about 100 s) that ships with the app.
set -e
npx prisma generate
if [ -n "$DATABASE_URL" ] && [ "$SENTINEL_MOCK" != "1" ]; then
  npx prisma migrate deploy
else
  node scripts/build-mock-db.mjs
fi
npx next build
