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
# 系統分類是每個資料庫都要有的資料（PRD FR-12）。可以重複執行、不會動使用者的資料，
# 所以每次啟動都跑也沒關係；要在 migrate 之後（資料表要先存在）。連線用 DATABASE_URL。
if [ "${RUN_SEED:-}" = "true" ]; then
  echo "[entrypoint] RUN_SEED=true: seeding system categories"
  node dist/seed/seed-categories.js
else
  echo "[entrypoint] RUN_SEED is not exactly true: skipping seed"
fi
exec node dist/main.js
