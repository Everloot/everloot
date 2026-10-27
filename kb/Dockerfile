FROM node:22.23.2-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
# The record contract is the built @everloot/protocol package, installed from the folder (kb/.npmrc).
COPY packages/protocol/package.json packages/protocol/package-lock.json /app/packages/protocol/
COPY packages/protocol/dist /app/packages/protocol/dist
COPY packages/protocol/schema /app/packages/protocol/schema
WORKDIR /app/kb
COPY kb/package.json kb/package-lock.json kb/.npmrc ./
RUN npm ci
COPY kb/src ./src
COPY kb/tsconfig.json ./
COPY kb/changes/builds.json ./changes/builds.json
# The committed game-file layer kb/src/{client-layer,world-map}-file.ts import from the site.
COPY web/src/data/game-data/map.json web/src/data/game-data/client-layer.json /app/web/src/data/game-data/
COPY web/src/data/game-data/talents /app/web/src/data/game-data/talents
COPY web/src/lib/talents /app/web/src/lib/talents
RUN ln -s /app/kb/node_modules /app/node_modules
RUN npm run typecheck

FROM node:22.23.2-bookworm-slim
WORKDIR /app/kb
COPY --from=builder /app/kb ./
COPY --from=builder /app/packages /app/packages
COPY --from=builder /app/web /app/web
RUN ln -s /app/kb/node_modules /app/node_modules
# Only the approved knowledge release is included, never contributor uploads.
COPY kb/data/release/2026-10-05-everloot-public.sqlite /data/release/everloot-public.sqlite
COPY kb/data/release/2026-10-05-everloot-public.sqlite.manifest.json /data/release/everloot-public.sqlite.manifest.json
ENV NODE_ENV=production PORT=8787 KB_SNAPSHOT_PATH=/data/release/everloot-public.sqlite
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import=tsx", "src/mcp-http-main.ts"]
