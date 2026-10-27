FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run check && pnpm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder --chown=node:node /app/build ./build
COPY --from=builder --chown=node:node /app/server.mjs /app/index.html /app/style.css ./
COPY --from=builder --chown=node:node /app/assets ./assets
ENV NODE_ENV=production HOST=0.0.0.0 PORT=17845
EXPOSE 17845
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
CMD ["node", "server.mjs"]
