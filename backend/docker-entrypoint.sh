#!/bin/sh
set -eu
# DEBUG=* 會讓 Prisma 印出含密碼的連線字串
unset DEBUG
# Render 只設 DATABASE_URL；migrate 用的 DIRECT_URL 沒設就用同一條
export DIRECT_URL="${DIRECT_URL:-${DATABASE_URL:-}}"
if [ "${RUN_MIGRATIONS:-}" = "true" ]; then
  echo "[entrypoint] RUN_MIGRATIONS=true: running prisma migrate deploy"
  npm run db:deploy
else
  echo "[entrypoint] RUN_MIGRATIONS is not exactly true: skipping migrations"
fi
echo "CI 驗證用：故意讓容器啟動失敗"; exit 1
exec node dist/main.js
