FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
# 只複製 npm ci 需要的檔案（postinstall 的 prisma generate 要 schema）；新增 migration 不會讓這層快取失效
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/
RUN npm ci
# 新版 npm 若擋下 prisma 的安裝腳本，build 不會失敗、要到 migrate 才壞，所以在這裡先確認
RUN ls node_modules/@prisma/engines/schema-engine-* > /dev/null
COPY . .
# Windows 工作目錄裡的檔案可能是 CRLF
RUN sed -i 's/\r$//' docker-entrypoint.sh
RUN npm run build && npm prune --omit=dev

FROM node:24.22.1-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production TZ=UTC NPM_CONFIG_UPDATE_NOTIFIER=false PRISMA_HIDE_UPDATE_MESSAGE=1 CHECKPOINT_DISABLE=1
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# prisma/ 底下的 .env 已由 .dockerignore 的 **/.env 排除
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts /app/package.json /app/docker-entrypoint.sh ./
USER node
EXPOSE 3001
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
