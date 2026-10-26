#!/bin/sh
set -eu
# DEBUG=* 會讓 Prisma 印出含密碼的連線字串
unset DEBUG
if [ "${RUN_MIGRATIONS:-}" = "true" ]; then
  # DATABASE_URL 在 Render 上是 transaction 模式，不能拿來跑 migrate
  if [ -z "${DIRECT_URL:-}" ]; then
    echo "[entrypoint] RUN_MIGRATIONS=true but DIRECT_URL is not set" >&2
    exit 1
  fi
  echo "[entrypoint] RUN_MIGRATIONS=true: running prisma migrate deploy"
  npm run db:deploy
else
  echo "[entrypoint] RUN_MIGRATIONS is not exactly true: skipping migrations"
fi
exec node dist/main.js
